# Edit a machine's URL & token (PWA Settings)

Date: 2026-06-19

## Goal

Let the user change an existing machine's `url` and `token` from the PWA Settings
screen, in place, without removing and re-adding it. The machine stays the **same
machine** — its `name` and `id` are preserved, so connection status, workspace
routing (keyed off the connection id), and diagnostics carry over.

"Done" looks like: in Settings, each machine row has an **Edit** action that opens an
inline form pre-filled with the current url/token; saving reconnects that machine with
the new values; the rest of the list is untouched.

## Scope

In scope:
- Edit `url` and `token` of an existing machine.

Out of scope (explicitly):
- Renaming a machine or changing its `id`.
- Reordering machines.
- Any change to `@perch/contracts`, the agent, or the wire protocol. This is
  **PWA-local** only.

## Why this is small

The persistence + reconnect plumbing already exists and is correct for an in-place edit:

- `SettingsStore.add()` is an **upsert keyed by `id`** (filters out the matching id,
  re-appends).
- `PerchStore.addMachine()` persists then calls `ConnectionManager.setMachines()`, which
  closes the stale `MachineConnection` for that id and reconnects with the new url/token.

So an edit is fundamentally "write the same id/name with new url/token, then re-push to
the manager". There is no new *core algorithm* — only a clearly-named entry point and the
UI to drive it.

## Design

### Core: `SettingsStore.update`

Add a focused method to `SettingsStore`:

```
update(id: string, patch: { url: string; token?: string }): void
```

- Looks up the existing machine by `id`.
- If not found: **no-op** (cannot accidentally create a machine — distinguishes it from
  `add`).
- If found: persists the merged config (same `id`, same `name`, new `url`). `token` is
  optional: when omitted (or blank) the existing token is kept; when provided it replaces
  the stored token. This lets the user change only the URL without re-typing the secret.

This is preferred over reusing `add` from the UI because it states intent at the call
site, isolates a clean unit-test target, and is safe against unknown ids.

### Application: `PerchStore.updateMachine`

```
updateMachine(id: string, patch: { url: string; token?: string }): void
```

Mirrors `addMachine`'s post-write steps:
1. `this.deps.settings.update(id, patch)`
2. `this.machines = this.deps.settings.list()`
3. `this.deps.manager.setMachines(this.machines)`

`setMachines` handles the reconnect (old connection closed, new one opened with the new
url/token).

### UI: `Settings.svelte`

- Each machine row gains an **Edit** button next to **Remove**.
- Track a single `editingId: string | null` — only one row is editable at a time.
- Clicking **Edit** sets `editingId` and pre-fills local `editUrl` from that machine's
  current `url`. `editToken` starts **empty** (the stored secret is never surfaced).
- The inline edit form (reusing existing input/label styling) shows URL + token (token as
  `type="password"`, with a placeholder like "leave blank to keep current") and **Save** /
  **Cancel**.
- **Save**: requires `editUrl` non-empty (URL-empty → no submit). `editToken` is optional —
  call `store.updateMachine(editingId, { url: editUrl, token: editToken || undefined })`,
  then clear `editingId`. A blank token keeps the stored token; a typed token replaces it.
- **Cancel**: clear `editingId`, no store call.
- The existing bottom "Add machine" form is unchanged.

## Data flow (save)

```
Settings.svelte (Save)
  -> store.updateMachine(id, { url, token })
       -> settings.update(id, patch)        // persist upsert (same id/name)
       -> machines = settings.list()         // refresh reactive list
       -> manager.setMachines(machines)      // close stale conn, reconnect with new url/token
            -> onStatus(online) -> send { type: 'list' }  // existing re-sync path
```

## Error handling

- Empty url: form does not submit (URL is required). Empty token is allowed and means
  "keep the current token".
- Unknown id passed to `update`: no-op (defensive; not reachable from the UI since edit is
  launched from an existing row).
- Reconnect failures surface through the existing `lastConnectionError` /
  `setConnectionError` diagnostic path already rendered per-row — no new handling.

## Testing (TDD — tests written first)

`settings-store.test.ts`:
- `update` changes url (and token when provided) of an existing machine, preserving `name`
  and `id`.
- `update` with no/blank token keeps the existing token, still updates the url.
- `update` leaves other machines untouched.
- `update` with an unknown id is a no-op (list unchanged).

store test (`store.svelte.test.ts`):
- `updateMachine` persists via settings, refreshes `machines`, and calls
  `manager.setMachines` with the updated list.

`Settings.test.ts`:
- Clicking **Edit** reveals a form pre-filled with the machine's current url; token starts
  empty.
- **Save** with url + new token calls `updateMachine` with both and collapses the form.
- **Save** with url only (blank token) calls `updateMachine` with `token: undefined`.
- **Cancel** collapses the form with no `updateMachine` call.
- Empty url does not submit.

## Unresolved questions

None.
