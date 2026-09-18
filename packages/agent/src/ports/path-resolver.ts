// Resolves a project path to an absolute, canonical form. A relative path becomes
// absolute (against the agent's cwd, the same base tmux uses), so the recent store and
// the tmux session cwd always agree and relative/absolute forms of the same directory
// dedupe instead of accumulating as separate entries.
export type PathResolver = (path: string) => string;
