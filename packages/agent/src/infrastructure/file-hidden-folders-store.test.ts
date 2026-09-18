import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileHiddenFoldersStore } from './file-hidden-folders-store';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-hidden-'));
  file = join(dir, 'hidden-folders.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileHiddenFoldersStore', () => {
  it('returns an empty list when the file is missing', async () => {
    expect(await new FileHiddenFoldersStore(file).list()).toEqual([]);
  });

  it('reads the array of folder names', async () => {
    await writeFile(file, JSON.stringify(['secret-proj', 'archive', 'scratch']), 'utf8');
    expect(await new FileHiddenFoldersStore(file).list()).toEqual(['secret-proj', 'archive', 'scratch']);
  });

  it('ignores non-string and empty entries', async () => {
    await writeFile(file, JSON.stringify(['secret-proj', 42, '', null, 'scratch']), 'utf8');
    expect(await new FileHiddenFoldersStore(file).list()).toEqual(['secret-proj', 'scratch']);
  });

  it('returns an empty list for a non-array payload', async () => {
    await writeFile(file, JSON.stringify({ folders: ['secret-proj'] }), 'utf8');
    expect(await new FileHiddenFoldersStore(file).list()).toEqual([]);
  });

  it('returns an empty list for malformed JSON', async () => {
    await writeFile(file, 'not json', 'utf8');
    expect(await new FileHiddenFoldersStore(file).list()).toEqual([]);
  });
});
