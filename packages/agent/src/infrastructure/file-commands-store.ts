import { readFile } from 'node:fs/promises';
import type { CommandEntry } from '@perch/contracts';
import type { CommandsPort } from '../ports/commands-port';
import { parseCommands } from '../application/parse-commands';

// Reads the command shortcuts from a file (default ~/.perch/commands.json). A missing or
// unreadable/malformed file yields an empty list, so the drop-down is opt-in by simply
// creating the file — and a bad file can never break the terminal.
export class FileCommandsStore implements CommandsPort {
  constructor(private readonly filePath: string) {}

  async list(): Promise<CommandEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return [];
    }
    try {
      return parseCommands(JSON.parse(raw));
    } catch {
      return [];
    }
  }
}
