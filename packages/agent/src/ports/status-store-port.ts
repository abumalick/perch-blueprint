import type { WorkspaceStatus } from '@perch/contracts';

export interface StatusStorePort {
  get(workspaceId: string): WorkspaceStatus | undefined;
  // Epoch ms of the last actual status transition, or undefined if never set.
  getChangedAt(workspaceId: string): number | undefined;
  set(workspaceId: string, status: WorkspaceStatus): void;
  // Manual "pin to top of its status group" flag, orthogonal to status: it persists across
  // status changes until cleared. `getUrgent` defaults to false for an unknown id.
  getUrgent(workspaceId: string): boolean;
  setUrgent(workspaceId: string, urgent: boolean): void;
  // The last known Claude Code session id for this workspace, or undefined if no hook
  // event has carried one yet. Setting it never fires onChange — a session id is not an
  // attention-status event.
  getClaudeSessionId(workspaceId: string): string | undefined;
  setClaudeSessionId(workspaceId: string, sessionId: string): void;
  onChange(listener: (workspaceId: string, status: WorkspaceStatus) => void): void;
}
