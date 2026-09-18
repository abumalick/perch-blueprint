import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';
import type { BrowserCommandPort } from '../ports/browser-command-port';
import { browserSessionsForWorkspace } from './browser-session-owner';

// Closes the agent-browser sessions a workspace owns, invoked when the workspace is closed.
// Best-effort throughout: agent-browser not running (discovery throws) or a single `stop`
// failing must never fail the workspace close. Only the workspace's own sessions are
// touched (name is `<wsid>` or `<wsid>__…`) — never a home-level per-site session (e.g. a
// shared `github` login) or another workspace's.
export async function closeWorkspaceBrowserSessions(
  deps: { discovery: BrowserDiscoveryPort; commands: Pick<BrowserCommandPort, 'stop'> },
  workspaceId: string,
): Promise<void> {
  let names: string[];
  try {
    const sessions = await deps.discovery.listSessions();
    names = browserSessionsForWorkspace(
      sessions.map((s) => s.name),
      workspaceId,
    );
  } catch {
    return;
  }
  for (const name of names) {
    await deps.commands.stop(name).catch(() => undefined);
  }
}
