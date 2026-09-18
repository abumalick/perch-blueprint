import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileParkedStore } from './file-parked-store';
import type { ParkedWorkspace } from '../ports/parked-store-port';

const entry = (id: string): ParkedWorkspace => ({
  id,
  name: 'Fix login redirect',
  projectPath: '/home/u/workspace/foo',
  command: 'claude --model opus',
  machineId: 'dev',
  createdAt: 100,
  parkedAt: 200,
  claudeSessionId: 'sess-1',
});

describe('FileParkedStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'perch-parked-'));
    file = join(dir, 'parked.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty list when the file is missing', async () => {
    expect(await new FileParkedStore(file).list()).toEqual([]);
  });

  it('returns an empty list when the file is malformed', async () => {
    writeFileSync(file, '{ not json', 'utf8');
    expect(await new FileParkedStore(file).list()).toEqual([]);
  });

  it('round-trips an added entry', async () => {
    const store = new FileParkedStore(file);
    await store.add(entry('perch-a'));
    expect(await store.get('perch-a')).toEqual(entry('perch-a'));
    expect(await store.list()).toEqual([entry('perch-a')]);
  });

  it('survives an agent restart', async () => {
    await new FileParkedStore(file).add(entry('perch-a'));
    // A fresh instance reads from disk — this is the case that reusing status.json
    // would have broken, since it prunes entries for sessions that no longer exist.
    expect(await new FileParkedStore(file).get('perch-a')).toEqual(entry('perch-a'));
  });

  it('replaces an existing entry with the same id rather than duplicating it', async () => {
    const store = new FileParkedStore(file);
    await store.add(entry('perch-a'));
    await store.add({ ...entry('perch-a'), parkedAt: 999 });
    const all = await store.list();
    expect(all).toHaveLength(1);
    const [first] = all;
    expect(first?.parkedAt).toBe(999);
  });

  it('removes an entry, and removing an unknown id is a no-op', async () => {
    const store = new FileParkedStore(file);
    await store.add(entry('perch-a'));
    await store.remove('perch-a');
    expect(await store.list()).toEqual([]);
    await expect(store.remove('perch-nope')).resolves.toBeUndefined();
  });

  it('drops entries that are missing required fields', async () => {
    writeFileSync(file, JSON.stringify([{ id: 'perch-a' }, entry('perch-b')]), 'utf8');
    const all = await new FileParkedStore(file).list();
    expect(all.map((w) => w.id)).toEqual(['perch-b']);
  });

  it('omits claudeSessionId when absent', async () => {
    const store = new FileParkedStore(file);
    const { claudeSessionId: _drop, ...noSession } = entry('perch-a');
    await store.add(noSession);
    expect((await store.get('perch-a'))?.claudeSessionId).toBeUndefined();
  });
});
