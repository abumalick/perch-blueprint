import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCommandsStore } from './file-commands-store';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-commands-'));
  file = join(dir, 'commands.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileCommandsStore', () => {
  it('returns an empty list when the file is missing', async () => {
    expect(await new FileCommandsStore(file).list()).toEqual([]);
  });

  it('reads the command entries in file order', async () => {
    await writeFile(
      file,
      JSON.stringify([{ command: '/myplugin:task' }, { command: '/rename', submit: true }]),
      'utf8',
    );
    expect(await new FileCommandsStore(file).list()).toEqual([
      { command: '/myplugin:task', submit: false },
      { command: '/rename', submit: true },
    ]);
  });

  it('drops unusable entries but keeps the rest', async () => {
    await writeFile(file, JSON.stringify([{ command: '/keep' }, { command: '' }, 'nope']), 'utf8');
    expect(await new FileCommandsStore(file).list()).toEqual([{ command: '/keep', submit: false }]);
  });

  it('returns an empty list for a non-array payload', async () => {
    await writeFile(file, JSON.stringify({ commands: [{ command: '/rename' }] }), 'utf8');
    expect(await new FileCommandsStore(file).list()).toEqual([]);
  });

  it('returns an empty list for malformed JSON', async () => {
    await writeFile(file, 'not json', 'utf8');
    expect(await new FileCommandsStore(file).list()).toEqual([]);
  });
});
