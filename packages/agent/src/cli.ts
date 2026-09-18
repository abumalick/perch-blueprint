import { homedir } from 'node:os';
import { readFile, writeFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type AgentConfig } from './infrastructure/config';
import { systemClock, RandomIdGenerator, systemPathResolver } from './infrastructure/system';
import { TmuxAdapter } from './infrastructure/tmux-adapter';
import { FsProjectLister } from './infrastructure/fs-project-lister';
import { FileRecentStore } from './infrastructure/file-recent-store';
import { FileHiddenFoldersStore } from './infrastructure/file-hidden-folders-store';
import { GitRepoRemote } from './infrastructure/git-repo-remote';
import { FileClaudeSessionsStore } from './infrastructure/file-claude-sessions-store';
import { fsIsDirectory } from './infrastructure/fs-directory-checker';
import { createWorkspace } from './application/create-workspace';
import { listWorkspaces } from './application/list-workspaces';
import { closeWorkspace } from './application/close-workspace';
import { getRecentPaths } from './application/get-recent-paths';
import { browseDir } from './application/browse-dir';
import { isHiddenPath } from './application/is-hidden-path';
import { installHooks } from './application/install-hooks';

function wire(config: AgentConfig) {
  const tmux = new TmuxAdapter();
  const recent = new FileRecentStore(config.recentStorePath);
  const lister = new FsProjectLister();
  const hiddenFolders = new FileHiddenFoldersStore(config.hiddenFoldersPath);
  const repoRemote = new GitRepoRemote();
  const claudeSessions = new FileClaudeSessionsStore(config.claudeSessionsDir);
  return { tmux, recent, lister, hiddenFolders, repoRemote, claudeSessions };
}

export async function run(argv: string[], env: NodeJS.ProcessEnv, home: string): Promise<string> {
  const config = loadConfig(env, home);
  const { tmux, recent, lister, hiddenFolders, repoRemote, claudeSessions } = wire(config);
  const [command, ...rest] = argv;

  switch (command) {
    case 'list': {
      const hidden = await hiddenFolders.list();
      const workspaces = (
        await listWorkspaces({
          tmux,
          machineId: config.machineId,
          sessionPrefix: config.sessionPrefix,
          status: { get: () => undefined, getChangedAt: () => undefined, getUrgent: () => false },
          repoRemote,
          claudeSessions,
        })
      ).filter((w) => !isHiddenPath(w.projectPath, hidden));
      return JSON.stringify(workspaces, null, 2);
    }
    case 'create': {
      const projectPath = rest[0];
      if (!projectPath) throw new Error('usage: perch create <projectPath> [command]');
      const cmd = rest[1] ?? 'claude';
      const ws = await createWorkspace(
        {
          tmux,
          recent,
          resolvePath: systemPathResolver,
          isDirectory: fsIsDirectory,
          clock: systemClock,
          ids: new RandomIdGenerator(),
          machineId: config.machineId,
        },
        { projectPath, command: cmd },
      );
      return JSON.stringify(ws, null, 2);
    }
    case 'close': {
      const id = rest[0];
      if (!id) throw new Error('usage: perch close <workspaceId>');
      await closeWorkspace({ tmux }, id);
      return JSON.stringify({ closed: id });
    }
    case 'recent': {
      const hidden = await hiddenFolders.list();
      return JSON.stringify(await getRecentPaths({ recent, hidden }), null, 2);
    }
    case 'browse': {
      const path = rest[0];
      if (!path) throw new Error('usage: perch browse <path>');
      const hidden = await hiddenFolders.list();
      return JSON.stringify(await browseDir({ lister, hidden }, path, config.projectRoots), null, 2);
    }
    case 'install-hooks': {
      // Copy the hook script to a stable, $HOME-relative location so the
      // registered command is byte-identical across machines (the repo itself
      // lives at different sub-paths per machine). Copy rather than symlink so
      // the reference never goes stale if the repo moves or is removed.
      const sourceScript = joinPath(dirname(fileURLToPath(import.meta.url)), 'hooks', 'perch-hook.sh');
      const stableScript = joinPath(home, '.perch', 'perch-hook.sh');
      await mkdir(dirname(stableScript), { recursive: true });
      await copyFile(sourceScript, stableScript);
      await chmod(stableScript, 0o755);

      const settingsPath = joinPath(home, '.claude', 'settings.json');
      let current: Record<string, unknown> = {};
      try {
        current = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      const merged = installHooks({ settings: current }, { hookCommand: 'bash ~/.perch/perch-hook.sh', port: config.port });
      await mkdir(dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
      return JSON.stringify({ installed: settingsPath, scriptPath: stableScript });
    }
    default:
      throw new Error(`unknown command: ${command ?? '(none)'}`);
  }
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isEntrypoint) {
  run(process.argv.slice(2), process.env, homedir())
    .then((out) => {
      process.stdout.write(`${out}\n`);
    })
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
