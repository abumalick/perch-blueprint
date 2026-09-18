import type { ProcessScopePort } from '../ports/process-scope-port';

// Stops the scope a closed workspace's pane lived in, sweeping up whatever detached itself
// from the pane and outlived the SIGHUP. Deliberately swallows failures: this runs after the
// client has been told the workspace is closed, so there is no one left to report to, and a
// scope that is already empty (systemd garbage-collects those) is the common case, not an error.
export async function reapWorkspaceScope(
  deps: { scopes?: ProcessScopePort },
  scope: string | null,
): Promise<void> {
  if (!deps.scopes || !scope) return;
  try {
    await deps.scopes.stopScope(scope);
  } catch {
    // best-effort
  }
}
