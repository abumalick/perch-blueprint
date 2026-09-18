import { describe, it, expect } from 'vitest';
import { createWorkspace } from './create-workspace';
import type { TmuxPort } from '../ports/tmux-port';
import type { RecentStorePort } from '../ports/recent-store-port';
import type { PathResolver } from '../ports/path-resolver';

function fakes(resolvePath: PathResolver = (p) => p) {
  const created: Array<{ name: string; cwd: string; command: string }> = [];
  const recorded: string[] = [];
  const tmux: TmuxPort = {
    listSessions: async () => [],
    createSession: async (i) => {
      created.push(i);
    },
    killSession: async () => undefined,
    hasSession: async () => false,
  };
  const recent: RecentStorePort = {
    list: async () => recorded,
    record: async (p) => {
      recorded.push(p);
    },
  };
  const isDirectory = async () => true;
  return { created, recorded, tmux, recent, resolvePath, isDirectory };
}

describe('createWorkspace', () => {
  it('creates a tmux session and returns an idle workspace', async () => {
    const f = fakes();
    const ws = await createWorkspace(
      {
        tmux: f.tmux,
        recent: f.recent,
        resolvePath: f.resolvePath,
        isDirectory: f.isDirectory,
        clock: { now: () => 1000 },
        ids: { next: () => 'ab12cd' },
        machineId: 'mini',
      },
      { projectPath: '/home/u/workspace/perch', command: 'claude' },
    );

    expect(ws).toEqual({
      machineId: 'mini',
      id: 'perch-ab12cd',
      name: 'perch',
      projectPath: '/home/u/workspace/perch',
      command: 'claude',
      createdAt: 1000,
      lastActivityAt: 1000,
      status: 'idle',
    });
    expect(f.created).toEqual([
      { name: 'perch-ab12cd', cwd: '/home/u/workspace/perch', command: 'claude' },
    ]);
    expect(f.recorded).toEqual(['/home/u/workspace/perch']);
  });

  it('canonicalizes a relative path before tmux cwd and recording', async () => {
    const f = fakes((p) => (p === 'perch' ? '/home/u/workspace/perch' : p));
    const ws = await createWorkspace(
      {
        tmux: f.tmux,
        recent: f.recent,
        resolvePath: f.resolvePath,
        isDirectory: f.isDirectory,
        clock: { now: () => 1000 },
        ids: { next: () => 'ab12cd' },
        machineId: 'mini',
      },
      { projectPath: 'perch', command: 'claude' },
    );

    expect(ws.projectPath).toBe('/home/u/workspace/perch');
    expect(ws.name).toBe('perch');
    expect(f.created).toEqual([
      { name: 'perch-ab12cd', cwd: '/home/u/workspace/perch', command: 'claude' },
    ]);
    expect(f.recorded).toEqual(['/home/u/workspace/perch']);
  });

  it('rejects and creates nothing when the directory does not exist', async () => {
    const f = fakes();
    f.isDirectory = async () => false;

    await expect(
      createWorkspace(
        {
          tmux: f.tmux,
          recent: f.recent,
          resolvePath: f.resolvePath,
          isDirectory: f.isDirectory,
          clock: { now: () => 1000 },
          ids: { next: () => 'ab12cd' },
          machineId: 'mini',
        },
        { projectPath: '/home/u/nope', command: 'claude' },
      ),
    ).rejects.toThrow('directory does not exist: /home/u/nope');

    expect(f.created).toEqual([]);
    expect(f.recorded).toEqual([]);
  });
});
