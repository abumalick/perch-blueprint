#!/usr/bin/env bash
# Temporarily serve a worktree's PWA build at the live origin, so the installed PWA
# auto-updates to it for on-device testing. Flips the deploy/pwa-live symlink that
# run-pwa.sh serves. Restore main with --restore. See docs/WORKTREES.md.
#
#   pnpm serve:build <worktree-path>   # build that worktree's PWA and serve it live
#   pnpm serve:restore                 # point back at main's build
#   pnpm serve:heal                    # restore main only if pwa-live dangles
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${REPO}/deploy/pwa-live"
MAIN_DIST="${REPO}/packages/pwa/dist"

restore_main() { ln -sfn "${MAIN_DIST}" "${LIVE}"; }

if [ "${1:-}" = "--restore" ]; then
  restore_main
  echo "Restored: serving main. The PWA updates within ~60s (app must be foregrounded)."
  exit 0
fi

if [ "${1:-}" = "--ensure" ]; then
  # Startup guard for run-pwa.sh: guarantee pwa-live points at a valid build, but DON'T
  # clobber an active `pnpm serve:build` worktree deploy on a service restart. Point at main
  # only when pwa-live is absent, dangling, or not a symlink; a healthy symlink (main OR a
  # worktree) is left in place. `serve:restore` flips back to main explicitly.
  if [ -L "${LIVE}" ] && [ -e "${LIVE}" ]; then
    echo "pwa-live is healthy; leaving it in place."
  else
    restore_main
    echo "pwa-live was absent/dangling; pointed at main."
  fi
  exit 0
fi

if [ "${1:-}" = "--heal" ]; then
  # Self-heal: a symlink that exists but resolves to nothing means its worktree build
  # was removed out from under the live deploy. Fall back to main so the PWA never
  # serves a missing/stale target. A healthy symlink is left untouched.
  if [ -L "${LIVE}" ] && [ ! -e "${LIVE}" ]; then
    restore_main
    echo "Healed: pwa-live was dangling; restored main."
  else
    echo "pwa-live is healthy; nothing to heal."
  fi
  exit 0
fi

# Service managers / fresh shells don't inherit an interactive PATH; run through mise.
PNPM=(pnpm)
for mise_bin in "${HOME}/.local/bin/mise" /opt/homebrew/bin/mise /usr/local/bin/mise; do
  if [ -x "${mise_bin}" ]; then PNPM=("${mise_bin}" exec -- pnpm); break; fi
done

WT_ARG="${1:?usage: serve-build.sh <worktree-path> | --restore | --heal}"
WT="$(cd "${WT_ARG}" && pwd)"   # absolutize; fails loudly if the path is missing
SLUG="$(basename "${WT}")"
WT_DIST="${WT}/packages/pwa/dist"

echo "Building '${SLUG}' PWA (PERCH_BUILD_LABEL=${SLUG})…"
PERCH_BUILD_LABEL="${SLUG}" "${PNPM[@]}" --filter @perch/pwa --dir "${WT}" build

ln -sfn "${WT_DIST}" "${LIVE}"
echo "Now serving '${SLUG}'. The PWA updates within ~60s (app must be foregrounded)."
echo "Restore main with: pnpm serve:restore"
