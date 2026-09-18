import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsFileWriter } from './fs-file-writer';

describe('FsFileWriter', () => {
  it('creates nested dirs, reports existence, and writes bytes', async () => {
    const base = await mkdtemp(join(tmpdir(), 'perch-fw-'));
    try {
      const w = new FsFileWriter();
      const dir = join(base, '.tmp', 'files');
      await w.ensureDir(dir);
      const path = join(dir, 'a.bin');
      expect(await w.exists(path)).toBe(false);
      await w.writeFile(path, new Uint8Array([1, 2, 3]));
      expect(await w.exists(path)).toBe(true);
      expect([...(await readFile(path))]).toEqual([1, 2, 3]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
