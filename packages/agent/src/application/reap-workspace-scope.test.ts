import { describe, it, expect } from 'vitest';
import { reapWorkspaceScope } from './reap-workspace-scope';
import type { ProcessScopePort } from '../ports/process-scope-port';

describe('reapWorkspaceScope', () => {
  it('stops the scope', async () => {
    const stopped: string[] = [];
    const scopes: ProcessScopePort = {
      scopeForPid: async () => null,
      stopScope: async (name) => {
        stopped.push(name);
      },
    };
    await reapWorkspaceScope({ scopes }, 'tmux-spawn-abc.scope');
    expect(stopped).toEqual(['tmux-spawn-abc.scope']);
  });

  it('does nothing when there is no scope to reap', async () => {
    let called = false;
    const scopes: ProcessScopePort = {
      scopeForPid: async () => null,
      stopScope: async () => {
        called = true;
      },
    };
    await reapWorkspaceScope({ scopes }, null);
    expect(called).toBe(false);
  });

  // This runs detached, after the client has already been told the workspace is closed.
  // An unhandled rejection here would surface as a crashed agent for a workspace that did
  // in fact close — the leak it cleans up is the lesser problem.
  it('resolves when stopping the scope fails', async () => {
    const scopes: ProcessScopePort = {
      scopeForPid: async () => null,
      stopScope: async () => {
        throw new Error('Unit tmux-spawn-abc.scope not loaded.');
      },
    };
    await expect(reapWorkspaceScope({ scopes }, 'tmux-spawn-abc.scope')).resolves.toBeUndefined();
  });
});
