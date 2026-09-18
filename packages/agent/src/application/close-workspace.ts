import type { TmuxPort } from '../ports/tmux-port';
import type { ProcessScopePort } from '../ports/process-scope-port';

export interface CloseWorkspaceDeps {
  tmux: TmuxPort;
  // Optional so non-systemd agents (macOS) and unit tests can omit it; without it a close
  // is exactly what it always was, and the pane's detached survivors leak as before.
  scopes?: ProcessScopePort;
}

// Kills the workspace's tmux session and returns the scope its pane lived in, for the
// caller to reap once the close has been acknowledged. Resolving the scope first is not a
// style choice: /proc/<pid> vanishes with the pane, so after the kill there is nothing left
// to read. Best-effort — a workspace must still close on a machine where none of this works.
export async function closeWorkspace(
  deps: CloseWorkspaceDeps,
  id: string,
): Promise<string | null> {
  const scope = await paneScope(deps, id);
  await deps.tmux.killSession(id);
  return scope;
}

async function paneScope(deps: CloseWorkspaceDeps, id: string): Promise<string | null> {
  if (!deps.scopes || !deps.tmux.panePid) return null;
  try {
    const pid = await deps.tmux.panePid(id);
    return pid === null ? null : await deps.scopes.scopeForPid(pid);
  } catch {
    return null;
  }
}
