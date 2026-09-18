import { readFile } from 'node:fs/promises';
import type { HiddenFoldersPort } from '../ports/hidden-folders-port';

// Reads a JSON array of folder names from a file (default ~/.perch/hidden-folders.json).
// A missing or unreadable/malformed file yields an empty list, so filtering is opt-in by
// simply creating the file — and a bad file can never break workspace listing.
export class FileHiddenFoldersStore implements HiddenFoldersPort {
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : [];
    } catch {
      return [];
    }
  }
}
