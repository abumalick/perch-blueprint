#!/usr/bin/env bash
# Shared test gate for the pre-commit / pre-merge-commit / pre-push hooks. Runs
# the full suite; a non-zero exit aborts the git operation that invoked it.
#
# WHY three hooks share this: `pre-commit` alone does NOT gate `main`. Git runs
# `pre-commit` only for `git commit` — never for merge commits (that's
# `pre-merge-commit`), never for fast-forward merges (no commit at all), and
# never when a ref is moved directly (`git update-ref`/`git push`). Merges are
# this repo's dominant integration path, so the merge + push hooks are what
# actually keep red code off `main` and `origin`.
#
# Arg 1 is the hook name, used only for the log line.
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"

# Git hooks don't inherit an interactive PATH; run through mise when present.
RUN=()
for mise_bin in "${HOME}/.local/bin/mise" /opt/homebrew/bin/mise /usr/local/bin/mise; do
  if [ -x "${mise_bin}" ]; then RUN=("${mise_bin}" exec --); break; fi
done
PNPM=("${RUN[@]}" pnpm)

echo "${1:-test-gate}: checking for leaks…"
"${RUN[@]}" bash "${REPO}/deploy/check-leaks.sh"

echo "${1:-test-gate}: running typecheck + unit tests…"
"${PNPM[@]}" --dir "${REPO}" -r typecheck
"${PNPM[@]}" --dir "${REPO}" -r test
"${PNPM[@]}" --dir "${REPO}" test:scripts

# Playwright e2e: serve the built PWA on a free port (the default 4173 is the
# standing deploy on the host running run-pwa.sh) so the gate never clashes with a
# live preview. Requires WebKit once per machine:
# `pnpm --filter @perch/pwa exec playwright install webkit`.
echo "${1:-test-gate}: building PWA + running e2e…"
"${PNPM[@]}" --dir "${REPO}" --filter @perch/pwa build
# console.log(String(port)), not console.log(port): a bare number goes through
# util.inspect, which Node auto-colors with ANSI escape codes whenever stdout looks
# like a TTY (as it can when this hook runs under an agent harness's pseudo-terminal).
# Those codes corrupt the command-substitution capture below, Number(...) on the
# result in playwright.config.ts becomes NaN, and the webServer URL construction
# throws "TypeError: Invalid URL" instead of a clear port-selection failure.
E2E_PORT="$("${RUN[@]}" node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(String(s.address().port));s.close()})')" \
  "${PNPM[@]}" --dir "${REPO}" --filter @perch/pwa e2e
