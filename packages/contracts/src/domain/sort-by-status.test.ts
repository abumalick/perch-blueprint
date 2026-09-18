import { describe, it, expect } from 'vitest';
import { sortByStatus } from './sort-by-status';
import type { Workspace } from './workspace';
import type { WorkspaceStatus } from './workspace-status';

function ws(
  id: string,
  status: WorkspaceStatus,
  lastActivityAt: number,
  urgent?: boolean,
): Workspace {
  return {
    machineId: 'm1',
    id,
    name: id,
    projectPath: `/p/${id}`,
    command: 'claude',
    createdAt: 0,
    lastActivityAt,
    status,
    ...(urgent !== undefined ? { urgent } : {}),
  };
}

describe('sortByStatus', () => {
  it('orders by the canonical status priority', () => {
    const input = [
      ws('working', 'working', 100),
      ws('parked', 'parked', 100),
      ws('blocked', 'blocked', 100),
      ws('review', 'review', 100),
      ws('finished', 'finished', 100),
      ws('idle', 'idle', 100),
      ws('feedback', 'needs-feedback', 100),
      ws('hands', 'needs-hands', 100),
    ];
    expect(sortByStatus(input).map((w) => w.id)).toEqual([
      'feedback',
      'hands',
      'idle',
      'finished',
      'parked',
      'blocked',
      'review',
      'working',
    ]);
  });

  it('breaks ties by oldest activity first (drain top-to-bottom)', () => {
    const input = [
      ws('old', 'finished', 10),
      ws('new', 'finished', 30),
      ws('mid', 'finished', 20),
    ];
    expect(sortByStatus(input).map((w) => w.id)).toEqual(['old', 'mid', 'new']);
  });

  it('floats an urgent workspace to the top of its status group', () => {
    const input = [
      ws('old', 'working', 10),
      ws('new', 'working', 30),
      ws('urgent', 'working', 40, true),
    ];
    // Urgent leads its group even though it has the newest activity; the rest keep
    // oldest-first order behind it.
    expect(sortByStatus(input).map((w) => w.id)).toEqual(['urgent', 'old', 'new']);
  });

  it('keeps urgency within the status group, never lifting across ranks', () => {
    const input = [
      ws('working-urgent', 'working', 10, true),
      ws('feedback-plain', 'needs-feedback', 10),
    ];
    // needs-feedback outranks working, so a plain needs-feedback still sits above an
    // urgent working one.
    expect(sortByStatus(input).map((w) => w.id)).toEqual(['feedback-plain', 'working-urgent']);
  });

  it('orders multiple urgent workspaces in a group oldest-first among themselves', () => {
    const input = [
      ws('u-new', 'idle', 30, true),
      ws('plain', 'idle', 5),
      ws('u-old', 'idle', 10, true),
    ];
    expect(sortByStatus(input).map((w) => w.id)).toEqual(['u-old', 'u-new', 'plain']);
  });

  it('treats a missing urgent flag as not urgent', () => {
    const input = [ws('plain', 'idle', 10), ws('urgent', 'idle', 20, true)];
    expect(sortByStatus(input).map((w) => w.id)).toEqual(['urgent', 'plain']);
  });

  it('does not mutate the input array', () => {
    const input = [ws('a', 'idle', 1), ws('b', 'needs-feedback', 1)];
    const snapshot = input.map((w) => w.id);
    sortByStatus(input);
    expect(input.map((w) => w.id)).toEqual(snapshot);
  });
});
