import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileClientLogStore } from './file-client-log-store';
import type { ClientLogBatch } from '@perch/contracts';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-clientlog-'));
  file = join(dir, 'nested', 'client-log.jsonl');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const batch: ClientLogBatch = {
  ua: 'iPhone',
  shell: 'pwa',
  events: [
    { sess: 'A', seq: 0, t: 1, machineId: 'dev', kind: 'connect', online: true, vis: 'visible' },
    { sess: 'A', seq: 1, t: 2, machineId: 'dev', kind: 'close', code: 1006, online: true, vis: 'hidden' },
  ],
};

describe('FileClientLogStore', () => {
  it('writes one self-contained JSONL line per event and creates the directory', async () => {
    const store = new FileClientLogStore(file, () => 999);
    await store.append(batch);
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first).toMatchObject({ sess: 'A', seq: 0, kind: 'connect', ua: 'iPhone', shell: 'pwa', rt: 999 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ seq: 1, code: 1006 });
  });

  it('appends across calls without truncating', async () => {
    const store = new FileClientLogStore(file, () => 1);
    await store.append(batch);
    await store.append({ events: [{ sess: 'B', seq: 0, t: 5, kind: 'hidden', online: false, vis: 'hidden' }] });
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!)).toMatchObject({ sess: 'B', kind: 'hidden' });
  });
});
