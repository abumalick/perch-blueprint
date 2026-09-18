import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ParkedStorePort, ParkedWorkspace } from '../ports/parked-store-port';

// Reads/writes a JSON array of parked workspaces (default ~/.perch/parked.json). Read fresh
// from disk on every call, like FileHiddenFoldersStore — no caching, so a hand-edit takes
// effect immediately. A missing or malformed file yields an empty list, so a bad file can
// never break workspace listing; entries missing required fields are dropped individually.
export class FileParkedStore implements ParkedStorePort {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ParkedWorkspace[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map(parseEntry).filter((e): e is ParkedWorkspace => e !== undefined)
        : [];
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<ParkedWorkspace | undefined> {
    return (await this.list()).find((w) => w.id === id);
  }

  async add(entry: ParkedWorkspace): Promise<void> {
    const rest = (await this.list()).filter((w) => w.id !== entry.id);
    await this.persist([...rest, entry]);
  }

  async remove(id: string): Promise<void> {
    const all = await this.list();
    const rest = all.filter((w) => w.id !== id);
    if (rest.length === all.length) return;
    await this.persist(rest);
  }

  private async persist(entries: ParkedWorkspace[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(entries, null, 2), 'utf8');
  }
}

function parseEntry(value: unknown): ParkedWorkspace | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof v[k] === 'string' && (v[k] as string).length > 0 ? (v[k] as string) : undefined;
  const num = (k: string): number | undefined => (typeof v[k] === 'number' ? (v[k] as number) : undefined);
  const id = str('id');
  const name = str('name');
  const projectPath = str('projectPath');
  const command = str('command');
  const machineId = str('machineId');
  const createdAt = num('createdAt');
  const parkedAt = num('parkedAt');
  if (!id || !name || !projectPath || !command || !machineId || createdAt === undefined || parkedAt === undefined) {
    return undefined;
  }
  const claudeSessionId = str('claudeSessionId');
  return { id, name, projectPath, command, machineId, createdAt, parkedAt, ...(claudeSessionId ? { claudeSessionId } : {}) };
}
