# Connection-event logging (client → agent JSONL)

**Status:** approved · **Date:** 2026-07-17

## Problem

Users see frequent disconnect/reconnect churn in the PWA. Runtime investigation cleared the
agent — it can stay up for days with zero restarts, and it logs nothing about connections.
The drops are transport/client-side (iOS backgrounding, WiFi↔cellular handoff, or the
tailnet link dropping while the network stays "up"), and there is currently **no record**
of them: the client keeps only the *latest* `ConnectionDiagnostic` per machine
(`store.lastConnectionError`), with no history and nothing sent anywhere.

We want a durable, post-hoc log of connection lifecycle events — enriched with the
signals that distinguish the three suspects — buffered on the client and flushed to the
agent after recovery, so the drops can be analysed offline from a file on the box.

## Goal / done

- Every connection lifecycle transition is recorded as a structured event carrying the
  three discriminating signals: WebSocket **close code**, `navigator.onLine`, and
  `document.visibilityState` at the moment of the event.
- Events survive a full app kill (not just backgrounding).
- After a machine reconnects, its buffered events (plus app-global visibility/online
  transitions) are POSTed to that machine's agent and appended to
  `~/.perch/client-log.jsonl`.
- The whole core is unit-tested with fakes; adapters are thin.

## Non-goals (YAGNI)

- No on-device viewer UI (backend file only; the existing per-machine error display stays).
- No log rotation/retention service — append-only JSONL, truncated manually.
- No central/cloud sink — each agent holds its own machine's view.
- No capture of terminal content.
- No change to `machine-connection.ts` reconnect/heartbeat *behavior* — we only observe
  its existing `onStatus`/`onDiagnostic` callbacks.

## Transport — HTTP `POST /clientlog` (Approach A)

Mirrors the existing bearer-guarded `POST /hooks`: same shared `node:http` server,
`Authorization: Bearer <token>`. Deliberately **not** the WebSocket — the diagnostics
about why the socket died must not depend on that socket, and it avoids a
`ClientMessage`/`AgentMessage` protocol change on the streaming path.

Because the PWA origin (`:8443`) differs from the agent (`:8442`), the fetch is
cross-origin with an `Authorization` header (non-simple) → the endpoint sets
`Access-Control-Allow-Origin: *` and answers the `OPTIONS` preflight, exactly like
`/file`.

## Wire shape — `packages/contracts/src/protocol/client-log.ts`

```ts
clientLogEventSchema = z.object({
  sess: z.string(),                     // per-app-launch id
  seq: z.number().int().nonnegative(),  // monotonic within sess (unambiguous ordering)
  t: z.number(),                        // epoch ms at emit
  machineId: z.string().optional(),     // absent for app-global events (visibility/online)
  kind: z.string(),                     // open string, NOT an enum → forward-compatible
  code: z.number().int().optional(),    // WS close code, when reported
  reason: z.string().optional(),        // classified message / close reason
  online: z.boolean(),                  // navigator.onLine at emit
  vis: z.string(),                      // document.visibilityState at emit
})

clientLogBatchSchema = z.object({
  ua: z.string().optional(),            // userAgent
  shell: z.string().optional(),         // client kind, e.g. 'pwa'
  events: z.array(clientLogEventSchema).min(1).max(500),
})
```

`kind` is a bare string, not a zod enum: a client that starts emitting a new kind must
not be rejected by an older agent's parser. Exported from `contracts/src/index.ts`.

Event `kind` values emitted in v1 (derived from existing callbacks):

| kind | source | notes |
|------|--------|-------|
| `connect` | `onStatus('connecting')` | a connect attempt started |
| `online` | `onStatus('online')` | auth succeeded, machine live |
| `close` | `onDiagnostic` (on offline) | carries `code` + `reason` (the classified `diagnose()` message: "connection timed out" / "…unreachable" / "closed by agent — …" / "opened then dropped") |
| `visible` / `hidden` | App `visibilitychange` | app-global (no machineId) |
| `net-online` / `net-offline` | App `online`/`offline` | app-global (no machineId) |

Every event — including per-machine ones — carries inline `online` + `vis`. The app-global
transition events add the "backgrounded at T with no coincident drop" signal that inline
context alone can't show.

**What the signals can and can't disambiguate (be honest with the reader):**
- `vis` (`document.visibilityState`) is reliable → cleanly flags **iOS backgrounding**.
- `navigator.onLine` is **unreliable on iOS**: it frequently stays `true` with no
  connectivity. So a WiFi loss and a tailnet/DERP link drop usually look identical
  (`online:true, vis:visible, close code 1006`). Do **not** read `online:` as a WiFi detector.
- The signals that actually work are **`vis` + close `code` + timing**. Telling
  WiFi-loss from tailnet-loss is *not* solved here (a browser has no reliable signal for it).
  This log is still strictly more than the nothing we have today — it will separate
  backgrounding from everything-else and give timing/frequency, which is the immediate need.

## Client core — `packages/pwa/src/core`

Pure, DOM-free, injected clock/env/store.

- **`connection-log.ts`** — the ring + flush bookkeeping. Owns:
  - `sess` (generated once per construction), a monotonic `seq`, a fixed-capacity ring
    (cap ~300; oldest evicted past cap), and `flushed: Record<machineId, seq>` (per-machine
    high-water mark).
  - `push(machineId | null, kind, { code?, reason? }?)` — stamps `seq`/`t`/`online`/`vis`
    (via injected `now()` + `readEnv()`), appends, persists.
  - `pendingFor(machineId)` — buffered events with `seq > (flushed[machineId] ?? -1)` and
    (`machineId === m` **or** `machineId == null`). App-global events are thus delivered to
    every machine's log (self-contained per-machine logs; deduped by `(sess,seq)` at read).
  - `markFlushed(machineId, upToSeq)` — advance the high-water mark, persist.
  - `snapshot()` — for tests/debug.
- **`ports/log-store.ts`** — `{ load(): PersistedLogState | null; save(s: PersistedLogState): void }`.
  `PersistedLogState = { sess, seq, ring: ClientLogEvent[], flushed: Record<string, number> }`.
- **`ports/env-probe.ts`** — `{ now(): number; readEnv(): { online: boolean; vis: string } }`.
- **`connection-log-flush.ts`** — `flush({ log, machineId, httpUrl, token, fetch })`:
  `pendingFor` → if empty, return; POST `clientLogBatch` to `${httpUrl}/clientlog` with the
  bearer header; on 2xx `markFlushed(machineId, maxSeqSent)`; on any failure leave buffered
  (retried on the next reconnect). `httpUrl` is the machine's ws URL mapped to https
  (`wss://→https://`, `ws://→http://`), reusing the existing image-fetch URL derivation.

## Client adapters — `packages/pwa/src/adapters`

- **`local-storage-log-store.ts`** — `LocalStorageLogStore` reads/writes the
  `PersistedLogState` JSON under `perch.connlog`. Synchronous → survives iOS killing the
  PWA. Malformed/absent → `null` (fresh start). A quota/serialize failure is swallowed
  (logging must never break the app).
- Real `fetch` is passed straight through (a `typeof fetch` param) — no bespoke adapter.

## Client wiring

- **Composition root (`main.ts`)** builds `ConnectionLog` with `LocalStorageLogStore` +
  a real env probe (`Date.now`, `navigator.onLine`, `document.visibilityState`), and injects
  it into the store along with a `flush` binding (real `fetch`).
- **`store.svelte.ts`**: `setStatus(machineId, s)` pushes `connect` on `'connecting'` and
  `online` on `'online'` — and on `'online'` fires `flush(machineId)`. `setConnectionError`
  pushes `close` with `{ code, reason: diagnostic.message }`. (Ordering is safe: in
  `machine-connection.onClose`, `onDiagnostic` fires before `onStatus('offline')`.)
- **`App.svelte`** `visibilitychange`/`online`/`offline` handlers additionally push the
  app-global `visible`/`hidden`/`net-online`/`net-offline` events, then (as today) call
  `store.reconnectAll()`; a `visible`/`net-online` also opportunistically flushes each
  online machine.

## Agent side — `packages/agent`

- **`ports/client-log-port.ts`** — `{ append(batch: ClientLogBatch): Promise<void> }`.
- **`infrastructure/file-client-log-store.ts`** — `FileClientLogStore` implements `append`
  by `appendFile`ing one JSON line per event (each event merged with the batch's `ua`/`shell`
  + a server `rt` receive-timestamp) to `clientLogPath`. `mkdir -p` the `.perch` dir first,
  like the other file stores.
- **`infrastructure/config.ts`** — add `clientLogPath = ~/.perch/client-log.jsonl`.
- **`server/ws-server.ts` `handleHttp`** — add:
  - `OPTIONS /clientlog` → 204 with CORS headers (ACAO:\*, `POST, OPTIONS`,
    `authorization, content-type`).
  - `POST /clientlog` → bearer-guard (401); **body cap** (accumulate, destroy + 413 past
    512 KB — the cap the current `/hooks` handler lacks); `JSON.parse` +
    `clientLogBatchSchema.safeParse` (400 on failure); `await clientLog.append(...)` → 204.
- **`WsServerDeps`** — add `clientLog: ClientLogPort`; **`serve.ts`** wires
  `new FileClientLogStore(config.clientLogPath)`.

## Testing (all with fakes; no real I/O in unit tests)

- **contracts**: valid parse round-trip; unknown `kind` string accepted; `events` empty →
  reject, >500 → reject.
- **`connection-log.test.ts`**: `push` stamps monotonic `seq` + `t` + `online`/`vis` from
  the fake env; ring cap evicts oldest; `pendingFor` filters by seq & includes global
  events for every machine; `markFlushed` advances and suppresses re-send; state persists
  via the fake store and reloads.
- **`connection-log-flush.test.ts`**: fake `fetch` receives the batch at the https-mapped
  URL with the bearer header; 200 → `markFlushed`; non-2xx / throw → nothing flushed,
  events still pending.
- **`local-storage-log-store.test.ts`**: round-trip; malformed → null; quota throw swallowed.
- **store**: `setStatus`/`setConnectionError` push the expected event kinds (fake log).
- **`file-client-log-store.test.ts`** (temp dir): append writes N JSONL lines, creates the
  dir, appends (doesn't truncate) across calls.
- **`ws-server.test.ts`**: `POST /clientlog` → 401 (no bearer), 400 (bad body), 413
  (oversized), 204 (valid → `append` called with parsed batch); `OPTIONS /clientlog` → 204.

## Deploy / rollout

New agent endpoint → each agent must be rebuilt + restarted (`pnpm serve:agent
.worktrees/<feature>` to test before merge, or restart `perch-agent.service` after it). Until the
agent has the endpoint, the client's flush just gets a non-2xx and keeps the events
buffered — **no data lost**, it drains once the new agent is live. The PWA change is
backward-safe against an old agent (buffers, retries).

## Reading the log

`~/.perch/client-log.jsonl` on each agent machine — one JSON event per line. Dedup by
`(sess, seq)` at read (a global event may appear once per machine it was flushed to).
Analysed on the box on demand (grep/jq); no UI.

**Correlate by time, not by a single event's `vis`.** A drop that happens while the app is
backgrounded is *processed on resume*, so the `close` event's own `vis` stamps `"visible"`
(the state at processing time, not at drop time). The truthful "was it backgrounded?" signal
is the separate `hidden` event's timestamp — line up events within a `sess` by `t` to
reconstruct what actually happened, rather than trusting one event's inline context.
