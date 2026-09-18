import type { Workspace } from '@perch/contracts';
import type { WorkspaceCloseReason, WorkspaceLogPort } from '../ports/workspace-log-port';
import type { StatusStorePort } from '../ports/status-store-port';
import type { Clock } from '../ports/clock';

export interface RecordWorkspaceClosedDeps {
  workspaceLog: WorkspaceLogPort;
  status: Pick<StatusStorePort, 'get' | 'getClaudeSessionId'>;
  clock: Clock;
}

// Records a workspace close event to the persistent log. Best-effort throughout: a log-write
// failure must never fail the workspace close itself or throw from a background poll interval.
// Swallows any append error and returns normally so both the explicit close path and the
// background disappearance poll are automatically protected.
export async function recordWorkspaceClosed(
  deps: RecordWorkspaceClosedDeps,
  workspace: Workspace,
  reason: WorkspaceCloseReason,
): Promise<void> {
  try {
    await deps.workspaceLog.append({
      id: workspace.id,
      name: workspace.name,
      projectPath: workspace.projectPath,
      machineId: workspace.machineId,
      createdAt: workspace.createdAt,
      closedAt: deps.clock.now(),
      reason,
      lastStatus: deps.status.get(workspace.id),
      claudeSessionId: deps.status.getClaudeSessionId(workspace.id),
    });
  } catch {
    return;
  }
}
