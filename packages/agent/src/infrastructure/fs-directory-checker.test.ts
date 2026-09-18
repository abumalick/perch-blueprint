import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fsIsDirectory } from './fs-directory-checker';

describe('fsIsDirectory', () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'perch-dircheck-'));
    file = join(dir, 'a-file.txt');
    await writeFile(file, 'hi', 'utf8');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is true for an existing directory', async () => {
    expect(await fsIsDirectory(dir)).toBe(true);
  });

  it('is false for an existing file', async () => {
    expect(await fsIsDirectory(file)).toBe(false);
  });

  it('is false for a missing path', async () => {
    expect(await fsIsDirectory(join(dir, 'does-not-exist'))).toBe(false);
  });
});
