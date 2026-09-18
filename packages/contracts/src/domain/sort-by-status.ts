import { WORKSPACE_STATUSES, type WorkspaceStatus } from './workspace-status';
import type { Workspace } from './workspace';

// Index in WORKSPACE_STATUSES is the sort rank (lower = higher in the list).
const RANK = Object.fromEntries(WORKSPACE_STATUSES.map((s, i) => [s, i])) as Record<
  WorkspaceStatus,
  number
>;

export function sortByStatus(workspaces: readonly Workspace[]): Workspace[] {
  return [...workspaces].sort((a, b) => {
    const byRank = RANK[a.status] - RANK[b.status];
    if (byRank !== 0) return byRank;
    // Within a status group, urgent (pinned) workspaces float to the top.
    const byUrgent = Number(b.urgent ?? false) - Number(a.urgent ?? false);
    if (byUrgent !== 0) return byUrgent;
    // Oldest activity first so a group can be drained top-to-bottom: the workspace
    // that entered its status earliest sits at the top.
    return a.lastActivityAt - b.lastActivityAt;
  });
}
