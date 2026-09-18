# Perch

> **A personal project, shared as a reference.** It is not maintained, there is no
> support, and issues and pull requests are not accepted. Fork it and make it yours.

Perch is a mobile-first PWA for watching and driving [Claude Code](https://claude.com/claude-code)
sessions running in tmux on several machines, from a phone, over a private
[Tailscale](https://tailscale.com) network.

It is shared so that you can see how such a tool can be built and adapt the ideas to your
own setup, not as a product to install as-is. It is shaped around one person's machines and
habits.

## How it works

- An **agent** (`packages/agent`, Node) runs on each machine. It manages tmux sessions
  ("workspaces"), streams their terminals through `node-pty` over a WebSocket, and receives
  Claude Code hook events on `POST /hooks` to know whether a session is working or waiting
  for you.
- The **PWA** (`packages/pwa`, Svelte 5 + xterm.js) connects to every agent at once, lists
  the workspaces sorted by who needs attention, and opens a full terminal with a
  touch-friendly keyboard bar.
- `packages/contracts` holds the shared zod wire protocol.
- Everything stays on the tailnet: the PWA is served from the tailnet too, because browsers
  (iOS Safari in particular) block a public page from reaching a private address.
  `tailscale serve` provides HTTPS. Each agent also requires its own bearer token.

The code follows a hexagonal layout (pure core, ports, adapters) and is mostly unit-tested
against fakes, with a Playwright e2e suite driving the PWA against a fake agent.

## Where to look

- `docs/DEPLOY.md` — running agents as services, exposing them with `tailscale serve`,
  hosting the PWA, installing Claude Code hooks.
- `docs/WORKTREES.md` — the git-worktree workflow used for development.
- `docs/BROWSER.md` — naming agent-browser sessions so Perch's browser view attaches them
  to a workspace.
- `CLAUDE.md` and `.claude/skills/` — the instructions the project was built with, using
  Claude Code as the main developer. The "Gotchas already fixed" section records the
  non-obvious lessons (iOS WebKit, Android IMEs, tmux, reconnect handling).

## Security

An agent's bearer token is equivalent to a shell on that machine: creating a workspace and
sending terminal input run arbitrary commands as the user the agent runs as. Keep each
agent bound to loopback (`PERCH_HOST=127.0.0.1`, the default) and reach it only through the
private network (`tailscale serve`). Never expose an agent on a public interface, and use a
strong random token per machine.

## Development

Toolchain is pinned with [mise](https://mise.jdx.dev) (Node, pnpm, gitleaks); the package
manager is pnpm.

```bash
mise install
pnpm install
pnpm -s test                       # unit tests, all packages
pnpm --filter @perch/pwa build
pnpm --filter @perch/pwa exec playwright install webkit
E2E_PORT=4175 pnpm --filter @perch/pwa e2e
```

## License

[MIT](LICENSE)
