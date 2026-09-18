import { describe, it, expect, vi } from 'vitest';
import type { Workspace } from '@perch/contracts';
import { parkWorkspace } from './park-workspace';
import type { ParkedWorkspace } from '../ports/parked-store-port';

const workspace: Workspace = {
  machineId: 'dev',
  id: 'perch-a',
  name: 'Fix login redirect',
  projectPath: '/home/u/workspace/foo',
  command: 'claude --model opus',
  createdAt: 100,
  lastActivityAt: 150,
  status: 'needs-feedback',
};

function makeDeps(existing: ParkedWorkspace[] = []) {
  const added: ParkedWorkspace[] = [];
  const order: string[] = [];
  return {
    added,
    order,
    deps: {
      parked: {
        get: async (id: string) => existing.find((e) => e.id === id),
        add: async (e: ParkedWorkspace) => {
          order.push('add');
          added.push(e);
        },
      },
      tmux: {
        killSession: vi.fn(async () => {
          order.push('kill');
        }),
      },
      status: {
        getClaudeSessionId: (): string | undefined => 'sess-1',
        set: vi.fn(() => {
          order.push('status');
        }),
      },
      clock: { now: () => 500 },
    },
  };
}

describe('parkWorkspace', () => {
  it('writes a self-sufficient record carrying the claude session id', async () => {
    const { added, deps } = makeDeps();
    await parkWorkspace(deps, workspace);
    expect(added).toEqual([
      {
        id: 'perch-a',
        name: 'Fix login redirect',
        projectPath: '/home/u/workspace/foo',
        command: 'claude --model opus',
        machineId: 'dev',
        createdAt: 100,
        parkedAt: 500,
        claudeSessionId: 'sess-1',
      },
    ]);
  });

  it('writes the record before killing tmux, and sets the status last', async () => {
    // Ordering is load-bearing: tmux cannot answer about a killed session, and status.set
    // fires onChange -> broadcastWorkspace, which rebuilds via listWorkspaces and must
    // therefore find the record already on disk.
    const { order, deps } = makeDeps();
    await parkWorkspace(deps, workspace);
    expect(order).toEqual(['add', 'kill', 'status']);
  });

  it('sets the status to parked', async () => {
    const { deps } = makeDeps();
    await parkWorkspace(deps, workspace);
    expect(deps.status.set).toHaveBeenCalledWith('perch-a', 'parked');
  });

  // Parking without a resumable conversation is worse than not parking: it frees the
  // resources but silently throws the conversation away, which is the whole thing the
  // feature exists to protect.
  it('refuses to park when no session id is known, even though the command is valid', async () => {
    const { added, deps } = makeDeps();
    deps.status.getClaudeSessionId = () => undefined;
    const result = await parkWorkspace(deps, workspace);
    expect(result).toBe('not-restorable');
    expect(added).toEqual([]);
    expect(deps.tmux.killSession).not.toHaveBeenCalled();
    expect(deps.status.set).not.toHaveBeenCalled();
  });

  it('always records the session id on the parked record', async () => {
    const { added, deps } = makeDeps();
    await parkWorkspace(deps, workspace);
    expect(added).toHaveLength(1);
    expect(added[0]?.claudeSessionId).toBe('sess-1');
  });

  it('is a no-op when a record already exists, without re-snapshotting or killing', async () => {
    const existing: ParkedWorkspace = {
      id: 'perch-a',
      name: 'Old name',
      projectPath: '/home/u/workspace/foo',
      command: 'claude',
      machineId: 'dev',
      createdAt: 1,
      parkedAt: 2,
      claudeSessionId: 'original-session',
    };
    const { added, deps } = makeDeps([existing]);
    const result = await parkWorkspace(deps, workspace);
    expect(result).toBe('already-parked');
    expect(added).toEqual([]);
    expect(deps.tmux.killSession).not.toHaveBeenCalled();
  });

  // tmux-continuum restores sessions after a reboot but does not restore custom session
  // options, so a continuum-revived workspace's `@perch_command` (and therefore
  // `workspace.command`) is empty even though it is a live Claude session.
  it('stores "claude" as the command when the command is empty but a session id is known', async () => {
    const { added, deps } = makeDeps();
    const result = await parkWorkspace(deps, { ...workspace, command: '' });
    expect(result).toBe('parked');
    expect(added).toHaveLength(1);
    expect(added[0]?.command).toBe('claude');
    expect(added[0]?.claudeSessionId).toBe('sess-1');
    expect(deps.tmux.killSession).toHaveBeenCalledWith('perch-a');
  });

  it('refuses to park when both the command and the session id are unknown, leaving the session alive', async () => {
    const { added, deps } = makeDeps();
    deps.status.getClaudeSessionId = () => undefined;
    const result = await parkWorkspace(deps, { ...workspace, command: '' });
    expect(result).toBe('not-restorable');
    expect(added).toEqual([]);
    expect(deps.tmux.killSession).not.toHaveBeenCalled();
    expect(deps.status.set).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only command the same as empty', async () => {
    const { added, deps } = makeDeps();
    const result = await parkWorkspace(deps, { ...workspace, command: '   ' });
    expect(result).toBe('parked');
    expect(added).toHaveLength(1);
    expect(added[0]?.command).toBe('claude');
  });
});
