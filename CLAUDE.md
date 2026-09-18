# Perch — agent guide

Perch is a mobile-first PWA to view and interact with Claude Code terminal sessions
(tmux workspaces) running on multiple machines, from an iPhone, over a private
Tailscale mesh. An **agent** runs on each machine (e.g. a Mac and a Linux box); the **PWA**
connects to the agents over WebSocket and streams their terminals.

## Golden rules
- **All code, docs, comments, and commits in English.**
- **Testability is the top priority.** Clean / hexagonal architecture: pure domain +
  application (ports) layers, all I/O behind infrastructure/adapters. Unit-test the core
  with fakes; keep a thin, well-covered adapter layer.
- **Surgical changes, YAGNI.** Match surrounding style. Add comments only for genuinely
  tricky logic, not to restate code.
- Toolchain via **mise** (`mise.toml` pins node 24 + pnpm 11). Package manager is **pnpm**
  (workspace monorepo). Any Python would use **uv** (none today).
- **Never commit secrets.** Tokens live in `deploy/agent.env` (gitignored) and in a password manager. `deploy/agent.env.example` is the template.

## Layout
- `packages/contracts` (`@perch/contracts`) — the zod wire protocol and shared types.
  `ClientMessage` / `AgentMessage` discriminated unions. Terminal `data` is base64.
  **Change the protocol here first**, then the agent and PWA.
- `packages/agent` (`@perch/agent`) — per-machine agent. tmux via `node:child_process`,
  terminal streaming via `node-pty`, a `ws` WebSocketServer sharing a `node:http` server
  with a bearer-token-guarded `POST /hooks` (Claude Code hooks report attention here).
  Domain/application in `application/` + `ports/`, adapters in `infrastructure/`, wiring in
  `server/`.
- `packages/pwa` (`@perch/pwa`) — Svelte 5 (runes) PWA. xterm.js terminal, vite-plugin-pwa
  (auto-update), Playwright e2e. Core logic (connection manager, aggregator, store) is in
  `src/core` + `src/adapters` and unit-tested with a fake socket; `src/lib` is the UI.

## Commands (per package via `pnpm --filter @perch/<pkg> …`)
- Test: `test` (vitest). Types: `typecheck`. Build (pwa): `build`. E2E (pwa):
  `exec playwright test` (uses a faithful fake agent in `e2e/fake-agent.ts`).
- Run the whole suite: `pnpm -s test`. Keep it green; add tests with every change.

## Worktrees & on-device testing
Build each feature in its own git worktree; full runbook in `docs/WORKTREES.md`.
- **NEVER do feature work in the main checkout — and NEVER `git checkout`/`git checkout -b`
  there.** The main checkout is shared: switching its branch or leaving edits in its working
  tree blocks every other agent and process bound to it (the standing deploy, other worktrees'
  expectations). Start a feature with its own worktree *first* (below), before editing. If you
  somehow already have uncommitted edits in the main checkout, surface it and move them into a
  worktree — do not `checkout -b` in place to "branch" them.
- Create: `git worktree add .worktrees/<feature> -b <feature>` (`.worktrees/` is gitignored),
  then `pnpm install` (node_modules is per-worktree). Unit/integration tests bind ephemeral
  ports, so they run in parallel across worktrees with no clash.
- **e2e ports clash** — `vite preview` uses a fixed port. On the host running `run-pwa.sh`,
  **4173 is the standing deploy**; give each checkout its own:
  `E2E_PORT=4175 pnpm --filter @perch/pwa e2e` (build first — `vite preview` serves the gitignored `dist/`).
- **Test a worktree build on the phone:** `pnpm serve:build .worktrees/<feature>` points the
  live deploy at it (installed PWA auto-updates in ~60s; the home header shows the worktree
  slug as a badge); `pnpm serve:restore` flips back to main.
- **Protocol changes need the worktree's agent too:** the PWA and agent share the zod wire
  protocol, so testing a protocol change on-device requires running the worktree's agent or
  the deployed (main) agent silently drops the new/changed messages. `pnpm serve:agent
  .worktrees/<feature>` runs that worktree's agent live (flips `deploy/agent-live`, restarts
  the service — safe via `KillMode=process`); `pnpm serve:agent-restore` flips back. Secrets
  come from main's `deploy/agent.env`. Make additive protocol fields backward-compatible
  (e.g. `z.array(...).default([])`) so a version-skewed rollout degrades gracefully instead
  of the strict client parser dropping the whole message.

## Runtime & deployment
See `docs/DEPLOY.md` for the full runbook. In short:
- Each agent reads `deploy/agent.env` (`PERCH_TOKEN`, `PERCH_MACHINE_ID`,
  `PERCH_PROJECT_ROOTS`, host/port) and runs as a service: **launchd** on macOS
  (`deploy/com.perch.agent.plist`), **systemd user unit + linger** on Ubuntu. Both invoke
  `deploy/run-agent.sh`, which self-locates `mise` (services don't inherit an interactive
  PATH). Run `mise trust` once per machine or the unit crash-loops.
- Agents are exposed on the tailnet via `tailscale serve --bg --https=<port> <localport>`
  (v1.64+ syntax; needs `sudo` on Linux). MagicDNS gives each a `*.ts.net` Let's Encrypt cert.
- The PWA is built and served on the always-on machine via `deploy/run-pwa.sh` +
  `tailscale serve`, and added to the iPhone home screen.
  - **The host running `run-pwa.sh`:** it keeps a `vite preview`
    process serving the `deploy/pwa-live` symlink (defaults to `packages/pwa/dist/`), fronted
    by `tailscale serve` on :8443. The preview stays up and serves whatever the symlink points
    at, so `pnpm --filter @perch/pwa build` alone re-deploys here — no process restart, just
    reload the PWA. `pnpm serve:build` temporarily repoints the symlink at a worktree build
    (see above).
- Install Claude Code hooks on each agent machine: the agent CLI `install-hooks` command.
- **Hidden folders are per-machine, file-based config — not a protocol/PWA feature.** A
  gitignored `~/.perch/hidden-folders.json` (JSON array of folder names) on each agent
  machine hides matching projects from workspaces, recent paths, and the folder picker
  (`is-hidden-path.ts`: any path segment equal to a listed name is filtered). Read fresh
  from disk on every call (`FileHiddenFoldersStore`) — no caching, so edits take effect
  immediately with no agent restart. Missing or malformed file → empty list (opt-in;
  filtering only activates once the file exists). Manage it directly on each machine (there's
  no CLI/PWA UI to edit it), and set it up separately per machine — nothing syncs it.
- **Command shortcuts are per-machine, file-based config too — but they cross the wire.** A
  gitignored `~/.perch/commands.json` (JSON array of `{command, submit?}`) on each agent
  machine fills the keyboard bar's `/` drop-down. Unlike hidden folders (agent-internal, only
  the *effect* crosses the wire), the PWA needs the contents, so it follows the
  `listRoots`/`roots` request/reply shape: `listCommands` → `commands`. The PWA asks on every
  (re)connect and keys the result by connection id (`store.machineCommands`), so **an edit
  takes effect on the next reconnect, not immediately** — that's the one property this gives
  up versus hidden folders. Missing/malformed file → empty list → the `/` button doesn't
  render at all. `parse-commands.ts` degrades entry-by-entry (a bad `submit` costs the flag,
  not the command) since the file is hand-edited. Set it up separately per machine.
- **Connection-event log — a client→agent diagnostic that survives drops.** The PWA records
  connection lifecycle events (`connect`/`online`/`close`/`manual-reconnect` per machine —
  `manual-reconnect` = the user tapped Reconnect, `auto-reconnect` = a foreground/`online`
  event drove `reconnectAll` — plus app-global `visible`/`hidden`/`net-online`/`net-offline`),
  each stamped with the WS close `code`,
  `navigator.onLine`, and `document.visibilityState` — the three signals that separate
  iOS-backgrounding from network loss from a tailnet link drop. Events buffer in a durable
  localStorage ring (`core/connection-log.ts`, key `perch.connlog`) that survives an app kill,
  and flush **per-machine** to the agent's bearer-guarded `POST /clientlog` after a reconnect
  (`core/connection-log-flush.ts`, driven from `store.setStatus`/`setConnectionError` and
  `App.svelte`'s visibility/online handlers via `store.logConnectivity`). The transport is HTTP,
  **not** the WebSocket — diagnostics about why the socket died must not depend on that socket;
  it fails soft (non-2xx → events stay buffered, drain next reconnect). The agent appends one
  JSON line per event to a gitignored `~/.perch/client-log.jsonl` (`FileClientLogStore`), with a
  512 KB body cap the older `/hooks` handler lacks. Dedup by `(sess, seq)` at read (a global
  event may appear once per machine it flushed to). Adding the endpoint means the agent must be
  rebuilt + restarted per machine (a version-skewed old agent just 404s the flush — no data
  lost). No PWA/UI to read it; analyse the file on the box.
- **Workspace lifecycle log — a durable record of every closed workspace, agent-side only.**
  `WsServer` tracks each live workspace's last-known snapshot (`lastWorkspaces`, the same map
  that already drives rename/disappearance detection); whenever one stops existing it appends
  one JSON line — id, name, project path, machine id, created/closed timestamps, a reason
  (`closed-by-user` for an explicit PWA close, `exited` for a shell exit/crash/manual
  `tmux kill-session`), and the last known attention status — to a gitignored
  `~/.perch/workspace-log.jsonl` (`FileWorkspaceLogStore`). An explicit close snapshots via
  `WsServer.forgetWorkspace(id)` *before* killing the tmux session (tmux can't answer
  afterward) and falls back to a fresh tmux lookup if the workspace was closed within its
  first title-poll tick. The log write is best-effort (a failure must never fail the close
  or crash the poll's fire-and-forget interval). No PWA/UI, no protocol change; read the file
  by hand on the box. Two edge cases are accepted by design (a narrow duplicate-log race, and log writes failing silently).
- **Parking a workspace — stop the session, keep the conversation.** Setting a workspace's
  status to `parked` (renamed from `postponed`) kills its tmux session to free the `claude`
  process, and snapshots what's needed to revive it — id, name, path, command, and the
  captured `claudeSessionId` — into a gitignored `~/.perch/parked.json`
  (`FileParkedStore`). `listWorkspaces` unions parked records with live tmux sessions, so
  a parked workspace stays in the list with no protocol change, no new `Workspace` field,
  and no PWA logic — and the disappearance poll never sees it vanish, so it logs no
  spurious `exited`. Opening it recreates the session with `--resume` injected into the
  **original** command (`claude --model 'opus[1m]' --resume <id>`, preserving flags), then
  clears the record. **The parked record — not `status === 'parked'` — is the source of
  truth for behavior:** the rename migration relabels pre-existing live workspaces to
  `parked` with no record, so status-keyed logic would try to recreate a live session on
  attach. The unpark command carries a `|| exec <original>` tail because
  `claude --resume <unknown-id>` is a hard error that would otherwise destroy the
  workspace. **A known `claudeSessionId` is required to park at all** — without one the
  conversation could not be resumed, so parking would free the resources and silently throw
  the conversation away, which is worse than not parking; `parkWorkspace` returns
  `not-restorable` and the agent sends an `error` the PWA shows as a dismissible banner
  (`ActionErrorBanner`, fed by `store.actionError` — the fallback arm of the `error` handler,
  for refusals no view owns). The id arrives with the first Claude Code hook event, so a
  workspace becomes parkable once it is used; non-Claude workspaces (Codex, zsh) never
  emit those hooks and therefore cannot be parked. `FileStatusStore`
  migrates the old `postponed` literal on read, since nothing syncs config between machines.
  At agent startup, `reconcileParked` kills any tmux session whose id collides with a
  parked record — the one case is tmux-continuum resurrecting a parked id as a Claude-less
  shell on restart — so the parked record stays the single source of truth. Requires an
  agent rebuild + restart per machine.

- **Closing a workspace reaps the pane's systemd scope — and acknowledges before it does.**
  tmux (built with systemd support) puts every pane it spawns in its own transient
  `tmux-spawn-<uuid>.scope`. `tmux kill-session` only SIGHUPs the pane's process **group**, so
  anything that called `setsid()` — a backgrounded dev server, or a self-daemonizing tool like
  `adb`'s fork-server or `Xvfb` — survives with no tmux session left to find it by. Left alone,
  such scopes accumulate indefinitely, holding memory/swap and squatting localhost ports.
  `closeWorkspace` resolves the pane's scope **before** the kill (`/proc/<pid>/cgroup` vanishes
  with the process, so afterwards there is nothing to read) and returns it; `reapWorkspaceScope`
  stops it with `systemctl --user stop`. `SystemdScopeReaper` **refuses any unit that is not
  `tmux-spawn-<uuid>.scope`** — a pane under a tmux built without systemd support sits in
  `perch-agent.service`, and stopping that would kill the agent itself. Linux-only by
  construction: on macOS `scopeForPid` returns null and the leak remains.
  **Two orderings carry the design.** Claude Code exits gracefully on SIGTERM as well as SIGHUP
  (verified: its `~/.claude/sessions/<pid>.json` registry entry, key and socket are all removed;
  only SIGKILL leaves a stale entry), so the scope stop cannot strand a session — but the tmux
  kill must still come first. And the `closed` reply is sent **before** the slow tail
  (`finishClose` — the scope stop, then the agent-browser cascade, which waits on a Chrome
  shutdown). Don't move either back in front of the acknowledgement: everything after the kill
  only touches the local machine, and waiting on it is what made the phone's close button feel
  hung. Reaping is best-effort at every layer — a workspace must still close on a machine where
  none of this works. There is no exclusion list, so a shared daemon started from a workspace
  (the `adb` fork-server is the one that bites) dies with it; re-running `adb connect` is the cost.
- **Reconnect must replace the connect chain, never stack a second one.** `MachineConnection`'s
  backoff retry is a fire-and-forget timer with no cancel handle, and `reconnect()` clears the
  `closedByUser` kill-switch. Before the fix, tapping Reconnect (or the app auto-firing
  `reconnectAll` on every foreground/`online`) started a *new* connect while a pending retry was
  still queued, so overlapping chains stacked up; each left a socket stalled in CONNECTING that
  WebKit never tears down, saturating the per-host pool and wedging reconnect until the user
  toggled the machine off/on (the only path that called `close()`, which quiesced everything).
  Fix: a monotonic `generation` token bumped by `reconnect()`/`close()`; the retry captures it
  and no-ops if superseded, so at most one chain is ever live. `onOpen`/`onMessage` also guard
  `this.socket === socket` so a late-opening orphan can't authenticate. Don't reintroduce an
  uncancellable retry or let `reconnect()` add chains without superseding the old one.
- **Reconnect UX: auto-recover calmly, don't interrupt in-flight connects.** `reconnectAll`
  (app refocus / browser `online` / the home Reconnect button) **skips machines already
  `connecting`** — aborting an in-flight attempt to restart it just resets progress on a
  slow-to-establish path (a phone waking, Tailscale cold); the 10s connect-deadline reaps a
  genuinely stalled one anyway. It only kicks idle-`offline` machines. The home screen shows a
  distinct calm **`reconnecting`** view ("Reconnecting…", spinner, no button) for a machine that
  reached `online` at least once this session (`store.reachedOnce`) and is briefly down — vs the
  alarming `unreachable` "Can't reach your machines / Reconnect" which is reserved for a machine
  that has **never** connected this session. **The `reconnecting` view falls through to
  `unreachable` after a longer grace** (`RECONNECT_GRACE_MS` = 25s, an adaptive duration on the
  single existing grace timer keyed off `reachedOnce`; `anyReconnecting` is gated on
  `!graceElapsed`) so a genuine extended outage surfaces the Tailscale hint + button instead of
  an eternal spinner. `deriveHomeView`'s `anyReconnecting` is otherwise stable within the window
  so it doesn't flicker with the backoff `connecting`↔`offline` cycle. The home button
  passes `reconnectAll(true)` → logs `manual-reconnect` (vs `auto-reconnect` for refocus). This
  came from on-device logs: the old 4s-grace flip to "Can't reach" made the user tap Reconnect,
  and each tap aborted an about-to-succeed connect, making recovery *slower*.

## CRITICAL: the PWA must be served from the tailnet, not a public origin
Do **not** re-attempt hosting the PWA on a public origin (Cloudflare Pages/Workers, etc.)
to talk to the tailnet agents. Browsers block a **public-origin page from connecting to a
private/tailnet `100.x` address**:
- Chromium: Local Network Access (the PNA successor) gates public→local behind a user
  permission; as of Chrome 147 this also covers WebSockets. The
  `Access-Control-Allow-Private-Network` header is a dead path.
- **iOS Safari (all iOS browsers are WebKit): there is no web-facing local-network
  permission at all — the connection fails silently with no workaround.**
Because the primary client is an iPhone, the PWA is served **from the tailnet** (same
network class as the agents), which is the only thing that works while keeping the agents
private. This was investigated and settled.

## Gotchas already fixed (don't regress)
- **A subagent's tool calls must not stamp the parent workspace's status.** `PreToolUse`/
  `PostToolUse` fire in the **parent** session for a subagent's own tool calls, carrying an
  `agent_id`/`agent_type` pair that is absent on the main loop's calls. Mapping those to
  `working` meant that whenever a session sat blocked on a question with a background subagent
  still running, the subagent's next tool call (seconds later) silently overwrote the
  `needs-feedback` the block had just raised — so the workspace showed `working` with a prompt
  waiting on screen, indefinitely. `attentionDecision` now returns `status: null` for any tool
  event carrying an `agent_id`, leaving the parent's status alone. Read `agent_id` defensively;
  it is undocumented.
- **A pending multiple choice is read off the tool name, not a notification.** Claude blocks
  indefinitely on `AskUserQuestion`/`ExitPlanMode` waiting for the user to pick an option, and
  (from v2.1.200) these never auto-time-out. A `Notification` with
  `notification_type: 'permission_prompt'` *is* emitted for them on 2.1.215 — but a few seconds
  late and undocumented for `AskUserQuestion`, so it is not the primary signal. `PreToolUse` for
  those two tools maps straight to `needs-feedback`; the matching `PostToolUse` (which fires only
  once the user has answered) returns the session to `working`. Both checks are skipped for
  subagent calls, so a subagent's own question never speaks for the parent.
- **The create form's `--model` value must stay single-quoted.** `CreateWorkspace.svelte`
  builds `claude --model '<value>'`, and two Claude entries carry Claude Code's `[1m]`
  suffix — `opus[1m]` (the default) and `sonnet[1m]`. That suffix used to be what bought the
  1M window, the bare alias being the *smaller* 200K one despite looking canonical; Opus 5
  and Sonnet 5 are now natively 1M, so the CLI strips the suffix for them and it buys nothing.
  It is kept because it is what ships and works — the window is what matters here (Claude Code
  never errors at the context limit, it silently autocompacts, so a small window costs
  fidelity rather than raising an error anyone would notice), and re-testing the default
  launch command to win a cosmetic tidy is a bad trade. The suffix is **not** a safety net for
  a future non-native-1M model: on one of those the CLI passes it through as a request for the
  1M beta, which a model without a 1M window rejects — `claude-haiku-4-5[1m]` returns
  a 400 because Haiku 4.5 is a 200K model, which is also why Haiku is the one 200K entry in the picker. tmux runs the command string through the login shell, and brackets
  are a glob pattern there: under zsh an unmatched glob aborts the whole command line, so an
  unquoted `opus[1m]` means the session dies before `claude` ever starts — and because the
  command *is* the pane's process, the workspace vanishes from the list instantly. The quote
  is applied to **every** model, not just this one, so the next value someone adds can't
  reintroduce it; it lives at the build site rather than in `value`, which doubles as the
  radio's identity. `resumeCommand`'s whitespace split preserves it, so park/unpark is safe
  (guarded by a test). Verified against zsh through `tmux new-session`, not just in jsdom.
- **A new `Workspace` field must be added to `workspaceSchema` too — the type guard will not
  tell you.** `messages.ts` asserts schema/domain agreement with
  `Equals<z.infer<typeof workspaceSchema>, Workspace>`, but that check is blind to a *missing
  optional* property: a type lacking an optional key is still assignable in both directions,
  so the drift typechecks clean. Since `z.object()` strips unknown keys, the agent then sends
  the field and the client parser deletes it before the store sees it — both sides' unit tests
  green, nothing in the UI, no error anywhere. `agentAddress` shipped this way once. Guard a
  new optional field with a `workspaceSchema.parse` test (the only thing that proves it
  survives the wire) and, when it renders, an e2e through `e2e/fake-agent.ts` (the only thing
  that proves it reaches the DOM).
- **Terminal encoding:** the agent base64-encodes the pty's UTF-8 bytes; the PWA must
  decode base64 → bytes → `TextDecoder` (UTF-8), never `atob` into a latin1 string (that
  mojibakes box-drawing/accents and breaks the xterm render). Guarded by a store unit test.
- **Machine routing:** the PWA routes attach/input/close by the **connection id** (the
  PWA's machine config id), not the agent's `PERCH_MACHINE_ID`. The aggregator stamps each
  workspace with the connection id. The e2e uses a deliberately mismatched agent id to
  cover this.
- **List on connect:** the agent only sends workspaces in response to an explicit `list`;
  the PWA sends `list` on every (re)connect. The e2e fake agent is faithful to this.
- **Restarting the agent must NOT kill tmux sessions:** the agent spawns the tmux server
  as a child, so it lives in the systemd unit's cgroup. The default
  `KillMode=control-group` would SIGTERM the whole cgroup on restart and take every
  workspace (and the Claude Code session inside it) down with it. `deploy/perch-agent.service`
  sets **`KillMode=process`** so a restart stops only the agent; the tmux server and its
  sessions survive. Don't drop this. On restart the agent re-discovers live sessions via
  `tmux list-sessions` (no in-memory session registry), so workspaces reappear on the PWA's
  next `list`. Status is **durable** (`FileStatusStore` → `~/.perch/status.json`): it reloads
  on startup, so each session keeps its last status across a restart instead of resetting to
  `idle`, and entries for sessions that no longer exist are pruned at startup. After changing
  the unit, re-deploy it and `systemctl --user daemon-reload`; this and `install-hooks` must
  be redone per machine.
- **Android terminal input bypasses xterm's IME path.** xterm.js's composition handling
  desyncs from the pty on Android (e.g. AnySoftKeyboard): it tracks a
  composition as absolute indices into its accumulating hidden-textarea value, which breaks on
  Android's racing composition events, and Perch's keyboard-bar arrows write to the pty
  out-of-band. Symptoms were dropped slash-command letters, arrows shifting/removing text, and
  the submitted line differing from the display. Fix (Android UA only, iOS untouched):
  `lib/android-input.ts` takes over input, driving the pty from composition + `beforeinput`
  events through a pure diff-based reducer (`core/android-terminal-input.ts`) so each keystroke
  reaches the pty live and autocorrect swaps reconcile with backspaces. **Critical:** the
  adapter must listen on an **ancestor** (the terminal container) in the **capture phase** and
  call `stopPropagation()`, NOT on the textarea. xterm registers its own textarea listeners
  during `open()` *before* the adapter, and at the target node listeners fire in registration
  order regardless of capture flag — so a textarea-level `stopImmediatePropagation` runs too
  late and xterm re-processes the event (every letter was sent twice). Don't "simplify" it back
  onto the textarea. Also do **not** wipe the reducer's composition baseline on a keyboard-bar
  key: keeping it makes the diff send only the new delta after a mid-line cursor move
  (`compositionstart` re-baselines a genuinely new word). Verified byte-for-byte on an Android
  tablet via CDP; a `beforeinput` regression test with a pre-registered xterm-like
  listener guards the ordering. A Settings → Diagnostics input log (`core/terminal-input-log.ts`)
  captures the raw event stream on-device.
  - **Arrow `keydown`s are the one key the adapter forwards.** Swallowing every keydown also
    swallowed soft-keyboard cursor moves (HeliBoard's dpad joystick sends real
    `KEYCODE_DPAD_*` events), which then worked in every app except the terminal. `onKeyDown`
    maps `ArrowLeft/Right/Up/Down` to the cursor pad's sequences, `preventDefault`s, and calls
    `resetContext()` just like a keyboard-bar move. Don't widen this to other keys without
    checking they can't double-send alongside a composition.
  - **The hidden textarea must keep the last committed word — do NOT blank it.** Gesture
    (swipe) typing emits the inter-word space as a **standalone `beforeinput`/`insertText " "`
    between two compositions**, and only when the keyboard can see a word character before the
    cursor. The adapter used to set `textarea.value = ''` after each commit, so every swiped
    word started at what looked like offset 0 of an empty field, where a *leading* space is
    correctly suppressed — the space was never emitted at all and swiped words ran together
    (`helloworld`). `android-input.ts` now keeps **the whole line as typed since the last
    submission** in `context` and re-applies it: `compositionend` appends the committed word,
    and every non-composition edit we `preventDefault` (`insertText`, `insertReplacementText`,
    backspace, Enter) is mirrored onto it — the inter-word space included. Enter, and
    `resetContext()` from the keyboard bar, clear it; that is what bounds its growth and what
    stops it drifting when the pty line changes out-of-band.
    **Retaining only the last committed word is not enough, and fails deceptively:** the first
    space appears and every later one is dropped, so a two-word test passes while real
    sentences still run together (`one twothreefour`). The keyboard tracks the field as a
    whole, so a one-word window stops it emitting the space from the second word on. This was
    shipped once and had to be corrected — verify any change here with **four** words against a
    plain textarea on-device, never two.
    Three things not to "simplify": the trailing `input` event must **re-apply** the context
    rather than blank it (Chrome fires `beforeinput` → `compositionend` → `input`, so blanking
    there wipes the context one line after it is set, and the fix silently does nothing); the
    retained value must be the **real** word, not a sentinel, so an autocorrect
    `insertReplacementText` targeting it maps onto the right backspaces; and `KeyboardBar` must
    call `resetContext()` (it writes to the pty directly, bypassing the adapter, so after its
    Enter the stale word would make the keyboard prepend a space to the next line).
    `resetContext()` no-ops while composing, which is what keeps the mid-word cursor-move
    baseline rule above intact. `reduceInput` needed no change — it already emits `' '` for a
    post-commit `insertText`. Verified on-device by a 2×2 factorial isolating the cause.
  - **A composition can *reclaim* text that is already on the pty line.** Backspacing back
    into a committed word makes the IME (HeliBoard; recorrection is standard behaviour)
    re-open that word as an active composition and re-announce it **in full** on the first
    `compositionupdate`. With the baseline reset to empty at `compositionstart`, the diff
    typed the whole word a second time — `hello world` + backspace became `hellohello`.
    There is **no browser signal for this**, and the plausible one is a dead end: on-device
    logs show `beforeinput`/`insertCompositionText` arriving *after* the update it belongs
    to, always with an empty `getTargetRanges()` (textareas aren't ranges), and the
    reclaiming composition emits **no `beforeinput` and no `input` event at all** — so a
    target-range fix looks correct in unit tests (which must stub the API) and is a silent
    no-op on the device. The working signal is the retained `context`, which already mirrors
    the tail of the pty line: an *opening* update starting with the context's trailing word
    is a reclaim, so that word seeds `composed` (`compositionReclaim`) and leaves the
    context, and `compositionend` appends it back in full. **Only the opening update may
    reclaim** — later ones are diffed against the baseline it set. What keeps swipe typing
    out of this path is that a trailing word only exists while the caret is attached to it
    (a committed space ends the run), and a swiped word always brings its own inter-word
    space — guarded by a `two` → `twofold` test. The heuristic's one exposure is context
    drift: an out-of-band pty write not followed by `resetContext()` could let a reclaim
    swallow characters.
  - **A keyboard paste must join the context too.** HeliBoard's paste key sends Ctrl+V:
    xterm's `paste` listener sends the text and blanks the field, then the browser's default
    `insertFromPaste` puts back *only the pasted text*. HeliBoard re-opens the last word it
    sees, `context` did not end with it, so the reclaim missed and the word was typed again
    (`alpha beta gammagamma`, and dictation dups on the poisoned line after). The adapter now
    `preventDefault`s `insertFromPaste`, appends it to `context`, and re-applies — the bytes
    stay xterm's. The reverse drift (field shorter than the pty line) is harmless: a reclaim
    needs the word in the field.
  - **The adapter must stop `keypress` too, not just `keydown`.** One soft-keyboard Enter fires
    `keydown`(13) → `keypress`(13) → `beforeinput`(`insertLineBreak`). xterm registers a
    `keypress` listener on its textarea and sends the key from it whenever it did not handle the
    matching `keydown`, which with `keydown` stopped is always. The adapter's `beforeinput`
    path sends `\r` as well, so every Enter submitted twice. In Claude Code's `AskUserQuestion`
    the extra `\r` answers the next question with its first option (or lands on the review
    screen), which reads as "several answers submitted" or a declined prompt. The keyboard
    bar's ⏎ writes straight to the pty and never had the bug, which is what hid the cause. The
    `keypress` is stopped **without** `preventDefault`, which could cancel the `beforeinput`
    that carries the Enter. Found by capturing the WebSocket bytes on-device over Chrome
    DevTools. The in-app input log never records xterm's own sends, so it could not show this.
- **A dropdown inside the keyboard bar must be `position: fixed`, not `absolute`.** The bar
  is a horizontal scroller (`overflow-x: auto`), and CSS forces the cross axis to a clipping
  value when one axis scrolls — `overflow-y: visible` is impossible there. So an
  absolutely-positioned menu inside the bar renders in the DOM but is invisibly clipped
  (jsdom has no layout, so unit tests happily pass; only the Playwright e2e caught it).
  `CommandPicker` measures its trigger's rect on open and positions the menu fixed against
  the viewport, which also keeps it anchored as the bar scrolls and the soft keyboard
  resizes the viewport. Don't "simplify" it back to `absolute`.
- **A keyboard-bar key commits on release, never on `pointerdown`.** The bar is a horizontal
  scroller, so a drag that starts on a key is usually the user scrolling it — and firing on
  `pointerdown` typed a space / submitted the line / sent an Escape before the gesture could
  reveal itself as a scroll. A keystroke on the wire cannot be recalled, so `press` waits for
  `pointerup` and cancels on drag. Two things not to "simplify": **`pointercancel` is the
  primary cancel signal, not a backstop** — once WebKit's scroller claims the gesture it fires
  `pointerdown → pointercancel` with typically *zero* `pointermove`, so a slop-only version
  passes every unit test and does nothing on the phone; and **`suppressClick` is set in `arm`,
  not at the fire site**, or a cancelled press still sends on the `click` the browser
  synthesizes anyway. `startKeyRepeat` now owns the *first* hit of a held key (at 300ms) and
  sets `fired` so the release doesn't double-send — a held `⌫` therefore starts deleting at
  300ms, an accepted cost. `TAP_SLOP_PX` (10, exported from `KeyboardBar.svelte`) is the knob.
  Playwright can't cover this — `page.touchscreen` has only `tap()`, no drag-pan — so the
  unit tests carry it.
- **Cursor movement is a trackpad (`✥`), not four arrow buttons.** Dragging the pad emits one
  arrow key per `NOTCH_PX` of travel (Blink-Shell style), so distance controls how far the
  cursor moves instead of tap-count or hold-duration. **The tuning knobs, in order of how
  likely you are to want them:**
  - `NOTCH_PX` in `core/cursor-pad.ts` (currently 18) — px of travel per arrow key. Lower =
    faster/twitchier, higher = slower/more precise. Changing it needs no other edit; the unit
    tests derive from the constant.
  - The axis lock in `moveGesture`'s `lockAxis` — the first notch picks an axis and the
    gesture keeps it until release, so a sloppy diagonal can't spray perpendicular arrows.
  - `padKeys` in `KeyboardBar.svelte` — the four arrow definitions, kept intact (just not
    rendered as buttons) so restoring the old four-arrow bar is a small revert.
  The logic is a pure reducer (`core/cursor-pad.ts`) modelled as **reference point + notch
  crossing**, not distance-from-origin: each emitted notch advances the reference, which is
  what makes reversing the drag emit the opposite arrow for free. Two things not to
  "simplify": the pad uses its **own** pointer action, **not** the shared `press` action —
  `press` releases on `pointerleave`, which would abort the drag the instant the finger left
  the 2.75rem button; and it needs `setPointerCapture` **plus** `touch-action: none`, or the
  bar's `overflow-x: auto` scroller eats the gesture (jsdom has no layout, so only an e2e
  sees that). Each notch is emitted through the same `applyEditKey` path as a real key tap,
  so an **armed** ⌥ is consumed by the first notch only (word-left, then char-lefts) while a
  **locked** ⌥ applies to every notch — and `↑`/`↓` deliberately carry no `edit` field, so
  modifiers never transform them. A plain tap emits nothing (the button has no inherent
  direction). If the ratchet model ever loses on feel, the recorded fallback is a
  hold-to-repeat joystick reusing `core/key-repeat.ts`.
- **Attention status self-heals via tool hooks:** the attention state is last-hook-wins
  (`attention-decision.ts`). `UserPromptSubmit`/`PreToolUse`/`PostToolUse` → `working`,
  `Notification` and `Stop` → `needs-feedback` ("Needs you"). A bare `Stop` only means the
  turn ended, **not** that the task is done, so it maps to `needs-feedback`. **`finished`
  is a manual status the user sets from the PWA StatusPicker** — no hook emits it (a trailing
  `Stop` would overwrite anything Claude tried to set, so auto-`finished` isn't possible
  without a side channel; intentionally out of scope). Mapping `Pre`/`PostToolUse` to
  `working` is what unsticks a stale "Needs you" after a mid-task permission/idle
  `Notification` once Claude resumes — keep all five events registered in `install-hooks.ts`.
- **A session parked on background work stays `working`, and the 60s idle notification must
  not undo it.** `perch-hook.sh` forwards Claude's hook stdin verbatim as a nested `claude`
  object on `POST /hooks`; `attention-decision.ts` reads `background_tasks` from it. A `Stop`
  with any `background_tasks[].status === 'running'` (covers backgrounded shells **and**
  background subagents) leaves the session at `working` and marks it deferred in an in-memory
  `Set` on `WsServer`. This is **not** an LLM judgement — the Stop payload carries the answer
  as data (`background_tasks`, `last_assistant_message`, `session_crons` — all undocumented,
  so read defensively; anything unexpected falls back to `needs-feedback`, i.e. the old
  behaviour). **Claude Code emits a `Notification` with `notification_type: 'idle_prompt'`
  exactly 60s after every `Stop` — even while a background task is still running** — so
  without suppressing that one on a deferred session the feature would silently die after a
  minute. Only `idle_prompt` is suppressed; permission prompts always get through. And
  `Pre`/`PostToolUse` must **keep** the deferral (they don't clear it): a background
  subagent's own tool calls fire them in the parent session after its `Stop`, and clearing
  there would re-open the 60s hole for the subagent case. The deferral `Set` is deliberately
  in-memory — losing it on restart costs one extra "Needs you", never a missed one.
  **`perch-hook.sh` exits early unless `$TMUX` is set**: `tmux display-message -p '#S'`
  resolves to the most-recently-active session even outside tmux, which otherwise stamps a
  status onto an unrelated workspace. Changing the script means re-running `install-hooks` per
  machine (it copies it to `~/.perch/perch-hook.sh`).
- **Image preview fetches bytes over HTTP, not the WebSocket — and needs iCloud Private
  Relay OFF.** Image files in the file browser are served by the agent's bearer-guarded
  `GET /file?path=` HTTP endpoint (`ws-server.ts`, 5 MB cap, beside `POST /hooks`); the PWA
  fetches them with an `Authorization` header → `Blob` → object URL (`store.loadImage`). They
  are **not** sent as base64 over the terminal WebSocket (that bloats/stalls the shared
  stream). Because the PWA origin (`:8443`) differs from the agent (`:8442`), the fetch is
  cross-origin, so `/file` sets `Access-Control-Allow-Origin: *` and answers the `OPTIONS`
  preflight (the `Authorization` header makes it non-simple). **On the iPhone, iCloud Private
  Relay must be off** (globally or per-site for the tailnet): it proxies Safari's HTTPS
  through Apple's relay, which can't reach a tailnet `100.x` address, so the fetch fails
  silently — while the WebSocket and the cached PWA shell keep working, which masks the cause.
  (WebKit itself does *not* block this — verified via Playwright WebKit; only Private Relay
  does.) Also: the image viewer's frame is sized to `calc(100dvh - 8rem)` like `FileViewer`,
  **not** `height:100%` — the narrow phone layout's `<main>` has no height, so a percentage
  height collapses the frame to 0 (image invisible). A phone-width Playwright test guards it;
  the wide-viewport e2e missed it.
- **Attaching a file: the picker takes every type, paste cannot.** The keyboard bar's 📎
  input deliberately carries **no `accept`** (and no `capture`): any `accept` greys out
  non-matching files in the OS picker, and an `image/*` one made archives unreachable in
  the iPhone's Files app. Nothing downstream ever needed an image — `putFile` is
  `{name, data}` on the wire and `storePastedFile` only sanitizes the basename — so the
  restriction was purely the two PWA entry points. **Paste is different and is not a bug:**
  WebKit's async clipboard read (`navigator.clipboard.read()`, what the 📋 button calls)
  supports only `text/plain`, `text/html`, `text/uri-list` and `image/png`, and it
  deliberately suppresses file references — with a file on the pasteboard, `text/uri-list`
  is honoured only for `http`/`https`/`data`/`blob` schemes and `text/plain` returns empty,
  so a `file:` URL from Files.app is blocked by design. Don't "fix" `clipboard-paste.ts` to
  chase it. (The *paste-event* path, `DataTransfer.files` on a real paste into a focused
  editable field, is a different API that WebKit does populate — untested here, and using it
  would mean replacing the button with a native paste callout.)
  Two things not to drop: **uploads are capped at 20 MB in `store.sendPutFile`** — `putFile`
  base64s the file over the *terminal* WebSocket, and the old image-only filter was
  implicitly bounding size, so accepting archives removes that bound; the guard lives in
  `sendPutFile` because paste, the picker and the share target all funnel through it. And
  `sendPutFile` **returns whether it sent**, which `flushPendingSharedFile` must honour: the
  share-target cache entry is the only copy of a shared file, so clearing it after a refused
  send destroys the bytes. The Android share target accepts `*/*` and the service worker
  reads **`form.get('file') ?? form.get('image')`** — an installed PWA keeps its old manifest
  until a home-screen reinstall, so the OS goes on POSTing the old field name.

## The test gate is at commit, merge, AND push — don't punch holes in it
Three hooks (`deploy/git-hooks/`) run the full suite via a shared `run-tests.sh`:
`pre-commit`, `pre-merge-commit`, and `pre-push`. The merge and push hooks exist because
`pre-commit` alone does **not** gate `main`: git never runs it for merge commits (the
dominant integration path here), fast-forward merges, or direct ref moves. `pre-merge-commit`
catches red merges before they land; `pre-push` is the universal backstop so nothing red
reaches `origin`, including FF merges and `git update-ref` advances no commit hook can see.
- **Never land code on `main` through a path that skips the gate.** Do **not** use
  `git commit --no-verify`, `git push --no-verify`, or `git update-ref refs/heads/main`
  to integrate — every one of these bypasses the suite and is how red code reached `main`
  before these hooks existed. If the gate is in your way, the tests are red — fix them.
- The gate first runs `deploy/check-leaks.sh`: gitleaks over the staged diff and history,
  then a whole-word check of tracked files against a word list kept **outside** the repo
  (`~/.perch/leak-words.txt`, or `$PERCH_LEAK_WORDS`) — names of other projects,
  organisations and hosts that must never be published. gitleaks only knows credential
  shapes, so it can't catch those; and committing the list would publish the names it
  guards. No list on a machine → that half is skipped. Use neutral fixture names (`foo`,
  `acme-org/acme-app`), never real ones.
- It then runs `pnpm -r typecheck` + `pnpm -r test` + `pnpm test:scripts`, builds the
  PWA and runs the Playwright **e2e** on a free port (the default 4173 is the standing
  deploy on the host running `run-pwa.sh`). The suite runs on **WebKit only** (the Perch client is exclusively WebKit —
  iPhone/iPad/Safari), so a machine needs it once — `pnpm --filter @perch/pwa exec
  playwright install webkit` — alongside `mise trust`; without them the gate fails closed.

## Pushing & merge conflicts
**There is no remote test CI.** The only GitHub Action is a gitleaks secret scan
(`.github/workflows/gitleaks.yml`), a backstop for the local leak check. The test gate
runs entirely on the local git hooks (commit/merge/push) before anything reaches `origin`.
So after a `git push`, do **not** wait for a remote test run — there is none. Verifying locally with
`pnpm -s test` + e2e is the whole story.

`origin` is a real GitHub remote (no test CI). The post-merge hook auto-pushes `main`, but that
push **fails whenever `origin/main` has advanced** since you branched. When a push fails —
the hook's auto-push or a manual `git push` — integrate automatically; do **not** stop and
ask:
1. `git fetch origin`, then `git merge origin/main` into local `main`.
2. Resolve any conflicts by reading **both** sides and integrating the real intent — never
   blind-pick `-X ours`/`-X theirs`, which silently drops code.
3. Gate on the suite (`pnpm -s test`): green → `git push origin main`; red, or a conflict
   hunk that's genuinely ambiguous → **stop and hand back**. Never push a red or guessed
   `main`.

## Reference
- Deploy runbook: `docs/DEPLOY.md`. Worktree runbook: `docs/WORKTREES.md`.
- The repo has no remote test CI; verify locally (`pnpm -s test` + e2e) before pushing.
