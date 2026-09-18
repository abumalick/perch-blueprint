import type { WorkspaceStatus } from '@perch/contracts';
import type { StatusStorePort } from '../ports/status-store-port';

interface Entry {
  status: WorkspaceStatus;
  changedAt: number;
  // Manual pin flag, orthogonal to status. Absent/false means not urgent.
  urgent?: boolean;
  claudeSessionId?: string;
}

// Last-write-wins, in-memory. Both hook events and the PWA's setStatus message write here;
// the value resets on agent restart (sessions then show `idle` until the next hook event).
export class InMemoryStatusStore implements StatusStorePort {
  private readonly statuses = new Map<string, Entry>();
  private readonly listeners: Array<(id: string, status: WorkspaceStatus) => void> = [];

  constructor(private readonly now: () => number = Date.now) {}

  get(workspaceId: string): WorkspaceStatus | undefined {
    return this.statuses.get(workspaceId)?.status;
  }

  getChangedAt(workspaceId: string): number | undefined {
    return this.statuses.get(workspaceId)?.changedAt;
  }

  set(workspaceId: string, status: WorkspaceStatus): void {
    const current = this.statuses.get(workspaceId);
    if (current?.status === status) {
      return;
    }
    // Preserve the urgent pin across a status change (spread `current` first).
    this.statuses.set(workspaceId, { ...current, status, changedAt: this.now() });
    for (const listener of this.listeners) {
      listener(workspaceId, status);
    }
  }

  getUrgent(workspaceId: string): boolean {
    return this.statuses.get(workspaceId)?.urgent ?? false;
  }

  setUrgent(workspaceId: string, urgent: boolean): void {
    const current = this.statuses.get(workspaceId);
    if ((current?.urgent ?? false) === urgent) {
      return;
    }
    const status = current?.status ?? 'idle';
    // Keep changedAt untouched so pinning never reshuffles the within-group order; a
    // brand-new entry gets `now()` to satisfy the required field.
    this.statuses.set(workspaceId, { changedAt: this.now(), ...current, status, urgent });
    for (const listener of this.listeners) {
      listener(workspaceId, status);
    }
  }

  getClaudeSessionId(workspaceId: string): string | undefined {
    return this.statuses.get(workspaceId)?.claudeSessionId;
  }

  setClaudeSessionId(workspaceId: string, sessionId: string): void {
    const current = this.statuses.get(workspaceId);
    if (current?.claudeSessionId === sessionId) {
      return;
    }
    const status = current?.status ?? 'idle';
    this.statuses.set(workspaceId, { changedAt: this.now(), ...current, status, claudeSessionId: sessionId });
  }

  onChange(listener: (workspaceId: string, status: WorkspaceStatus) => void): void {
    this.listeners.push(listener);
  }
}
