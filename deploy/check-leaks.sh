#!/usr/bin/env bash
# Leak guard, run first by the test gate (run-tests.sh). Fails on:
#   1. secrets — gitleaks over the staged diff and the whole history;
#   2. blocklisted words in tracked files — names that must never be published
#      (other projects, organisations, hostnames). gitleaks only knows credential
#      shapes, so it cannot catch these.
# The word list lives OUTSIDE the repo, one case-insensitive whole word (or ERE) per
# line, `#` comments allowed: ${PERCH_LEAK_WORDS:-~/.perch/leak-words.txt}. Keeping it
# out of the tree is the point — committing the list would publish the very names it
# guards. A missing list skips the word check (opt-in per machine).
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
WORDS="${PERCH_LEAK_WORDS:-${HOME}/.perch/leak-words.txt}"

command -v gitleaks >/dev/null || { echo "check-leaks: gitleaks not found (pinned in mise.toml; run 'mise install')" >&2; exit 1; }

gitleaks git --no-banner --redact --log-level warn --pre-commit --staged "${REPO}"
gitleaks git --no-banner --redact --log-level warn "${REPO}"

if [ ! -f "${WORDS}" ]; then
  echo "check-leaks: no word list at ${WORDS}; skipping the word check"
  exit 0
fi

# A blank pattern would match every line, so strip blanks and comments first.
patterns="$(sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^$/d' "${WORDS}")"
[ -n "${patterns}" ] || exit 0

if hits="$(git -C "${REPO}" grep -n -I -i -w -E -f <(printf '%s\n' "${patterns}"))"; then
  echo "check-leaks: blocklisted words (from ${WORDS}) in tracked files:" >&2
  printf '%s\n' "${hits}" >&2
  exit 1
fi
