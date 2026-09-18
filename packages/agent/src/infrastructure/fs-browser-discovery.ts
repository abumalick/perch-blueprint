import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserDiscoveryPort, BrowserSessionInfo } from '../ports/browser-discovery-port';

function defaultDir(): string {
  const runtime = process.env.XDG_RUNTIME_DIR;
  return runtime ? join(runtime, 'agent-browser') : join(homedir(), '.agent-browser');
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Discovers live agent-browser sessions from its sidecar files: `<name>.stream`
// holds the stream server port and `<name>.pid` the browser process pid. Stale
// files (dead pid, unparsable port) are skipped; a missing dir means agent-browser
// isn't installed or never ran, which is not an error.
export class FsBrowserDiscovery implements BrowserDiscoveryPort {
  private readonly dir: string;
  private readonly isPidAlive: (pid: number) => boolean;

  constructor(opts: { dir?: string; isPidAlive?: (pid: number) => boolean } = {}) {
    this.dir = opts.dir ?? defaultDir();
    this.isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;
  }

  async listSessions(): Promise<BrowserSessionInfo[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const sessions: BrowserSessionInfo[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.stream')) continue;
      const name = entry.slice(0, -'.stream'.length);
      const streamPort = await readPositiveInt(join(this.dir, entry));
      if (streamPort === undefined) continue;
      const pid = await readPositiveInt(join(this.dir, `${name}.pid`));
      if (pid === undefined || !this.isPidAlive(pid)) continue;
      sessions.push({ name, streamPort });
    }
    return sessions;
  }
}

async function readPositiveInt(path: string): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}
