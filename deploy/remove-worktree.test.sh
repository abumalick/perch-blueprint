#!/usr/bin/env bash
# Tests for the worktree-removal deploy guard: serve-build.sh --heal and
# remove-worktree.sh must keep deploy/pwa-live off a removed worktree build.
# Runs against a throwaway git sandbox; needs no pnpm (only --restore/--heal paths).
set -euo pipefail

# When run from a git hook (the pre-commit gate), git exports GIT_DIR, GIT_INDEX_FILE,
# GIT_WORK_TREE, etc. into the environment. The sandbox's own git commands would inherit
# them and operate on the OUTER repo instead of the sandbox — corrupting the very commit
# that triggered us. Strip every GIT_* var so the sandbox is fully isolated.
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "${_v}"; done

# Flip the live symlinks without restarting the (non-existent, in this sandbox) agent.
export PERCH_SKIP_RESTART=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
mkdir -p "${REPO}/.tmp"
SB="$(mktemp -d "${REPO}/.tmp/wt-remove-test.XXXXXX")"
trap 'rm -rf "${SB}"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }
serves_main() { [ -f "$1/main.txt" ]; }
serves_foo()  { [ -f "$1/foo.txt" ]; }

# --- build the sandbox repo -------------------------------------------------
git init -q "${SB}"
git -C "${SB}" config user.email t@t
git -C "${SB}" config user.name test
mkdir -p "${SB}/deploy" "${SB}/packages/pwa/dist"
printf 'packages/pwa/dist/\n.worktrees/\ndeploy/pwa-live\ndeploy/agent-live\n' > "${SB}/.gitignore"
echo main > "${SB}/packages/pwa/dist/main.txt"
cp "${HERE}/serve-build.sh" "${HERE}/serve-agent.sh" "${HERE}/remove-worktree.sh" "${SB}/deploy/"
git -C "${SB}" add -A
git -C "${SB}" commit -qm init

LIVE="${SB}/deploy/pwa-live"
SERVE="${SB}/deploy/serve-build.sh"
REMOVE="${SB}/deploy/remove-worktree.sh"

# Agent equivalents: agent-live points at a checkout ROOT (main = the sandbox repo itself,
# or a worktree), not a dist dir. Resolve and compare physical paths.
SERVE_AGENT="${SB}/deploy/serve-agent.sh"
AGENT_LIVE="${SB}/deploy/agent-live"
SB_PHYS="$(cd "${SB}" && pwd -P)"
agent_target() { cd "${AGENT_LIVE}" && pwd -P; }
agent_serves_main() { [ "$(agent_target)" = "${SB_PHYS}" ]; }
agent_serves_foo()  { [ "$(agent_target)" = "$(cd "${SB}/.worktrees/foo" && pwd -P)" ]; }

make_worktree() {
  git -C "${SB}" worktree add -q "${SB}/.worktrees/foo" -b foo 2>/dev/null \
    || git -C "${SB}" worktree add -q "${SB}/.worktrees/foo" foo
  mkdir -p "${SB}/.worktrees/foo/packages/pwa/dist"
  echo foo > "${SB}/.worktrees/foo/packages/pwa/dist/foo.txt"
}

# --- 1. heal: dangling symlink falls back to main ---------------------------
ln -sfn "${SB}/gone/packages/pwa/dist" "${LIVE}"
"${SERVE}" --heal >/dev/null
serves_main "${LIVE}" || fail "heal did not restore main for a dangling symlink"
echo "ok: heal restores main when pwa-live dangles"

# --- 2. heal: healthy symlink is left untouched -----------------------------
make_worktree
ln -sfn "${SB}/.worktrees/foo/packages/pwa/dist" "${LIVE}"
"${SERVE}" --heal >/dev/null
serves_foo "${LIVE}" || fail "heal disturbed a healthy (non-dangling) symlink"
echo "ok: heal leaves a healthy symlink untouched"

# --- 2b. ensure: point at main only when absent or dangling; preserve a healthy symlink.
# This is what run-pwa.sh calls on startup so a restart doesn't clobber an active
# `serve:build` worktree deploy (the regression this guards).
rm -f "${LIVE}"
"${SERVE}" --ensure >/dev/null
serves_main "${LIVE}" || fail "ensure did not create pwa-live -> main when absent"
echo "ok: ensure creates a missing pwa-live pointing at main"

ln -sfn "${SB}/gone/packages/pwa/dist" "${LIVE}"
"${SERVE}" --ensure >/dev/null
serves_main "${LIVE}" || fail "ensure did not restore main for a dangling symlink"
echo "ok: ensure restores main when pwa-live dangles"

ln -sfn "${SB}/.worktrees/foo/packages/pwa/dist" "${LIVE}"
"${SERVE}" --ensure >/dev/null
serves_foo "${LIVE}" || fail "ensure clobbered a healthy worktree deploy"
echo "ok: ensure preserves an active worktree deploy across a restart"

# --- 3. remove: live deploy points INTO the worktree -> restore + remove ----
ln -sfn "${SB}/.worktrees/foo/packages/pwa/dist" "${LIVE}"
"${REMOVE}" "${SB}/.worktrees/foo" >/dev/null
[ ! -e "${SB}/.worktrees/foo" ] || fail "worktree was not removed"
serves_main "${LIVE}" || fail "live deploy was not restored to main before removal"
echo "ok: removing the deployed worktree restores main first"

# --- 4. remove: live deploy points at main -> untouched, still removes ------
git -C "${SB}" branch -D foo >/dev/null 2>&1 || true
make_worktree
ln -sfn "${SB}/packages/pwa/dist" "${LIVE}"
"${REMOVE}" "${SB}/.worktrees/foo" >/dev/null
[ ! -e "${SB}/.worktrees/foo" ] || fail "worktree was not removed (main-deploy case)"
serves_main "${LIVE}" || fail "main deploy should stay on main"
echo "ok: removing a non-deployed worktree leaves main deploy intact"

# --- 5. agent heal: dangling symlink falls back to main ---------------------
ln -sfn "${SB}/gone" "${AGENT_LIVE}"
"${SERVE_AGENT}" --heal >/dev/null
agent_serves_main || fail "agent heal did not restore main for a dangling symlink"
echo "ok: agent heal restores main when agent-live dangles"

# --- 6. agent heal: healthy symlink is left untouched -----------------------
git -C "${SB}" branch -D foo >/dev/null 2>&1 || true
make_worktree
ln -sfn "${SB}/.worktrees/foo" "${AGENT_LIVE}"
"${SERVE_AGENT}" --heal >/dev/null
agent_serves_foo || fail "agent heal disturbed a healthy (non-dangling) symlink"
echo "ok: agent heal leaves a healthy symlink untouched"

# --- 7. remove: agent runs from the worktree -> restore + remove ------------
ln -sfn "${SB}/.worktrees/foo" "${AGENT_LIVE}"
"${REMOVE}" "${SB}/.worktrees/foo" >/dev/null
[ ! -e "${SB}/.worktrees/foo" ] || fail "worktree was not removed (agent-deploy case)"
agent_serves_main || fail "agent was not restored to main before removal"
echo "ok: removing the agent-deployed worktree restores main first"

echo "All worktree-remove guard tests passed."
