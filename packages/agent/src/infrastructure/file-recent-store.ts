import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RecentStorePort } from '../ports/recent-store-port';

export class FileRecentStore implements RecentStorePort {
  constructor(
    private readonly filePath: string,
    private readonly cap = 5,
  ) {}

  async list(): Promise<string[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const paths = Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string')
        : [];
      // Cap on read too, so a file written by an older, larger-cap agent still returns ≤ cap.
      return paths.slice(0, this.cap);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async record(path: string): Promise<void> {
    const current = await this.list();
    const next = [path, ...current.filter((p) => p !== path)].slice(0, this.cap);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8');
  }
}
