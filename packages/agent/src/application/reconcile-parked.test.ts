import { describe, it, expect, vi } from 'vitest';
import { reconcileParked } from './reconcile-parked';
import type { ParkedWorkspace } from '../ports/parked-store-port';

import type { TmuxSessionInfo } from '../ports/tmux-port';

const record = (id: string): ParkedWorkspace => ({
  id,
  name: 'Parked',
  projectPath: '/home/u/workspace/foo',
  command: 'claude',
  machineId: 'dev',
  createdAt: 1,
  parkedAt: 2,
  claudeSessionId: 'sess-1',
});

const session = (name: string): TmuxSessionInfo => ({
  name,
  startPath: '/home/u/workspace/foo',
  command: 'claude',
  createdAt: 1,
  title: name,
});

describe('reconcileParked', () => {
  it('kills a tmux session that collides with a parked record', async () => {
    // tmux-continuum restores session names (not the claude process) when the tmux server
    // starts, resurrecting a parked id as an empty shell. The record wins — otherwise the
    // shell would shadow it and its claudeSessionId would be lost.
    const killSession = vi.fn(async () => {});
    const killed = await reconcileParked({
      parked: { list: async () => [record('perch-a')] },
      tmux: { listSessions: async () => [session('perch-a')], killSession },
      sessionPrefix: 'perch-',
    });
    expect(killed).toEqual(['perch-a']);
    expect(killSession).toHaveBeenCalledWith('perch-a');
  });

  it('leaves live sessions with no parked record alone', async () => {
    const killSession = vi.fn(async () => {});
    const killed = await reconcileParked({
      parked: { list: async () => [record('perch-a')] },
      tmux: { listSessions: async () => [session('perch-other')], killSession },
      sessionPrefix: 'perch-',
    });
    expect(killed).toEqual([]);
    expect(killSession).not.toHaveBeenCalled();
  });

  it('does nothing when there are no parked records', async () => {
    const killSession = vi.fn(async () => {});
    const killed = await reconcileParked({
      parked: { list: async () => [] },
      tmux: { listSessions: async () => [session('perch-a')], killSession },
      sessionPrefix: 'perch-',
    });
    expect(killed).toEqual([]);
    expect(killSession).not.toHaveBeenCalled();
  });
});
