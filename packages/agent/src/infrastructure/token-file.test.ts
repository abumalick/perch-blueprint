import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAgentToken } from './token-file';

let home = '';
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

describe('writeAgentToken', () => {
  it('writes the token to <home>/.perch/token with 0600 perms', async () => {
    home = await mkdtemp(join(tmpdir(), 'perch-token-'));
    const path = await writeAgentToken(home, 'secret-123');
    expect(path).toBe(join(home, '.perch', 'token'));
    expect(await readFile(path, 'utf8')).toBe('secret-123');
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
