#!/usr/bin/env bash
# Tests for perch-hook.sh, the Claude Code hook that reports attention events to the
# local agent. Hermetic: fake `tmux` and `curl` on PATH, no network, no real tmux server.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="${HERE}/perch-hook.sh"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "${SANDBOX}"' EXIT

BIN="${SANDBOX}/bin"
mkdir -p "${BIN}"

# `tmux display-message -p '#S'` resolves to the most-recently-active session even when run
# outside tmux, so the fake always answers — the hook must not rely on it to detect tmux.
cat > "${BIN}/tmux" <<'EOF'
#!/usr/bin/env bash
echo "perch-somesession"
EOF
cat > "${BIN}/curl" <<'EOF'
#!/usr/bin/env bash
# Record the POST body (the argument after -d) so the test can assert on it.
prev=""
for arg in "$@"; do
  [ "$prev" = "-d" ] && printf '%s' "$arg" > "${CURL_LOG}"
  prev="$arg"
done
EOF
chmod +x "${BIN}/tmux" "${BIN}/curl"
export PATH="${BIN}:${PATH}"
export HOME="${SANDBOX}"

fails=0
check() {
  if [ "$2" = "$3" ]; then
    echo "  ok: $1"
  else
    echo "  FAIL: $1"
    echo "    expected: $2"
    echo "    actual:   $3"
    fails=$((fails + 1))
  fi
}

STOP_PAYLOAD='{"hook_event_name":"Stop","background_tasks":[{"id":"x","type":"shell","status":"running"}]}'

# A nested `claude -p` run by the agent (a systemd/launchd service) has no TMUX, yet the fake
# tmux above still names a session. Without the guard the hook would stamp a status onto an
# unrelated workspace — and, once the agent shells out to claude, recurse.
echo "perch-hook.sh"
export CURL_LOG="${SANDBOX}/no-tmux.txt"
: > "${CURL_LOG}"
env -u TMUX CURL_LOG="${CURL_LOG}" bash "${HOOK}" Stop 8787 <<< "${STOP_PAYLOAD}"
check "posts nothing when TMUX is unset" "" "$(cat "${CURL_LOG}")"

# Inside a real Claude session (always under tmux) the hook posts, forwarding Claude's stdin
# payload verbatim so the agent can read background_tasks.
export CURL_LOG="${SANDBOX}/with-tmux.txt"
: > "${CURL_LOG}"
TMUX="/tmp/tmux-1000/default,1,0" CURL_LOG="${CURL_LOG}" bash "${HOOK}" Stop 8787 <<< "${STOP_PAYLOAD}"
body="$(cat "${CURL_LOG}")"
check "posts the session name" "perch-somesession" "$(python3 -c 'import json,sys; print(json.load(sys.stdin)["sessionName"])' <<< "${body}")"
check "posts the event" "Stop" "$(python3 -c 'import json,sys; print(json.load(sys.stdin)["event"])' <<< "${body}")"
check "forwards background_tasks" "running" \
  "$(python3 -c 'import json,sys; print(json.load(sys.stdin)["claude"]["background_tasks"][0]["status"])' <<< "${body}")"

# Claude Code always supplies stdin, but a hand-run hook or a future event might not; the body
# must stay valid JSON so the agent parses it instead of 400-ing.
export CURL_LOG="${SANDBOX}/empty-stdin.txt"
: > "${CURL_LOG}"
TMUX="/tmp/tmux-1000/default,1,0" CURL_LOG="${CURL_LOG}" bash "${HOOK}" Stop 8787 < /dev/null
check "sends valid JSON with empty stdin" "null" \
  "$(python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["claude"]))' <<< "$(cat "${CURL_LOG}")")"

if [ "${fails}" -gt 0 ]; then
  echo "${fails} check(s) failed"
  exit 1
fi
echo "all perch-hook.sh checks passed"
