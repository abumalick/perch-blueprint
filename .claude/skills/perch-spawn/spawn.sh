#!/usr/bin/env bash
# Spawn one Perch workspace: a detached tmux session running Claude Code on a brief.
#
# usage: spawn.sh [--title NAME] <projectPath> [modelAlias]   # brief on stdin
# prints: the workspace id (e.g. perch-a1b2c3)
#
# The brief arrives on stdin and is written to a file; the tmux command string
# contains only that fixed path. This is what makes arbitrary prose safe: the
# login shell expands "$(cat …)" and hands the bytes to claude as one argv
# element, and command-substitution output is never re-parsed. Quotes,
# apostrophes, backticks, $ and newlines in the brief all survive untouched.
# Do NOT "simplify" this by interpolating the brief into the command string.
set -eu

title=""
while [ $# -gt 0 ]; do
  case "$1" in
    --title) title="${2:-}"; shift 2 || true ;;
    --title=*) title="${1#--title=}"; shift ;;
    *) break ;;
  esac
done

project="${1:-}"
model="${2:-opus[1m]}"
if [ -z "$project" ]; then
  echo "usage: spawn.sh [--title NAME] <projectPath> [modelAlias]   (brief on stdin)" >&2
  exit 2
fi

# `tmux new-session -c` silently runs in $HOME when the cwd is missing, which
# would create a workspace pointing at the wrong directory. Reject up front.
resolved="$(cd "$project" 2>/dev/null && pwd -P)" || {
  echo "not a directory: $project" >&2
  exit 2
}

brief="$(cat)"
case "$brief" in
  *[![:space:]]*) ;;
  *) echo "empty brief on stdin" >&2; exit 2 ;;
esac

id="perch-$(head -c 3 /dev/urandom | od -An -tx1 | tr -d ' \n')"
dir="$HOME/.perch/spawn"
mkdir -p "$dir"
printf '%s\n' "$brief" > "$dir/$id.md"

base="claude --model '$model'"

# Without --title, Claude Code names the workspace itself: it writes the pane
# title as it goes and the agent reads that. A caller who already knows what the
# workspace is for can say so instead, which keeps the name stable and lets a
# batch of workspaces be told apart at a glance.
#
# Two halves, both needed. CLAUDE_CODE_DISABLE_TERMINAL_TITLE stops Claude Code
# overwriting the pane title a second later — an env prefix rather than tmux's
# `-e`, which wants tmux 3.2. And the title is stored with the status glyph the
# agent expects, because `deriveWorkspaceName` only trusts a pane title that
# carries one; a bare title reads as a plain shell and falls back to the
# directory name.
launch="$base \"\$(cat '$dir/$id.md')\""
if [ -n "$title" ]; then
  launch="CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 $launch"
fi

tmux new-session -d -s "$id" -c "$resolved" "$launch"
if [ -n "$title" ]; then
  tmux select-pane -t "$id" -T "✳ $title"
fi

# The stored command deliberately omits the brief. `resumeCommand` in the agent
# splits this on whitespace and builds `<base> --resume <sid> || exec <base>`,
# so keeping the "$(cat …)" arg here would re-submit the original brief into the
# conversation every time the workspace is unparked.
tmux set-option -t "$id" @perch_command "$base"

# A command string the login shell rejects kills the pane instantly, and tmux
# then destroys the session — the workspace just never appears, with no error.
sleep 2
if ! tmux has-session -t "$id" 2>/dev/null; then
  echo "workspace $id died on launch (brief kept at $dir/$id.md)" >&2
  exit 1
fi

echo "$id"
