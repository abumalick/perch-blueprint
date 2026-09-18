---
name: work
description: Use to implement any Perch feature, fix, or change. Enforces the project development flow — brainstorm first, mandatory git worktree for code changes, TDD on a clean/hexagonal architecture, an on-device deploy-test gate, then a direct local merge to main with worktree cleanup. Use whenever the user asks to build, add, implement, fix, or change behavior in Perch.
---

# Work — Perch development flow

A thin orchestrator. It owns the **sequence** and the Perch-specific glue; each phase
delegates to the existing superpowers skill. Do not restate TDD/worktree rules here —
invoke the real skills so they stay the source of truth.

It assumes the public [`superpowers`](https://github.com/obra/superpowers) Claude Code
plugin is installed; the `superpowers:*` skills below come from it.

Follow the phases in order. Create one todo per phase.

## Phase 1 — Brainstorm → plan

Invoke `superpowers:brainstorming`. Nothing is built before a design exists. The
brainstorming skill chains to `writing-plans`; let it. Scale it down for trivial work,
but never skip it.

The specs and plans these skills write under `docs/superpowers/` are local working notes:
that directory is gitignored, so skip their "commit the design doc / plan" steps and leave
them uncommitted. Anything a future reader of the repo needs belongs in the code, a test,
`CLAUDE.md`, or a top-level `docs/*.md` instead.

## Phase 2 — Worktree gate (strict path rule)

Decide from the agreed scope:

- **Provably docs-only** — every file in scope is under `*.md` or `docs/**`. Work on the
  current branch, no worktree. Skip to Phase 3.
- **Anything else** — any code or config file in scope makes a worktree **mandatory**.
  When in doubt, use a worktree (safe default).

Create it via `superpowers:using-git-worktrees`, following Perch's convention:

```bash
git worktree add .worktrees/<feature> -b <feature>
cd .worktrees/<feature> && pnpm install   # node_modules is per-worktree
```

`<feature>` is a short kebab-case slug for the work. All implementation happens inside
the worktree.

## Phase 3 — Implement (TDD + clean architecture)

Invoke `superpowers:test-driven-development`. While implementing, honor Perch's
hexagonal layering: pure domain + application (`application/`, `ports/`), all I/O behind
infrastructure adapters (`infrastructure/`), wiring in `server/`. Unit-test the core with
fakes. Keep `pnpm -s test` green; add tests with every change.

Do not advance to Phase 4 until tests pass and you have verified the change does what it
should.

## Phase 4 — Deploy-to-prod test gate

When the work is green and verified, **propose** the on-device test — do not run it
automatically. Tell the user you will run:

```bash
pnpm serve:build .worktrees/<feature>
```

This builds the worktree's PWA and points the live tailnet deploy at it. The installed
PWA auto-updates within ~60s (app must be foregrounded), and the home header shows the
`<feature>` slug as a badge.

After running it, **stop and wait** for the user's verdict. Do not proceed.

## Phase 5 — Iterate or integrate

- **Rejected / feedback** → return to Phase 3, then re-offer Phase 4.
- **Approved** → integrate, in this order:

```bash
pnpm serve:restore                       # flip the live deploy back to main
git checkout main
git merge <feature>                      # direct local merge (Perch has no remote CI)
pnpm worktree:remove .worktrees/<feature>  # restores main if it was still deployed, then removes
git branch -d <feature>
```

**If `git merge <feature>` reports conflicts:** resolve them yourself — read *both*
sides and integrate the actual intent; never blind-pick with `-X ours`/`-X theirs`, which
silently drops code. Then gate on the test suite (`pnpm -s test`):

- **Green** → complete the merge commit, then push explicitly with `git push origin
  main` (the post-merge hook does *not* fire on a conflicted merge, so the auto-push is
  skipped — you must push). Then continue the cleanup above (`worktree:remove`,
  `branch -d`).
- **Tests fail, or a conflict hunk is genuinely ambiguous** → stop. Leave the merge
  in progress and hand back to the user with what you found. Never ship a guessed or red
  main.

On a **clean** merge the post-merge git hook rebuilds main's dist, so the live PWA
returns to main automatically, and pushes main to origin (best-effort) since the merge
landed on main.
`pnpm worktree:remove` is a safe wrapper around `git worktree remove`:
if the live deploy is still serving the worktree being removed, it flips back to main
first so the PWA is never left pointing at a vanished build.

For docs-only work (no worktree), just commit on the current branch; there is no deploy
gate and no worktree to clean.

## Phase 6 — Closeout report

End every run with a short, explicit status:

- **What was done** — one line.
- **What's left** — anything outstanding, or "nothing".
- **Session state** — one of:
  - **Ready to close** — merged into main and the worktree is removed (or: docs-only
    change committed).
  - **Open — awaiting your deploy-test verdict** — Phase 4 proposed/running, not yet
    approved.
  - **Open — <reason>** — e.g. tests failing, merged but worktree not yet cleaned, blocked.

Be honest about partial states. If something was skipped or failed, say so plainly.
