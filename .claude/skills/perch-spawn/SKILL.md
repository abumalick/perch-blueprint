---
name: perch-spawn
description: Use when asked to launch, spawn, or open one or more new Perch workspaces to work on something — a batch of tickets or issues, or a single problem found mid-conversation that deserves its own workspace. Triggers on "launch a workspace on this", "spawn a workspace for each of those tickets", "open a new Perch workspace to investigate…", "start a workspace in <project>". NOT for in-session subagents (the Agent tool): a Perch workspace is a separate tmux session with its own Claude process and none of this conversation's context.
---

# Spawning Perch workspaces

## Overview

A Perch workspace *is* a detached tmux session named `perch-<6 hex>`. The Perch
agent discovers workspaces by running `tmux list-sessions` — nothing registers
them. So spawning one needs no Perch code, no agent restart and no token:
`spawn.sh` in this directory does it in two tmux calls.

Each workspace runs its own `claude` process with its own context. It cannot see
this conversation. **The brief is the only thing it will ever know.**

## When to use

- "Launch a workspace on each of these three tickets"
- "Open a workspace to investigate that bug and fix it"
- "Start a workspace in <project> to do X while we keep going here"

**Do not use for:**
- In-session subagents. "Launch a subagent", "run an agent on this" mean the
  Agent tool, which shares this conversation's context. Different thing.
- Spawning onto another machine. This spawns locally; another machine would need
  the WebSocket protocol and its token.

## Workflow

1. **Resolve a project path per item** — absolute, and it must exist. Two items
   on the same repo get the same path (see Isolation).
2. **Write a self-contained brief per item** (see below).
3. **Show the batch as a table and ask before spawning.** One row per workspace:
   project path, and the brief or its first line. N background Claude processes
   is not silently reversible, and the briefs are the part worth checking — the
   user gets to see what each workspace will be told before it starts.
4. **Spawn each**, after the yes.
5. **Report the ids.** Names sort themselves out: Claude Code writes the pane
   title and the agent reads that as the workspace name, so each tile ends up
   labelled by what it is doing rather than by the repo. Pass `--title` instead
   when the workspaces come from one batch and their summaries would all look
   alike — see [Naming a workspace](#naming-a-workspace).

## Quick reference

```bash
bash ~/.claude/skills/perch-spawn/spawn.sh /abs/path/to/project <<'PROMPT'
Work on issue #412. Read it first, then follow this project's conventions.
PROMPT
```

Prints the workspace id. Optional second arg is the model alias (default
`opus[1m]`); pass `sonnet[1m]` for cheap batch work. Each brief is kept at
`~/.perch/spawn/<id>.md` as a record of what that workspace was launched to do.

## Naming a workspace

By default Claude Code names the workspace, by writing the pane title as it
works — which is why the names read like task summaries rather than repo names.
That is usually what you want, and it is the name you will see change as the
conversation moves on.

When you already know what the workspace is for, say so and the name stops
moving:

```bash
bash ~/.claude/skills/perch-spawn/spawn.sh --title 'story foo 9' /abs/path <<'PROMPT'
...
PROMPT
```

Worth it for a **batch**: ten workspaces launched from one loop otherwise end up
with ten near-identical summaries, and the tiles cannot be told apart. Give each
the identifier the rest of the work already uses — the branch, the ticket, the
row — and a tile matches a log line without guessing.

The title survives for the life of the session. It does **not** survive an
unpark: a resumed workspace starts a fresh Claude Code without the flag that
suppresses renaming, so it goes back to naming itself.

Always pass the brief through a **quoted** heredoc (`<<'PROMPT'`). An unquoted
one lets the shell expand `$` and backticks in the brief before it is written.

## Writing the brief

The workspace starts cold. Anything carried from this conversation has to be
written down.

- **With a ticket, reference it and stop:** "Work on issue #412. Read it first."
  The details are in the ticket — do not restate them.
- **Without a ticket, describe the actual problem:** what was observed, where,
  and what a good outcome is. Never "the bug we discussed" or "the issue above" —
  the workspace has no above.
- **Say what to do, not how:** "Fix it, and open a ticket if there isn't one" is
  enough. It has the repo and its conventions.
- **Tell it to run to completion.** A workspace's tile turns "Needs you"
  whenever its turn ends, so an agent that stops mid-task to confirm a plan
  looks like it is waiting on the user when it is not. "Work it through, don't
  check in with me" keeps that signal honest. The "Needs you" at the *end* is
  correct — that one means the workspace is worth looking at.
- Keep it short. A few sentences beats a page.

## Isolation

Point every workspace at the project root and let the repo's own convention take
over — many repos require a git worktree per feature, and their agents create one
themselves. Do not create worktrees or branches here; this is a launcher.

If a repo has no such convention and two workspaces will touch the same files,
say so when presenting the table and let the user decide.

## Why raw tmux — don't "fix" this

The agent's `perch create` CLI needs `PERCH_MACHINE_ID` and the checkout path,
which differ per machine; that is exactly what would stop this working
everywhere. `spawn.sh` couples to four stable things instead: the `perch-`
prefix, `new-session -d`, `-c <cwd>`, and the `@perch_command` option. Do not add
a use-the-CLI-if-present branch.

`@perch_command` is not decorative — it feeds the workspace's `command` field,
and park/unpark resumes from it. A workspace spawned without it can never be
parked.

## Testing this script is where the danger is

`spawn.sh` calls bare `tmux` deliberately: in production it must reach the ambient
server, the one its own workspace lives on. That leaves environment variables as
the only way to isolate it under test — and `$TMUX` beats `TMUX_TMPDIR`, so a test
run from inside a Perch pane resolves to the **real** server unless every single
call is prefixed with `env -u TMUX`.

So a test's own tmux calls, `kill-server` above all, must pass an explicit
`-S <sandbox socket>`: it overrides both variables and errors out rather than
falling back, which makes reaching the real server structurally impossible rather
than merely unlikely. `spawn.test.sh` does this, and asserts its first spawned
session really landed on the sandbox socket before it touches anything else.

A single missing `env -u TMUX` on a `kill-server` destroys every live workspace on
the machine. Do not isolate destructive tmux calls with environment variables
alone.

## Common mistakes

| Mistake | What happens |
|---|---|
| Interpolating the brief into the tmux command string | An apostrophe or backtick mangles the command, the pane dies instantly and the workspace never appears — no error anywhere |
| Storing the full command (brief included) in `@perch_command` | Every unpark re-submits the original brief into the resumed conversation |
| A brief that says "the bug above" | The workspace has no above; it starts by asking what you mean and then sits idle |
| Spawning before showing the table | Several Claude processes start on briefs nobody checked |
| Relative project path | `tmux new-session -c` falls back to `$HOME`; `spawn.sh` rejects it, but resolve it anyway |
| Setting the pane title yourself, after spawning | Claude Code overwrites it within seconds — use `--title`, which also turns its renaming off |
