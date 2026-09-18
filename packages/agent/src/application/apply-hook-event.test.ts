import { describe, it, expect } from 'vitest';
import { applyHookEvent } from './apply-hook-event';
import type { StatusStorePort } from '../ports/status-store-port';

function fakeStore() {
  const sets: Array<[string, string]> = [];
  const sessionIds: Array<[string, string]> = [];
  const store: Pick<StatusStorePort, 'set' | 'setClaudeSessionId'> = {
    set: (id, s) => sets.push([id, s]),
    setClaudeSessionId: (id, sessionId) => sessionIds.push([id, sessionId]),
  };
  return { store, sets, sessionIds };
}

const runningTask = { background_tasks: [{ id: 'b00000001', type: 'shell', status: 'running' }] };
const idlePrompt = { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' };

describe('applyHookEvent', () => {
  it('sets status for a known event and returns the change', () => {
    const f = fakeStore();
    const result = applyHookEvent(
      { store: f.store, deferred: new Set() },
      { sessionName: 'perch-aa', event: 'Notification' },
    );
    expect(result).toEqual({ workspaceId: 'perch-aa', status: 'needs-feedback' });
    expect(f.sets).toEqual([['perch-aa', 'needs-feedback']]);
  });

  it('ignores an unknown event and writes nothing', () => {
    const f = fakeStore();
    const result = applyHookEvent(
      { store: f.store, deferred: new Set() },
      { sessionName: 'perch-aa', event: 'Whatever' },
    );
    expect(result).toBeNull();
    expect(f.sets).toEqual([]);
  });

  it('writes nothing and marks the session deferred when a background task is running', () => {
    const f = fakeStore();
    const deferred = new Set<string>();
    const result = applyHookEvent(
      { store: f.store, deferred },
      { sessionName: 'perch-aa', event: 'Stop', claude: runningTask },
    );
    expect(result).toBeNull();
    expect(f.sets).toEqual([]);
    expect(deferred.has('perch-aa')).toBe(true);
  });

  it('swallows the idle prompt of a deferred session', () => {
    const f = fakeStore();
    const deferred = new Set(['perch-aa']);
    const result = applyHookEvent(
      { store: f.store, deferred },
      { sessionName: 'perch-aa', event: 'Notification', claude: idlePrompt },
    );
    expect(result).toBeNull();
    expect(f.sets).toEqual([]);
    expect(deferred.has('perch-aa')).toBe(true);
  });

  it('does not swallow the idle prompt of a different, undeferred session', () => {
    const f = fakeStore();
    const deferred = new Set(['perch-aa']);
    const result = applyHookEvent(
      { store: f.store, deferred },
      { sessionName: 'perch-bb', event: 'Notification', claude: idlePrompt },
    );
    expect(result).toEqual({ workspaceId: 'perch-bb', status: 'needs-feedback' });
    expect(deferred.has('perch-aa')).toBe(true);
  });

  it('clears the deferral once the background task is gone', () => {
    const f = fakeStore();
    const deferred = new Set(['perch-aa']);
    const result = applyHookEvent(
      { store: f.store, deferred },
      { sessionName: 'perch-aa', event: 'Stop', claude: { background_tasks: [] } },
    );
    expect(result).toEqual({ workspaceId: 'perch-aa', status: 'needs-feedback' });
    expect(deferred.has('perch-aa')).toBe(false);
  });

  it("keeps the deferral through a background subagent's own tool calls", () => {
    const f = fakeStore();
    const deferred = new Set(['perch-aa']);
    applyHookEvent({ store: f.store, deferred }, { sessionName: 'perch-aa', event: 'PreToolUse' });
    expect(deferred.has('perch-aa')).toBe(true);
    expect(f.sets).toEqual([['perch-aa', 'working']]);
  });

  it('captures a valid session_id from the hook payload', () => {
    const f = fakeStore();
    applyHookEvent(
      { store: f.store, deferred: new Set() },
      { sessionName: 'perch-aa', event: 'UserPromptSubmit', claude: { session_id: 'abc-123' } },
    );
    expect(f.sessionIds).toEqual([['perch-aa', 'abc-123']]);
  });

  it('does not capture a session id from a payload missing it', () => {
    const f = fakeStore();
    applyHookEvent(
      { store: f.store, deferred: new Set() },
      { sessionName: 'perch-aa', event: 'UserPromptSubmit', claude: { cwd: '/x' } },
    );
    expect(f.sessionIds).toEqual([]);
  });

  it('does not capture a session id from a malformed payload (wrong type, or no claude object)', () => {
    const f = fakeStore();
    applyHookEvent(
      { store: f.store, deferred: new Set() },
      { sessionName: 'perch-aa', event: 'UserPromptSubmit', claude: { session_id: 42 } },
    );
    applyHookEvent(
      { store: f.store, deferred: new Set() },
      { sessionName: 'perch-aa', event: 'UserPromptSubmit' },
    );
    expect(f.sessionIds).toEqual([]);
  });
});
