import type { ProjectListerPort } from '../ports/project-lister-port';
import { pathWithinRoots } from './path-within-roots';
import { isHiddenPath } from './is-hidden-path';

export async function browseDir(
  deps: { lister: ProjectListerPort; hidden: string[] },
  path: string,
  allowedRoots: string[],
): Promise<{ subdirs: string[]; files: string[] }> {
  if (!pathWithinRoots(path, allowedRoots)) {
    throw new Error(`path outside allowed roots: ${path}`);
  }
  const { subdirs, files } = await deps.lister.browse(path);
  return {
    subdirs: subdirs.filter((d) => !isHiddenPath(d, deps.hidden)),
    files,
  };
}
