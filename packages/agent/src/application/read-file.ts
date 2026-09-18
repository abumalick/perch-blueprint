import type { FileReaderPort } from '../ports/file-reader-port';
import { pathWithinRoots } from './path-within-roots';
import { classifyTextFile } from './classify-text-file';

export const MAX_FILE_BYTES = 512 * 1024;

export async function readFile(
  deps: { reader: FileReaderPort },
  path: string,
  allowedRoots: string[],
): Promise<{ binary: boolean; data: string; truncated: boolean }> {
  if (!pathWithinRoots(path, allowedRoots)) {
    throw new Error(`path outside allowed roots: ${path}`);
  }
  const { bytes, truncated } = await deps.reader.read(path, MAX_FILE_BYTES);
  const { binary, data } = classifyTextFile(bytes, truncated);
  return { binary, data, truncated };
}
