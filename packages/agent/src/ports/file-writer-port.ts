export interface FileWriterPort {
  // Creates `dir` (recursively) if it does not exist.
  ensureDir(dir: string): Promise<void>;
  // True iff a filesystem entry exists at `path`.
  exists(path: string): Promise<boolean>;
  // Writes the raw bytes to `path`, overwriting any existing file.
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}
