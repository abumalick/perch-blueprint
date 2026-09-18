import { describe, it, expect, vi } from 'vitest';
import { unparkWorkspace } from './unpark-workspace';
import type { ParkedWorkspace } from '../ports/parked-store-port';

const record: ParkedWorkspace = {
  id: 'perch-a',
  name: 'Fix login redirect',
  projectPath: '/home/u/workspace/foo',
  command: 'claude --model opus',
  machineId: 'dev',
  createdAt: 100,
  parkedAt: 500,
  claudeSessionId: 'sess-1',
};

function makeDeps(entryArg?: ParkedWorkspace, isDirectory = true) {
  // A default parameter (`entry = record`) would also fire on an *explicit* `undefined`
  // argument, silently defeating the "no record" test case. `arguments.length` is the only
  // way to tell "omitted" from "passed undefined" apart.
  const entry = arguments.length > 0 ? entryArg : record;
  const removed: string[] = [];
  return {
    removed,
    deps: {
      parked: {
        get: async (id: string) => (entry && entry.id === id ? entry : undefined),
        remove: async (id: string) => {
          removed.push(id);
        },
      },
      tmux: { createSession: vi.fn(async () => {}) },
      isDirectory: async () => isDirectory,
      status: { set: vi.fn() },
    },
  };
}

describe('unparkWorkspace', () => {
  it('reports not-parked for an id with no record, touching nothing', async () => {
    const { deps } = makeDeps(undefined);
    expect(await unparkWorkspace(deps, 'perch-a')).toBe('not-parked');
    expect(deps.tmux.createSession).not.toHaveBeenCalled();
  });

  it('recreates the session with the original id, cwd, and a resume-injected command', async () => {
    const { deps } = makeDeps();
    expect(await unparkWorkspace(deps, 'perch-a')).toBe('unparked');
    expect(deps.tmux.createSession).toHaveBeenCalledWith({
      name: 'perch-a',
      cwd: '/home/u/workspace/foo',
      command: 'claude --model opus --resume sess-1 || exec claude --model opus',
    });
  });

  it('runs the original command verbatim when there is no session id', async () => {
    const { claudeSessionId: _drop, ...noSession } = record;
    const { deps } = makeDeps(noSession);
    await unparkWorkspace(deps, 'perch-a');
    expect(deps.tmux.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'claude --model opus' }),
    );
  });

  it('clears the record and resets the status to idle', async () => {
    const { removed, deps } = makeDeps();
    await unparkWorkspace(deps, 'perch-a');
    expect(removed).toEqual(['perch-a']);
    expect(deps.status.set).toHaveBeenCalledWith('perch-a', 'idle');
  });

  it('refuses when the project directory is gone, keeping the record intact', async () => {
    // tmux new-session -c silently runs in $HOME when the cwd is missing, and resume is
    // scoped to the project directory — so a missing directory must not create a session.
    const { removed, deps } = makeDeps(record, false);
    expect(await unparkWorkspace(deps, 'perch-a')).toBe('missing-directory');
    expect(deps.tmux.createSession).not.toHaveBeenCalled();
    expect(removed).toEqual([]);
  });
});
