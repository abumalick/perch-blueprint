import type { TmuxPort } from '../ports/tmux-port';
import type { ParkedStorePort } from '../ports/parked-store-port';

export interface ReconcileParkedDeps {
  parked: Pick<ParkedStorePort, 'list'>;
  tmux: Pick<TmuxPort, 'listSessions' | 'killSession'>;
  sessionPrefix: string;
}

// Resolves the one collision a parked record can have with a live tmux session, at startup.
//
// Workspace ids are randomly generated, so a live session can never collide with a parked
// record through normal use. The only cause is tmux-continuum, which restores session names
// (but not the claude process inside them) when the tmux server starts — resurrecting a
// parked id as an empty shell. The record wins: letting the shell win would discard the
// claudeSessionId of exactly the long-parked workspaces most likely to survive to a reboot,
// which is the case parking exists for. Killing the orphan leaves one source of truth.
//
// Done here rather than inside listWorkspaces so that listing stays free of side effects.
export async function reconcileParked(deps: ReconcileParkedDeps): Promise<string[]> {
  const parked = await deps.parked.list();
  if (parked.length === 0) {
    return [];
  }
  const parkedIds = new Set(parked.map((p) => p.id));
  const sessions = await deps.tmux.listSessions(deps.sessionPrefix);
  const orphans = sessions.map((s) => s.name).filter((name) => parkedIds.has(name));
  for (const name of orphans) {
    await deps.tmux.killSession(name);
  }
  return orphans;
}
