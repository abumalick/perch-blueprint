export interface HiddenFoldersPort {
  // The folder names to hide across workspaces, recent paths, and the folder picker.
  // Empty when the config file is absent — filtering is then off.
  list(): Promise<string[]>;
}
