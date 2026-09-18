import type { Workspace } from '@perch/contracts';
import type { TmuxPort } from '../ports/tmux-port';
import type { StatusStorePort } from '../ports/status-store-port';
import type { RepoRemotePort } from '../ports/repo-remote-port';
import type { ParkedStorePort, ParkedWorkspace } from '../ports/parked-store-port';
import type { ClaudeSessionsPort } from '../ports/claude-sessions-port';
import { deriveWorkspaceName } from './derive-workspace-name';

export interface ListWorkspacesDeps {
  tmux: TmuxPort;
  machineId: string;
  sessionPrefix: string;
  status: Pick<StatusStorePort, 'get' | 'getChangedAt' | 'getUrgent'>;
  // Optional so unit tests and non-display call sites can omit it; when present, each
  // workspace is stamped with its GitHub owner/repo (when the project has a GitHub remote).
  repoRemote?: RepoRemotePort;
  // Optional for the same reason. Parked workspaces have no tmux session, so they are
  // merged in from this store — that is what keeps them visible in the PWA with no
  // protocol change, and what stops the disappearance poll logging a spurious `exited`.
  parked?: Pick<ParkedStorePort, 'list'>;
  // Optional for the same reason. Supplies each live Claude Code session's address, keyed by
  // the tmux session it runs in — which is the workspace id, so the join needs no lookup.
  claudeSessions?: ClaudeSessionsPort;
}

export async function listWorkspaces(deps: ListWorkspacesDeps): Promise<Workspace[]> {
  const sessions = await deps.tmux.listSessions(deps.sessionPrefix);
  const parked = (await deps.parked?.list()) ?? [];
  // Read once per listing rather than per workspace: one registry read covers them all.
  const addresses = (await deps.claudeSessions?.addressesByTmuxSession()) ?? {};
  const parkedIds = new Set(parked.map((p) => p.id));
  const live = await Promise.all(
    sessions
      // A parked record shadows a live session of the same id. The only way that collision
      // arises is tmux-continuum resurrecting a parked id as a Claude-less shell; letting
      // the shell win would discard the record's claudeSessionId, which is the whole point
      // of parking. Startup reconciliation kills such orphans, so this is a safety net.
      .filter((s) => !parkedIds.has(s.name))
      .map(async (s) => {
        const github = (await deps.repoRemote?.getGithubRepo(s.startPath)) ?? undefined;
        const agentAddress = addresses[s.name];
        return {
          machineId: deps.machineId,
          id: s.name,
          name: deriveWorkspaceName(s.title, s.startPath),
          projectPath: s.startPath,
          command: s.command,
          createdAt: s.createdAt,
          // The time the workspace entered its current status, so the PWA can order each
          // status group oldest-first. Falls back to creation time when never set.
          lastActivityAt: deps.status.getChangedAt(s.name) ?? s.createdAt,
          status: deps.status.get(s.name) ?? 'idle',
          urgent: deps.status.getUrgent(s.name),
          ...(github ? { github } : {}),
          ...(agentAddress ? { agentAddress } : {}),
        };
      }),
  );
  return [...live, ...parked.map((p) => toWorkspace(p, deps.machineId))];
}

function toWorkspace(parked: ParkedWorkspace, machineId: string): Workspace {
  return {
    machineId,
    id: parked.id,
    name: parked.name,
    projectPath: parked.projectPath,
    command: parked.command,
    createdAt: parked.createdAt,
    lastActivityAt: parked.parkedAt,
    // Always `parked` — the record's existence IS the parked state, so this never consults
    // the status store (whose entry for a dead session is pruned at startup anyway).
    status: 'parked',
    urgent: false,
  };
}
