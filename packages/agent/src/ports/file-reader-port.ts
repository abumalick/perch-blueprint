export interface FileReaderPort {
  // Reads up to `maxBytes` of the file. `truncated` is true when the file is larger than
  // the cap (only the first `maxBytes` are returned). Authorization is the caller's job —
  // see read-file + pathWithinRoots in the application layer.
  read(path: string, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }>;
}
