import { describe, it, expect } from 'vitest';
import type { BrowserSession, Workspace } from '@perch/contracts';
import { joinBrowserSessions, browserSessionLabel } from './browser-sessions';

function ws(id: string): Workspace {
  return {
    machineId: 'm1',
    id,
    name: id,
    projectPath: `/p/${id}`,
    command: 'claude',
    createdAt: 0,
    lastActivityAt: 0,
    status: 'idle',
  };
}

function s(name: string): BrowserSession {
  return { name };
}

describe('joinBrowserSessions', () => {
  it('returns empty results for no sessions', () => {
    const result = joinBrowserSessions([], [ws('ws1')]);
    expect(result.attached.size).toBe(0);
    expect(result.unattached).toEqual([]);
  });

  it('attaches a session whose name equals a workspace id', () => {
    const result = joinBrowserSessions([s('ws1')], [ws('ws1')]);
    expect(result.attached.get('ws1')).toEqual(['ws1']);
    expect(result.unattached).toEqual([]);
  });

  it('buckets sessions matching no workspace as unattached', () => {
    const result = joinBrowserSessions([s('github')], [ws('ws1')]);
    expect(result.attached.size).toBe(0);
    expect(result.unattached).toEqual(['github']);
  });

  it('splits a mixed set across multiple workspaces', () => {
    const result = joinBrowserSessions(
      [s('ws1'), s('github'), s('ws2'), s('scratch')],
      [ws('ws1'), ws('ws2'), ws('ws3')],
    );
    expect(result.attached.get('ws1')).toEqual(['ws1']);
    expect(result.attached.get('ws2')).toEqual(['ws2']);
    expect(result.attached.has('ws3')).toBe(false);
    expect(result.unattached).toEqual(['github', 'scratch']);
  });

  it('treats every session as unattached when there are no workspaces', () => {
    const result = joinBrowserSessions([s('a'), s('b')], []);
    expect(result.attached.size).toBe(0);
    expect(result.unattached).toEqual(['a', 'b']);
  });

  it('attaches a session named <wsid>__<slug> to that workspace', () => {
    const result = joinBrowserSessions([s('ws1__login')], [ws('ws1')]);
    expect(result.attached.get('ws1')).toEqual(['ws1__login']);
    expect(result.unattached).toEqual([]);
  });

  it('groups several sessions under the same workspace', () => {
    const result = joinBrowserSessions(
      [s('ws1'), s('ws1__login'), s('ws1__checkout')],
      [ws('ws1')],
    );
    expect(result.attached.get('ws1')).toEqual(['ws1', 'ws1__login', 'ws1__checkout']);
    expect(result.unattached).toEqual([]);
  });

  it('does not attach on a bare prefix without the __ delimiter', () => {
    // `ws1x` merely shares the `ws1` prefix; only `ws1` or `ws1__…` belong to ws1.
    const result = joinBrowserSessions([s('ws1x')], [ws('ws1')]);
    expect(result.attached.size).toBe(0);
    expect(result.unattached).toEqual(['ws1x']);
  });

  it('assigns a nested-id session to the longest matching workspace id', () => {
    // `perch-a__b__run` matches both `perch-a` (via `perch-a__`) and `perch-a__b`
    // (via `perch-a__b__`); the longer id wins.
    const result = joinBrowserSessions(
      [s('perch-a__b__run')],
      [ws('perch-a'), ws('perch-a__b')],
    );
    expect(result.attached.get('perch-a__b')).toEqual(['perch-a__b__run']);
    expect(result.attached.has('perch-a')).toBe(false);
    expect(result.unattached).toEqual([]);
  });
});

describe('browserSessionLabel', () => {
  it('labels a bare-name session (name === workspace id) "main"', () => {
    expect(browserSessionLabel('ws1', 'ws1')).toBe('main');
  });

  it('labels a prefixed session with its slug', () => {
    expect(browserSessionLabel('ws1__login', 'ws1')).toBe('login');
  });

  it('keeps the remaining slug intact when it contains the delimiter', () => {
    expect(browserSessionLabel('ws1__a__b', 'ws1')).toBe('a__b');
  });
});
