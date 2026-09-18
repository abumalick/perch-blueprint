import { describe, it, expect, vi } from 'vitest';
import { InMemoryStatusStore } from './in-memory-status-store';

describe('InMemoryStatusStore', () => {
  it('returns undefined for an unset workspace and stores the last write', () => {
    const store = new InMemoryStatusStore();
    expect(store.get('w1')).toBeUndefined();
    store.set('w1', 'working');
    store.set('w1', 'blocked');
    expect(store.get('w1')).toBe('blocked');
  });

  it('notifies listeners on change and stays silent on a no-op write', () => {
    const store = new InMemoryStatusStore();
    const listener = vi.fn();
    store.onChange(listener);
    store.set('w1', 'review');
    store.set('w1', 'review');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('w1', 'review');
  });

  it('stamps the change time from the clock, only on an actual transition', () => {
    let now = 100;
    const store = new InMemoryStatusStore(() => now);
    expect(store.getChangedAt('w1')).toBeUndefined();
    store.set('w1', 'working');
    expect(store.getChangedAt('w1')).toBe(100);
    now = 200;
    store.set('w1', 'working'); // no-op: keeps the original stamp
    expect(store.getChangedAt('w1')).toBe(100);
    now = 300;
    store.set('w1', 'needs-feedback'); // real change: re-stamps
    expect(store.getChangedAt('w1')).toBe(300);
  });

  it('defaults urgent to false and stores the last write', () => {
    const store = new InMemoryStatusStore();
    expect(store.getUrgent('w1')).toBe(false);
    store.setUrgent('w1', true);
    expect(store.getUrgent('w1')).toBe(true);
    store.setUrgent('w1', false);
    expect(store.getUrgent('w1')).toBe(false);
  });

  it('notifies listeners on an urgent change and stays silent on a no-op', () => {
    const store = new InMemoryStatusStore();
    const listener = vi.fn();
    store.setUrgent('w1', false); // no-op from the default
    store.onChange(listener);
    store.setUrgent('w1', true);
    store.setUrgent('w1', true); // no-op
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('w1', 'idle');
  });

  it('preserves urgent across a status change and leaves changedAt untouched on pin', () => {
    let now = 100;
    const store = new InMemoryStatusStore(() => now);
    store.set('w1', 'working');
    now = 200;
    store.setUrgent('w1', true); // pin: must not re-stamp
    expect(store.getChangedAt('w1')).toBe(100);
    now = 300;
    store.set('w1', 'needs-feedback'); // status change keeps the pin
    expect(store.getUrgent('w1')).toBe(true);
    expect(store.get('w1')).toBe('needs-feedback');
  });

  it('returns undefined for claudeSessionId when never set, then stores the last write', () => {
    const store = new InMemoryStatusStore();
    expect(store.getClaudeSessionId('w1')).toBeUndefined();
    store.setClaudeSessionId('w1', 'abc-123');
    store.setClaudeSessionId('w1', 'def-456');
    expect(store.getClaudeSessionId('w1')).toBe('def-456');
  });

  it('preserves claudeSessionId across a status change and leaves changedAt untouched', () => {
    let now = 100;
    const store = new InMemoryStatusStore(() => now);
    store.set('w1', 'working');
    now = 200;
    store.setClaudeSessionId('w1', 'abc-123');
    expect(store.getChangedAt('w1')).toBe(100);
    expect(store.get('w1')).toBe('working');
  });

  it('does not notify onChange listeners for a claudeSessionId update', () => {
    const store = new InMemoryStatusStore();
    const listener = vi.fn();
    store.onChange(listener);
    store.setClaudeSessionId('w1', 'abc-123');
    expect(listener).not.toHaveBeenCalled();
  });
});
