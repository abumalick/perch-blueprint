export interface ClaudeSessionsPort {
  // Each live Claude Code session's address, keyed by the tmux session it runs in (which is
  // a Perch workspace id). Empty when the registry is absent — the PWA then shows no badge.
  addressesByTmuxSession(): Promise<Record<string, string>>;
}
