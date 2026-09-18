import { parseClientMessage, isWorkspaceStatus, type BrowserSession, type ClientMessage, type Workspace } from '@perch/contracts';
import type { ClientConnection } from '../ports/client-connection';
import type { PtyPort, PtySession } from '../ports/pty-port';
import type { ViewerRegistry, Viewer } from './viewer-registry';
import type { TmuxPort } from '../ports/tmux-port';
import type { RepoRemotePort } from '../ports/repo-remote-port';
import type { ClaudeSessionsPort } from '../ports/claude-sessions-port';
import type { RecentStorePort } from '../ports/recent-store-port';
import type { ProjectListerPort } from '../ports/project-lister-port';
import type { FileReaderPort } from '../ports/file-reader-port';
import type { PathResolver } from '../ports/path-resolver';
import type { DirectoryChecker } from '../ports/directory-checker';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { AgentConfig } from '../infrastructure/config';
import type { StatusStorePort } from '../ports/status-store-port';
import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';
import type { BrowserCommandPort } from '../ports/browser-command-port';
import type { HiddenFoldersPort } from '../ports/hidden-folders-port';
import type { CommandsPort } from '../ports/commands-port';
import type { WorkspaceLogPort } from '../ports/workspace-log-port';
import type { ParkedStorePort } from '../ports/parked-store-port';
import type { ProcessScopePort } from '../ports/process-scope-port';
import { recordWorkspaceClosed } from '../application/record-workspace-closed';
import { isHiddenPath } from '../application/is-hidden-path';
import { listWorkspaces } from '../application/list-workspaces';
import { createWorkspace } from '../application/create-workspace';
import { closeWorkspace } from '../application/close-workspace';
import { reapWorkspaceScope } from '../application/reap-workspace-scope';
import { parkWorkspace } from '../application/park-workspace';
import { unparkWorkspace } from '../application/unpark-workspace';
import { closeWorkspaceBrowserSessions } from '../application/close-workspace-browsers';
import { getRecentPaths } from '../application/get-recent-paths';
import { browseDir } from '../application/browse-dir';
import { makeDir } from '../application/make-dir';
import { readFile } from '../application/read-file';
import { storePastedFile } from '../application/store-pasted-file';
import type { FileWriterPort } from '../ports/file-writer-port';

export interface ConnectionHandlerDeps {
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
  registry: ViewerRegistry;
  status: StatusStorePort;
  writer: FileWriterPort;
  browserDiscovery: BrowserDiscoveryPort;
  browserCommands: BrowserCommandPort;
  hiddenFolders: HiddenFoldersPort;
  commands: CommandsPort;
  workspaceLog: WorkspaceLogPort;
  parked: ParkedStorePort;
  forgetWorkspace: (id: string) => Workspace | undefined;
  broadcastClosed: (id: string) => void;
  repoRemote?: RepoRemotePort;
  claudeSessions?: ClaudeSessionsPort;
  scopes?: ProcessScopePort;
}

export class ConnectionHandler {
  private authed = false;
  private attachment:
    | { workspaceId: string; session: PtySession; terminated: boolean; viewer: Viewer }
    | null = null;

  constructor(
    private readonly conn: ClientConnection,
    private readonly deps: ConnectionHandlerDeps,
  ) {
    conn.onMessage((raw) => {
      void this.handle(raw);
    });
    conn.onClose(() => {
      this.onClose();
    });
  }

  pushWorkspaceUpdated(workspace: Workspace): void {
    if (this.authed) {
      this.conn.send({ type: 'workspaceUpdated', workspace });
    }
  }

  pushClosed(workspaceId: string): void {
    if (this.authed) {
      this.conn.send({ type: 'closed', workspaceId });
    }
  }

  pushBrowserSessions(sessions: BrowserSession[]): void {
    if (this.authed) {
      this.conn.send({ type: 'browserSessions', sessions });
    }
  }

  protected onClose(): void {
    const att = this.attachment;
    if (!att) return;
    att.terminated = true;
    att.session.kill();
    this.deps.registry.release(att.workspaceId, att.viewer);
    this.attachment = null;
  }

  private async handle(raw: unknown): Promise<void> {
    let message: ClientMessage;
    try {
      message = parseClientMessage(raw);
    } catch (err) {
      this.conn.send({ type: 'error', code: 'bad_message', message: errMsg(err) });
      return;
    }

    if (message.type === 'auth') {
      if (message.token === this.deps.config.token) {
        this.authed = true;
        this.conn.send({ type: 'authResult', ok: true });
      } else {
        this.conn.send({ type: 'authResult', ok: false });
        this.conn.close();
      }
      return;
    }

    if (!this.authed) {
      this.conn.send({ type: 'error', code: 'unauthorized', message: 'authenticate first' });
      return;
    }

    try {
      await this.route(message as Exclude<ClientMessage, { type: 'auth' }>);
    } catch (err) {
      this.conn.send({ type: 'error', code: 'internal', message: errMsg(err) });
    }
  }

  protected async route(message: Exclude<ClientMessage, { type: 'auth' }>): Promise<void> {
    const { config, tmux, recent, lister, reader, resolvePath, isDirectory, clock, ids, status, hiddenFolders, commands, repoRemote, claudeSessions } = this.deps;
    switch (message.type) {
      case 'list': {
        const hidden = await hiddenFolders.list();
        const workspaces = (
          await listWorkspaces({
            tmux,
            machineId: config.machineId,
            sessionPrefix: config.sessionPrefix,
            status,
            repoRemote,
            claudeSessions,
            parked: this.deps.parked,
          })
        ).filter((w) => !isHiddenPath(w.projectPath, hidden));
        this.conn.send({ type: 'workspaces', workspaces });
        await this.sendBrowserSessions();
        return;
      }
      case 'getRecentPaths': {
        const hidden = await hiddenFolders.list();
        this.conn.send({ type: 'recentPaths', paths: await getRecentPaths({ recent, hidden }) });
        return;
      }
      case 'browseDir': {
        const hidden = await hiddenFolders.list();
        const { subdirs, files } = await browseDir({ lister, hidden }, message.path, await this.allowedRoots());
        this.conn.send({ type: 'dirEntries', path: message.path, subdirs, files });
        return;
      }
      case 'makeDir': {
        const allowed = await this.allowedRoots();
        const hidden = await hiddenFolders.list();
        const created = await makeDir({ lister }, message.parent, message.name, allowed);
        const { subdirs, files } = await browseDir({ lister, hidden }, created, allowed);
        this.conn.send({ type: 'dirEntries', path: created, subdirs, files });
        return;
      }
      case 'listRoots': {
        this.conn.send({ type: 'roots', roots: config.projectRoots });
        return;
      }
      case 'listCommands': {
        this.conn.send({ type: 'commands', commands: await commands.list() });
        return;
      }
      case 'readFile': {
        const { binary, data, truncated } = await readFile({ reader }, message.path, await this.allowedRoots());
        this.conn.send({ type: 'fileContents', path: message.path, data, truncated, binary });
        return;
      }
      case 'create': {
        const workspace = await createWorkspace(
          { tmux, recent, resolvePath, isDirectory, clock, ids, machineId: config.machineId },
          { projectPath: message.projectPath, command: message.command },
        );
        this.conn.send({ type: 'workspaceUpdated', workspace });
        return;
      }
      case 'close': {
        const parkedRecord = await this.deps.parked.get(message.workspaceId);
        const workspace =
          this.deps.forgetWorkspace(message.workspaceId) ??
          (parkedRecord
            ? {
                machineId: parkedRecord.machineId,
                id: parkedRecord.id,
                name: parkedRecord.name,
                projectPath: parkedRecord.projectPath,
                command: parkedRecord.command,
                createdAt: parkedRecord.createdAt,
                lastActivityAt: parkedRecord.parkedAt,
                status: 'parked' as const,
              }
            : await this.snapshotWorkspace(message.workspaceId));
        if (parkedRecord) {
          await this.deps.parked.remove(message.workspaceId);
        }
        const scope = await closeWorkspace(
          { tmux, scopes: this.deps.scopes },
          message.workspaceId,
        );
        if (workspace) {
          await recordWorkspaceClosed(
            {
              workspaceLog: this.deps.workspaceLog,
              status: parkedRecord
                ? {
                    get: (id: string) => this.deps.status.get(id),
                    getClaudeSessionId: () => parkedRecord.claudeSessionId,
                  }
                : this.deps.status,
              clock: this.deps.clock,
            },
            workspace,
            'closed-by-user',
          );
        }
        // The tmux session is gone, so the workspace is closed as far as any device is
        // concerned — say so now. What remains (tearing down agent-browser sessions, which
        // waits on a Chrome shutdown, and stopping the pane's scope, which waits on
        // systemd) only touches this machine, and made the phone's close button feel like
        // it had hung.
        this.conn.send({ type: 'closed', workspaceId: message.workspaceId });
        this.deps.broadcastClosed(message.workspaceId);
        void this.finishClose(message.workspaceId, scope);
        return;
      }
      case 'setStatus': {
        if (!isWorkspaceStatus(message.status)) {
          return;
        }
        // `parked` is the park gesture: it frees the workspace's resources rather than
        // just relabelling it. parkWorkspace sets the status itself (last, so the
        // onChange broadcast sees the record already written), and is a no-op when a
        // record already exists.
        if (message.status === 'parked') {
          const workspace =
            this.deps.forgetWorkspace(message.workspaceId) ??
            (await this.snapshotWorkspace(message.workspaceId));
          if (workspace) {
            const result = await parkWorkspace(
              {
                parked: this.deps.parked,
                tmux: this.deps.tmux,
                status: this.deps.status,
                clock: this.deps.clock,
              },
              workspace,
            );
            if (result === 'not-restorable') {
              this.conn.send({
                type: 'error',
                code: 'not-restorable',
                message:
                  "Can't park yet: Perch hasn't seen a Claude session id for this workspace. Send it a message first, then park.",
              });
            }
          }
          return;
        }
        // The store's onChange (wired in WsServer) broadcasts the refreshed workspace to
        // every connection, so the sender and other devices both observe the new status.
        status.set(message.workspaceId, message.status);
        return;
      }
      case 'setUrgent': {
        // Same broadcast path as setStatus: onChange fans the refreshed workspace out to
        // every device. Orthogonal to status — the pin persists across status changes.
        status.setUrgent(message.workspaceId, message.urgent);
        return;
      }
      case 'attach': {
        // A parked workspace has no tmux session — recreate it (resuming the Claude
        // conversation) before attaching. Keyed on the parked record, never on the
        // status string: the postponed->parked rename leaves pre-existing LIVE
        // workspaces labelled `parked` with no record, and those must attach normally.
        const result = await unparkWorkspace(
          {
            parked: this.deps.parked,
            tmux: this.deps.tmux,
            isDirectory: this.deps.isDirectory,
            status: this.deps.status,
          },
          message.workspaceId,
        );
        if (result === 'missing-directory') {
          this.conn.send({
            type: 'error',
            code: 'missing-directory',
            message: 'the project directory no longer exists',
          });
          return;
        }
        // Enable OSC 8 hyperlink passthrough before the attach client connects — tmux
        // reads terminal-features at attach time and otherwise strips Claude Code's links.
        await tmux.ensureHyperlinks?.();
        this.attach(message.workspaceId, message.cols, message.rows);
        return;
      }
      case 'detach': {
        if (this.attachment?.workspaceId === message.workspaceId) {
          this.teardownAttachment('closed');
        }
        return;
      }
      case 'input': {
        if (this.attachment?.workspaceId === message.workspaceId) {
          this.attachment.session.write(Buffer.from(message.data, 'base64').toString('utf8'));
        }
        return;
      }
      case 'resize': {
        if (this.attachment?.workspaceId === message.workspaceId) {
          this.attachment.session.resize(message.cols, message.rows);
        }
        return;
      }
      case 'putFile': {
        const projectPath = await this.workspacePath(message.workspaceId);
        if (!projectPath) {
          this.conn.send({ type: 'error', code: 'unknown_workspace', message: `unknown workspace: ${message.workspaceId}` });
          return;
        }
        const bytes = new Uint8Array(Buffer.from(message.data, 'base64'));
        const path = await storePastedFile({ writer: this.deps.writer }, { projectPath, name: message.name, bytes });
        this.conn.send({ type: 'fileStored', workspaceId: message.workspaceId, path });
        return;
      }
      case 'ping': {
        this.conn.send({ type: 'pong' });
        return;
      }
      case 'startBrowser': {
        try {
          await this.deps.browserCommands.start(message.workspaceId);
        } catch (err) {
          this.conn.send({ type: 'error', code: 'start-browser-failed', message: errMsg(err) });
          return;
        }
        await this.sendBrowserSessions();
        return;
      }
      default: {
        const exhaustive: never = message;
        void exhaustive;
        this.conn.send({ type: 'error', code: 'unsupported', message: 'unhandled message' });
      }
    }
  }

  // Names only — the stream port stays agent-side (the PWA reaches streams via the agent's
  // /browser relay, never the upstream port directly). Discovery failure degrades to an
  // empty list so a broken agent-browser install can never break the `list` reply.
  private async sendBrowserSessions(): Promise<void> {
    let sessions: Array<{ name: string }> = [];
    try {
      sessions = (await this.deps.browserDiscovery.listSessions()).map(({ name }) => ({ name }));
    } catch {
      // degrade to []
    }
    this.conn.send({ type: 'browserSessions', sessions });
  }

  // The set of paths a client may browse/read: the configured roots ∪ the live workspaces'
  // project paths, so a workspace's own tree is reachable even outside PERCH_PROJECT_ROOTS.
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

  // The live workspace matching this id, freshly queried from tmux — used as a fallback
  // when no poll has observed this workspace yet (e.g. it was created and closed within
  // the same title-poll tick).
  // The slow tail of a close, run detached once the client has been acknowledged. Both steps
  // swallow their own failures; the outer catch only guards against an unhandled rejection
  // taking the agent down for work nobody is waiting on.
  private async finishClose(workspaceId: string, scope: string | null): Promise<void> {
    try {
      await reapWorkspaceScope({ scopes: this.deps.scopes }, scope);
      await closeWorkspaceBrowserSessions(
        { discovery: this.deps.browserDiscovery, commands: this.deps.browserCommands },
        workspaceId,
      );
    } catch {
      // best-effort
    }
  }

  private async snapshotWorkspace(workspaceId: string): Promise<Workspace | undefined> {
    const { config, tmux, status } = this.deps;
    const workspaces = await listWorkspaces({
      tmux,
      machineId: config.machineId,
      sessionPrefix: config.sessionPrefix,
      status,
    });
    return workspaces.find((w) => w.id === workspaceId);
  }

  // The cwd a workspace runs in (its projectPath), or undefined if no live session has that
  // id. Used to anchor a pasted file under the workspace's own `.tmp/files/`.
  private async workspacePath(workspaceId: string): Promise<string | undefined> {
    return (await this.snapshotWorkspace(workspaceId))?.projectPath;
  }

  private attach(workspaceId: string, cols: number, rows: number): void {
    if (this.attachment) {
      this.teardownAttachment('closed');
    }
    const session = this.deps.pty.spawn({
      command: 'tmux',
      args: ['attach-session', '-t', workspaceId],
      cols,
      rows,
    });
    const viewer: Viewer = {
      detach: () => {
        if (this.attachment?.session !== session) return;
        this.attachment.terminated = true;
        session.kill();
        this.attachment = null;
        this.conn.send({ type: 'detached', workspaceId, reason: 'opened-elsewhere' });
      },
    };
    const att = { workspaceId, session, terminated: false, viewer };
    this.attachment = att;
    this.deps.registry.acquire(workspaceId, viewer);

    session.onData((data) => {
      this.conn.send({
        type: 'output',
        workspaceId,
        data: Buffer.from(data, 'utf8').toString('base64'),
      });
    });
    session.onExit(() => {
      if (att.terminated) return;
      if (this.attachment === att) {
        this.attachment = null;
      }
      this.deps.registry.release(workspaceId, viewer);
      this.conn.send({ type: 'detached', workspaceId, reason: 'closed' });
    });

    this.conn.send({ type: 'attached', workspaceId });
  }

  private teardownAttachment(reason: 'closed'): void {
    const att = this.attachment;
    if (!att) return;
    att.terminated = true;
    att.session.kill();
    this.deps.registry.release(att.workspaceId, att.viewer);
    this.attachment = null;
    this.conn.send({ type: 'detached', workspaceId: att.workspaceId, reason });
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
