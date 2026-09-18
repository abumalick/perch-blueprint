// One entry of Claude Code's session registry (~/.claude/sessions/<pid>.json), reduced to
// the two fields Perch needs: the tmux session it runs in (the join key — a workspace id)
// and the session's name, which is the address other Claude Code sessions message it by.
export interface ClaudeSessionRef {
  tmuxSession: string;
  address: string;
}

// Validates one registry entry. The registry is undocumented Claude Code internals, so this
// reads defensively and drops anything it cannot both join and label — an entry we cannot
// key on a tmux session could never match a workspace anyway.
export function parseClaudeSession(raw: unknown): ClaudeSessionRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, tmux } = raw as { name?: unknown; tmux?: unknown };
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof tmux !== 'string') return null;
  // `tmux` is "<session>:<window>.<pane>"; only the session name is the workspace id.
  const tmuxSession = tmux.split(':')[0] ?? '';
  if (tmuxSession.length === 0) return null;
  return { tmuxSession, address: name };
}
