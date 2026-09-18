#!/usr/bin/env bash
# Perch Claude Code hook: notify the local agent of an attention event.
# Usage: perch-hook.sh <Event> <port>   (Claude Code's JSON payload arrives on stdin)
event="$1"
port="${2:-8787}"
# Claude Code always runs inside the workspace's tmux session, so no TMUX means this is not a
# workspace event. The guard matters because `tmux display-message` happily resolves to the
# most-recently-active session when run outside tmux, which would otherwise stamp the status
# onto an unrelated workspace.
[ -z "${TMUX:-}" ] && exit 0
session="$(tmux display-message -p '#S' 2>/dev/null)"
[ -z "$session" ] && exit 0
# Claude's payload is forwarded verbatim as a nested object so the agent can read
# `background_tasks` without this script needing jq (not installed on every agent machine) or
# any bash JSON parsing. The tty check keeps a hand-run hook from blocking forever on stdin.
payload=null
[ -t 0 ] || payload="$(cat)"
[ -z "$payload" ] && payload=null
token=""
[ -r "${HOME}/.perch/token" ] && token="$(cat "${HOME}/.perch/token")"
curl -s -m 2 -X POST "http://127.0.0.1:${port}/hooks" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${token}" \
  -d "{\"sessionName\":\"${session}\",\"event\":\"${event}\",\"claude\":${payload}}" >/dev/null 2>&1 || true
exit 0
