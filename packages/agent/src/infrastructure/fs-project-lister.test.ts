import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsProjectLister } from './fs-project-lister';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'perch-lister-'));
  await mkdir(join(root, 'alpha'));
  await mkdir(join(root, 'beta'));
  await writeFile(join(root, 'file.txt'), 'x');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FsProjectLister', () => {
  it('lists subdirectories and files as absolute paths, separated and sorted', async () => {
    const lister = new FsProjectLister();
    const result = await lister.browse(root);
    expect(result).toEqual({
      subdirs: [join(root, 'alpha'), join(root, 'beta')],
      files: [join(root, 'file.txt')],
    });
  });
});
