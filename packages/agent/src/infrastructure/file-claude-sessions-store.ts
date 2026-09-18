import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeSessionsPort } from '../ports/claude-sessions-port';
import { parseClaudeSession } from '../application/parse-claude-session';

// Reads Claude Code's session registry (default ~/.claude/sessions), one json file per live
// session. A missing directory yields an empty map, so an agent on a machine without Claude
// Code — or a future version that moves the registry — simply shows no addresses.
//
// Read fresh on every call, deliberately: a cache would leave a newly-spawned session
// unaddressable until the agent restarted, which is exactly when the address is wanted.
export class FileClaudeSessionsStore implements ClaudeSessionsPort {
  constructor(private readonly dirPath: string) {}

  async addressesByTmuxSession(): Promise<Record<string, string>> {
    let files: string[];
    try {
      files = await readdir(this.dirPath);
    } catch {
      return {};
    }
    const addresses: Record<string, string> = {};
    await Promise.all(
      files
        // The directory also holds per-session `.key` files, which are not registry entries.
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => {
          const entry = await this.read(join(this.dirPath, f));
          if (entry) addresses[entry.tmuxSession] = entry.address;
        }),
    );
    return addresses;
  }

  // Another process writes these files while we read them, so a half-written or corrupted
  // one costs its own entry only — never the whole listing.
  private async read(path: string) {
    try {
      return parseClaudeSession(JSON.parse(await readFile(path, 'utf8')));
    } catch {
      return null;
    }
  }
}
