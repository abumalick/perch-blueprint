#!/usr/bin/env bash
# Temporarily run the agent service from a worktree's source, so agent/protocol changes
# can be tested on-device without merging — the agent equivalent of serve-build.sh.
# Flips the deploy/agent-live symlink (which run-agent.sh runs the agent from) and
# restarts the service. Secrets still come from main's deploy/agent.env. See docs/WORKTREES.md.
#
#   pnpm serve:agent <worktree-path>   # run that worktree's agent live
#   pnpm serve:agent-restore           # point back at main's agent
#   pnpm serve:agent-heal              # restore main only if agent-live dangles
#
# Set PERCH_SKIP_RESTART=1 to flip the symlink without restarting (used by the tests).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${REPO}/deploy/agent-live"

# Restart is safe: the unit uses KillMode=process, so the tmux server and its sessions
# survive (the agent re-discovers them via `tmux list-sessions`). The in-memory attention
# store resets, so sessions show idle until their next hook event.
restart_agent() {
  if [ -n "${PERCH_SKIP_RESTART:-}" ]; then return 0; fi
  if command -v systemctl >/dev/null 2>&1 \
     && systemctl --user list-unit-files perch-agent.service >/dev/null 2>&1; then
    systemctl --user restart perch-agent
  elif command -v launchctl >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/com.perch.agent"
  else
    echo "warning: no systemd/launchd found; restart the agent manually." >&2
  fi
}

restore_main() { ln -sfn "${REPO}" "${LIVE}"; }

if [ "${1:-}" = "--restore" ]; then
  restore_main
  restart_agent
  echo "Restored: agent running from main."
  exit 0
fi

if [ "${1:-}" = "--heal" ]; then
  # A symlink that exists but resolves to nothing means its worktree was removed out from
  # under the live agent. Fall back to main so the next (re)start runs a valid checkout.
  if [ -L "${LIVE}" ] && [ ! -e "${LIVE}" ]; then
    restore_main
    restart_agent
    echo "Healed: agent-live was dangling; restored main."
  else
    echo "agent-live is healthy; nothing to heal."
  fi
  exit 0
fi

WT_ARG="${1:?usage: serve-agent.sh <worktree-path> | --restore | --heal}"
WT="$(cd "${WT_ARG}" && pwd)"   # absolutize; fails loudly if the path is missing
SLUG="$(basename "${WT}")"

ln -sfn "${WT}" "${LIVE}"
restart_agent
echo "Now running the agent from '${SLUG}'. Restore main with: pnpm serve:agent-restore"
