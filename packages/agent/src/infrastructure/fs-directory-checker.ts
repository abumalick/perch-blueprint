import { stat } from 'node:fs/promises';
import type { DirectoryChecker } from '../ports/directory-checker';

// ENOENT, a permission error, or a path that is a file all mean "not a usable directory".
export const fsIsDirectory: DirectoryChecker = async (path) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};
