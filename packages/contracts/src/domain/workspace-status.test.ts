import { describe, it, expect } from 'vitest';
import { isWorkspaceStatus, WORKSPACE_STATUSES } from './workspace-status';

describe('isWorkspaceStatus', () => {
  it('accepts every declared status', () => {
    for (const status of WORKSPACE_STATUSES) {
      expect(isWorkspaceStatus(status)).toBe(true);
    }
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isWorkspaceStatus('busy')).toBe(false);
    expect(isWorkspaceStatus(42)).toBe(false);
    expect(isWorkspaceStatus(undefined)).toBe(false);
  });

  it('lists statuses in the canonical priority order', () => {
    expect([...WORKSPACE_STATUSES]).toEqual([
      'needs-feedback',
      'needs-hands',
      'idle',
      'finished',
      'parked',
      'blocked',
      'review',
      'working',
    ]);
  });
});
