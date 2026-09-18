// A pane's process scope — the unit of cleanup when a workspace closes.
//
// tmux (built with systemd support) puts every pane it spawns into its own transient
// `tmux-spawn-<uuid>.scope`. Killing the session only SIGHUPs the pane's process group, so
// anything that called setsid() — a backgrounded dev server, a self-daemonizing tool —
// survives in that scope with no tmux session left to find it by. Stopping the scope is the
// one handle that reaches all of them at once.
export interface ProcessScopePort {
  // The scope holding this pid, or null when there is none (no systemd, a non-Linux agent,
  // or a process outside any scope). Must be called while the process is alive: the answer
  // comes from /proc/<pid>, which disappears with it.
  scopeForPid(pid: number): Promise<string | null>;
  stopScope(name: string): Promise<void>;
}
