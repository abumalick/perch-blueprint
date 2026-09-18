import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WsServer } from './ws-server';
import { TmuxAdapter } from '../infrastructure/tmux-adapter';
import { FileRecentStore } from '../infrastructure/file-recent-store';
import { FileClientLogStore } from '../infrastructure/file-client-log-store';
import { FileParkedStore } from '../infrastructure/file-parked-store';
import { FsProjectLister } from '../infrastructure/fs-project-lister';
import { FsFileReader } from '../infrastructure/fs-file-reader';
import { FsFileWriter } from '../infrastructure/fs-file-writer';
import { fsIsDirectory } from '../infrastructure/fs-directory-checker';
import { NodePtyAdapter } from '../infrastructure/node-pty-adapter';
import { InMemoryStatusStore } from '../infrastructure/in-memory-status-store';
import { systemClock, RandomIdGenerator, systemPathResolver } from '../infrastructure/system';
import type { AgentConfig } from '../infrastructure/config';
import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';
import type { BrowserCommandPort } from '../ports/browser-command-port';
import type { HiddenFoldersPort } from '../ports/hidden-folders-port';
import type { CommandsPort } from '../ports/commands-port';
import type { ClientLogPort } from '../ports/client-log-port';
import type { WorkspaceLogPort, WorkspaceLogEntry } from '../ports/workspace-log-port';
import type { ConnectUpstream } from '../ports/browser-stream-port';
import { connectBrowserUpstream } from '../infrastructure/ws-relay-socket';
import type { AgentMessage } from '@perch/contracts';

const noBrowserDiscovery: BrowserDiscoveryPort = { listSessions: async () => [] };
const noBrowserCommands: BrowserCommandPort = {
  start: async () => undefined,
  navigate: async () => undefined,
  back: async () => undefined,
  forward: async () => undefined,
  stop: async () => undefined,
  setViewport: async () => undefined,
};
const noHiddenFolders: HiddenFoldersPort = { list: async () => [] };
const noCommands: CommandsPort = { list: async () => [] };
const noClientLog: ClientLogPort = { append: async () => {} };
const noWorkspaceLog: WorkspaceLogPort = { append: async () => {} };
const noConnectUpstream: ConnectUpstream = () => Promise.reject(new Error('unexpected upstream dial'));

const exec = promisify(execFile);
const sessions: string[] = [];
const dirs: string[] = [];
let server: WsServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
  for (const n of sessions.splice(0)) await exec('tmux', ['kill-session', '-t', n]).catch(() => undefined);
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function nextMessage(socket: WebSocket): Promise<AgentMessage> {
  return new Promise((resolve) => {
    socket.once('message', (raw) => resolve(JSON.parse(raw.toString()) as AgentMessage));
  });
}

describe('WsServer (E2E, real tmux)', () => {
  it('authenticates and lists workspaces', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-srv-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));

    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    const authResult = await nextMessage(socket);
    expect(authResult).toEqual({ type: 'authResult', ok: true });

    socket.send(JSON.stringify({ type: 'list' }));
    const listed = await nextMessage(socket);
    expect(listed.type).toBe('workspaces');
    if (listed.type === 'workspaces') {
      expect(listed.workspaces.some((w) => w.id === name)).toBe(true);
    }

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('delivers a hook-driven workspaceUpdated to a connected client', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-hook-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    const updated = new Promise<AgentMessage>((resolve) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'workspaceUpdated') resolve(msg);
      });
    });

    const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ sessionName: name, event: 'Notification' }),
    });
    expect(res.status).toBe(204);

    const msg = await updated;
    expect(msg.type).toBe('workspaceUpdated');
    if (msg.type === 'workspaceUpdated') {
      expect(msg.workspace.id).toBe(name);
      expect(msg.workspace.status).toBe('needs-feedback');
    }

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('does NOT flip to needs-feedback when Stop reports a running background task', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-bg-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'),
      hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    let broadcast = false;
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as AgentMessage;
      if (msg.type === 'workspaceUpdated') broadcast = true;
    });

    const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({
        sessionName: name,
        event: 'Stop',
        claude: { background_tasks: [{ id: 'b00000001', type: 'shell', status: 'running' }] },
      }),
    });
    expect(res.status).toBe(204);

    await new Promise((r) => setTimeout(r, 300));
    expect(broadcast).toBe(false);

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('does NOT broadcast a hook-driven update for a workspace under a hidden folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-hidden-'));
    dirs.push(home);
    const projectDir = join(home, 'secret-proj');
    await mkdir(projectDir);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [home],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'),
      hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: { list: async () => ['secret-proj'] },
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', projectDir, 'sleep 30']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    let broadcast = false;
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as AgentMessage;
      if (msg.type === 'workspaceUpdated') broadcast = true;
    });

    const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ sessionName: name, event: 'Notification' }),
    });
    expect(res.status).toBe(204);

    await new Promise((r) => setTimeout(r, 300));
    expect(broadcast).toBe(false);

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('delivers a setStatus-driven workspaceUpdated to a connected client', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-block-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-block`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    const updated = new Promise<AgentMessage>((resolve) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'workspaceUpdated' && msg.workspace.id === name) resolve(msg);
      });
    });

    socket.send(JSON.stringify({ type: 'setStatus', workspaceId: name, status: 'blocked' }));

    const msg = await updated;
    expect(msg.type).toBe('workspaceUpdated');
    if (msg.type === 'workspaceUpdated') {
      expect(msg.workspace.id).toBe(name);
      expect(msg.workspace.status).toBe('blocked');
    }

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('polls tmux and pushes a workspaceUpdated when a pane title changes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-title-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
      titlePollMs: 50,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-title`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    const renamed = new Promise<AgentMessage>((resolve) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'workspaceUpdated' && msg.workspace.id === name && msg.workspace.name === 'fresh title') {
          resolve(msg);
        }
      });
    });

    // Let the poller record the session's initial (hostname-derived) name first.
    await new Promise((r) => setTimeout(r, 300));
    await exec('tmux', ['select-pane', '-t', name, '-T', '✳ fresh title']);

    const msg = await renamed;
    expect(msg.type).toBe('workspaceUpdated');
    if (msg.type === 'workspaceUpdated') {
      expect(msg.workspace.name).toBe('fresh title');
    }

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('polls tmux and pushes a closed when a session disappears', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-gone-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    const workspaceLogged: WorkspaceLogEntry[] = [];
    const workspaceLog: WorkspaceLogPort = { append: async (e) => void workspaceLogged.push(e) };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
      titlePollMs: 50,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-gone`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    const closed = new Promise<AgentMessage>((resolve) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'closed' && msg.workspaceId === name) resolve(msg);
      });
    });

    // Let the poller record the session as present first, then kill it out from under
    // the agent (as happens when the inner Claude process exits and tmux destroys it).
    await new Promise((r) => setTimeout(r, 300));
    await exec('tmux', ['kill-session', '-t', name]);

    const msg = await closed;
    expect(msg.type).toBe('closed');
    if (msg.type === 'closed') {
      expect(msg.workspaceId).toBe(name);
    }
    expect(workspaceLogged).toEqual([
      expect.objectContaining({ id: name, projectPath: tmpdir(), reason: 'exited' }),
    ]);

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('broadcasts closed to every connected device on an explicit close, and logs exactly one entry', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-explicit-close-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    const workspaceLogged: WorkspaceLogEntry[] = [];
    const workspaceLog: WorkspaceLogPort = { append: async (e) => void workspaceLogged.push(e) };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
      // A coarser interval than the other polling tests here (50ms): this test's race is
      // *with the poll itself* (forgetWorkspace's synchronous map removal racing the async
      // tmux kill it precedes — the accepted "narrow double-log race"), so a tight
      // interval makes the accepted, documented race far likelier to fire and flake this
      // test. A wider gap leaves a comfortable margin around the close for the real
      // tmux-kill subprocess to finish well clear of the neighbouring poll ticks.
      titlePollMs: 400,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-explicit`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const closer = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => closer.once('open', r));
    closer.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(closer); // authResult

    const observer = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => observer.once('open', r));
    observer.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(observer); // authResult

    // Let the poller record the session as present before closing it.
    await new Promise((r) => setTimeout(r, 450));

    const observerClosed = new Promise<AgentMessage>((resolve) => {
      observer.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'closed' && msg.workspaceId === name) resolve(msg);
      });
    });

    closer.send(JSON.stringify({ type: 'close', workspaceId: name }));
    await nextMessage(closer); // the requester's own `closed` reply

    const msg = await observerClosed; // the OTHER device must also get it
    expect(msg.type).toBe('closed');

    // Give the next poll tick(s) a chance to run and confirm no duplicate 'exited' entry appears.
    await new Promise((r) => setTimeout(r, 450));
    expect(workspaceLogged.filter((e) => e.id === name)).toEqual([
      expect.objectContaining({ id: name, reason: 'closed-by-user' }),
    ]);

    for (const s of [closer, observer]) {
      await new Promise<void>((resolve) => {
        s.on('close', () => resolve());
        s.close();
      });
    }
  });

  it('rejects a /hooks POST without the bearer token', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-hook401-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test', token: 'secret', host: '127.0.0.1', port: 0,
      projectRoots: [tmpdir()], recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'), sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config, tmux: new TmuxAdapter(), recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(), reader: new FsFileReader(), resolvePath: systemPathResolver, isDirectory: fsIsDirectory, clock: systemClock,
      ids: new RandomIdGenerator(), pty: new NodePtyAdapter(), status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionName: 'perch-x', event: 'Stop' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a bad token', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-srv-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'wrong' }));
    const authResult = await nextMessage(socket);
    expect(authResult).toEqual({ type: 'authResult', ok: false });
    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  // The bug the fake-agent E2E could never catch: a session emits an OSC 8 hyperlink, and
  // it must reach the client THROUGH a real `tmux attach-session`. tmux's default
  // terminal-features for xterm* omits `hyperlinks`, so it strips the link to plain text
  // unless the agent enables passthrough on attach. We reset terminal-features to baseline
  // first so this test has teeth: without ConnectionHandler's ensureHyperlinks() the
  // assertion fails (the OSC 8 introducer never arrives).
  it('streams OSC 8 hyperlinks through a real tmux attach', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-osc8-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test', token: 'secret', host: '127.0.0.1', port: 0,
      projectRoots: [tmpdir()], recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'), sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config, tmux: new TmuxAdapter(), recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(), reader: new FsFileReader(), resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory, clock: systemClock,
      ids: new RandomIdGenerator(), pty: new NodePtyAdapter(), status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-osc8`;
    sessions.push(name);
    // A pane that prints an OSC 8 hyperlink and stays alive so the attach redraws it.
    const script =
      "printf '\\033]8;;%s\\033\\\\%s\\033]8;;\\033\\\\\\n' 'https://ex.com/HL' 'OSC8LINK'; sleep 30";
    await exec('tmux', ['new-session', '-d', '-s', name, '-x', '120', '-y', '30', '-c', tmpdir(), 'bash', '-c', script]);
    // Baseline: strip the hyperlinks feature so only the agent's attach can re-enable it.
    await exec('tmux', ['set', '-ug', 'terminal-features']).catch(() => undefined);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    let stream = '';
    const needle = '\x1b]8;;'; // OSC 8 introducer
    const seen = new Promise<void>((resolve) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'output' && msg.workspaceId === name) {
          stream += Buffer.from(msg.data, 'base64').toString('utf8');
          if (stream.includes(needle)) resolve();
        }
      });
    });
    socket.send(JSON.stringify({ type: 'attach', workspaceId: name, cols: 120, rows: 30 }));

    await Promise.race([
      seen,
      new Promise((_r, reject) => setTimeout(() => reject(new Error('no OSC 8 link in stream')), 5000)),
    ]);
    expect(stream).toContain(needle);
    expect(stream).toContain('https://ex.com/HL');

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('parks a workspace (killing tmux, keeping it listed) and reopens it on attach', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-park-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    const logged: WorkspaceLogEntry[] = [];
    const workspaceLog: WorkspaceLogPort = { append: async (e) => void logged.push(e) };
    const status = new InMemoryStatusStore();
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status,
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-park`;
    sessions.push(name);
    // `@perch_command` mirrors what TmuxAdapter.createSession sets on a real workspace —
    // FileParkedStore.list() drops any entry with an empty `command` field, so a parked
    // record for a session missing this option is silently unparseable.
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 300']);
    await exec('tmux', ['set-option', '-t', name, '@perch_command', 'sleep 300']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    const tmux = new TmuxAdapter();

    // Parking requires a resumable conversation. A real workspace gets this from the first
    // Claude Code hook event; stamp it directly so the test does not depend on hook wiring.
    status.setClaudeSessionId(name, 'sess-e2e');

    // Park it.
    socket.send(JSON.stringify({ type: 'setStatus', workspaceId: name, status: 'parked' }));
    await vi.waitFor(async () => {
      expect(await tmux.hasSession(name)).toBe(false);
    });

    // Still listed as parked — the PWA sees no gap, and parking is not a close.
    socket.send(JSON.stringify({ type: 'list' }));
    const listed = await nextMessage(socket);
    expect(listed.type).toBe('workspaces');
    if (listed.type === 'workspaces') {
      expect(listed.workspaces.find((w) => w.id === name)).toMatchObject({ status: 'parked' });
    }
    expect(logged.find((e) => e.id === name)).toBeUndefined();

    // Reopening recreates the session.
    socket.send(JSON.stringify({ type: 'attach', workspaceId: name, cols: 80, rows: 24 }));
    await vi.waitFor(async () => {
      expect(await tmux.hasSession(name)).toBe(true);
    });
    // unparkWorkspace creates the session before clearing the record, so hasSession can
    // flip true a moment before the parked-store write lands — poll this too rather than
    // reading the file exactly once.
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(config.parkedStorePath, 'utf8'))).toEqual([]);
    });

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('parks a continuum-restored session (no @perch_command) when a claude session id is known', async () => {
    // tmux-continuum restores sessions after a reboot but does not restore custom session
    // options, so a continuum-revived workspace has an empty `@perch_command`/command even
    // though it is a live, resumable Claude session (its id lives in the status store, set
    // by a prior hook event).
    const home = await mkdtemp(join(tmpdir(), 'perch-park-continuum-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    const status = new InMemoryStatusStore();
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status,
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-continuum`;
    sessions.push(name);
    // No `@perch_command` set — this is what a continuum-restored session looks like.
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 300']);
    status.setClaudeSessionId(name, 'sess-continuum');

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    const tmux = new TmuxAdapter();
    socket.send(JSON.stringify({ type: 'setStatus', workspaceId: name, status: 'parked' }));
    await vi.waitFor(async () => {
      expect(await tmux.hasSession(name)).toBe(false);
    });

    const parked = JSON.parse(await readFile(config.parkedStorePath, 'utf8')) as Array<{ id: string; command: string }>;
    expect(parked).toHaveLength(1);
    expect(parked[0]?.command).toBe('claude');

    socket.send(JSON.stringify({ type: 'list' }));
    const listed = await nextMessage(socket);
    expect(listed.type).toBe('workspaces');
    if (listed.type === 'workspaces') {
      expect(listed.workspaces.find((w) => w.id === name)).toMatchObject({ status: 'parked' });
    }

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('refuses to park a continuum-restored session (no @perch_command, no known session id), leaving it alive', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-park-continuum-refused-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-continuum-refused`;
    sessions.push(name);
    // No `@perch_command`, and no session id was ever recorded either — nothing to restore.
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 300']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    socket.send(JSON.stringify({ type: 'setStatus', workspaceId: name, status: 'parked' }));
    const errorMsg = await nextMessage(socket);
    expect(errorMsg).toMatchObject({ type: 'error', code: 'not-restorable' });

    const tmux = new TmuxAdapter();
    expect(await tmux.hasSession(name)).toBe(true);
    expect(JSON.parse(await readFile(config.parkedStorePath, 'utf8').catch(() => '[]'))).toEqual([]);

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('does NOT log or broadcast a close for a parked workspace once its session disappears', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-park-poll-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    const logged: WorkspaceLogEntry[] = [];
    const workspaceLog: WorkspaceLogPort = { append: async (e) => void logged.push(e) };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
      titlePollMs: 50,
    });
    await server.start();
    const port = server.address().port;

    const name = `perch-${Date.now()}-park-poll`;
    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 300']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    const closedForParked: string[] = [];
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as AgentMessage;
      if (msg.type === 'closed' && msg.workspaceId === name) closedForParked.push(msg.workspaceId);
    });

    // Let the poller record the session as present first, so the id is already tracked in
    // WsServer's internal `lastWorkspaces` map when it disappears below — exactly the
    // precondition the disappearance-detection loop needs to fire.
    await new Promise((r) => setTimeout(r, 300));

    // Land the workspace directly in the settled post-park state (a parked record on disk,
    // no tmux session) instead of going through the WS `setStatus: 'parked'` flow. That
    // flow's own `forgetWorkspace` call pre-emptively removes the id from `lastWorkspaces`
    // before parkWorkspace ever kills the session, so in the common case the poll never
    // gets a chance to observe a disappearance at all — the `parked: this.deps.parked`
    // protection only matters for a narrow, timing-dependent race (an in-flight poll
    // re-adding the id just before the kill lands; see the accepted-race comment on
    // `WsServer.forgetWorkspace`). Building the settled state directly exercises the
    // protection deterministically, independent of that race.
    await new FileParkedStore(config.parkedStorePath).add({
      id: name,
      name: 'parked test workspace',
      projectPath: tmpdir(),
      command: 'sleep 300',
      machineId: 'test',
      createdAt: Date.now(),
      parkedAt: Date.now(),
    });
    await exec('tmux', ['kill-session', '-t', name]);

    // Give several poll ticks (titlePollMs: 50) a chance to run against the settled state.
    // Absence can't be `vi.waitFor`'d, so wait a fixed window well past several ticks, then
    // assert.
    await new Promise((r) => setTimeout(r, 400));

    expect(closedForParked).toEqual([]);
    expect(logged.find((e) => e.id === name)).toBeUndefined();

    socket.send(JSON.stringify({ type: 'list' }));
    const listed = await nextMessage(socket);
    expect(listed.type).toBe('workspaces');
    if (listed.type === 'workspaces') {
      expect(listed.workspaces.find((w) => w.id === name)).toMatchObject({ status: 'parked' });
    }

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });
});

describe('WsServer browser-session polling', () => {
  it('pushes browserSessions when the live set changes, and only then', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-bpoll-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    // Mutable discovery: starts empty, then a session appears mid-test (as when the CLI
    // or another client starts one) — the poll must push the change without a `list`.
    let live: Array<{ name: string; streamPort: number }> = [];
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: { listSessions: async () => live },
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
      titlePollMs: 50,
    });
    await server.start();
    const port = server.address().port;

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    const pushed: AgentMessage[] = [];
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as AgentMessage;
      if (msg.type === 'browserSessions') pushed.push(msg);
    });

    // A few empty polls: an unchanged (empty) set must not be broadcast.
    await new Promise((r) => setTimeout(r, 300));
    expect(pushed).toEqual([]);

    live = [{ name: 'github', streamPort: 9300 }];
    await Promise.race([
      new Promise<void>((resolve) => {
        socket.on('message', (raw) => {
          if ((JSON.parse(raw.toString()) as AgentMessage).type === 'browserSessions') resolve();
        });
      }),
      new Promise((_r, reject) => setTimeout(() => reject(new Error('no browserSessions push')), 5000)),
    ]);
    expect(pushed).toEqual([{ type: 'browserSessions', sessions: [{ name: 'github' }] }]);

    // Unchanged set → no further pushes across later polls.
    await new Promise((r) => setTimeout(r, 300));
    expect(pushed).toHaveLength(1);

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });
});

describe('WsServer GET /file (image bytes over HTTP)', () => {
  async function startFileServer(projectRoots: string[]): Promise<number> {
    const home = await mkdtemp(join(tmpdir(), 'perch-file-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots,
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    });
    await server.start();
    return server.address().port;
  }

  const get = (port: number, path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}/file?path=${encodeURIComponent(path)}`, init);
  const auth = { headers: { authorization: 'Bearer secret' } };

  it('serves image bytes with the right content-type for an allowed image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'perch-img-'));
    dirs.push(root);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    await writeFile(join(root, 'logo.png'), bytes);
    const port = await startFileServer([root]);

    const res = await get(port, join(root, 'logo.png'), auth);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('serves pdf bytes with the application/pdf content-type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'perch-pdf-'));
    dirs.push(root);
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4]); // %PDF…
    await writeFile(join(root, 'doc.pdf'), bytes);
    const port = await startFileServer([root]);

    const res = await get(port, join(root, 'doc.pdf'), auth);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('rejects a request without the bearer token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'perch-img-'));
    dirs.push(root);
    await writeFile(join(root, 'logo.png'), Buffer.from([1, 2, 3]));
    const port = await startFileServer([root]);
    expect((await get(port, join(root, 'logo.png'))).status).toBe(401);
  });

  it('returns 403 for a path outside the allowed roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'perch-img-'));
    dirs.push(root);
    const port = await startFileServer([root]);
    expect((await get(port, '/etc/hosts.png', auth)).status).toBe(403);
  });

  it('returns 404 for a non-image path within the roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'perch-img-'));
    dirs.push(root);
    await writeFile(join(root, 'notes.txt'), 'hi');
    const port = await startFileServer([root]);
    expect((await get(port, join(root, 'notes.txt'), auth)).status).toBe(404);
  });

  it('returns 404 for a missing image within the roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'perch-img-'));
    dirs.push(root);
    const port = await startFileServer([root]);
    expect((await get(port, join(root, 'gone.png'), auth)).status).toBe(404);
  });

  it('answers a CORS preflight (OPTIONS) for /file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'perch-img-'));
    dirs.push(root);
    const port = await startFileServer([root]);
    const res = await fetch(`http://127.0.0.1:${port}/file`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });

  it('sets Access-Control-Allow-Origin on the image response (cross-origin fetch)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'perch-img-'));
    dirs.push(root);
    await writeFile(join(root, 'logo.png'), Buffer.from([1, 2, 3]));
    const port = await startFileServer([root]);
    const res = await get(port, join(root, 'logo.png'), auth);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('WsServer /browser upgrade routing', () => {
  async function startServer(browser?: {
    discovery?: BrowserDiscoveryPort;
    commands?: BrowserCommandPort;
  }): Promise<number> {
    const home = await mkdtemp(join(tmpdir(), 'perch-browser-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'), hiddenFoldersPath: join(home, 'hidden-folders.json'), commandsPath: join(home, 'commands.json'), clientLogPath: join(home, 'client-log.jsonl'), workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer({
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: browser?.discovery ?? noBrowserDiscovery,
      browserCommands: browser?.commands ?? noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog: noClientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
      titlePollMs: 50,
    });
    await server.start();
    return server.address().port;
  }

  it('cascades a browser-session close when a workspace vanishes on its own (inner process exit)', async () => {
    const name = `perch-${Date.now()}-vanish`;
    const stopped: string[] = [];
    const discovery: BrowserDiscoveryPort = {
      listSessions: async () => [
        { name, streamPort: 1 },
        { name: `${name}__tab`, streamPort: 2 },
        { name: 'github', streamPort: 3 },
      ],
    };
    const commands: BrowserCommandPort = { ...noBrowserCommands, stop: async (n) => void stopped.push(n) };
    const port = await startServer({ discovery, commands });

    sessions.push(name);
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', tmpdir(), 'sleep 30']);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.once('open', r));
    socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await nextMessage(socket); // authResult

    // Let the poller record the session as present before it disappears.
    await new Promise((r) => setTimeout(r, 200));
    // The inner process exits → tmux destroys the session, no Perch `close` message is sent.
    await exec('tmux', ['kill-session', '-t', name]);

    // The disappearance poll must cascade-stop the workspace's sessions (but not a
    // home-level per-site session like `github`).
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`cascade not observed; stopped=${stopped}`)), 3000);
      const tick = setInterval(() => {
        if (stopped.length >= 2) {
          clearInterval(tick);
          clearTimeout(deadline);
          resolve();
        }
      }, 25);
    });
    expect(stopped.sort()).toEqual([`${name}`, `${name}__tab`].sort());

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.close();
    });
  });

  it('closes a workspace’s own browser sessions on workspace close (best-effort cascade)', async () => {
    const stopped: string[] = [];
    const discovery: BrowserDiscoveryPort = {
      listSessions: async () => [
        { name: 'perch-cascade', streamPort: 1 },
        { name: 'perch-cascade__login', streamPort: 2 },
        { name: 'perch-other', streamPort: 3 },
        { name: 'github', streamPort: 4 },
      ],
    };
    const commands: BrowserCommandPort = { ...noBrowserCommands, stop: async (n) => void stopped.push(n) };
    const port = await startServer({ discovery, commands });

    const terminal = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => terminal.once('open', r));
    terminal.send(JSON.stringify({ type: 'auth', token: 'secret' }));

    const closed = new Promise<void>((resolve) => {
      terminal.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as AgentMessage;
        if (msg.type === 'closed' && msg.workspaceId === 'perch-cascade') resolve();
      });
    });
    terminal.send(JSON.stringify({ type: 'close', workspaceId: 'perch-cascade' }));
    await closed;

    // Only this workspace's sessions are stopped — never a peer's or a home-level per-site
    // session like `github`.
    expect(stopped).toEqual(['perch-cascade', 'perch-cascade__login']);
    await new Promise<void>((resolve) => {
      terminal.on('close', () => resolve());
      terminal.close();
    });
  });

  it('routes /browser to the relay (auth then ended not-found) while / still terminal-auths', async () => {
    const port = await startServer();

    const terminal = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => terminal.once('open', r));

    const browser = new WebSocket(`ws://127.0.0.1:${port}/browser?session=x`);
    await new Promise((r) => browser.once('open', r));
    const messages: unknown[] = [];
    const gotTwo = new Promise<void>((resolve) => {
      browser.on('message', (raw) => {
        messages.push(JSON.parse(raw.toString()));
        if (messages.length === 2) resolve();
      });
    });
    browser.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    await gotTwo;
    expect(messages[0]).toEqual({ type: 'authResult', ok: true });
    expect(messages[1]).toEqual({ type: 'ended', reason: 'not-found' });
    await new Promise((r) => browser.once('close', r)); // relay closes after `ended`

    terminal.send(JSON.stringify({ type: 'auth', token: 'secret' }));
    const authResult = await nextMessage(terminal);
    expect(authResult).toEqual({ type: 'authResult', ok: true });
    await new Promise<void>((resolve) => {
      terminal.on('close', () => resolve());
      terminal.close();
    });
  });

  it('answers authResult ok:false and closes for a bad token on /browser', async () => {
    const port = await startServer();
    const browser = new WebSocket(`ws://127.0.0.1:${port}/browser?session=x`);
    await new Promise((r) => browser.once('open', r));
    const first = new Promise<unknown>((resolve) => {
      browser.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    });
    browser.send(JSON.stringify({ type: 'auth', token: 'wrong' }));
    expect(await first).toEqual({ type: 'authResult', ok: false });
    await new Promise((r) => browser.once('close', r));
  });

  it('destroys a /browser upgrade with a missing or empty session name', async () => {
    const port = await startServer();
    for (const path of ['/browser', '/browser?session=']) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      const opened = await new Promise<boolean>((resolve) => {
        socket.once('open', () => resolve(true));
        socket.once('error', () => resolve(false));
      });
      expect(opened).toBe(false);
    }
  });
});

describe('connectBrowserUpstream (real ws client adapter)', () => {
  it('connects with no Origin header, exchanges messages, exposes bufferedAmount, propagates close', async () => {
    const upstream = new WebSocketServer({ port: 0 });
    await new Promise((r) => upstream.once('listening', r));
    const port = (upstream.address() as AddressInfo).port;
    let origin: string | undefined = 'unset';
    const serverGot: string[] = [];
    upstream.on('connection', (socket, req) => {
      origin = req.headers.origin;
      socket.on('message', (raw) => {
        serverGot.push(raw.toString());
        socket.send('reply-from-upstream');
      });
    });
    try {
      const relay = await connectBrowserUpstream(port);
      const received: string[] = [];
      const gotReply = new Promise<void>((resolve) => {
        relay.onMessage((data) => {
          received.push(data);
          resolve();
        });
      });
      relay.send('hello');
      await gotReply;
      expect(origin).toBeUndefined();
      expect(serverGot).toEqual(['hello']);
      expect(received).toEqual(['reply-from-upstream']);
      expect(typeof relay.bufferedAmount?.()).toBe('number');
      const closed = new Promise<void>((resolve) => relay.onClose(resolve));
      for (const client of upstream.clients) client.close();
      await closed;
    } finally {
      await new Promise((r) => upstream.close(r));
    }
  });

  it('rejects when nothing listens on the port', async () => {
    // Grab a free port, then close the listener so the dial hits a dead port.
    const probe = new WebSocketServer({ port: 0 });
    await new Promise((r) => probe.once('listening', r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));
    await expect(connectBrowserUpstream(port)).rejects.toThrow();
  });
});

describe('WsServer POST /clientlog (connection-log ingest)', () => {
  function makeServerDeps(config: AgentConfig, clientLog: ClientLogPort) {
    return {
      config,
      tmux: new TmuxAdapter(),
      recent: new FileRecentStore(config.recentStorePath),
      lister: new FsProjectLister(),
      reader: new FsFileReader(),
      resolvePath: systemPathResolver,
      isDirectory: fsIsDirectory,
      clock: systemClock,
      ids: new RandomIdGenerator(),
      pty: new NodePtyAdapter(),
      status: new InMemoryStatusStore(),
      writer: new FsFileWriter(),
      browserDiscovery: noBrowserDiscovery,
      browserCommands: noBrowserCommands,
      hiddenFolders: noHiddenFolders,
      commands: noCommands,
      clientLog,
      workspaceLog: noWorkspaceLog,
      parked: new FileParkedStore(config.parkedStorePath),
      connectUpstream: noConnectUpstream,
    };
  }

  async function startClientLogServer(clientLog: ClientLogPort): Promise<number> {
    const home = await mkdtemp(join(tmpdir(), 'perch-clientlog-'));
    dirs.push(home);
    const config: AgentConfig = {
      machineId: 'test',
      token: 'secret',
      host: '127.0.0.1',
      port: 0,
      projectRoots: [tmpdir()],
      recentStorePath: join(home, 'recent.json'),
      statusStorePath: join(home, 'status.json'),
      hiddenFoldersPath: join(home, 'hidden-folders.json'),
      commandsPath: join(home, 'commands.json'),
      clientLogPath: join(home, 'client-log.jsonl'),
      workspaceLogPath: join(home, 'workspace-log.jsonl'), parkedStorePath: join(home, 'parked.json'), claudeSessionsDir: join(home, 'claude-sessions'),
      sessionPrefix: 'perch-',
    };
    server = new WsServer(makeServerDeps(config, clientLog));
    await server.start();
    return server.address().port;
  }

  const validBatch = {
    ua: 'iPhone',
    shell: 'pwa',
    events: [{ sess: 'A', seq: 0, t: 1, machineId: 'dev', kind: 'close', code: 1006, online: true, vis: 'visible' }],
  };
  const post = (port: number, body: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}/clientlog`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret', ...(init?.headers ?? {}) },
      body,
      ...init,
    });

  it('appends a valid batch and answers 204', async () => {
    const appended: unknown[] = [];
    const port = await startClientLogServer({ append: async (b) => void appended.push(b) });
    const res = await post(port, JSON.stringify(validBatch));
    expect(res.status).toBe(204);
    expect(appended).toEqual([validBatch]);
  });

  it('writes a JSONL line to the real file store end-to-end', async () => {
    const home = await mkdtemp(join(tmpdir(), 'perch-clientlog-e2e-'));
    dirs.push(home);
    const logPath = join(home, '.perch', 'client-log.jsonl');
    const port = await startClientLogServer(new FileClientLogStore(logPath, () => 42));
    const res = await post(port, JSON.stringify(validBatch));
    expect(res.status).toBe(204);
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ sess: 'A', kind: 'close', code: 1006, ua: 'iPhone', rt: 42 });
  });

  it('rejects a batch without the bearer token', async () => {
    const port = await startClientLogServer({ append: async () => {} });
    const res = await post(port, JSON.stringify(validBatch), { headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body with 400', async () => {
    const port = await startClientLogServer({ append: async () => {} });
    expect((await post(port, '{not json')).status).toBe(400);
    expect((await post(port, JSON.stringify({ events: [] }))).status).toBe(400);
  });

  it('rejects an oversized body with 413', async () => {
    let appended = false;
    const port = await startClientLogServer({ append: async () => void (appended = true) });
    const huge = 'x'.repeat(600 * 1024);
    const res = await post(port, JSON.stringify({ ua: huge, events: validBatch.events }));
    expect(res.status).toBe(413);
    expect(appended).toBe(false);
  });

  it('answers a CORS preflight (OPTIONS) for /clientlog', async () => {
    const port = await startClientLogServer({ append: async () => {} });
    const res = await fetch(`http://127.0.0.1:${port}/clientlog`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
