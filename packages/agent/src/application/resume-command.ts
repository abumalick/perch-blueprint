// Builds the command used to bring a parked workspace back.
//
// Two things this must get right:
//  - Flags survive. The PWA's default create command is `claude --model 'opus[1m]'`, not
//    bare `claude`, so hardcoding `claude --resume <id>` would silently drop the model (and
//    any other flag the user set). `--model` and `--resume` compose fine. Splitting on
//    whitespace also leaves the model's shell quoting intact, which `opus[1m]` needs.
//  - A stale session id must not destroy the workspace. `claude --resume <unknown>` is a
//    hard error with no fallback, and because the command IS the pane's process, that exit
//    makes tmux destroy the session and the workspace vanish from the list. The `|| exec`
//    tail degrades to a fresh session instead — the same degradation already chosen for a
//    workspace that never had a session id. tmux runs the command string through a shell,
//    so `||` and `exec` work without an `sh -c` wrapper.
export function resumeCommand(command: string, sessionId: string | undefined): string {
  // An empty (or whitespace-only) command has nothing to resume or fall back to — building
  // `--resume <id> || exec` from it would leave a malformed, pane-killing shell string.
  if (!sessionId || command.trim().length === 0) {
    return command;
  }
  const base = stripResumeFlag(command);
  return `${base} --resume ${sessionId} || exec ${base}`;
}

// Drops an existing `--resume <value>` pair so parking a workspace twice replaces the id
// instead of appending a second, conflicting flag.
function stripResumeFlag(command: string): string {
  const parts = command.split(/\s+/).filter((p) => p.length > 0);
  const out: string[] = [];
  let skipNext = false;
  for (const part of parts) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (part === '--resume') {
      skipNext = true; // also skip its value
      continue;
    }
    out.push(part);
  }
  return out.join(' ');
}
