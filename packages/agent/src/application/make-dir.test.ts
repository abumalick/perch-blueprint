import { describe, it, expect } from 'vitest';
import { makeDir } from './make-dir';

function fakeLister() {
  const made: string[] = [];
  return {
    made,
    lister: {
      browse: async () => ({ subdirs: [], files: [] }),
      makeDir: async (path: string) => {
        made.push(path);
      },
    },
  };
}

const roots = ['/home/u/workspace'];

describe('makeDir', () => {
  it('creates a folder inside an allowed root and returns its path', async () => {
    const { made, lister } = fakeLister();
    const created = await makeDir({ lister }, '/home/u/workspace/api', 'docs', roots);
    expect(created).toBe('/home/u/workspace/api/docs');
    expect(made).toEqual(['/home/u/workspace/api/docs']);
  });

  it('trims surrounding whitespace from the name', async () => {
    const { made, lister } = fakeLister();
    const created = await makeDir({ lister }, '/home/u/workspace', '  spaced  ', roots);
    expect(created).toBe('/home/u/workspace/spaced');
    expect(made).toEqual(['/home/u/workspace/spaced']);
  });

  it('rejects a path outside the allowed roots', async () => {
    const { made, lister } = fakeLister();
    await expect(makeDir({ lister }, '/etc', 'evil', roots)).rejects.toThrow();
    expect(made).toEqual([]);
  });

  it('rejects an empty or whitespace-only name', async () => {
    const { made, lister } = fakeLister();
    await expect(makeDir({ lister }, '/home/u/workspace', '   ', roots)).rejects.toThrow();
    expect(made).toEqual([]);
  });

  it('rejects a name containing a path separator', async () => {
    const { made, lister } = fakeLister();
    await expect(makeDir({ lister }, '/home/u/workspace', 'a/b', roots)).rejects.toThrow();
    expect(made).toEqual([]);
  });

  it('rejects a name that would traverse out of the parent', async () => {
    const { made, lister } = fakeLister();
    await expect(makeDir({ lister }, '/home/u/workspace', '..', roots)).rejects.toThrow();
    expect(made).toEqual([]);
  });
});
