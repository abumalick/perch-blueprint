import { describe, it, expect } from 'vitest';
import { projectFolderLabel, deriveProjectFolders, filterWorkspaces, pruneStaleFilter } from './project-folders';
import type { Workspace } from '@perch/contracts';
import type { MachineConfig } from './settings-store';

const ws = (over: Partial<Workspace> & Pick<Workspace, 'id' | 'machineId' | 'projectPath'>): Workspace => ({
  name: over.name ?? over.id,
  command: 'bash',
  createdAt: 0,
  lastActivityAt: 0,
  status: 'idle',
  ...over,
});

const machine = (id: string, defaultPath?: string): MachineConfig => ({
  id,
  name: id,
  url: `ws://${id}`,
  token: 't',
  defaultPath,
});

describe('projectFolderLabel', () => {
  it('shows the path relative to the machine default', () => {
    const machines = [machine('m', '/home/u/workspace')];
    expect(projectFolderLabel(machines, ws({ id: 'a', machineId: 'm', projectPath: '/home/u/workspace/perch' }))).toBe(
      'perch',
    );
    expect(projectFolderLabel(machines, ws({ id: 'b', machineId: 'm', projectPath: '/home/u/workspace/acme/web-app' }))).toBe(
      'acme/web-app',
    );
  });

  it('falls back to the full path when the machine has no default', () => {
    const machines = [machine('m')];
    expect(projectFolderLabel(machines, ws({ id: 'a', machineId: 'm', projectPath: '/srv/app' }))).toBe('/srv/app');
  });

  it('falls back to the full path when the machine is unknown', () => {
    expect(projectFolderLabel([], ws({ id: 'a', machineId: 'gone', projectPath: '/srv/app' }))).toBe('/srv/app');
  });
});

describe('deriveProjectFolders', () => {
  const machines = [machine('m', '/home/u/workspace')];
  const at = (id: string, rel: string) => ws({ id, machineId: 'm', projectPath: `/home/u/workspace/${rel}` });

  it('counts workspaces per folder and orders folders alphabetically, not by count', () => {
    const folders = deriveProjectFolders([at('1', 'perch'), at('2', 'perch'), at('3', 'foo')], machines);
    expect(folders).toEqual([
      { key: 'foo', label: 'foo', count: 1, depth: 0 },
      { key: 'perch', label: 'perch', count: 2, depth: 0 },
    ]);
  });

  it('sorts case-insensitively', () => {
    const folders = deriveProjectFolders([at('1', 'zeta'), at('2', 'Beta'), at('3', 'alpha')], machines);
    expect(folders.map((f) => f.key)).toEqual(['alpha', 'Beta', 'zeta']);
  });

  it('nests projects under a parent folder that branches, counting the whole subtree', () => {
    const folders = deriveProjectFolders(
      [at('1', 'bar/qux/qux-content'), at('2', 'bar/baz'), at('3', 'bar/baz'), at('4', 'foo')],
      machines,
    );
    expect(folders).toEqual([
      { key: 'bar', label: 'bar', count: 3, depth: 0 },
      { key: 'bar/baz', label: 'baz', count: 2, depth: 1 },
      { key: 'bar/qux/qux-content', label: 'qux/qux-content', count: 1, depth: 1 },
      { key: 'foo', label: 'foo', count: 1, depth: 0 },
    ]);
  });

  it('collapses a chain of single-child folders into one entry', () => {
    const folders = deriveProjectFolders([at('1', 'acme/web-app')], machines);
    expect(folders).toEqual([{ key: 'acme/web-app', label: 'acme/web-app', count: 1, depth: 0 }]);
  });

  it('keeps a folder that holds sessions itself as the parent of its subfolders', () => {
    const folders = deriveProjectFolders([at('1', 'perch'), at('2', 'perch/.tmp')], machines);
    expect(folders).toEqual([
      { key: 'perch', label: 'perch', count: 2, depth: 0 },
      { key: 'perch/.tmp', label: '.tmp', count: 1, depth: 1 },
    ]);
  });

  it('does not treat a shared name prefix as a parent folder', () => {
    const folders = deriveProjectFolders([at('1', 'app'), at('2', 'app-web')], machines);
    expect(folders.map((f) => [f.key, f.depth])).toEqual([
      ['app', 0],
      ['app-web', 0],
    ]);
  });

  it('merges the same relative path across machines into one folder', () => {
    const folders = deriveProjectFolders(
      [
        ws({ id: '1', machineId: 'm1', projectPath: '/home/u/workspace/perch' }),
        ws({ id: '2', machineId: 'm2', projectPath: '/Users/u/code/perch' }),
      ],
      [machine('m1', '/home/u/workspace'), machine('m2', '/Users/u/code')],
    );
    expect(folders).toEqual([{ key: 'perch', label: 'perch', count: 2, depth: 0 }]);
  });

  it('builds the tree from absolute paths when there is no default path', () => {
    const folders = deriveProjectFolders(
      [
        ws({ id: '1', machineId: 'm', projectPath: '/srv/api' }),
        ws({ id: '2', machineId: 'm', projectPath: '/srv/web' }),
      ],
      [machine('m')],
    );
    expect(folders).toEqual([
      { key: '/srv', label: '/srv', count: 2, depth: 0 },
      { key: '/srv/api', label: 'api', count: 1, depth: 1 },
      { key: '/srv/web', label: 'web', count: 1, depth: 1 },
    ]);
  });

  it('returns an empty list for no workspaces', () => {
    expect(deriveProjectFolders([], machines)).toEqual([]);
  });
});

describe('filterWorkspaces', () => {
  const machines = [machine('m', '/home/u/workspace')];
  const list = [
    ws({ id: '1', machineId: 'm', projectPath: '/home/u/workspace/perch' }),
    ws({ id: '2', machineId: 'm', projectPath: '/home/u/workspace/foo' }),
    ws({ id: '3', machineId: 'm', projectPath: '/home/u/workspace/perch' }),
    ws({ id: '4', machineId: 'm', projectPath: '/home/u/workspace/bar/baz' }),
    ws({ id: '5', machineId: 'm', projectPath: '/home/u/workspace/bar/qux/qux-content' }),
    ws({ id: '6', machineId: 'm', projectPath: '/home/u/workspace/bar-archive' }),
  ];

  it('keeps every workspace inside a selected parent folder, at any depth', () => {
    const out = filterWorkspaces(list, machines, new Set(['bar']));
    expect(out.map((w) => w.id)).toEqual(['4', '5']);
  });

  it('returns all workspaces unchanged when nothing is selected', () => {
    expect(filterWorkspaces(list, machines, new Set())).toBe(list);
  });

  it('keeps only workspaces in the single selected folder', () => {
    const out = filterWorkspaces(list, machines, new Set(['perch']));
    expect(out.map((w) => w.id)).toEqual(['1', '3']);
  });

  it('keeps workspaces across multiple selected folders, preserving order', () => {
    const out = filterWorkspaces(list, machines, new Set(['perch', 'foo']));
    expect(out.map((w) => w.id)).toEqual(['1', '2', '3']);
  });

  it('returns empty when the selected folder has no workspaces', () => {
    expect(filterWorkspaces(list, machines, new Set(['gone']))).toEqual([]);
  });
});

describe('pruneStaleFilter', () => {
  const machines = [machine('m', '/home/u/workspace')];
  const list = [
    ws({ id: '1', machineId: 'm', projectPath: '/home/u/workspace/perch' }),
    ws({ id: '2', machineId: 'm', projectPath: '/home/u/workspace/bar/baz' }),
  ];

  it('leaves the selection untouched while workspaces have not loaded yet', () => {
    // The list is empty because the async workspace list hasn't arrived yet, not because the
    // selected folder is actually gone — pruning here would wipe a persisted filter on reload.
    expect(pruneStaleFilter(new Set(['perch']), [], machines, false)).toEqual(['perch']);
  });

  it('prunes keys with no workspace under them once workspaces have loaded', () => {
    expect(pruneStaleFilter(new Set(['perch', 'gone']), list, machines, true)).toEqual(['perch']);
  });

  it('keeps a parent folder that is not shown as its own entry but still holds sessions', () => {
    // With a single project left under bar, the tree collapses bar into bar/baz — the bar
    // selection must survive that, since it still matches a session.
    expect(pruneStaleFilter(new Set(['bar']), list, machines, true)).toEqual(['bar']);
  });

  it('returns an empty array when nothing is selected', () => {
    expect(pruneStaleFilter(new Set(), list, machines, true)).toEqual([]);
  });
});
