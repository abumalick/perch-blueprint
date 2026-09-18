# Browser sessions for agents

Agents in a Perch workspace can drive headless browsers with
[agent-browser](https://github.com/vercel-labs/agent-browser) (a CDP CLI). Perch's browser
view discovers those sessions, streams them to the phone, and relays input back — so you can
watch an agent's browser, or take over to log in, from the PWA.

The browser view was built against agent-browser 0.31.x and depends on its stream wire
format. After upgrading agent-browser, re-check that session open/close, `get cdp-url`, and
the Perch browser view (stream attach + input) still work.

## Session naming — how Perch attaches a browser to a workspace

Name each session `<wsid>__<slug>`, where `<wsid>` is the workspace id (the tmux session
name, `tmux display-message -p '#S'`) and `<slug>` is a short task label. Compute the name
rather than hand-picking it, so the prefix is never dropped:

```bash
wsid=$(tmux display-message -p '#S' 2>/dev/null)   # empty outside a Perch tmux session
session="${wsid:+${wsid}__}login"                  # -> perch-fix-ui__login, or just "login"
```

- Perch attaches a session to a workspace **only** when its name is *exactly* `<wsid>` or
  starts with `<wsid>__` (`browser-session-owner.ts` on the agent, `browser-sessions.ts` in
  the PWA). Anything else shows as unattached in the home "Browser sessions" list.
- An attached session opens from the workspace's 🌐 icon (a picker when there are several),
  and closing the workspace closes its sessions.
- `__` (double underscore) is the delimiter and never appears in a workspace id, so keep the
  id verbatim before it. Outside a Perch workspace a plain `<slug>` is fine. Avoid the
  implicit `default` session.
- **A mis-named session can't be relinked.** Attachment is purely by name, so there is
  nothing to refresh; close it and reopen with the computed name.
- Sessions are isolated Chrome processes that outlive the CLI call. Set an idle timeout on
  a session's first command so abandoned browsers reap themselves, and close it when done:

  ```bash
  AGENT_BROWSER_IDLE_TIMEOUT_MS=1800000 agent-browser --session "$session" open <url>
  agent-browser --session "$session" close
  ```

## Cookies: fresh by default, per-site login opt-in

A default session gets a fresh temporary profile, deleted on close — no cookies, no history.
That is the right mode for almost all work. When a task genuinely needs a real login, open a
**per-site session** with `--restore`, which auto-saves that site's cookies + localStorage
on close and restores them on the next open, keyed by name:

```bash
site=github
AGENT_BROWSER_IDLE_TIMEOUT_MS=1800000 \
  agent-browser --session "${wsid:+${wsid}__}$site" --restore "$site" open "https://$site.com"
```

This separates two concerns:

- **`--session <wsid>__<site>` — attachment.** The live browser shows under the workspace's
  🌐 icon and closes with it.
- **`--restore <site>` — persistence.** The login is stored under the `<site>` key, not the
  session name, so one login is reused across every workspace instead of fragmenting into
  per-workspace copies.

Why not the alternatives:

- One shared state file for every site mixes unrelated logins into one blob; per-site keys
  isolate them.
- A `--profile <dir>` user-data-dir does not keep a login across restarts with
  Chrome for Testing: it doesn't flush HttpOnly/Secure session cookies on close, so the
  login silently disappears. `--restore` reads cookies over CDP instead of relying on the
  on-disk profile store, so it persists.

### Seeding a login (one-time, by a human)

Agents should not hold credentials or attempt logins. A person seeds each site once, through
Perch:

1. Start the per-site session (the command above), or ask the agent to.
2. Open it in Perch — the workspace's 🌐 icon, or the home **Browser sessions** list — and
   log in, completing 2FA. The input relay lets you type and tap from the phone.
3. Close the session; `--restore` saves the cookies. The next open is already logged in.
4. To refresh an expired login, repeat.

### Rules

- **Keep a per-site `--restore` session on its own site.** Navigating a session that
  carries a real login to untrusted pages hands that login to whatever the page can reach.
- Two workspaces driving the same site at once share one restore key; the last one to close
  wins on auto-save. Fine for stable login cookies.

## Security notes

- CDP ports and stream servers bind 127.0.0.1 only. Nothing is exposed on the tailnet
  directly; the browser view goes through the token-guarded Perch agent.
- Saved `--restore` states hold live session cookies. Treat `~/.agent-browser/` like a
  credential store.
