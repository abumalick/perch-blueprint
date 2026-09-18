import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsFileReader } from './fs-file-reader';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'perch-reader-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FsFileReader', () => {
  it('reads a small file whole and reports not truncated', async () => {
    const p = join(root, 'a.txt');
    await writeFile(p, 'hello');
    const { bytes, truncated } = await new FsFileReader().read(p, 1024);
    expect(Buffer.from(bytes).toString('utf8')).toBe('hello');
    expect(truncated).toBe(false);
  });

  it('caps the read at maxBytes and reports truncated', async () => {
    const p = join(root, 'big.txt');
    await writeFile(p, 'abcdefghij');
    const { bytes, truncated } = await new FsFileReader().read(p, 4);
    expect(Buffer.from(bytes).toString('utf8')).toBe('abcd');
    expect(truncated).toBe(true);
  });

  it('reads an empty file as zero bytes, not truncated', async () => {
    const p = join(root, 'empty.txt');
    await writeFile(p, '');
    const { bytes, truncated } = await new FsFileReader().read(p, 1024);
    expect(bytes.length).toBe(0);
    expect(truncated).toBe(false);
  });
});
