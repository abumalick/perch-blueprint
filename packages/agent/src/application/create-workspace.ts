import { basename } from 'node:path';
import type { Workspace } from '@perch/contracts';
import type { TmuxPort } from '../ports/tmux-port';
import type { RecentStorePort } from '../ports/recent-store-port';
import type { PathResolver } from '../ports/path-resolver';
import type { DirectoryChecker } from '../ports/directory-checker';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';

export interface CreateWorkspaceDeps {
  tmux: TmuxPort;
  recent: RecentStorePort;
  resolvePath: PathResolver;
  isDirectory: DirectoryChecker;
  clock: Clock;
  ids: IdGenerator;
  machineId: string;
}

export interface CreateWorkspaceInput {
  projectPath: string;
  command: string;
}

export async function createWorkspace(
  deps: CreateWorkspaceDeps,
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  const id = `perch-${deps.ids.next()}`;
  const projectPath = deps.resolvePath(input.projectPath);
  // tmux's `new-session -c` silently runs the command in $HOME when the cwd is missing,
  // so reject up front rather than create a workspace pointing at the wrong directory.
  if (!(await deps.isDirectory(projectPath))) {
    throw new Error(`directory does not exist: ${projectPath}`);
  }
  await deps.tmux.createSession({ name: id, cwd: projectPath, command: input.command });
  await deps.recent.record(projectPath);
  const now = deps.clock.now();
  return {
    machineId: deps.machineId,
    id,
    name: basename(projectPath),
    projectPath,
    command: input.command,
    createdAt: now,
    lastActivityAt: now,
    status: 'idle',
  };
}
