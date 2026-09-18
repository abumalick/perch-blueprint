import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProjectListerPort } from '../ports/project-lister-port';

// Raw directory listing. Authorization (which paths a client may browse) is the caller's
// job — see browseDir + pathWithinRoots in the application layer.
export class FsProjectLister implements ProjectListerPort {
  async browse(path: string): Promise<{ subdirs: string[]; files: string[] }> {
    const target = resolve(path);
    const entries = await readdir(target, { withFileTypes: true });
    const subdirs = entries.filter((e) => e.isDirectory()).map((e) => join(target, e.name)).sort();
    const files = entries.filter((e) => e.isFile()).map((e) => join(target, e.name)).sort();
    return { subdirs, files };
  }

  async makeDir(path: string): Promise<void> {
    await mkdir(resolve(path));
  }
}
