// Resolves to true only when `path` is an existing directory. Used to reject a workspace
// create against a non-existent path before tmux silently falls back to the home dir.
export type DirectoryChecker = (path: string) => Promise<boolean>;
