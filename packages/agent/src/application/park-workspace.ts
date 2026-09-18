import type { Workspace } from '@perch/contracts';
import type { TmuxPort } from '../ports/tmux-port';
import type { StatusStorePort } from '../ports/status-store-port';
import type { ParkedStorePort } from '../ports/parked-store-port';
import type { Clock } from '../ports/clock';

export interface ParkWorkspaceDeps {
  parked: Pick<ParkedStorePort, 'get' | 'add'>;
  tmux: Pick<TmuxPort, 'killSession'>;
  status: Pick<StatusStorePort, 'getClaudeSessionId' | 'set'>;
  clock: Clock;
}

// 'already-parked': a record already existed, nothing changed.
// 'not-restorable': neither a command nor a session id is known, so parking was refused
// and the session was left alive — see parkWorkspace below.
export type ParkResult = 'parked' | 'already-parked' | 'not-restorable';

// Frees a workspace's resources (the claude process, its tmux session, its pty) while
// keeping it listed and revivable.
//
// A known claudeSessionId is REQUIRED. Parking frees the resources either way, but without
// an id the conversation cannot be resumed — so parking would silently throw away the very
// thing the feature exists to preserve, which is worse than not parking at all. Refuse
// instead, and let the caller tell the user. An id appears once any Claude Code hook fires
// for the session, so a workspace becomes parkable as soon as it is used.
//
// `workspace.command` comes from the tmux session option `@perch_command`, which
// tmux-continuum does not restore after a reboot — a continuum-revived workspace therefore
// has an empty command even though it is a live, resumable Claude session. Falling back to
// the literal `'claude'` keeps such a workspace parkable: unparking then runs
// `claude --resume <id> || exec claude` (default model, since the original flags are lost).
//
// Step order is load-bearing:
//  1. tmux cannot answer questions about a session after it is killed, so the snapshot
//     must be complete before the kill.
//  2. FileStatusStore prunes entries for dead sessions at startup, so claudeSessionId has
//     to be copied into the record now — reading it back later would find nothing.
//  3. status.set fires onChange -> WsServer.broadcastWorkspace, which rebuilds the
//     workspace via listWorkspaces. Doing it last means that broadcast finds the record
//     already written and emits a correct `parked` entry instead of a half-torn-down one.
//     It is also the ONLY thing that announces a park: pollTitles broadcasts on a name
//     change, never on a status change.
export async function parkWorkspace(
  deps: ParkWorkspaceDeps,
  workspace: Workspace,
): Promise<ParkResult> {
  // Keyed on the record, never on `workspace.status === 'parked'`: the postponed->parked
  // rename relabels pre-existing LIVE workspaces to `parked` with no record, and those
  // must still be parkable.
  if (await deps.parked.get(workspace.id)) {
    return 'already-parked';
  }
  const claudeSessionId = deps.status.getClaudeSessionId(workspace.id);
  if (!claudeSessionId) {
    return 'not-restorable';
  }
  const hasCommand = workspace.command.trim().length > 0;
  const command = hasCommand ? workspace.command : 'claude';
  await deps.parked.add({
    id: workspace.id,
    name: workspace.name,
    projectPath: workspace.projectPath,
    command,
    machineId: workspace.machineId,
    createdAt: workspace.createdAt,
    parkedAt: deps.clock.now(),
    claudeSessionId,
  });
  await deps.tmux.killSession(workspace.id);
  deps.status.set(workspace.id, 'parked');
  return 'parked';
}
