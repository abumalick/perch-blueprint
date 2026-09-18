import { homedir } from 'node:os';
import { loadConfig, assertServerConfig } from './infrastructure/config';
import { systemClock, RandomIdGenerator, systemPathResolver } from './infrastructure/system';
import { TmuxAdapter } from './infrastructure/tmux-adapter';
import { FileRecentStore } from './infrastructure/file-recent-store';
import { FileHiddenFoldersStore } from './infrastructure/file-hidden-folders-store';
import { FileCommandsStore } from './infrastructure/file-commands-store';
import { FileClaudeSessionsStore } from './infrastructure/file-claude-sessions-store';
import { SystemdScopeReaper } from './infrastructure/systemd-scope-reaper';
import { FileClientLogStore } from './infrastructure/file-client-log-store';
import { FileWorkspaceLogStore } from './infrastructure/file-workspace-log-store';
import { FileParkedStore } from './infrastructure/file-parked-store';
import { reconcileParked } from './application/reconcile-parked';
import { FsProjectLister } from './infrastructure/fs-project-lister';
import { FsFileReader } from './infrastructure/fs-file-reader';
import { FsFileWriter } from './infrastructure/fs-file-writer';
import { fsIsDirectory } from './infrastructure/fs-directory-checker';
import { NodePtyAdapter } from './infrastructure/node-pty-adapter';
import { FileStatusStore } from './infrastructure/file-status-store';
import { FsBrowserDiscovery } from './infrastructure/fs-browser-discovery';
import { GitRepoRemote } from './infrastructure/git-repo-remote';
import { AgentBrowserCli } from './infrastructure/agent-browser-cli';
import { connectBrowserUpstream } from './infrastructure/ws-relay-socket';
import { WsServer } from './server/ws-server';
import { writeAgentToken } from './infrastructure/token-file';
import { ensureUtf8Locale } from './infrastructure/ensure-utf8-locale';

async function main(): Promise<void> {
  ensureUtf8Locale(process.env);
  const config = loadConfig(process.env, homedir());
  assertServerConfig(config);
  await writeAgentToken(homedir(), config.token);
  const tmux = new TmuxAdapter();
  const status = new FileStatusStore(config.statusStorePath);
  const parked = new FileParkedStore(config.parkedStorePath);
  // Kill any tmux session tmux-continuum resurrected under a parked workspace's id, so the
  // parked record stays the single source of truth. Must run before prune/list below.
  await reconcileParked({ parked, tmux, sessionPrefix: config.sessionPrefix });
  const sessions = await tmux.listSessions(config.sessionPrefix);
  const parkedIds = (await parked.list()).map((p) => p.id);
  // Parked workspaces have no live session, so their status entries must be preserved
  // explicitly or prune would drop them.
  status.prune([...sessions.map((s) => s.name), ...parkedIds]);
  const server = new WsServer({
    config,
    tmux,
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
    browserDiscovery: new FsBrowserDiscovery(),
    browserCommands: new AgentBrowserCli(),
    hiddenFolders: new FileHiddenFoldersStore(config.hiddenFoldersPath),
    commands: new FileCommandsStore(config.commandsPath),
    clientLog: new FileClientLogStore(config.clientLogPath),
    workspaceLog: new FileWorkspaceLogStore(config.workspaceLogPath),
    parked,
    connectUpstream: connectBrowserUpstream,
    repoRemote: new GitRepoRemote(),
    claudeSessions: new FileClaudeSessionsStore(config.claudeSessionsDir),
    scopes: new SystemdScopeReaper(),
  });
  await server.start();
  process.stdout.write(`perch agent listening on ${config.host}:${server.address().port}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
