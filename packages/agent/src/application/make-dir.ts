import { join } from 'node:path';
import type { ProjectListerPort } from '../ports/project-lister-port';
import { pathWithinRoots } from './path-within-roots';

// A safe new folder name: a single non-empty path segment, no separators or traversal.
function isValidFolderName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && name !== '.' && name !== '..';
}

// Create a directory `name` inside `parent`, confined to `allowedRoots`, and return the
// created absolute path. Rejects unsafe names and paths outside the allowed roots (the same
// guard as browseDir) so a client can never mkdir outside its sandbox.
export async function makeDir(
  deps: { lister: Pick<ProjectListerPort, 'makeDir'> },
  parent: string,
  name: string,
  allowedRoots: string[],
): Promise<string> {
  const clean = name.trim();
  if (!isValidFolderName(clean)) {
    throw new Error(`invalid folder name: ${name}`);
  }
  const target = join(parent, clean);
  if (!pathWithinRoots(target, allowedRoots)) {
    throw new Error(`path outside allowed roots: ${target}`);
  }
  await deps.lister.makeDir(target);
  return target;
}
