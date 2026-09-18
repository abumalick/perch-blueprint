#!/usr/bin/env bash
# Tests for check-leaks.sh against a throwaway git sandbox. Needs gitleaks on PATH
# (pinned in mise.toml).
set -euo pipefail

# Under a git hook, GIT_DIR/GIT_INDEX_FILE point at the OUTER repo; the sandbox's git
# commands must not inherit them.
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "${_v}"; done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
mkdir -p "${REPO}/.tmp"
SB="$(mktemp -d "${REPO}/.tmp/check-leaks-test.XXXXXX")"
trap 'rm -rf "${SB}"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }
check() { (cd "${SB}/repo" && PERCH_LEAK_WORDS="${SB}/words.txt" bash "${HERE}/check-leaks.sh") >"${SB}/out" 2>&1; }

git init -q "${SB}/repo"
echo "hello" > "${SB}/repo/readme.txt"
git -C "${SB}/repo" add -A
git -C "${SB}/repo" -c user.email=t@t -c user.name=test commit -qm init

printf '# comment\n\nzorblax\n' > "${SB}/words.txt"

check || { cat "${SB}/out"; fail "a clean repo must pass"; }

echo "see the Zorblax project" > "${SB}/repo/notes.txt"
git -C "${SB}/repo" add notes.txt
check && fail "a blocklisted word in a tracked file must fail"
grep -q 'notes.txt' "${SB}/out" || fail "the failure must name the offending file"

echo "zorblaxian is a different word" > "${SB}/repo/notes.txt"
git -C "${SB}/repo" add notes.txt
check || { cat "${SB}/out"; fail "blocklisted words match whole words only"; }

echo "see the Zorblax project" > "${SB}/repo/notes.txt"
git -C "${SB}/repo" add notes.txt
rm "${SB}/words.txt"
check || { cat "${SB}/out"; fail "a missing word list must skip the word check, not fail"; }
git -C "${SB}/repo" rm -q --cached notes.txt && rm "${SB}/repo/notes.txt"

# Built at runtime so this file never contains a token-shaped string itself.
token="ghp_$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 36)"
echo "GITHUB_TOKEN=${token}" > "${SB}/repo/config.env"
git -C "${SB}/repo" add config.env
check && fail "a staged secret must fail"
grep -q "${token}" "${SB}/out" && fail "the secret must be redacted from the output"

echo "all check-leaks checks passed"
