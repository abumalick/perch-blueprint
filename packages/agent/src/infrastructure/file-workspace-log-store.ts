import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WorkspaceLogEntry, WorkspaceLogPort } from '../ports/workspace-log-port';

// Appends closed-workspace records to a JSONL file (default ~/.perch/workspace-log.jsonl),
// one self-contained record per line. Append-only, no rotation — matches client-log.jsonl.
export class FileWorkspaceLogStore implements WorkspaceLogPort {
  constructor(private readonly filePath: string) {}

  async append(entry: WorkspaceLogEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
  }
}
