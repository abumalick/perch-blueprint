import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FileRecentStore } from './file-recent-store';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-recent-'));
  file = join(dir, 'nested', 'recent.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileRecentStore', () => {
  it('returns an empty list when the file is missing', async () => {
    const store = new FileRecentStore(file);
    expect(await store.list()).toEqual([]);
  });

  it('records most-recent-first, de-duplicates, and creates the directory', async () => {
    const store = new FileRecentStore(file);
    await store.record('/a');
    await store.record('/b');
    await store.record('/a');
    expect(await store.list()).toEqual(['/a', '/b']);
  });

  it('caps the list length', async () => {
    const store = new FileRecentStore(file, 2);
    await store.record('/a');
    await store.record('/b');
    await store.record('/c');
    expect(await store.list()).toEqual(['/c', '/b']);
  });

  it('defaults the cap to 5', async () => {
    const store = new FileRecentStore(file);
    for (let i = 0; i < 6; i++) await store.record(`/p${i}`);
    expect(await store.list()).toHaveLength(5);
  });

  it('caps reads of a pre-existing oversized file at the cap', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(['/a', '/b', '/c', '/d', '/e', '/f', '/g']), 'utf8');
    const store = new FileRecentStore(file);
    expect(await store.list()).toEqual(['/a', '/b', '/c', '/d', '/e']);
  });
});
