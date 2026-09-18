import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import type { AgentConfig } from '../infrastructure/config';
import type { TmuxPort } from '../ports/tmux-port';
import type { RecentStorePort } from '../ports/recent-store-port';
import type { ProjectListerPort } from '../ports/project-lister-port';
import type { FileReaderPort } from '../ports/file-reader-port';
import type { PathResolver } from '../ports/path-resolver';
import type { DirectoryChecker } from '../ports/directory-checker';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { PtyPort } from '../ports/pty-port';
import type { StatusStorePort } from '../ports/status-store-port';
import type { RepoRemotePort } from '../ports/repo-remote-port';
import type { ClaudeSessionsPort } from '../ports/claude-sessions-port';
import type { FileWriterPort } from '../ports/file-writer-port';
import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';
import type { BrowserCommandPort } from '../ports/browser-command-port';
import type { ConnectUpstream } from '../ports/browser-stream-port';
import { wsRelaySocket } from '../infrastructure/ws-relay-socket';
import { BrowserRelayHandler } from './browser-relay-handler';
import type { HiddenFoldersPort } from '../ports/hidden-folders-port';
import type { CommandsPort } from '../ports/commands-port';
import type { ClientLogPort } from '../ports/client-log-port';
import type { WorkspaceLogPort } from '../ports/workspace-log-port';
import type { ParkedStorePort } from '../ports/parked-store-port';
import type { ProcessScopePort } from '../ports/process-scope-port';
import { recordWorkspaceClosed } from '../application/record-workspace-closed';
import { clientLogBatchSchema, type Workspace } from '@perch/contracts';
import { ConnectionHandler } from './connection-handler';
import { ViewerRegistry } from './viewer-registry';
import { WsClientConnection } from './ws-client-connection';
import { applyHookEvent } from '../application/apply-hook-event';
import { listWorkspaces } from '../application/list-workspaces';
import { isHiddenPath } from '../application/is-hidden-path';
import { closeWorkspaceBrowserSessions } from '../application/close-workspace-browsers';
import { readServableFile } from '../application/read-servable-file';

export interface WsServerDeps {
  config: AgentConfig;
  tmux: TmuxPort;
  recent: RecentStorePort;
  lister: ProjectListerPort;
  reader: FileReaderPort;
  resolvePath: PathResolver;
  isDirectory: DirectoryChecker;
  clock: Clock;
  ids: IdGenerator;
  pty: PtyPort;
  status: StatusStorePort;
  writer: FileWriterPort;
  browserDiscovery: BrowserDiscoveryPort;
  browserCommands: BrowserCommandPort;
  hiddenFolders: HiddenFoldersPort;
  commands: CommandsPort;
  clientLog: ClientLogPort;
  workspaceLog: WorkspaceLogPort;
  parked: ParkedStorePort;
  connectUpstream: ConnectUpstream;
  repoRemote?: RepoRemotePort;
  claudeSessions?: ClaudeSessionsPort;
  scopes?: ProcessScopePort;
  titlePollMs?: number;
}

const DEFAULT_TITLE_POLL_MS = 2000;

// CORS for the /file image endpoint. ACAO:* is safe here — the bytes are still gated by the
// bearer token and the agent is only reachable on the private tailnet. The preflight allows
// the Authorization header (which is not CORS-safelisted, so a preflight is required).
const FILE_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization',
  'access-control-max-age': '86400',
} as const;

// CORS for the POST /clientlog endpoint. Same rationale as /file (bearer-gated, tailnet-only),
// but the PWA sends JSON with an Authorization header, so the preflight must allow POST and the
// content-type header too.
const CLIENTLOG_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
} as const;

// Cap on the /clientlog request body. The diagnostics buffer is small (a few hundred tiny
// events); anything larger is malformed or hostile, so we stop reading and reject rather than
// buffer it unbounded (a gap the older /hooks handler still has).
const CLIENTLOG_MAX_BODY_BYTES = 512 * 1024;

export class WsServer {
  private http: Server | null = null;
  private readonly registry = new ViewerRegistry();
  // Separate registry for browser viewers: keys are session names, which could collide
  // with the terminal registry's workspace ids (sessions are named after workspaces).
  private readonly browserViewers = new ViewerRegistry();
  private readonly handlers = new Set<ConnectionHandler>();
  private titlePoll: ReturnType<typeof setInterval> | null = null;
  private readonly lastWorkspaces = new Map<string, Workspace>();
  private lastBrowserNames = new Set<string>();
  // Sessions parked on background work, so the idle notification that follows their Stop can
  // be told apart from a genuine one. In-memory on purpose — see applyHookEvent.
  private readonly deferred = new Set<string>();

  constructor(private readonly deps: WsServerDeps) {}

  // Removes and returns the last-known snapshot for a workspace id, if the poll has ever
  // observed it. Used by ConnectionHandler on an explicit close, both to build the log
  // entry (the session is about to be killed and tmux won't be able to answer afterward)
  // and to keep the disappearance poll from separately logging it as `exited` — in the
  // common case. Known limitation, accepted
  // by design: closeWorkspace's tmux kill is async, so a poll tick landing in that gap
  // can still observe the session as present and re-add it to this map; the poll then
  // logs a second, duplicate `exited` entry once the kill actually completes. Harmless
  // (one extra line in an append-only diagnostic file), just not airtight.
  forgetWorkspace(id: string): Workspace | undefined {
    const workspace = this.lastWorkspaces.get(id);
    this.lastWorkspaces.delete(id);
    return workspace;
  }

  // Pushes a `closed` message to every connected device — used when a workspace is closed
  // explicitly, so devices other than the requester learn about it immediately instead of
  // waiting for the next title-poll tick (which no longer fires it for this id, since
  // forgetWorkspace already removed it from the tracking map before the poll runs).
  broadcastClosed(id: string): void {
    for (const handler of this.handlers) {
      handler.pushClosed(id);
    }
  }

  start(): Promise<void> {
    if (this.http) {
      return Promise.reject(new Error('server already started'));
    }
    this.deps.status.onChange((workspaceId) => {
      void this.broadcastWorkspace(workspaceId);
    });
    this.titlePoll = setInterval(() => {
      void this.pollTitles();
      void this.pollBrowserSessions();
    }, this.deps.titlePollMs ?? DEFAULT_TITLE_POLL_MS);
    this.titlePoll.unref?.();
    return new Promise((resolve, reject) => {
      const http = createServer((req, res) => {
        this.handleHttp(req, res);
      });
      this.http = http;
      http.on('error', (err) => {
        this.http = null;
        reject(err);
      });
      const terminalWss = new WebSocketServer({ noServer: true });
      terminalWss.on('connection', (socket) => {
        const conn = new WsClientConnection(socket);
        const handler = new ConnectionHandler(conn, {
          ...this.deps,
          registry: this.registry,
          forgetWorkspace: (id: string) => this.forgetWorkspace(id),
          broadcastClosed: (id: string) => this.broadcastClosed(id),
        });
        this.handlers.add(handler);
        conn.onClose(() => {
          this.handlers.delete(handler);
        });
      });
      const browserWss = new WebSocketServer({ noServer: true });
      browserWss.on('connection', (socket, req) => {
        const token = this.deps.config.token;
        if (token === undefined) {
          // serve.ts asserts the token before starting; fail closed if that ever changes.
          socket.close();
          return;
        }
        const session = new URL(req.url ?? '', 'http://localhost').searchParams.get('session') ?? '';
        new BrowserRelayHandler({
          client: wsRelaySocket(socket),
          sessionName: session,
          token,
          discovery: this.deps.browserDiscovery,
          commands: this.deps.browserCommands,
          connectUpstream: this.deps.connectUpstream,
          registry: this.browserViewers,
        });
      });
      http.on('upgrade', (req, socket, head) => {
        const { pathname, searchParams } = new URL(req.url ?? '', 'http://localhost');
        if (pathname === '/browser' && !searchParams.get('session')) {
          socket.destroy();
          return;
        }
        const target = pathname === '/browser' ? browserWss : terminalWss;
        target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
      });
      http.listen(this.deps.config.port, this.deps.config.host, () => {
        resolve();
      });
    });
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '').split('?')[0];
    // The PWA is served from a different origin/port than the agent, so the cross-origin image
    // fetch (with its Authorization header) needs CORS, including a preflight.
    if (req.method === 'OPTIONS' && path === '/file') {
      res.writeHead(204, FILE_CORS_HEADERS).end();
      return;
    }
    if (req.method === 'GET' && path === '/file') {
      void this.handleFileGet(req, res);
      return;
    }
    if (req.method === 'OPTIONS' && path === '/clientlog') {
      res.writeHead(204, CLIENTLOG_CORS_HEADERS).end();
      return;
    }
    if (req.method === 'POST' && path === '/clientlog') {
      this.handleClientLogPost(req, res);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/hooks') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${this.deps.config.token}`) {
      res.writeHead(401).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(body);
        const { sessionName, event, claude } = parsed as {
          sessionName?: unknown;
          event?: unknown;
          claude?: unknown;
        };
        if (typeof sessionName !== 'string' || typeof event !== 'string') {
          res.writeHead(400).end();
          return;
        }
        applyHookEvent({ store: this.deps.status, deferred: this.deferred }, { sessionName, event, claude });
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  }

  // Serves a servable file's raw bytes — images and PDFs (the PWA fetches these instead of
  // receiving multi-MB base64 over the terminal WebSocket). Bearer-token guarded like /hooks,
  // authorized against the same allowed roots the WS file browser uses.
  private async handleFileGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('access-control-allow-origin', '*');
    if (req.headers.authorization !== `Bearer ${this.deps.config.token}`) {
      res.writeHead(401).end();
      return;
    }
    const url = new URL(req.url ?? '', 'http://localhost');
    const path = url.searchParams.get('path');
    if (!path) {
      res.writeHead(400).end();
      return;
    }
    try {
      const result = await readServableFile({ reader: this.deps.reader }, path, await this.allowedRoots());
      switch (result.kind) {
        case 'ok':
          res.writeHead(200, { 'content-type': result.mediaType, 'content-length': result.bytes.byteLength });
          res.end(Buffer.from(result.bytes));
          return;
        case 'forbidden':
          res.writeHead(403).end();
          return;
        case 'not-servable':
          res.writeHead(404).end();
          return;
        case 'too-large':
          res.writeHead(413).end();
          return;
      }
    } catch (err) {
      res.writeHead((err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500).end();
    }
  }

  // Receives the PWA's flushed connection-log batch (see packages/pwa connection-log) and
  // appends it to durable storage. Bearer-guarded and CORS-enabled like /file, with a hard body
  // cap so a malformed/hostile payload can't be buffered unbounded.
  private handleClientLogPost(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('access-control-allow-origin', '*');
    if (req.headers.authorization !== `Bearer ${this.deps.config.token}`) {
      res.writeHead(401).end();
      return;
    }
    let body = '';
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      body += chunk;
      if (body.length > CLIENTLOG_MAX_BODY_BYTES) {
        aborted = true;
        res.writeHead(413).end();
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const result = clientLogBatchSchema.safeParse(parsed);
      if (!result.success) {
        res.writeHead(400).end();
        return;
      }
      this.deps.clientLog.append(result.data).then(
        () => res.writeHead(204).end(),
        () => res.writeHead(500).end(),
      );
    });
  }

  private async allowedRoots(): Promise<string[]> {
    const { config, tmux, status } = this.deps;
    const workspaces = await listWorkspaces({
      tmux,
      machineId: config.machineId,
      sessionPrefix: config.sessionPrefix,
      status,
    });
    return [...config.projectRoots, ...workspaces.map((w) => w.projectPath)];
  }

  // Detects pane-title renames (which have no hook) and pushes the new name, and detects
  // sessions that have disappeared (the inner process exited and tmux destroyed the session)
  // and pushes a `closed` so the workspace stops lingering as a ghost in connected clients.
  // The first sighting of a session only records its name; later changes broadcast.
  private async pollTitles(): Promise<void> {
    if (this.handlers.size === 0) return;
    let workspaces;
    try {
      workspaces = await listWorkspaces({
        tmux: this.deps.tmux,
        machineId: this.deps.config.machineId,
        sessionPrefix: this.deps.config.sessionPrefix,
        status: this.deps.status,
        repoRemote: this.deps.repoRemote,
        claudeSessions: this.deps.claudeSessions,
        parked: this.deps.parked,
      });
    } catch {
      return;
    }
    const hidden = await this.deps.hiddenFolders.list();
    const present = new Set<string>();
    for (const workspace of workspaces) {
      if (isHiddenPath(workspace.projectPath, hidden)) continue;
      present.add(workspace.id);
      const previous = this.lastWorkspaces.get(workspace.id);
      this.lastWorkspaces.set(workspace.id, workspace);
      if (previous !== undefined && previous.name !== workspace.name) {
        for (const handler of this.handlers) {
          handler.pushWorkspaceUpdated(workspace);
        }
      }
    }
    for (const id of this.lastWorkspaces.keys()) {
      if (!present.has(id)) {
        const workspace = this.lastWorkspaces.get(id)!;
        this.lastWorkspaces.delete(id);
        for (const handler of this.handlers) {
          handler.pushClosed(id);
        }
        await recordWorkspaceClosed(
          { workspaceLog: this.deps.workspaceLog, status: this.deps.status, clock: this.deps.clock },
          workspace,
          'exited',
        );
        // The inner process exited and tmux destroyed the session without a Perch `close`
        // message, so the connection-handler cascade never ran — close the workspace's
        // orphaned browser sessions here. Best-effort (never throws); pollBrowserSessions
        // then broadcasts the shrunken set.
        await closeWorkspaceBrowserSessions(
          { discovery: this.deps.browserDiscovery, commands: this.deps.browserCommands },
          id,
        );
      }
    }
  }

  // The agent only answers `list` with browserSessions, so a session started outside that
  // request/reply cycle (the CLI, another device's start button) would stay invisible until
  // a reconnect. This piggybacks on the title poll: when the live set of session names
  // changes, push the fresh list to every connected client. Discovery is a cheap fs scan.
  private async pollBrowserSessions(): Promise<void> {
    if (this.handlers.size === 0) return;
    let sessions;
    try {
      sessions = await this.deps.browserDiscovery.listSessions();
    } catch {
      return;
    }
    const names = new Set(sessions.map((s) => s.name));
    const unchanged =
      names.size === this.lastBrowserNames.size && [...names].every((n) => this.lastBrowserNames.has(n));
    if (unchanged) return;
    this.lastBrowserNames = names;
    // Names only — streamPort never leaves the agent (same rule as the `list` reply).
    const payload = sessions.map(({ name }) => ({ name }));
    for (const handler of this.handlers) {
      handler.pushBrowserSessions(payload);
    }
  }

  private async broadcastWorkspace(workspaceId: string): Promise<void> {
    const workspaces = await listWorkspaces({
      tmux: this.deps.tmux,
      machineId: this.deps.config.machineId,
      sessionPrefix: this.deps.config.sessionPrefix,
      status: this.deps.status,
      repoRemote: this.deps.repoRemote,
      claudeSessions: this.deps.claudeSessions,
      parked: this.deps.parked,
    });
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (!workspace) {
      return;
    }
    const hidden = await this.deps.hiddenFolders.list();
    if (isHiddenPath(workspace.projectPath, hidden)) {
      return;
    }
    for (const handler of this.handlers) {
      handler.pushWorkspaceUpdated(workspace);
    }
  }

  address(): { port: number } {
    const addr = this.http?.address() as AddressInfo | null;
    return { port: addr?.port ?? 0 };
  }

  stop(): Promise<void> {
    if (this.titlePoll) {
      clearInterval(this.titlePoll);
      this.titlePoll = null;
    }
    this.lastWorkspaces.clear();
    this.lastBrowserNames.clear();
    const http = this.http;
    if (!http) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      http.close((err) => {
        this.http = null;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
