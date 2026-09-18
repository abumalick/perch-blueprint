import type { WorkspaceStatus } from '@perch/contracts';

export type WorkspaceCloseReason = 'closed-by-user' | 'exited';

export interface WorkspaceLogEntry {
  id: string;
  name: string;
  projectPath: string;
  machineId: string;
  createdAt: number;
  closedAt: number;
  reason: WorkspaceCloseReason;
  lastStatus: WorkspaceStatus | undefined;
  // The Claude Code session id running in this workspace at close time, if any hook event
  // ever carried one. Lets `claude --resume <id>` (run from `projectPath`) pick the exact
  // conversation back up.
  claudeSessionId: string | undefined;
}

export interface WorkspaceLogPort {
  // Appends one closed-workspace record to durable storage. One call = one JSONL line.
  append(entry: WorkspaceLogEntry): Promise<void>;
}
