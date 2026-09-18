// One flat status per workspace. The array order is the canonical priority used for both
// list sorting and the picker (top = needs you most; `working` last — an actively-running
// session needs no attention). Hooks set `working`/`needs-feedback`/`finished`/`idle`; the
// user can manually set any value, and the next hook event overrides it.
// `needs-hands` sits right below `needs-feedback`: it is the same "you are the blocker",
// but it cannot be cleared from the phone — the work has to happen at the machine — so it
// is drained after everything that a reply would unblock.
export const WORKSPACE_STATUSES = [
  'needs-feedback',
  'needs-hands',
  'idle',
  'finished',
  'parked',
  'blocked',
  'review',
  'working',
] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export function isWorkspaceStatus(value: unknown): value is WorkspaceStatus {
  return typeof value === 'string' && (WORKSPACE_STATUSES as readonly string[]).includes(value);
}
