import { describe, it, expect } from 'vitest';
import { listWorkspaces } from './list-workspaces';
import type { TmuxPort } from '../ports/tmux-port';
import type { StatusStorePort } from '../ports/status-store-port';

type StatusFake = Pick<StatusStorePort, 'get' | 'getChangedAt' | 'getUrgent'>;

const noStatus: StatusFake = {
  get: () => undefined,
  getChangedAt: () => undefined,
  getUrgent: () => false,
};

const baseTmux: TmuxPort = {
  listSessions: async () => [
    { name: 'perch-1', startPath: '/home/u/workspace/foo', command: 'claude', createdAt: 1, title: 'dev' },
  ],
  createSession: async () => undefined,
  killSession: async () => undefined,
  hasSession: async () => true,
};

const baseDeps = {
  tmux: baseTmux,
  machineId: 'mini',
  sessionPrefix: 'perch-',
  status: noStatus,
};

describe('listWorkspaces', () => {
  it('maps tmux sessions to workspaces, defaulting status to idle', async () => {
    const tmux: TmuxPort = {
      listSessions: async () => [
        {
          name: 'perch-aa',
          startPath: '/home/u/workspace/api',
          command: 'claude',
          createdAt: 5000,
          title: 'dev',
        },
      ],
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => true,
    };

    const result = await listWorkspaces({
      tmux,
      machineId: 'mini',
      sessionPrefix: 'perch-',
      status: noStatus,
    });

    expect(result).toEqual([
      {
        machineId: 'mini',
        id: 'perch-aa',
        name: 'api',
        projectPath: '/home/u/workspace/api',
        command: 'claude',
        createdAt: 5000,
        lastActivityAt: 5000,
        status: 'idle',
        urgent: false,
      },
    ]);
  });

  it('derives the name from the live pane title, stripping the status glyph', async () => {
    const tmux: TmuxPort = {
      listSessions: async () => [
        {
          name: 'perch-cc',
          startPath: '/home/u/workspace/api',
          command: 'claude',
          createdAt: 1,
          title: '✳ refactor the parser',
        },
      ],
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => true,
    };

    const result = await listWorkspaces({
      tmux,
      machineId: 'm',
      sessionPrefix: 'perch-',
      status: noStatus,
    });
    expect(result[0]?.name).toBe('refactor the parser');
  });

  it('uses the stored status when present, defaulting others to idle', async () => {
    const tmux: TmuxPort = {
      listSessions: async () => [
        { name: 'perch-bb', startPath: '/p/web', command: 'claude', createdAt: 1, title: 'dev' },
        { name: 'perch-cc', startPath: '/p/api', command: 'claude', createdAt: 1, title: 'dev' },
      ],
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => true,
    };
    const status: StatusFake = {
      get: (id) => (id === 'perch-bb' ? 'blocked' : undefined),
      getChangedAt: () => undefined,
      getUrgent: () => false,
    };

    const result = await listWorkspaces({ tmux, machineId: 'm', sessionPrefix: 'perch-', status });
    expect(result.find((w) => w.id === 'perch-bb')?.status).toBe('blocked');
    expect(result.find((w) => w.id === 'perch-cc')?.status).toBe('idle');
  });

  it('stamps the urgent flag from the store', async () => {
    const tmux: TmuxPort = {
      listSessions: async () => [
        { name: 'perch-bb', startPath: '/p/web', command: 'claude', createdAt: 1, title: 'dev' },
        { name: 'perch-cc', startPath: '/p/api', command: 'claude', createdAt: 1, title: 'dev' },
      ],
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => true,
    };
    const status: StatusFake = {
      get: () => undefined,
      getChangedAt: () => undefined,
      getUrgent: (id) => id === 'perch-bb',
    };

    const result = await listWorkspaces({ tmux, machineId: 'm', sessionPrefix: 'perch-', status });
    expect(result.find((w) => w.id === 'perch-bb')?.urgent).toBe(true);
    expect(result.find((w) => w.id === 'perch-cc')?.urgent).toBe(false);
  });

  it('uses the status change time as lastActivityAt, falling back to createdAt', async () => {
    const tmux: TmuxPort = {
      listSessions: async () => [
        { name: 'perch-bb', startPath: '/p/web', command: 'claude', createdAt: 100, title: 'dev' },
        { name: 'perch-cc', startPath: '/p/api', command: 'claude', createdAt: 200, title: 'dev' },
      ],
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => true,
    };
    const status: StatusFake = {
      get: () => 'needs-feedback',
      getChangedAt: (id) => (id === 'perch-bb' ? 5000 : undefined),
      getUrgent: () => false,
    };

    const result = await listWorkspaces({ tmux, machineId: 'm', sessionPrefix: 'perch-', status });
    expect(result.find((w) => w.id === 'perch-bb')?.lastActivityAt).toBe(5000);
    expect(result.find((w) => w.id === 'perch-cc')?.lastActivityAt).toBe(200);
  });

  it('stamps github owner/repo from the repo-remote port, omitting it when null', async () => {
    const tmux: TmuxPort = {
      listSessions: async () => [
        { name: 'perch-gh', startPath: '/p/perch', command: 'claude', createdAt: 1, title: 'dev' },
        { name: 'perch-no', startPath: '/p/plain', command: 'claude', createdAt: 1, title: 'dev' },
      ],
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => true,
    };
    const repoRemote = {
      getGithubRepo: async (path: string) =>
        path === '/p/perch' ? { owner: 'someuser', repo: 'perch' } : null,
    };

    const result = await listWorkspaces({
      tmux,
      machineId: 'm',
      sessionPrefix: 'perch-',
      status: noStatus,
      repoRemote,
    });
    expect(result.find((w) => w.id === 'perch-gh')?.github).toEqual({ owner: 'someuser', repo: 'perch' });
    expect(result.find((w) => w.id === 'perch-no')).not.toHaveProperty('github');
  });

  it('omits github entirely when no repo-remote port is provided', async () => {
    const tmux: TmuxPort = {
      listSessions: async () => [
        { name: 'perch-aa', startPath: '/p/api', command: 'claude', createdAt: 1, title: 'dev' },
      ],
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => true,
    };
    const result = await listWorkspaces({ tmux, machineId: 'm', sessionPrefix: 'perch-', status: noStatus });
    expect(result[0]).not.toHaveProperty('github');
  });

  it('passes the configured prefix to the port', async () => {
    let seen = '';
    const tmux: TmuxPort = {
      listSessions: async (prefix) => {
        seen = prefix;
        return [];
      },
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => false,
    };
    await listWorkspaces({ tmux, machineId: 'm', sessionPrefix: 'perch-', status: noStatus });
    expect(seen).toBe('perch-');
  });

  it('includes parked workspaces, stamped parked and ordered by parkedAt', async () => {
    const parked = {
      list: async () => [
        {
          id: 'perch-parked',
          name: 'Shelved thing',
          projectPath: '/home/u/workspace/foo',
          command: 'claude --model opus',
          machineId: 'dev',
          createdAt: 100,
          parkedAt: 500,
          claudeSessionId: 'sess-1',
        },
      ],
    };
    const result = await listWorkspaces({ ...baseDeps, parked });
    const entry = result.find((w) => w.id === 'perch-parked');
    expect(entry).toMatchObject({
      id: 'perch-parked',
      name: 'Shelved thing',
      projectPath: '/home/u/workspace/foo',
      command: 'claude --model opus',
      status: 'parked',
      createdAt: 100,
      lastActivityAt: 500,
    });
  });

  it('lets a parked record shadow a live session of the same id', async () => {
    // Only reachable via tmux-continuum resurrecting a parked id as an empty shell; the
    // record wins so its claudeSessionId is not thrown away. Startup reconciliation
    // normally kills the orphan session before this is ever observed.
    const parked = {
      list: async () => [
        {
          id: 'perch-1', // same id the fake tmux reports as live
          name: 'Parked one',
          projectPath: '/home/u/workspace/foo',
          command: 'claude',
          machineId: 'dev',
          createdAt: 1,
          parkedAt: 2,
        },
      ],
    };
    const result = await listWorkspaces({ ...baseDeps, parked });
    expect(result.filter((w) => w.id === 'perch-1')).toHaveLength(1);
    expect(result.find((w) => w.id === 'perch-1')?.status).toBe('parked');
  });

  it('works with no parked dependency at all', async () => {
    const result = await listWorkspaces(baseDeps);
    expect(result.every((w) => w.status !== 'parked')).toBe(true);
  });
});

describe('listWorkspaces agent address', () => {
  const twoSessions: TmuxPort = {
    listSessions: async () => [
      { name: 'perch-cc', startPath: '/p/perch', command: 'claude', createdAt: 1, title: 'dev' },
      { name: 'perch-sh', startPath: '/p/plain', command: 'zsh', createdAt: 1, title: 'dev' },
    ],
    createSession: async () => undefined,
    killSession: async () => undefined,
    hasSession: async () => true,
  };

  it('stamps the address of the Claude session running in each workspace', async () => {
    const result = await listWorkspaces({
      ...baseDeps,
      tmux: twoSessions,
      claudeSessions: { addressesByTmuxSession: async () => ({ 'perch-cc': 'perch-be' }) },
    });
    expect(result.find((w) => w.id === 'perch-cc')?.agentAddress).toBe('perch-be');
  });

  // A workspace running zsh or Codex registers no Claude session, so it has nothing to
  // address — the field is omitted rather than blank.
  it('omits the address for a workspace with no registered session', async () => {
    const result = await listWorkspaces({
      ...baseDeps,
      tmux: twoSessions,
      claudeSessions: { addressesByTmuxSession: async () => ({ 'perch-cc': 'perch-be' }) },
    });
    expect(result.find((w) => w.id === 'perch-sh')).not.toHaveProperty('agentAddress');
  });

  it('omits the address entirely when no claude-sessions port is provided', async () => {
    const result = await listWorkspaces({ ...baseDeps, tmux: twoSessions });
    expect(result[0]).not.toHaveProperty('agentAddress');
  });

  // A parked workspace has no tmux session and no live process, so there is nothing to
  // contact even if a stale registry entry still carries its id.
  it('never stamps an address on a parked workspace', async () => {
    const parked = {
      list: async () => [
        {
          id: 'perch-parked',
          name: 'parked one',
          projectPath: '/p/perch',
          command: 'claude',
          machineId: 'mini',
          claudeSessionId: 'abc',
          createdAt: 1,
          parkedAt: 500,
        },
      ],
    };
    const result = await listWorkspaces({
      ...baseDeps,
      parked,
      claudeSessions: { addressesByTmuxSession: async () => ({ 'perch-parked': 'stale-address' }) },
    });
    expect(result.find((w) => w.id === 'perch-parked')).not.toHaveProperty('agentAddress');
  });
});
