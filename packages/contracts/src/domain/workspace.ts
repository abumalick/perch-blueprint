import type { WorkspaceStatus } from './workspace-status';

export interface Workspace {
  machineId: string;
  id: string;
  name: string;
  projectPath: string;
  command: string;
  createdAt: number;
  lastActivityAt: number;
  // Single flat status. Set by hooks (working/needs-feedback/finished/idle) or manually from
  // the PWA (any value); the next hook event overrides a manual choice. Defaults to `idle`.
  status: WorkspaceStatus;
  // The GitHub owner/repo parsed from the project's `origin` remote, when it is a GitHub URL.
  // Absent for non-GitHub or non-git projects. Additive/optional so a version-skewed rollout
  // degrades gracefully. The PWA uses it to build Issues/Projects links. `ownerType` (when the
  // agent could resolve it) picks the right Projects URL: orgs use /orgs/<owner>/projects,
  // users use /users/<owner>/projects. Absent → the PWA falls back to the user form.
  github?: { owner: string; repo: string; ownerType?: 'user' | 'org' };
  // Manual "pin to top" flag. When set, the workspace sorts above the non-urgent ones in
  // its own status group (never across groups). Orthogonal to status: it persists across
  // status changes until the user clears it. Additive/optional so a version-skewed rollout
  // degrades gracefully — an old agent omits it and it reads as not-urgent.
  urgent?: boolean;
  // The name Claude Code's session registry gives the session running in this workspace —
  // the address other sessions message it by. Absent when the workspace runs something else
  // (zsh, Codex), when it is parked, or when the agent cannot read the registry. Additive/
  // optional so a version-skewed rollout degrades gracefully. Machine-scoped: an address is
  // only reachable from a session on the same machine.
  agentAddress?: string;
}

export interface Machine {
  id: string;
  name: string;
  baseUrl: string;
  token: string;
}
