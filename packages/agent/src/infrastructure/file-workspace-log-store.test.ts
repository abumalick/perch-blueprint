import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWorkspaceLogStore } from './file-workspace-log-store';
import type { WorkspaceLogEntry } from '../ports/workspace-log-port';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-workspacelog-'));
  file = join(dir, 'nested', 'workspace-log.jsonl');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const entry: WorkspaceLogEntry = {
  id: 'perch-aa',
  name: 'Fix login',
  projectPath: '/home/u/workspace/api',
  machineId: 'dev',
  createdAt: 1000,
  closedAt: 2000,
  reason: 'closed-by-user',
  lastStatus: 'needs-feedback',
  claudeSessionId: undefined,
};

describe('FileWorkspaceLogStore', () => {
  it('writes one JSON line per entry and creates the directory', async () => {
    const store = new FileWorkspaceLogStore(file);
    await store.append(entry);
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(entry);
  });

  it('appends across calls without truncating', async () => {
    const store = new FileWorkspaceLogStore(file);
    await store.append(entry);
    await store.append({ ...entry, id: 'perch-bb', reason: 'exited' });
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toMatchObject({ id: 'perch-bb', reason: 'exited' });
  });
});
