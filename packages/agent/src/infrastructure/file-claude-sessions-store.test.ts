import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileClaudeSessionsStore } from './file-claude-sessions-store';

let dir: string;

const write = (pid: string, entry: unknown) =>
  writeFile(join(dir, `${pid}.json`), JSON.stringify(entry), 'utf8');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-claude-sessions-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileClaudeSessionsStore', () => {
  it('returns an empty map when the directory is missing', async () => {
    const store = new FileClaudeSessionsStore(join(dir, 'absent'));
    expect(await store.addressesByTmuxSession()).toEqual({});
  });

  it('maps each session tmux name to its address', async () => {
    await write('12345', { name: 'foo-cc', tmux: 'perch-aaa111:@1.%1' });
    await write('23456', { name: 'perch-be', tmux: 'perch-bbb222:@2.%2' });
    expect(await new FileClaudeSessionsStore(dir).addressesByTmuxSession()).toEqual({
      'perch-aaa111': 'foo-cc',
      'perch-bbb222': 'perch-be',
    });
  });

  // The registry is written by another process while we read it, so a half-written or
  // hand-corrupted file must cost that one entry rather than every workspace's address.
  it('skips an unparseable file and keeps the rest', async () => {
    await write('12345', { name: 'foo-cc', tmux: 'perch-aaa111:@1.%1' });
    await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8');
    expect(await new FileClaudeSessionsStore(dir).addressesByTmuxSession()).toEqual({
      'perch-aaa111': 'foo-cc',
    });
  });

  it('skips an entry with no tmux session to join on', async () => {
    await write('12345', { name: 'foo-cc', tmux: 'perch-aaa111:@1.%1' });
    await write('900001', { name: 'ran-outside-tmux', cwd: '/home/x' });
    expect(await new FileClaudeSessionsStore(dir).addressesByTmuxSession()).toEqual({
      'perch-aaa111': 'foo-cc',
    });
  });

  // Only the per-session json files are entries; the directory also holds `.key` files.
  it('ignores files that are not json', async () => {
    await write('12345', { name: 'foo-cc', tmux: 'perch-aaa111:@1.%1' });
    await writeFile(join(dir, '12345.abc123.key'), 'secret', 'utf8');
    expect(await new FileClaudeSessionsStore(dir).addressesByTmuxSession()).toEqual({
      'perch-aaa111': 'foo-cc',
    });
  });
});
