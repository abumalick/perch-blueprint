#!/usr/bin/env bash
# Build the current working tree's PWA. Called by the post-commit and post-merge
# git hooks: a hook runs in the working tree where the action happened, so this
# rebuilds main's dist when invoked from the main worktree (the live deploy serves
# that via the deploy/pwa-live symlink) and a feature worktree's dist otherwise.
# Blocking, with output inline. Skip with PERCH_NO_BUILD=1.
set -euo pipefail

if [ "${PERCH_NO_BUILD:-}" = "1" ]; then
  echo "PERCH_NO_BUILD=1 set; skipping PWA build."
  exit 0
fi

REPO="$(git rev-parse --show-toplevel)"

# Service managers / git hooks don't inherit an interactive PATH; run through mise.
PNPM=(pnpm)
for mise_bin in "${HOME}/.local/bin/mise" /opt/homebrew/bin/mise /usr/local/bin/mise; do
  if [ -x "${mise_bin}" ]; then PNPM=("${mise_bin}" exec -- pnpm); break; fi
done

echo "Building @perch/pwa in ${REPO}…"
"${PNPM[@]}" --filter @perch/pwa --dir "${REPO}" build
