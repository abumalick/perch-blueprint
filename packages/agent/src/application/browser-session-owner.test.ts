import { describe, it, expect } from 'vitest';
import { browserSessionsForWorkspace } from './browser-session-owner';

describe('browserSessionsForWorkspace', () => {
  it('matches the bare workspace id and its <id>__ prefixed sessions', () => {
    const names = ['perch-a', 'perch-a__login', 'perch-a__checkout', 'perch-b', 'github'];
    expect(browserSessionsForWorkspace(names, 'perch-a')).toEqual([
      'perch-a',
      'perch-a__login',
      'perch-a__checkout',
    ]);
  });

  it('does not match another workspace or a shared bare prefix', () => {
    // `perch-a-b` and `perch-ax` merely share the `perch-a` prefix without the `__` boundary.
    const names = ['perch-b', 'perch-a-b', 'perch-ax', 'github'];
    expect(browserSessionsForWorkspace(names, 'perch-a')).toEqual([]);
  });

  it('returns nothing when there are no sessions', () => {
    expect(browserSessionsForWorkspace([], 'perch-a')).toEqual([]);
  });
});
