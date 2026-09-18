export interface ProjectListerPort {
  browse(path: string): Promise<{ subdirs: string[]; files: string[] }>;
  // Create a single directory at `path`. The parent must already exist (non-recursive).
  // Authorization is the caller's job — see makeDir + pathWithinRoots in the application layer.
  makeDir(path: string): Promise<void>;
}
