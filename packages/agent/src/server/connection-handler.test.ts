import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionHandler } from './connection-handler';
import { ViewerRegistry } from './viewer-registry';
import type { ClientConnection } from '../ports/client-connection';
import type { PtyPort } from '../ports/pty-port';
import type { AgentMessage, Workspace } from '@perch/contracts';
import type { TmuxPort } from '../ports/tmux-port';
import type { RecentStorePort } from '../ports/recent-store-port';
import type { ProjectListerPort } from '../ports/project-lister-port';
import type { FileReaderPort } from '../ports/file-reader-port';
import type { StatusStorePort } from '../ports/status-store-port';
import type { FileWriterPort } from '../ports/file-writer-port';
import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';
import type { BrowserCommandPort } from '../ports/browser-command-port';
import type { HiddenFoldersPort } from '../ports/hidden-folders-port';
import type { CommandsPort } from '../ports/commands-port';
import type { AgentConfig } from '../infrastructure/config';
import type { WorkspaceLogEntry, WorkspaceLogPort } from '../ports/workspace-log-port';
import type { DirectoryChecker } from '../ports/directory-checker';
import type { ParkedStorePort, ParkedWorkspace } from '../ports/parked-store-port';
import type { ProcessScopePort } from '../ports/process-scope-port';

function stubBrowserCommands(overrides: Partial<BrowserCommandPort> = {}): BrowserCommandPort {
  return {
    start: async () => undefined,
    navigate: async () => undefined,
    back: async () => undefined,
    forward: async () => undefined,
    stop: async () => undefined,
    setViewport: async () => undefined,
    ...overrides,
  };
}

function fakeParkedStore(): ParkedStorePort {
  const entries = new Map<string, ParkedWorkspace>();
  return {
    list: async () => [...entries.values()],
    get: async (id) => entries.get(id),
    add: async (entry) => {
      entries.set(entry.id, entry);
    },
    remove: async (id) => {
      entries.delete(id);
    },
  };
}

function fakeConn() {
  const sent: AgentMessage[] = [];
  let closed = false;
  let onMessage: (raw: unknown) => void = () => undefined;
  let onCloseL: () => void = () => undefined;
  const conn: ClientConnection = {
    send: (m) => sent.push(m),
    close: () => {
      closed = true;
    },
    onMessage: (l) => {
      onMessage = l;
    },
    onClose: (l) => {
      onCloseL = l;
    },
  };
  return {
    conn,
    sent,
    isClosed: () => closed,
    emit: (raw: unknown) => onMessage(raw),
    triggerClose: () => onCloseL(),
  };
}

function fakePty() {
  const sessions: Array<{
    spawnArgs: { command: string; args: string[]; cols: number; rows: number };
    dataListeners: Array<(d: string) => void>;
    exitListeners: Array<() => void>;
    written: string[];
    resizes: Array<{ cols: number; rows: number }>;
    killed: boolean;
  }> = [];
  const pty: PtyPort = {
    spawn: (spawnArgs) => {
      const s = {
        spawnArgs,
        dataListeners: [] as Array<(d: string) => void>,
        exitListeners: [] as Array<() => void>,
        written: [] as string[],
        resizes: [] as Array<{ cols: number; rows: number }>,
        killed: false,
      };
      sessions.push(s);
      return {
        onData: (l: (d: string) => void) => s.dataListeners.push(l),
        onExit: (l: () => void) => s.exitListeners.push(l),
        write: (d: string) => s.written.push(d),
        resize: (cols: number, rows: number) => s.resizes.push({ cols, rows }),
        kill: () => {
          s.killed = true;
        },
      };
    },
  };
  return { pty, sessions };
}

const config = { machineId: 'mini', token: 'secret', sessionPrefix: 'perch-', projectRoots: [] } as unknown as AgentConfig;
const noPty: PtyPort = { spawn: () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }) };

function baseDeps() {
  const tmux: TmuxPort = {
    listSessions: async () => [
      {
        name: 'perch-aa',
        startPath: '/home/u/workspace/api',
        command: 'claude',
        createdAt: 7000,
        title: 'dev',
      },
    ],
    createSession: async () => undefined,
    killSession: async () => undefined,
    hasSession: async () => true,
  };
  const recent: RecentStorePort = { list: async () => ['/r1'], record: async () => undefined };
  const lister: ProjectListerPort = {
    browse: async () => ({ subdirs: ['/p/a'], files: ['/p/f.txt'] }),
    makeDir: async () => undefined,
  };
  const reader: FileReaderPort = {
    read: async () => ({ bytes: new TextEncoder().encode('file body'), truncated: false }),
  };
  const hiddenFolders: HiddenFoldersPort = { list: async () => [] };
  const commands: CommandsPort = { list: async () => [] };
  return {
    config,
    tmux,
    recent,
    lister,
    reader,
    resolvePath: (p: string) => p,
    isDirectory: (async () => true) as DirectoryChecker,
    clock: { now: () => 1000 },
    ids: { next: () => 'zz' },
    pty: noPty,
    registry: new ViewerRegistry(),
    status: {
      get: () => undefined,
      getChangedAt: () => undefined,
      set: () => undefined,
      getUrgent: () => false,
      setUrgent: () => undefined,
      getClaudeSessionId: () => undefined,
      setClaudeSessionId: () => undefined,
      onChange: () => undefined,
    } as StatusStorePort,
    writer: {
      ensureDir: async () => undefined,
      exists: async () => false,
      writeFile: async () => undefined,
    } as FileWriterPort,
    browserDiscovery: {
      listSessions: async () => [{ name: 'perch-aa', streamPort: 9223 }],
    } as BrowserDiscoveryPort,
    browserCommands: stubBrowserCommands(),
    hiddenFolders,
    commands,
    workspaceLog: { append: async () => {} } as WorkspaceLogPort,
    forgetWorkspace: (_id: string): Workspace | undefined => undefined,
    broadcastClosed: () => undefined,
    parked: fakeParkedStore(),
    scopes: undefined as ProcessScopePort | undefined,
  };
}

let f: ReturnType<typeof fakeConn>;
beforeEach(() => {
  f = fakeConn();
});

// A dedicated harness for the park/unpark/close-while-parked behaviors: unlike baseDeps()'s
// tmux fake (a single live session named 'perch-aa'), these scenarios exercise a workspace
// id ('perch-1') that starts out live in tmux by default, so setStatus/attach can find it.
function makeHandler(
  overrides: { isDirectory?: DirectoryChecker; command?: string; claudeSessionId?: string } = {},
) {
  const deps = baseDeps();
  const parkedStore = fakeParkedStore();
  deps.parked = parkedStore;
  // Parking requires a known Claude session id, so default to one and let a test opt out by
  // passing the key explicitly as undefined. Key-presence, not `??`, so an explicit
  // `claudeSessionId: undefined` is honoured rather than falling back to the default.
  const claudeSessionId = 'claudeSessionId' in overrides ? overrides.claudeSessionId : 'sess-1';
  deps.status = { ...deps.status, getClaudeSessionId: () => claudeSessionId };
  const workspaceLogEntries: WorkspaceLogEntry[] = [];
  const workspaceLog: WorkspaceLogPort & { entries: WorkspaceLogEntry[] } = {
    entries: workspaceLogEntries,
    append: async (e) => {
      workspaceLogEntries.push(e);
    },
  };
  deps.workspaceLog = workspaceLog;
  const tmux: TmuxPort = {
    listSessions: async () => [
      {
        name: 'perch-1',
        startPath: '/projects/app',
        command: overrides.command ?? 'claude',
        createdAt: 1,
        title: 'Parked',
      },
    ],
    createSession: vi.fn(async () => undefined),
    killSession: vi.fn(async () => undefined),
    hasSession: async () => true,
  };
  deps.tmux = tmux;
  if (overrides.isDirectory) {
    deps.isDirectory = overrides.isDirectory;
  }
  const conn = fakeConn();
  const handler = new ConnectionHandler(conn.conn, deps);
  const send = async (message: unknown) => {
    conn.emit(message);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { handler, send, tmux, parkedStore, sent: conn.sent, workspaceLog };
}

async function authenticate(_handler: ConnectionHandler, send: (message: unknown) => Promise<void>): Promise<void> {
  await send({ type: 'auth', token: 'secret' });
}

describe('ConnectionHandler auth', () => {
  it('accepts a matching token', () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    expect(f.sent).toEqual([{ type: 'authResult', ok: true }]);
  });

  it('rejects a wrong token and closes', () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'nope' });
    expect(f.sent).toEqual([{ type: 'authResult', ok: false }]);
    expect(f.isClosed()).toBe(true);
  });

  it('rejects control messages before auth', () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'list' });
    expect(f.sent).toEqual([{ type: 'error', code: 'unauthorized', message: 'authenticate first' }]);
  });

  it('invalid frame before auth yields bad_message and does not close the connection', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'nonsense' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent.some((m) => m.type === 'error' && m.code === 'bad_message')).toBe(true);
    expect(f.isClosed()).toBe(false);
  });
});

describe('ConnectionHandler control routing', () => {
  it('lists workspaces after auth', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'list' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent[1]).toEqual({
      type: 'workspaces',
      workspaces: [
        {
          machineId: 'mini',
          id: 'perch-aa',
          name: 'api',
          projectPath: '/home/u/workspace/api',
          command: 'claude',
          createdAt: 7000,
          lastActivityAt: 7000,
          status: 'idle',
          urgent: false,
        },
      ],
    });
  });

  it('replies to a ping with a pong', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'ping' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual({ type: 'pong' });
  });

  it('setStatus records the new status in the status store', async () => {
    const deps = baseDeps();
    const calls: Array<[string, string]> = [];
    deps.status = {
      get: () => undefined,
      getChangedAt: () => undefined,
      set: (id: string, s: string) => {
        calls.push([id, s]);
      },
      getUrgent: () => false,
      setUrgent: () => undefined,
      getClaudeSessionId: () => undefined,
      setClaudeSessionId: () => undefined,
      onChange: () => undefined,
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'setStatus', workspaceId: 'perch-aa', status: 'blocked' });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([['perch-aa', 'blocked']]);
  });

  it('setUrgent records the pin in the status store', async () => {
    const deps = baseDeps();
    const calls: Array<[string, boolean]> = [];
    deps.status = {
      get: () => undefined,
      getChangedAt: () => undefined,
      set: () => undefined,
      getUrgent: () => false,
      setUrgent: (id: string, urgent: boolean) => {
        calls.push([id, urgent]);
      },
      getClaudeSessionId: () => undefined,
      setClaudeSessionId: () => undefined,
      onChange: () => undefined,
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'setUrgent', workspaceId: 'perch-aa', urgent: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([['perch-aa', true]]);
  });

  it('returns recent paths, and dir entries for a live workspace path', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'getRecentPaths' });
    // /home/u/workspace/api is the live workspace's project path, so browsing it is allowed
    // even though no PERCH_PROJECT_ROOTS are configured in this test.
    f.emit({ type: 'browseDir', path: '/home/u/workspace/api' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual({ type: 'recentPaths', paths: ['/r1'] });
    expect(f.sent).toContainEqual({
      type: 'dirEntries',
      path: '/home/u/workspace/api',
      subdirs: ['/p/a'],
      files: ['/p/f.txt'],
    });
  });

  it('hides configured folders from workspaces, recent paths, and dir entries', async () => {
    const deps = baseDeps();
    deps.hiddenFolders = { list: async () => ['secret-proj', 'archive'] };
    deps.tmux = {
      listSessions: async () => [
        { name: 'perch-visible', startPath: '/home/u/workspace/api', command: 'claude', createdAt: 1, title: 'a' },
        { name: 'perch-hidden', startPath: '/home/u/workspace/secret-proj', command: 'claude', createdAt: 2, title: 'b' },
      ],
      createSession: async () => undefined,
      killSession: async () => undefined,
      hasSession: async () => true,
    };
    deps.recent = {
      list: async () => ['/home/u/workspace/api', '/home/u/workspace/archive/x'],
      record: async () => undefined,
    };
    deps.lister = {
      browse: async () => ({
        subdirs: ['/home/u/workspace/api/sub', '/home/u/workspace/api/secret-proj'],
        files: ['/home/u/workspace/api/f.txt'],
      }),
      makeDir: async () => undefined,
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'list' });
    f.emit({ type: 'getRecentPaths' });
    f.emit({ type: 'browseDir', path: '/home/u/workspace/api' });
    await new Promise((r) => setTimeout(r, 0));

    const workspaces = f.sent.find((m) => m.type === 'workspaces');
    expect(workspaces?.type === 'workspaces' && workspaces.workspaces.map((w) => w.id)).toEqual([
      'perch-visible',
    ]);
    expect(f.sent).toContainEqual({ type: 'recentPaths', paths: ['/home/u/workspace/api'] });
    const entries = f.sent.find((m) => m.type === 'dirEntries');
    expect(entries?.type === 'dirEntries' && entries.subdirs).toEqual(['/home/u/workspace/api/sub']);
  });

  it('answers listRoots with the configured project roots', async () => {
    const deps = baseDeps();
    deps.config = { ...config, projectRoots: ['/home/u/workspace', '/srv/code'] } as typeof config;
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'listRoots' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual({ type: 'roots', roots: ['/home/u/workspace', '/srv/code'] });
  });

  it('answers listCommands with the machine configured shortcuts', async () => {
    const deps = baseDeps();
    deps.commands = {
      list: async () => [
        { command: '/myplugin:task', submit: false },
        { command: '/rename', submit: true },
      ],
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'listCommands' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual({
      type: 'commands',
      commands: [
        { command: '/myplugin:task', submit: false },
        { command: '/rename', submit: true },
      ],
    });
  });

  it('answers listCommands with an empty list when the machine has no config file', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'listCommands' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual({ type: 'commands', commands: [] });
  });

  it('answers readFile with fileContents for an allowed path', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'readFile', path: '/home/u/workspace/api/a.txt' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual({
      type: 'fileContents',
      path: '/home/u/workspace/api/a.txt',
      data: Buffer.from('file body').toString('base64'),
      truncated: false,
      binary: false,
    });
  });

  it('rejects reading a path outside any workspace or configured root', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'readFile', path: '/etc/passwd' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent.some((m) => m.type === 'error')).toBe(true);
    expect(f.sent.some((m) => m.type === 'fileContents')).toBe(false);
  });

  it('rejects browsing a path outside any workspace or configured root', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'browseDir', path: '/etc' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent.some((m) => m.type === 'error')).toBe(true);
    expect(f.sent.some((m) => m.type === 'dirEntries')).toBe(false);
  });

  it('makes a directory in an allowed path and replies with dirEntries for the new folder', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'makeDir', parent: '/home/u/workspace/api', name: 'docs' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual({
      type: 'dirEntries',
      path: '/home/u/workspace/api/docs',
      subdirs: ['/p/a'],
      files: ['/p/f.txt'],
    });
  });

  it('rejects making a directory outside any workspace or configured root', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'makeDir', parent: '/etc', name: 'evil' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent.some((m) => m.type === 'error')).toBe(true);
    expect(f.sent.some((m) => m.type === 'dirEntries')).toBe(false);
  });

  it('creates and closes workspaces', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'create', projectPath: '/home/u/workspace/api', command: 'claude' });
    f.emit({ type: 'close', workspaceId: 'perch-zz' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual(
      expect.objectContaining({ type: 'workspaceUpdated' }),
    );
    expect(f.sent).toContainEqual({ type: 'closed', workspaceId: 'perch-zz' });
  });

  // The close button must feel instant on the phone. Everything the agent still has to do
  // on the machine — tearing down agent-browser sessions, stopping the pane's scope — runs
  // after the acknowledgement, never in front of it.
  it('acknowledges the close before the browser cascade has finished', async () => {
    const deps = baseDeps();
    let releaseStop: () => void = () => undefined;
    const stopped = new Promise<void>((r) => {
      releaseStop = r;
    });
    deps.browserCommands = stubBrowserCommands({ stop: () => stopped });
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'close', workspaceId: 'perch-aa' });
    await new Promise((r) => setTimeout(r, 0));

    expect(f.sent).toContainEqual({ type: 'closed', workspaceId: 'perch-aa' });
    releaseStop();
    await stopped;
  });

  it('reaps the pane scope after acknowledging the close', async () => {
    const deps = baseDeps();
    const stoppedScopes: string[] = [];
    deps.tmux = { ...deps.tmux, panePid: async () => 4242 };
    deps.scopes = {
      scopeForPid: async () => 'tmux-spawn-abc.scope',
      stopScope: async (name) => {
        stoppedScopes.push(name);
      },
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'close', workspaceId: 'perch-aa' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(stoppedScopes).toEqual(['tmux-spawn-abc.scope']);
  });

  it('still closes when reaping the pane scope fails', async () => {
    const deps = baseDeps();
    deps.tmux = { ...deps.tmux, panePid: async () => 4242 };
    deps.scopes = {
      scopeForPid: async () => 'tmux-spawn-abc.scope',
      stopScope: async () => {
        throw new Error('Unit not loaded.');
      },
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'close', workspaceId: 'perch-aa' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(f.sent).toContainEqual({ type: 'closed', workspaceId: 'perch-aa' });
  });

  it('logs a closed-by-user workspace-log entry when explicitly closing a workspace, using the last poll snapshot if available', async () => {
    const deps = baseDeps();
    const logged: WorkspaceLogEntry[] = [];
    deps.workspaceLog = { append: async (e) => void logged.push(e) };
    deps.forgetWorkspace = (id) =>
      id === 'perch-aa'
        ? {
            machineId: 'mini',
            id: 'perch-aa',
            name: 'from-poll-snapshot',
            projectPath: '/home/u/workspace/api',
            command: 'claude',
            createdAt: 7000,
            lastActivityAt: 7000,
            status: 'idle',
          }
        : undefined;
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'close', workspaceId: 'perch-aa' });
    await new Promise((r) => setTimeout(r, 0));
    expect(logged).toEqual([
      expect.objectContaining({
        id: 'perch-aa',
        name: 'from-poll-snapshot',
        projectPath: '/home/u/workspace/api',
        reason: 'closed-by-user',
      }),
    ]);
  });

  it('falls back to a fresh tmux lookup when closing a workspace the poll never observed', async () => {
    const deps = baseDeps();
    const logged: WorkspaceLogEntry[] = [];
    deps.workspaceLog = { append: async (e) => void logged.push(e) };
    deps.forgetWorkspace = () => undefined; // never polled yet
    // baseDeps()'s tmux.listSessions already returns a single session named 'perch-aa'
    // at /home/u/workspace/api — the fallback snapshot source.
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'close', workspaceId: 'perch-aa' });
    await new Promise((r) => setTimeout(r, 0));
    expect(logged).toEqual([
      expect.objectContaining({ id: 'perch-aa', projectPath: '/home/u/workspace/api', reason: 'closed-by-user' }),
    ]);
  });

  it('does not log when closing a workspace id nothing knows about', async () => {
    const deps = baseDeps();
    const logged: WorkspaceLogEntry[] = [];
    deps.workspaceLog = { append: async (e) => void logged.push(e) };
    deps.forgetWorkspace = () => undefined;
    deps.tmux = { ...deps.tmux, listSessions: async () => [] };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'close', workspaceId: 'perch-ghost' });
    await new Promise((r) => setTimeout(r, 0));
    expect(logged).toEqual([]);
  });

  it('emits a bad_message error on an invalid frame', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'nonsense' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent.some((m) => m.type === 'error' && m.code === 'bad_message')).toBe(true);
  });

  it('use-case throwing yields error{code:internal}', async () => {
    const deps = baseDeps();
    deps.tmux = {
      ...deps.tmux,
      listSessions: async () => { throw new Error('db gone'); },
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'list' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent.some((m) => m.type === 'error' && m.code === 'internal')).toBe(true);
  });
});

describe('ConnectionHandler park/unpark', () => {
  it('parks the workspace when the status is set to parked', async () => {
    const { handler, send, tmux, parkedStore } = makeHandler();
    await authenticate(handler, send);
    await send({ type: 'setStatus', workspaceId: 'perch-1', status: 'parked' });
    expect(await parkedStore.get('perch-1')).toMatchObject({ id: 'perch-1' });
    expect(tmux.killSession).toHaveBeenCalledWith('perch-1');
  });

  it('does not park for any other status', async () => {
    const { handler, send, tmux, parkedStore } = makeHandler();
    await authenticate(handler, send);
    await send({ type: 'setStatus', workspaceId: 'perch-1', status: 'blocked' });
    expect(await parkedStore.get('perch-1')).toBeUndefined();
    expect(tmux.killSession).not.toHaveBeenCalled();
  });

  // Without a captured Claude session id the conversation cannot be resumed, so parking
  // would free the resources and silently throw the conversation away. Refuse instead.
  it('sends an error and leaves the session alive when no session id is known', async () => {
    const { handler, send, tmux, parkedStore, sent } = makeHandler({ claudeSessionId: undefined });
    await authenticate(handler, send);
    await send({ type: 'setStatus', workspaceId: 'perch-1', status: 'parked' });
    expect(await parkedStore.get('perch-1')).toBeUndefined();
    expect(tmux.killSession).not.toHaveBeenCalled();
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code: 'not-restorable' }));
  });

  it('unparks before attaching to a parked workspace', async () => {
    const { handler, send, tmux, parkedStore } = makeHandler();
    await parkedStore.add({
      id: 'perch-1',
      name: 'Parked',
      projectPath: '/projects/app',
      command: 'claude',
      machineId: 'dev',
      createdAt: 1,
      parkedAt: 2,
      claudeSessionId: 'sess-1',
    });
    await authenticate(handler, send);
    await send({ type: 'attach', workspaceId: 'perch-1', cols: 80, rows: 24 });
    expect(tmux.createSession).toHaveBeenCalledWith({
      name: 'perch-1',
      cwd: '/projects/app',
      command: 'claude --resume sess-1 || exec claude',
    });
    expect(await parkedStore.get('perch-1')).toBeUndefined();
  });

  it('attaches normally when the workspace is not parked', async () => {
    const { handler, send, tmux } = makeHandler();
    await authenticate(handler, send);
    await send({ type: 'attach', workspaceId: 'perch-1', cols: 80, rows: 24 });
    expect(tmux.createSession).not.toHaveBeenCalled();
  });

  it('errors instead of attaching when a parked workspace project directory is gone', async () => {
    const { handler, send, sent, tmux, parkedStore } = makeHandler({ isDirectory: async () => false });
    await parkedStore.add({
      id: 'perch-1',
      name: 'Parked',
      projectPath: '/projects/deleted',
      command: 'claude',
      machineId: 'dev',
      createdAt: 1,
      parkedAt: 2,
    });
    await authenticate(handler, send);
    await send({ type: 'attach', workspaceId: 'perch-1', cols: 80, rows: 24 });
    expect(tmux.createSession).not.toHaveBeenCalled();
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', code: 'missing-directory' }));
    expect(await parkedStore.get('perch-1')).toMatchObject({ id: 'perch-1' });
  });

  it('closing a parked workspace removes its record and logs it', async () => {
    const { handler, send, parkedStore, workspaceLog } = makeHandler();
    await parkedStore.add({
      id: 'perch-1',
      name: 'Parked',
      projectPath: '/projects/app',
      command: 'claude',
      machineId: 'dev',
      createdAt: 1,
      parkedAt: 2,
      claudeSessionId: 'sess-1',
    });
    await authenticate(handler, send);
    await send({ type: 'close', workspaceId: 'perch-1' });
    expect(await parkedStore.get('perch-1')).toBeUndefined();
    expect(workspaceLog.entries).toContainEqual(
      expect.objectContaining({ id: 'perch-1', reason: 'closed-by-user', claudeSessionId: 'sess-1' }),
    );
  });
});

describe('ConnectionHandler browser sessions', () => {
  it('follows the workspaces reply to list with browserSessions (names only)', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'list' });
    await new Promise((r) => setTimeout(r, 0));
    const workspacesIdx = f.sent.findIndex((m) => m.type === 'workspaces');
    const sessionsIdx = f.sent.findIndex((m) => m.type === 'browserSessions');
    expect(workspacesIdx).toBeGreaterThanOrEqual(0);
    expect(sessionsIdx).toBeGreaterThan(workspacesIdx);
    // Names only — streamPort never leaves the agent.
    expect(f.sent[sessionsIdx]).toEqual({ type: 'browserSessions', sessions: [{ name: 'perch-aa' }] });
  });

  it('degrades a discovery failure to an empty session list without breaking list', async () => {
    const deps = baseDeps();
    deps.browserDiscovery = {
      listSessions: async () => {
        throw new Error('scan failed');
      },
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'list' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual(expect.objectContaining({ type: 'workspaces' }));
    expect(f.sent).toContainEqual({ type: 'browserSessions', sessions: [] });
    expect(f.sent.some((m) => m.type === 'error')).toBe(false);
  });

  it('startBrowser starts a session named after the workspace and refreshes the list', async () => {
    const deps = baseDeps();
    const started: string[] = [];
    deps.browserCommands = stubBrowserCommands({
      start: async (session: string) => {
        started.push(session);
      },
    });
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'startBrowser', workspaceId: 'perch-aa' });
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['perch-aa']);
    expect(f.sent).toContainEqual({ type: 'browserSessions', sessions: [{ name: 'perch-aa' }] });
  });

  it('answers a failed startBrowser with error{start-browser-failed}', async () => {
    const deps = baseDeps();
    deps.browserCommands = stubBrowserCommands({
      start: async () => {
        throw new Error('spawn failed');
      },
    });
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'startBrowser', workspaceId: 'perch-aa' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent).toContainEqual({ type: 'error', code: 'start-browser-failed', message: 'spawn failed' });
    expect(f.sent.some((m) => m.type === 'browserSessions')).toBe(false);
  });
});

describe('ConnectionHandler putFile', () => {
  it('stores a pasted file under the workspace cwd and replies fileStored', async () => {
    const deps = baseDeps();
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    deps.writer = {
      ensureDir: async () => undefined,
      exists: async () => false,
      writeFile: async (p: string, b: Uint8Array) => void writes.push({ path: p, bytes: b }),
    };
    new ConnectionHandler(f.conn, deps);
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({
      type: 'putFile',
      workspaceId: 'perch-aa',
      name: 'pasted-image.png',
      data: Buffer.from([1, 2, 3]).toString('base64'),
    });
    await new Promise((r) => setTimeout(r, 0));
    // /home/u/workspace/api is the live workspace's projectPath in baseDeps()'s tmux fake.
    expect(writes[0]!.path).toBe('/home/u/workspace/api/.tmp/files/pasted-image.png');
    expect([...writes[0]!.bytes]).toEqual([1, 2, 3]);
    expect(f.sent).toContainEqual({
      type: 'fileStored',
      workspaceId: 'perch-aa',
      path: '.tmp/files/pasted-image.png',
    });
  });

  it('rejects putFile for an unknown workspace', async () => {
    new ConnectionHandler(f.conn, baseDeps());
    f.emit({ type: 'auth', token: 'secret' });
    f.emit({ type: 'putFile', workspaceId: 'nope', name: 'x.png', data: 'AAAA' });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent.some((m) => m.type === 'error')).toBe(true);
    expect(f.sent.some((m) => m.type === 'fileStored')).toBe(false);
  });
});

describe('ConnectionHandler.pushWorkspaceUpdated', () => {
  it('sends workspaceUpdated only after auth', () => {
    const f = fakeConn();
    const handler = new ConnectionHandler(f.conn, baseDeps());
    const ws = {
      machineId: 'mini',
      id: 'perch-aa',
      name: 'api',
      projectPath: '/p/api',
      command: 'claude',
      createdAt: 1,
      lastActivityAt: 1,
      status: 'finished' as const,
    };
    handler.pushWorkspaceUpdated(ws); // not authed → ignored
    expect(f.sent).toEqual([]);
    f.emit({ type: 'auth', token: 'secret' });
    handler.pushWorkspaceUpdated(ws);
    expect(f.sent).toContainEqual({ type: 'workspaceUpdated', workspace: ws });
  });
});

describe('ConnectionHandler.pushBrowserSessions', () => {
  it('sends browserSessions only after auth', () => {
    const f = fakeConn();
    const handler = new ConnectionHandler(f.conn, baseDeps());
    handler.pushBrowserSessions([{ name: 'github' }]); // connection not authenticated → ignored
    expect(f.sent).toEqual([]);
    f.emit({ type: 'auth', token: 'secret' });
    handler.pushBrowserSessions([{ name: 'github' }]);
    expect(f.sent).toContainEqual({ type: 'browserSessions', sessions: [{ name: 'github' }] });
  });
});

describe('ConnectionHandler attach lifecycle', () => {
  it('attaches, streams base64 output, forwards input and resize', async () => {
    const fp = fakePty();
    const f2 = fakeConn();
    new ConnectionHandler(f2.conn, { ...baseDeps(), pty: fp.pty });
    f2.emit({ type: 'auth', token: 'secret' });
    f2.emit({ type: 'attach', workspaceId: 'perch-aa', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 0));

    const s = fp.sessions[0]!;
    expect(s.spawnArgs).toEqual({ command: 'tmux', args: ['attach-session', '-t', 'perch-aa'], cols: 80, rows: 24 });
    expect(f2.sent).toContainEqual({ type: 'attached', workspaceId: 'perch-aa' });

    s.dataListeners.forEach((l) => l('hello'));
    expect(f2.sent).toContainEqual({
      type: 'output',
      workspaceId: 'perch-aa',
      data: Buffer.from('hello', 'utf8').toString('base64'),
    });

    f2.emit({ type: 'input', workspaceId: 'perch-aa', data: Buffer.from('ls\n', 'utf8').toString('base64') });
    f2.emit({ type: 'resize', workspaceId: 'perch-aa', cols: 100, rows: 30 });
    await new Promise((r) => setTimeout(r, 0));
    expect(s.written).toEqual(['ls\n']);
    expect(s.resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('enables tmux hyperlink passthrough before attaching the pty', async () => {
    // Without this, tmux strips OSC 8 links and they reach the PWA as dead plain text.
    // It must run before the attach client connects (tmux reads features at attach time).
    const fp = fakePty();
    const f2 = fakeConn();
    const calls: string[] = [];
    const deps = { ...baseDeps(), pty: fp.pty };
    deps.tmux = { ...deps.tmux, ensureHyperlinks: async () => void calls.push('ensure') };
    const origSpawn = fp.pty.spawn;
    fp.pty.spawn = ((args: Parameters<typeof origSpawn>[0]) => {
      calls.push('spawn');
      return origSpawn(args);
    }) as typeof origSpawn;

    new ConnectionHandler(f2.conn, deps);
    f2.emit({ type: 'auth', token: 'secret' });
    f2.emit({ type: 'attach', workspaceId: 'perch-aa', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toEqual(['ensure', 'spawn']);
  });

  it('evicts a prior viewer of the same workspace across connections', async () => {
    const fp = fakePty();
    const registry = new ViewerRegistry();
    const fa = fakeConn();
    const fb = fakeConn();
    new ConnectionHandler(fa.conn, { ...baseDeps(), pty: fp.pty, registry });
    new ConnectionHandler(fb.conn, { ...baseDeps(), pty: fp.pty, registry });

    fa.emit({ type: 'auth', token: 'secret' });
    fa.emit({ type: 'attach', workspaceId: 'perch-aa', cols: 80, rows: 24 });
    fb.emit({ type: 'auth', token: 'secret' });
    fb.emit({ type: 'attach', workspaceId: 'perch-aa', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 0));

    expect(fa.sent).toContainEqual({ type: 'detached', workspaceId: 'perch-aa', reason: 'opened-elsewhere' });
    expect(fp.sessions[0]!.killed).toBe(true);

    // Fire the evicted session's exit — must NOT send a second detached to A
    fp.sessions[0]!.exitListeners.forEach((l) => l());
    await new Promise((r) => setTimeout(r, 0));
    expect(fa.sent.filter((m) => m.type === 'detached')).toHaveLength(1);
  });

  it('organic pty exit sends exactly one detached{closed}', async () => {
    const fp = fakePty();
    const f2 = fakeConn();
    new ConnectionHandler(f2.conn, { ...baseDeps(), pty: fp.pty });
    f2.emit({ type: 'auth', token: 'secret' });
    f2.emit({ type: 'attach', workspaceId: 'perch-aa', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 0));

    fp.sessions[0]!.exitListeners.forEach((l) => l());
    await new Promise((r) => setTimeout(r, 0));

    const detachedMsgs = f2.sent.filter((m) => m.type === 'detached');
    expect(detachedMsgs).toHaveLength(1);
    expect(detachedMsgs[0]).toEqual({ type: 'detached', workspaceId: 'perch-aa', reason: 'closed' });
  });

  it('tears down the pty when the connection closes', async () => {
    const fp = fakePty();
    const f3 = fakeConn();
    new ConnectionHandler(f3.conn, { ...baseDeps(), pty: fp.pty });
    f3.emit({ type: 'auth', token: 'secret' });
    f3.emit({ type: 'attach', workspaceId: 'perch-aa', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 0));
    f3.triggerClose();
    expect(fp.sessions[0]!.killed).toBe(true);
  });
});
