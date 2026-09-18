import type { TmuxPort } from '../ports/tmux-port';
import type { StatusStorePort } from '../ports/status-store-port';
import type { ParkedStorePort } from '../ports/parked-store-port';
import type { DirectoryChecker } from '../ports/directory-checker';
import { resumeCommand } from './resume-command';

export type UnparkResult = 'not-parked' | 'unparked' | 'missing-directory';

export interface UnparkWorkspaceDeps {
  parked: Pick<ParkedStorePort, 'get' | 'remove'>;
  tmux: Pick<TmuxPort, 'createSession'>;
  isDirectory: DirectoryChecker;
  status: Pick<StatusStorePort, 'set'>;
}

// Brings a parked workspace back: recreates its tmux session with the Claude conversation
// resumed, then clears the parked record. `not-parked` means the id has no record and the
// caller should proceed with a normal attach.
//
// The workspace id is reused deliberately — the PWA routes attach/input/close by workspace
// id, so minting a fresh one (as createWorkspace does) would orphan client state. That is
// why this bypasses createWorkspace; the directory guard below is the one piece of
// createWorkspace it must NOT skip.
export async function unparkWorkspace(
  deps: UnparkWorkspaceDeps,
  id: string,
): Promise<UnparkResult> {
  const record = await deps.parked.get(id);
  if (!record) {
    return 'not-parked';
  }
  // `tmux new-session -c` silently runs the command in $HOME when the cwd is missing, and
  // Claude scopes session-id lookup to the project directory — so a deleted project would
  // both resume in the wrong place and fail to find the conversation. Keep the record so
  // the workspace stays listed and the user can still close it deliberately.
  if (!(await deps.isDirectory(record.projectPath))) {
    return 'missing-directory';
  }
  await deps.tmux.createSession({
    name: record.id,
    cwd: record.projectPath,
    command: resumeCommand(record.command, record.claudeSessionId),
  });
  await deps.parked.remove(record.id);
  // Back to a normal live workspace. The next hook event moves it to `working`.
  deps.status.set(record.id, 'idle');
  return 'unparked';
}
