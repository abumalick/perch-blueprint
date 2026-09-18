#!/usr/bin/env bash
# Tests for spawn.sh, which launches a Perch workspace (a detached tmux session
# running Claude Code on a brief).
#
# ISOLATION - read before editing, this test can destroy real work.
#
# tmux picks its socket from $TMUX first when that is set, ignoring TMUX_TMPDIR
# entirely. This test is normally run by an agent from inside a Perch pane, where
# $TMUX points at the real server holding the user's live workspaces. So
# environment variables alone are NOT a safe way to keep tmux calls off it: one
# missing prefix turns `kill-server` into a machine-wide wipe.
#
# Two mechanisms, used for two different things:
#   * This test's own tmux calls go through `t()`, which passes an explicit
#     `-S <sandbox socket>`. -S overrides both $TMUX and TMUX_TMPDIR and never
#     falls back, so those calls cannot reach the real server no matter what the
#     environment says. Every destructive call MUST go through it.
#   * spawn.sh runs bare `tmux` on purpose - in production it must use the
#     ambient server, the one its own workspace lives on - so it can only be
#     isolated by environment, via `run_spawn()`. That is checked rather than
#     trusted: the first spawn is asserted to have landed on the sandbox socket,
#     and the test aborts loudly if it did not.
#
# A fake `claude` on PATH records its argv instead of starting a real session.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPAWN="${HERE}/spawn.sh"
SANDBOX="$(mktemp -d)"
SOCKET="${SANDBOX}/tmux-$(id -u)/default"

# Every tmux call this test makes itself. Explicit socket, no env resolution.
t() { tmux -S "${SOCKET}" "$@"; }

# spawn.sh calls bare tmux, so it is isolated by environment: TMUX_TMPDIR sets
# the socket directory and TMUX must be unset for it to be honoured at all.
run_spawn() { env -u TMUX TMUX_TMPDIR="${SANDBOX}" bash "${SPAWN}" "$@"; }

cleanup() {
  # Belt and braces over `t`: refuse to kill anything whose socket is not inside
  # the sandbox, in case SOCKET is ever changed carelessly. Not silenced - a
  # destructive step that fails must say so rather than fail invisibly.
  case "${SOCKET}" in
    "${SANDBOX}"/*)
      if [ -S "${SOCKET}" ]; then
        t kill-server || echo "warning: could not kill the test tmux server at ${SOCKET}" >&2
      fi
      ;;
    *)
      echo "refusing to kill a tmux server: ${SOCKET} is outside ${SANDBOX}" >&2
      ;;
  esac
  rm -rf "${SANDBOX}"
}
trap cleanup EXIT

BIN="${SANDBOX}/bin"
PROJECT="${SANDBOX}/project"
mkdir -p "${BIN}" "${PROJECT}"

# Records what claude was actually handed, then stays alive so spawn.sh's
# has-session check sees a live pane.
cat > "${BIN}/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s' "$#" > "${HOME}/argc"
printf '%s' "${1-}" > "${HOME}/arg1"
printf '%s' "${2-}" > "${HOME}/arg2"
printf '%s' "${3-}" > "${HOME}/arg3"
printf '%s' "${CLAUDE_CODE_DISABLE_TERMINAL_TITLE-}" > "${HOME}/title_env"
sleep 30
EOF
chmod +x "${BIN}/claude"

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

echo "spawn.sh"

# --- refusals -------------------------------------------------------------
status=0
run_spawn < /dev/null > /dev/null 2>&1 || status=$?
check "rejects a missing project path" "2" "${status}"

status=0
run_spawn "${SANDBOX}/nope" <<< "brief" > /dev/null 2>&1 || status=$?
check "rejects a project path that is not a directory" "2" "${status}"

# A blank brief would launch a workspace with nothing to do, which reads as a
# hung session rather than a mistake.
status=0
run_spawn "${PROJECT}" <<< "   " > /dev/null 2>&1 || status=$?
check "rejects a whitespace-only brief" "2" "${status}"

# --- the brief survives, verbatim, as a single argument -------------------
# The whole design rests on this: the brief reaches claude as ONE argv element
# with nothing expanded. If it were ever interpolated into the tmux command
# string, the login shell would split it and expand $HOME and $(whoami).
BRIEF='Fix the thing.
Hostile: don'"'"'t "quoted" `backtick` $HOME $(whoami) a|b; c>d & 100%'

id="$(run_spawn "${PROJECT}" <<< "${BRIEF}")"

# Isolation check, before anything else touches tmux. If spawn.sh's session is
# not on the sandbox socket then the environment isolation failed and its
# sessions are on the real server; stop immediately rather than carry on.
if ! t has-session -t "${id}" 2>/dev/null; then
  echo "ABORT: ${id} is not on the sandbox socket ${SOCKET}." >&2
  echo "       spawn.sh escaped its sandbox - its sessions may be on the real" >&2
  echo "       tmux server. Nothing was killed. Investigate before re-running." >&2
  exit 99
fi

case "${id}" in
  perch-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) check "id is perch- plus 6 hex" "ok" "ok" ;;
  *) check "id is perch- plus 6 hex" "perch-<6 hex>" "${id}" ;;
esac

check "brief is stored verbatim" "${BRIEF}" "$(cat "${SANDBOX}/.perch/spawn/${id}.md")"
check "claude gets exactly 3 arguments" "3" "$(cat "${SANDBOX}/argc")"
check "claude gets --model" "--model" "$(cat "${SANDBOX}/arg1")"
check "claude gets the default model" "opus[1m]" "$(cat "${SANDBOX}/arg2")"
check "claude gets the brief unexpanded, as one argument" "${BRIEF}" "$(cat "${SANDBOX}/arg3")"

# The stored command omits the brief on purpose: resumeCommand splits it on
# whitespace to build the unpark command, so keeping the brief here would
# re-submit it into the resumed conversation every time.
check "@perch_command is the base command only" "claude --model 'opus[1m]'" \
  "$(t show-options -t "${id}" -v @perch_command)"
check "session starts in the project directory" "${PROJECT}" \
  "$(t display-message -p -t "${id}" '#{session_path}')"

# --- model override, and a relative path ---------------------------------
# `tmux new-session -c` silently falls back to $HOME on a path it cannot use, so
# spawn.sh resolves the path itself rather than handing tmux a relative one.
id2="$(cd "${SANDBOX}" && run_spawn project 'sonnet[1m]' <<< "brief")"
check "model override reaches claude" "sonnet[1m]" "$(cat "${SANDBOX}/arg2")"
check "model override reaches @perch_command" "claude --model 'sonnet[1m]'" \
  "$(t show-options -t "${id2}" -v @perch_command)"
check "a relative project path is resolved" "${PROJECT}" \
  "$(t display-message -p -t "${id2}" '#{session_path}')"

# --- an explicit workspace name ------------------------------------------
# Naming a workspace is two things at once: the pane title has to be set AND
# Claude Code has to be told to stop writing its own, or it overwrites ours
# a second later. The glyph is not decoration — deriveWorkspaceName ignores a
# pane title without one and falls back to the directory name.
TITLED_BRIEF='Record story 9.
Hostile: don'"'"'t "quoted" `backtick` $HOME'
id3="$(run_spawn --title 'story foo 9' "${PROJECT}" <<< "${TITLED_BRIEF}")"
check "--title sets the pane title, with the status glyph" "✳ story foo 9" \
  "$(t display-message -p -t "${id3}" '#{pane_title}')"
check "--title stops Claude Code renaming the pane" "1" \
  "$(cat "${SANDBOX}/title_env")"
check "--title leaves the brief a single verbatim argument" "${TITLED_BRIEF}" \
  "$(cat "${SANDBOX}/arg3")"
check "--title does not leak into @perch_command" "claude --model 'opus[1m]'" \
  "$(t show-options -t "${id3}" -v @perch_command)"

id4="$(run_spawn --title='story foo 10' "${PROJECT}" 'sonnet[1m]' <<< "brief")"
check "--title=NAME is accepted too" "✳ story foo 10" \
  "$(t display-message -p -t "${id4}" '#{pane_title}')"
check "a title does not disturb the model argument" "sonnet[1m]" "$(cat "${SANDBOX}/arg2")"

# Left out, nothing changes: Claude Code keeps naming the workspace itself.
run_spawn "${PROJECT}" <<< "brief" > /dev/null
check "without --title the rename stays enabled" "" "$(cat "${SANDBOX}/title_env")"

if [ "${fails}" -gt 0 ]; then
  echo "${fails} check(s) failed"
  exit 1
fi
echo "all spawn.sh checks passed"
