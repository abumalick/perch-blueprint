import { describe, it, expect } from 'vitest';
import { closeWorkspace } from './close-workspace';
import type { TmuxPort } from '../ports/tmux-port';
import type { ProcessScopePort } from '../ports/process-scope-port';

function tmuxFake(over: Partial<TmuxPort> = {}): TmuxPort {
  return {
    listSessions: async () => [],
    createSession: async () => undefined,
    killSession: async () => undefined,
    hasSession: async () => true,
    ...over,
  };
}

describe('closeWorkspace', () => {
  it('kills the named tmux session', async () => {
    const killed: string[] = [];
    const tmux = tmuxFake({
      killSession: async (name) => {
        killed.push(name);
      },
    });
    await closeWorkspace({ tmux }, 'perch-aa');
    expect(killed).toEqual(['perch-aa']);
  });

  // /proc/<pid> is gone the moment the pane dies, so the scope can only be read while the
  // session is still alive. Getting this order wrong yields null every time — and silently.
  it('resolves the pane scope before killing the session', async () => {
    const order: string[] = [];
    const tmux = tmuxFake({
      panePid: async () => {
        order.push('panePid');
        return 4242;
      },
      killSession: async () => {
        order.push('kill');
      },
    });
    const scopes: ProcessScopePort = {
      scopeForPid: async (pid) => {
        order.push(`scopeForPid:${pid}`);
        return 'tmux-spawn-abc.scope';
      },
      stopScope: async () => undefined,
    };
    const scope = await closeWorkspace({ tmux, scopes }, 'perch-aa');
    expect(scope).toBe('tmux-spawn-abc.scope');
    expect(order).toEqual(['panePid', 'scopeForPid:4242', 'kill']);
  });

  it('still kills the session when no scope port is wired', async () => {
    const killed: string[] = [];
    const tmux = tmuxFake({
      panePid: async () => 4242,
      killSession: async (name) => {
        killed.push(name);
      },
    });
    const scope = await closeWorkspace({ tmux }, 'perch-aa');
    expect(scope).toBeNull();
    expect(killed).toEqual(['perch-aa']);
  });

  it('still kills the session when the pane is already gone', async () => {
    const killed: string[] = [];
    const tmux = tmuxFake({
      panePid: async () => null,
      killSession: async (name) => {
        killed.push(name);
      },
    });
    const scopes: ProcessScopePort = {
      scopeForPid: async () => 'never.scope',
      stopScope: async () => undefined,
    };
    const scope = await closeWorkspace({ tmux, scopes }, 'perch-aa');
    expect(scope).toBeNull();
    expect(killed).toEqual(['perch-aa']);
  });

  // Reaping is a bonus; a close that fails because the cgroup could not be read would be a
  // worse bug than the leak it cleans up.
  it('kills the session even when resolving the scope throws', async () => {
    const killed: string[] = [];
    const tmux = tmuxFake({
      panePid: async () => {
        throw new Error('tmux gone');
      },
      killSession: async (name) => {
        killed.push(name);
      },
    });
    const scopes: ProcessScopePort = {
      scopeForPid: async () => 'never.scope',
      stopScope: async () => undefined,
    };
    const scope = await closeWorkspace({ tmux, scopes }, 'perch-aa');
    expect(scope).toBeNull();
    expect(killed).toEqual(['perch-aa']);
  });
});
