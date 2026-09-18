import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isWorkspaceStatus, type WorkspaceStatus } from '@perch/contracts';
import type { StatusStorePort } from '../ports/status-store-port';

interface Entry {
  status: WorkspaceStatus;
  // Epoch ms of the transition. Undefined for entries migrated from the legacy
  // string format, which carried no timestamp.
  changedAt?: number;
  // Manual pin flag, orthogonal to status. Absent/false means not urgent.
  urgent?: boolean;
  claudeSessionId?: string;
}

// Durable last-write-wins status store. Mirrors InMemoryStatusStore's semantics
// but persists to ~/.perch/status.json so statuses survive an agent restart.
// Synchronous I/O matches the synchronous StatusStorePort and keeps the map hot
// before the first `list`. Tolerant of a missing or corrupt file (starts empty).
export class FileStatusStore implements StatusStorePort {
  private readonly statuses = new Map<string, Entry>();
  private readonly listeners: Array<(id: string, status: WorkspaceStatus) => void> = [];

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

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
    this.persist();
  }

  getUrgent(workspaceId: string): boolean {
    return this.statuses.get(workspaceId)?.urgent ?? false;
  }

  setUrgent(workspaceId: string, urgent: boolean): void {
    const current = this.statuses.get(workspaceId);
    if ((current?.urgent ?? false) === urgent) {
      return;
    }
    // An id with no status entry yet resolves to the default `idle`; keep its changedAt
    // untouched so pinning never reshuffles the within-group oldest-first order.
    const status = current?.status ?? 'idle';
    this.statuses.set(workspaceId, { ...current, status, urgent });
    for (const listener of this.listeners) {
      listener(workspaceId, status);
    }
    this.persist();
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
    this.statuses.set(workspaceId, { ...current, status, claudeSessionId: sessionId });
    this.persist();
  }

  onChange(listener: (workspaceId: string, status: WorkspaceStatus) => void): void {
    this.listeners.push(listener);
  }

  // Drop persisted statuses for sessions that no longer exist, so a reused
  // session name cannot inherit a dead one's status. Called once at startup.
  prune(liveIds: Iterable<string>): void {
    const live = new Set(liveIds);
    let changed = false;
    for (const id of this.statuses.keys()) {
      if (!live.has(id)) {
        this.statuses.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.persist();
    }
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // corrupt file (e.g. partial write on crash) → start empty
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    for (const [id, value] of Object.entries(parsed)) {
      const entry = parseEntry(value);
      if (entry) {
        this.statuses.set(id, entry);
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.statuses), null, 2), 'utf8');
  }
}

// `postponed` was renamed to `parked`. Existing ~/.perch/status.json files on each agent
// machine still hold the old literal, and nothing syncs config between machines — so
// migrate at read rather than requiring a manual step per machine.
function migrateStatus(value: unknown): unknown {
  return value === 'postponed' ? 'parked' : value;
}

// Accept both the current `{ status, changedAt }` shape and the legacy bare-string
// format so existing status.json files survive an upgrade. Unknown statuses are dropped.
function parseEntry(value: unknown): Entry | undefined {
  const bare = migrateStatus(value);
  if (isWorkspaceStatus(bare)) {
    return { status: bare };
  }
  if (typeof value === 'object' && value !== null) {
    const { status, changedAt, urgent, claudeSessionId } = value as {
      status?: unknown;
      changedAt?: unknown;
      urgent?: unknown;
      claudeSessionId?: unknown;
    };
    const migrated = migrateStatus(status);
    if (isWorkspaceStatus(migrated)) {
      return {
        status: migrated,
        changedAt: typeof changedAt === 'number' ? changedAt : undefined,
        urgent: typeof urgent === 'boolean' ? urgent : undefined,
        claudeSessionId: typeof claudeSessionId === 'string' ? claudeSessionId : undefined,
      };
    }
  }
  return undefined;
}
