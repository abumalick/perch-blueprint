#!/usr/bin/env bash
# Remove a feature worktree safely. If a live deploy (deploy/pwa-live for the PWA,
# deploy/agent-live for the agent) is serving that worktree, switch it back to main
# first — otherwise the symlink would dangle and keep serving a removed checkout.
# See docs/WORKTREES.md.
#
#   pnpm worktree:remove <worktree-path>
#
# Refuses (via git) if the worktree has uncommitted changes; commit or use
# `git worktree remove --force` yourself if you really mean to discard them.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${REPO}/deploy/pwa-live"
SERVE_BUILD="${REPO}/deploy/serve-build.sh"
LIVE_AGENT="${REPO}/deploy/agent-live"
SERVE_AGENT="${REPO}/deploy/serve-agent.sh"

WT_ARG="${1:?usage: remove-worktree.sh <worktree-path>}"
WT="$(cd "${WT_ARG}" && pwd -P)"   # absolutize physically; fails loudly if missing

# Resolve what each live deploy currently serves (physical path; portable, no readlink -f).
LIVE_TARGET=""
if [ -d "${LIVE}" ]; then LIVE_TARGET="$(cd "${LIVE}" && pwd -P)"; fi
AGENT_TARGET=""
if [ -d "${LIVE_AGENT}" ]; then AGENT_TARGET="$(cd "${LIVE_AGENT}" && pwd -P)"; fi

case "${LIVE_TARGET}/" in
  "${WT}/"*)
    echo "PWA deploy is serving '${WT}'; restoring main first…"
    "${SERVE_BUILD}" --restore
    ;;
esac

case "${AGENT_TARGET}/" in
  "${WT}/"*)
    echo "Agent is running from '${WT}'; restoring main first…"
    "${SERVE_AGENT}" --restore
    ;;
esac

git -C "${REPO}" worktree remove "${WT}"
echo "Removed worktree '${WT}'."

# Backstop: heal a still-dangling symlink (e.g. the worktree was already half-gone).
"${SERVE_BUILD}" --heal
"${SERVE_AGENT}" --heal
