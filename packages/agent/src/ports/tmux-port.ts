export interface TmuxSessionInfo {
  name: string;
  startPath: string;
  command: string;
  createdAt: number;
  title: string;
}

export interface TmuxPort {
  listSessions(prefix: string): Promise<TmuxSessionInfo[]>;
  createSession(input: { name: string; cwd: string; command: string }): Promise<void>;
  killSession(name: string): Promise<void>;
  hasSession(name: string): Promise<boolean>;
  // The pid of the session's first pane, or null when the session is gone. Optional for the
  // same reason as `ensureHyperlinks`: it is additive, and an adapter that omits it simply
  // yields no scope to reap on close.
  panePid?(name: string): Promise<number | null>;
  // Best-effort: enable OSC 8 hyperlink passthrough for clients tmux renders to. Without
  // it tmux strips hyperlinks (its default terminal-features for xterm* omits `hyperlinks`),
  // so Claude Code's file/doc links reach the PWA as dead plain text. Optional because it
  // is an additive capability — an adapter that omits it just yields non-clickable links.
  ensureHyperlinks?(): Promise<void>;
}
