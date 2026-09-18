import type { BrowserSession, Workspace } from '@perch/contracts';

// Delimiter between a workspace id and a session's free slug: `<wsid>__<slug>`. Double
// underscore is absent from `perch-…` workspace/tmux ids, so it never splits an id.
export const BROWSER_SESSION_DELIMITER = '__';

export interface BrowserSessionJoin {
  // workspaceId → session names attached to it. A session attaches when its name is exactly
  // the id or starts with `<id>__`; a nested match goes to the longest matching id.
  attached: Map<string, string[]>;
  // Session names matching no workspace (e.g. a home-level per-site login like `github`).
  unattached: string[];
}

function ownerWorkspaceId(sessionName: string, workspaceIds: readonly string[]): string | null {
  let best: string | null = null;
  for (const id of workspaceIds) {
    if (sessionName === id || sessionName.startsWith(id + BROWSER_SESSION_DELIMITER)) {
      if (best === null || id.length > best.length) best = id;
    }
  }
  return best;
}

export function joinBrowserSessions(
  sessions: readonly BrowserSession[],
  workspaces: readonly Workspace[],
): BrowserSessionJoin {
  const workspaceIds = workspaces.map((w) => w.id);
  const attached = new Map<string, string[]>();
  const unattached: string[] = [];
  for (const session of sessions) {
    const owner = ownerWorkspaceId(session.name, workspaceIds);
    if (owner === null) {
      unattached.push(session.name);
      continue;
    }
    const names = attached.get(owner);
    if (names) names.push(session.name);
    else attached.set(owner, [session.name]);
  }
  return { attached, unattached };
}

// The label shown for an attached session: the slug after `<wsid>__`, or "main" for a
// bare-name session (name === workspace id, e.g. Perch's own Start-browser session).
export function browserSessionLabel(sessionName: string, workspaceId: string): string {
  if (sessionName === workspaceId) return 'main';
  const prefix = workspaceId + BROWSER_SESSION_DELIMITER;
  return sessionName.startsWith(prefix) ? sessionName.slice(prefix.length) : sessionName;
}
