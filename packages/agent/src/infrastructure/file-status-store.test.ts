import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FileStatusStore } from './file-status-store';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-status-'));
  file = join(dir, 'nested', 'status.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileStatusStore', () => {
  it('returns undefined for any id when the file is missing', () => {
    const store = new FileStatusStore(file);
    expect(store.get('perch-foo')).toBeUndefined();
  });

  it('persists a set value across instances and creates the directory', () => {
    const store = new FileStatusStore(file);
    store.set('perch-foo', 'blocked');
    const reloaded = new FileStatusStore(file);
    expect(reloaded.get('perch-foo')).toBe('blocked');
  });

  it('loads pre-existing valid entries', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ 'perch-a': 'review', 'perch-b': 'working' }), 'utf8');
    const store = new FileStatusStore(file);
    expect(store.get('perch-a')).toBe('review');
    expect(store.get('perch-b')).toBe('working');
  });

  it('starts empty on a corrupt file without throwing', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, '{ not json', 'utf8');
    const store = new FileStatusStore(file);
    expect(store.get('perch-a')).toBeUndefined();
  });

  it('drops entries with an unknown status string', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ 'perch-a': 'busy', 'perch-b': 'idle' }), 'utf8');
    const store = new FileStatusStore(file);
    expect(store.get('perch-a')).toBeUndefined();
    expect(store.get('perch-b')).toBe('idle');
  });

  it('does not broadcast on a no-op set', () => {
    const store = new FileStatusStore(file);
    store.set('perch-a', 'working');
    let calls = 0;
    store.onChange(() => {
      calls++;
    });
    store.set('perch-a', 'working');
    expect(calls).toBe(0);
  });

  it('fires onChange with id and status on a real change', () => {
    const store = new FileStatusStore(file);
    const events: Array<[string, string]> = [];
    store.onChange((id, status) => events.push([id, status]));
    store.set('perch-a', 'finished');
    expect(events).toEqual([['perch-a', 'finished']]);
  });

  it('stamps and persists the change time from the clock, across instances', () => {
    let now = 1000;
    const store = new FileStatusStore(file, () => now);
    store.set('perch-a', 'working');
    expect(store.getChangedAt('perch-a')).toBe(1000);
    now = 2000;
    store.set('perch-a', 'working'); // no-op keeps the original stamp
    expect(store.getChangedAt('perch-a')).toBe(1000);

    const reloaded = new FileStatusStore(file, () => 9999);
    expect(reloaded.get('perch-a')).toBe('working');
    expect(reloaded.getChangedAt('perch-a')).toBe(1000);
  });

  it('migrates the legacy string format, preserving status with no change time', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ 'perch-a': 'review' }), 'utf8');
    const store = new FileStatusStore(file);
    expect(store.get('perch-a')).toBe('review');
    expect(store.getChangedAt('perch-a')).toBeUndefined();
  });

  it('defaults urgent to false and persists it across instances', () => {
    const store = new FileStatusStore(file);
    expect(store.getUrgent('perch-a')).toBe(false);
    store.setUrgent('perch-a', true);
    const reloaded = new FileStatusStore(file);
    expect(reloaded.getUrgent('perch-a')).toBe(true);
  });

  it('preserves urgent across a status change', () => {
    const store = new FileStatusStore(file);
    store.setUrgent('perch-a', true);
    store.set('perch-a', 'working');
    expect(store.getUrgent('perch-a')).toBe(true);
    const reloaded = new FileStatusStore(file);
    expect(reloaded.get('perch-a')).toBe('working');
    expect(reloaded.getUrgent('perch-a')).toBe(true);
  });

  it('does not re-stamp changedAt when pinning urgent', () => {
    let now = 1000;
    const store = new FileStatusStore(file, () => now);
    store.set('perch-a', 'working');
    now = 5000;
    store.setUrgent('perch-a', true);
    expect(store.getChangedAt('perch-a')).toBe(1000);
  });

  it('fires onChange on a real urgent change and stays silent on a no-op', () => {
    const store = new FileStatusStore(file);
    const events: Array<[string, string]> = [];
    store.onChange((id, status) => events.push([id, status]));
    store.setUrgent('perch-a', false); // no-op from default
    store.setUrgent('perch-a', true);
    store.setUrgent('perch-a', true); // no-op
    expect(events).toEqual([['perch-a', 'idle']]);
  });

  it('loads urgent from a pre-existing object entry; legacy string reads as not urgent', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ 'perch-a': { status: 'working', urgent: true }, 'perch-b': 'review' }),
      'utf8',
    );
    const store = new FileStatusStore(file);
    expect(store.getUrgent('perch-a')).toBe(true);
    expect(store.getUrgent('perch-b')).toBe(false);
  });

  it('prune drops entries not in the live set and persists', () => {
    const store = new FileStatusStore(file);
    store.set('perch-a', 'review');
    store.set('perch-b', 'blocked');
    store.prune(['perch-a']);
    expect(store.get('perch-a')).toBe('review');
    expect(store.get('perch-b')).toBeUndefined();
    const reloaded = new FileStatusStore(file);
    expect(reloaded.get('perch-b')).toBeUndefined();
    expect(reloaded.get('perch-a')).toBe('review');
  });

  it('returns undefined for claudeSessionId when never set', () => {
    const store = new FileStatusStore(file);
    expect(store.getClaudeSessionId('perch-a')).toBeUndefined();
  });

  it('persists claudeSessionId across instances', () => {
    const store = new FileStatusStore(file);
    store.setClaudeSessionId('perch-a', 'abc-123');
    const reloaded = new FileStatusStore(file);
    expect(reloaded.getClaudeSessionId('perch-a')).toBe('abc-123');
  });

  it('is idempotent: setting the same claudeSessionId twice keeps the value stable', () => {
    const store = new FileStatusStore(file);
    store.setClaudeSessionId('perch-a', 'abc-123');
    store.setClaudeSessionId('perch-a', 'abc-123');
    expect(store.getClaudeSessionId('perch-a')).toBe('abc-123');
  });

  it('preserves claudeSessionId across a status change and vice versa', () => {
    const store = new FileStatusStore(file);
    store.setClaudeSessionId('perch-a', 'abc-123');
    store.set('perch-a', 'working');
    expect(store.getClaudeSessionId('perch-a')).toBe('abc-123');
    store.setClaudeSessionId('perch-a', 'def-456');
    expect(store.get('perch-a')).toBe('working');
    expect(store.getClaudeSessionId('perch-a')).toBe('def-456');
  });

  it('does not fire onChange for a claudeSessionId update', () => {
    const store = new FileStatusStore(file);
    const events: Array<[string, string]> = [];
    store.onChange((id, status) => events.push([id, status]));
    store.setClaudeSessionId('perch-a', 'abc-123');
    expect(events).toEqual([]);
  });

  it('prune drops claudeSessionId along with the rest of a dead workspace entry', () => {
    const store = new FileStatusStore(file);
    store.setClaudeSessionId('perch-a', 'abc-123');
    store.prune([]);
    expect(store.getClaudeSessionId('perch-a')).toBeUndefined();
  });

  it('migrates a legacy "postponed" entry to "parked" on load', () => {
    const file = join(dir, 'status.json');
    writeFileSync(file, JSON.stringify({ 'perch-a': { status: 'postponed', changedAt: 5 } }), 'utf8');
    const store = new FileStatusStore(file);
    expect(store.get('perch-a')).toBe('parked');
    expect(store.getChangedAt('perch-a')).toBe(5);
  });

  it('migrates a legacy bare-string "postponed" entry', () => {
    const file = join(dir, 'status.json');
    writeFileSync(file, JSON.stringify({ 'perch-b': 'postponed' }), 'utf8');
    expect(new FileStatusStore(file).get('perch-b')).toBe('parked');
  });
});
