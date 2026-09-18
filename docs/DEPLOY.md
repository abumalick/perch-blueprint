# Deploying Perch (macOS and Linux agents, a phone client, over Tailscale)

Perch runs an **agent** on each machine (exposed over your tailnet via
`tailscale serve`), and a **PWA** hosted on an always-on Linux machine that your
phone installs and points at every agent.

## 0. Prerequisites (every machine)
- Tailscale installed and logged in (`tailscale status` shows the machine), MagicDNS + HTTPS enabled in the tailnet admin (`https://login.tailscale.com/admin/dns`).
- `tmux`, and the toolchain via mise: `mise trust` (the config isn't trusted on a fresh clone), then `mise install`, then `mise exec -- pnpm install` (the postinstall fixes node-pty's `spawn-helper` perms — works on macOS and Linux).
- Clone the repo on each machine that runs an agent (`deploy/agent.env` is per-machine and gitignored).
- Verify node-pty: `mise exec -- pnpm --filter @perch/agent test` should pass (real tmux/node-pty). On Ubuntu, `node-pty` prebuilds + the spawn-helper postinstall work without extra build tools.
- `deploy/run-agent.sh` and `run-pwa.sh` self-locate `mise`, so launchd/systemd units don't need mise on their PATH.

## 1. Configure each agent
```sh
cp deploy/agent.env.example deploy/agent.env
# edit deploy/agent.env: set PERCH_TOKEN (openssl rand -hex 32 — a strong random value; each machine has its own token,
# which you enter per-machine in the PWA), PERCH_MACHINE_ID (unique: "mac"/"mini"),
# PERCH_PROJECT_ROOTS (e.g. ~/workspace), keep PERCH_HOST=127.0.0.1, PERCH_PORT=8787
```
> The token can differ per machine — you enter each machine's token in the PWA separately. Use a strong random value either way.

## 2. Run the agent as a service
> Run these from the repo root (the `$(pwd)` substitution bakes in the absolute repo path).
> Run `mise trust` first on BOTH platforms — `run-agent.sh` calls `mise exec`, and a service
> context won't have an interactive trust, so an untrusted config makes the unit crash-loop.

**macOS:**
```sh
mise trust
sed "s#REPO_PATH#$(pwd)#g" deploy/com.perch.agent.plist > ~/Library/LaunchAgents/com.perch.agent.plist
launchctl load ~/Library/LaunchAgents/com.perch.agent.plist
# logs: tail -f deploy/agent.err.log
```
**Linux (systemd):**
```sh
mkdir -p ~/.config/systemd/user
sed "s#REPO_PATH#$(pwd)#g" deploy/perch-agent.service > ~/.config/systemd/user/perch-agent.service
systemctl --user daemon-reload
systemctl --user enable --now perch-agent
loginctl enable-linger "$USER"   # keep the user service running without an active login
# logs: journalctl --user -u perch-agent -f
```
Confirm: `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8787/hooks` prints `401` (server up, auth enforced). A plain `GET /hooks` returns `404` — only `POST /hooks` reaches the auth check, so the liveness probe must use `-X POST`.

## 3. Expose each agent over WSS with tailscale serve
On **each** machine (Tailscale ≥1.64 syntax — `serve <target>`, where the target is just
the local port; HTTPS is the default mode). Requires MagicDNS + HTTPS enabled in the
tailnet admin (`https://login.tailscale.com/admin/dns`).

The **agent** is served on **`:8442`**; the **PWA** (step 5) uses **`:8443`**. Keeping them
on distinct ports lets the always-on machine front *both* the agent and the PWA from the
same `*.ts.net` hostname without colliding.
```sh
# macOS: no sudo needed. Linux: prefix with sudo (the daemon socket is root-owned).
tailscale serve --bg --https=8442 8787
tailscale serve status   # shows https://<machine>.<tailnet>.ts.net:8442/ -> 127.0.0.1:8787
```
Your agent WSS URL is `wss://<machine>.<tailnet>.ts.net:8442/`. `/hooks` rides the same
port but is bearer-token-protected, so tailnet exposure is safe.
To undo later: `tailscale serve --https=8442 off`. (First HTTPS hit provisions the cert and
may take a few seconds / time out once — retry.)

## 4. Wire Claude Code hooks (each machine)
The agent writes its token to `~/.perch/token` on startup (mode 600); the hook reads it.
```sh
PERCH_MACHINE_ID=$(grep PERCH_MACHINE_ID deploy/agent.env | cut -d= -f2) \
PERCH_PORT=8787 \
pnpm --filter @perch/agent exec tsx src/cli.ts install-hooks
# merges UserPromptSubmit/PreToolUse/PostToolUse/Notification/Stop hooks into ~/.claude/settings.json
```

Same idea, same per-machine cadence: link the `perch-spawn` skill into the global
skills directory so a workspace on any project can launch further workspaces. It
lives in the repo (so it stays in step with the tmux session convention it depends
on) and is symlinked rather than copied, so `git pull` updates it.
```sh
ln -sfn "$(pwd)/.claude/skills/perch-spawn" ~/.claude/skills/perch-spawn
```

## 5. Host the PWA (the always-on Linux machine only)
```sh
sed "s#REPO_PATH#$(pwd)#g" deploy/perch-pwa.service > ~/.config/systemd/user/perch-pwa.service
systemctl --user daemon-reload
systemctl --user enable --now perch-pwa     # builds dist/ then serves on 127.0.0.1:4173
sudo tailscale serve --bg --https=8443 4173  # Linux: sudo; ≥1.64 syntax
tailscale serve status   # shows https://mini.<tailnet>.ts.net:8443/ -> 127.0.0.1:4173
```
PWA URL: `https://mini.<tailnet>.ts.net:8443/`.

## 6. Install on the phone
1. Install the Tailscale app, log into the same tailnet, ensure it's connected.
2. Open `https://mini.<tailnet>.ts.net:8443/` in Safari on an iPhone (the tailnet cert is publicly valid — no manual trust needed).
3. Share → **Add to Home Screen**. Launch Perch from the home screen (standalone).
4. **Settings** → add each machine:
   - name `Mac`, url `wss://mac.<tailnet>.ts.net:8442/`, token = that machine's `PERCH_TOKEN`.
   - name `Mini`, url `wss://mini.<tailnet>.ts.net:8442/`, token = that machine's `PERCH_TOKEN`.

## 7. On-device smoke test
1. On a machine: `pnpm --filter @perch/agent exec tsx src/cli.ts create ~/workspace/SOME_PROJECT bash` (or create from the phone).
2. Phone list shows the workspace under the right machine with a green status dot.
3. Tap it → the terminal streams; type `echo hi` → see `hi`.
4. In a workspace run `claude`; when it finishes a turn or asks for input, the row bubbles up with "Needs you". ("Finished" is a manual status you set from the status picker — no hook sets it.)
5. Open the same workspace on a second device → the first shows "Opened on another device".
6. Close from the phone → the workspace disappears from the list.

## 8. Troubleshooting
- **`/hooks` 401 from the local hook:** the agent hasn't written `~/.perch/token` yet (start the agent first) or the hook ran before startup — check `cat ~/.perch/token`.
- **node-pty `posix_spawnp failed` on Ubuntu:** re-run `pnpm install` (root postinstall chmods `spawn-helper`); confirm `node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/linux-*/spawn-helper` is `+x`.
- **WSS won't connect from the phone:** confirm `tailscale serve status` shows the mount, the phone's Tailscale is connected, and MagicDNS/HTTPS are enabled in the tailnet.
- **PWA loads but no workspaces:** check the machine URL/token in Settings; watch the agent log (`journalctl --user -u perch-agent -f` / `tail -f deploy/agent.err.log`).
- **Port already in use:** change `PERCH_PORT` in `deploy/agent.env` and the `tailscale serve` target accordingly.
- **`pnpm: command not found` from the service:** the launchd/systemd PATH may not include your pnpm (e.g. mise shims). Verify `which pnpm` in your normal shell; if it's under `~/.local/share/mise` or similar, either add that dir to the plist `PATH`/systemd `Environment=PATH=...`, or edit `deploy/run-agent.sh` to call pnpm by absolute path.
