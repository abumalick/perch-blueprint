// A workspace whose tmux session has been killed to free resources, retained so it can be
// listed and later revived. Self-sufficient by design: FileStatusStore prunes entries for
// sessions that no longer exist at startup, and a parked workspace is by definition one
// with no session — so everything needed to list and resume it is snapshotted here rather
// than read back from the status store.
export interface ParkedWorkspace {
  id: string;
  name: string;
  projectPath: string;
  command: string;
  machineId: string;
  createdAt: number;
  parkedAt: number;
  // Last known Claude Code session id, captured at park time. Absent when no hook event
  // ever carried one (a brand-new session, or a non-Claude command like zsh/codex) — such
  // a workspace reopens fresh rather than resumed.
  claudeSessionId?: string;
}

export interface ParkedStorePort {
  list(): Promise<ParkedWorkspace[]>;
  get(id: string): Promise<ParkedWorkspace | undefined>;
  add(entry: ParkedWorkspace): Promise<void>;
  remove(id: string): Promise<void>;
}
