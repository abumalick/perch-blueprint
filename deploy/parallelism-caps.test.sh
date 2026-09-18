#!/usr/bin/env bash
# The test gate (deploy/git-hooks/run-tests.sh) is the heaviest thing in the repo and runs on
# every commit. Left uncapped, each runner defaults to one worker per core, so the gate's peak
# memory scales with the host's core count and is rarely the only thing running -- enough of
# them together can exhaust a machine's memory and swap.
#
# Every test runner in the gate must therefore bound its own concurrency. This guards that:
# removing a cap silently restores the unbounded behaviour.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fails=0

fail() { echo "  FAIL: $1"; fails=$((fails + 1)); }
pass() { echo "  ok: $1"; }

# Reads an integer `key: <n>` out of a config file, ignoring commented lines.
config_int() {
  grep -oE "^[[:space:]]*$2:[[:space:]]*[0-9]+" "$1" 2>/dev/null | grep -oE '[0-9]+$' | head -1
}

check_cap() {
  local label="$1" file="$2" key="$3" max="$4" value
  if [ ! -f "$file" ]; then
    fail "$label: $file does not exist"
    return
  fi
  # `|| true`: a missing key is the failure this test exists to report, not a script error.
  value="$(config_int "$file" "$key" || true)"
  if [ -z "$value" ]; then
    fail "$label: no '$key' cap in $(basename "$file") -- unbounded parallelism"
  elif [ "$value" -gt "$max" ]; then
    fail "$label: $key=$value exceeds the agreed ceiling of $max"
  else
    pass "$label: $key=$value"
  fi
}

echo "parallelism caps:"

# jsdom + Svelte + xterm workers, over a gigabyte each -- the heaviest runner in the gate.
check_cap "pwa vitest" "$root/packages/pwa/vite.config.ts" maxWorkers 4

# Light (zod/pure domain) but defaults to one fork per core just the same.
check_cap "contracts vitest" "$root/packages/contracts/vitest.config.ts" maxWorkers 4

# Each Playwright worker is a full WebKit browser.
check_cap "e2e playwright" "$root/packages/pwa/playwright.config.ts" workers 2

# packages/agent pins fileParallelism:false, which bounds it to a single worker already.
if grep -qE '^[[:space:]]*fileParallelism:[[:space:]]*false' "$root/packages/agent/vitest.config.ts"; then
  pass "agent vitest: fileParallelism=false"
else
  fail "agent vitest: lost fileParallelism=false -- unbounded parallelism"
fi

if [ "$fails" -gt 0 ]; then
  echo "parallelism caps: $fails check(s) failed"
  exit 1
fi
echo "parallelism caps: all good"
