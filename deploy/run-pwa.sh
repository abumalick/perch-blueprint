#!/usr/bin/env bash
# Build (if needed) and statically serve the Perch PWA on loopback for tailscale serve.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO}"
# Service managers don't inherit an interactive PATH; run through mise when present.
PNPM=(pnpm)
for mise_bin in "${HOME}/.local/bin/mise" /opt/homebrew/bin/mise /usr/local/bin/mise; do
  if [ -x "${mise_bin}" ]; then PNPM=("${mise_bin}" exec -- pnpm); break; fi
done
"${PNPM[@]}" --filter @perch/pwa build
# Serve via the deploy/pwa-live symlink so a worktree build can be swapped in for testing
# (pnpm serve:build). On startup, only (re)point it at main when it's absent or dangling —
# a healthy symlink (main OR an active serve:build worktree deploy) is preserved, so a
# restart doesn't silently yank an on-device test back to main. serve:restore flips to main.
"${REPO}/deploy/serve-build.sh" --ensure
exec "${PNPM[@]}" --filter @perch/pwa exec \
  vite preview --host 127.0.0.1 --port 4173 --strictPort --outDir "${REPO}/deploy/pwa-live"
