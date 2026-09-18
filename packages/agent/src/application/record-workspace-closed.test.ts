import { describe, it, expect } from 'vitest';
import { recordWorkspaceClosed } from './record-workspace-closed';
import type { WorkspaceLogEntry, WorkspaceLogPort } from '../ports/workspace-log-port';
import type { Workspace } from '@perch/contracts';

const workspace: Workspace = {
  machineId: 'dev',
  id: 'perch-aa',
  name: 'Fix login',
  projectPath: '/home/u/workspace/api',
  command: 'claude',
  createdAt: 1000,
  lastActivityAt: 1500,
  status: 'needs-feedback',
};

describe('recordWorkspaceClosed', () => {
  it('appends an entry built from the workspace snapshot, reason, clock, and status', async () => {
    const appended: WorkspaceLogEntry[] = [];
    const workspaceLog: WorkspaceLogPort = { append: async (e) => void appended.push(e) };
    await recordWorkspaceClosed(
      {
        workspaceLog,
        status: { get: () => 'needs-feedback', getClaudeSessionId: () => 'abc-123' },
        clock: { now: () => 2000 },
      },
      workspace,
      'closed-by-user',
    );
    expect(appended).toEqual([
      {
        id: 'perch-aa',
        name: 'Fix login',
        projectPath: '/home/u/workspace/api',
        machineId: 'dev',
        createdAt: 1000,
        closedAt: 2000,
        reason: 'closed-by-user',
        lastStatus: 'needs-feedback',
        claudeSessionId: 'abc-123',
      },
    ]);
  });

  it('records lastStatus and claudeSessionId as undefined when the status store never saw the id', async () => {
    const appended: WorkspaceLogEntry[] = [];
    const workspaceLog: WorkspaceLogPort = { append: async (e) => void appended.push(e) };
    await recordWorkspaceClosed(
      {
        workspaceLog,
        status: { get: () => undefined, getClaudeSessionId: () => undefined },
        clock: { now: () => 2000 },
      },
      workspace,
      'exited',
    );
    expect(appended[0]?.lastStatus).toBeUndefined();
    expect(appended[0]?.claudeSessionId).toBeUndefined();
    expect(appended[0]?.reason).toBe('exited');
  });

  it('does not throw when the workspace log append fails (best-effort)', async () => {
    const workspaceLog: WorkspaceLogPort = {
      append: async () => {
        throw new Error('disk full');
      },
    };
    await expect(
      recordWorkspaceClosed(
        {
          workspaceLog,
          status: { get: () => undefined, getClaudeSessionId: () => undefined },
          clock: { now: () => 2000 },
        },
        workspace,
        'exited',
      ),
    ).resolves.toBeUndefined();
  });
});
