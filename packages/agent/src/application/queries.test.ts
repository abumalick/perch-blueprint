import { describe, it, expect } from 'vitest';
import { getRecentPaths } from './get-recent-paths';
import { browseDir } from './browse-dir';
import type { RecentStorePort } from '../ports/recent-store-port';
import type { ProjectListerPort } from '../ports/project-lister-port';

describe('getRecentPaths', () => {
  it('returns the recent store contents', async () => {
    const recent: RecentStorePort = { list: async () => ['/a', '/b'], record: async () => undefined };
    expect(await getRecentPaths({ recent, hidden: [] })).toEqual(['/a', '/b']);
  });

  it('drops paths under a hidden folder', async () => {
    const recent: RecentStorePort = {
      list: async () => ['/home/u/workspace/api', '/home/u/workspace/secret-proj/x'],
      record: async () => undefined,
    };
    expect(await getRecentPaths({ recent, hidden: ['secret-proj'] })).toEqual(['/home/u/workspace/api']);
  });
});

describe('browseDir', () => {
  it('lists a path that is within the allowed roots', async () => {
    let seen = '';
    const lister: ProjectListerPort = {
      browse: async (p) => {
        seen = p;
        return { subdirs: ['/p/a', '/p/b'], files: ['/p/f.txt'] };
      },
      makeDir: async () => undefined,
    };
    expect(await browseDir({ lister, hidden: [] }, '/p', ['/p'])).toEqual({
      subdirs: ['/p/a', '/p/b'],
      files: ['/p/f.txt'],
    });
    expect(seen).toBe('/p');
  });

  it('drops hidden subdirs from the listing but keeps files', async () => {
    const lister: ProjectListerPort = {
      browse: async () => ({ subdirs: ['/p/api', '/p/secret-proj'], files: ['/p/secret-proj.txt'] }),
      makeDir: async () => undefined,
    };
    expect(await browseDir({ lister, hidden: ['secret-proj'] }, '/p', ['/p'])).toEqual({
      subdirs: ['/p/api'],
      files: ['/p/secret-proj.txt'],
    });
  });

  it('rejects a path outside the allowed roots without listing', async () => {
    let listed = false;
    const lister: ProjectListerPort = {
      browse: async () => {
        listed = true;
        return { subdirs: [], files: [] };
      },
      makeDir: async () => undefined,
    };
    await expect(browseDir({ lister, hidden: [] }, '/etc', ['/p'])).rejects.toThrow();
    expect(listed).toBe(false);
  });
});
