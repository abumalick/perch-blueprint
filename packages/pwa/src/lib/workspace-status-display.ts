import { WORKSPACE_STATUSES, type WorkspaceStatus } from '@perch/contracts';

export const STATUS_LABELS: Record<WorkspaceStatus, string> = {
  'needs-feedback': 'Needs you',
  'needs-hands': 'Needs hands',
  idle: 'Idle',
  finished: 'Finished',
  review: 'Review',
  blocked: 'Blocked',
  parked: 'Parked',
  working: 'Working',
};

// The picker lists statuses in the same canonical order that drives the list sort.
export const STATUS_ORDER: readonly WorkspaceStatus[] = WORKSPACE_STATUSES;
