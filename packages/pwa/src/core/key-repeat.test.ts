import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startKeyRepeat,
  KEY_REPEAT_DELAY_MS,
  KEY_REPEAT_INTERVAL_MS,
} from './key-repeat';

describe('startKeyRepeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires nothing before the initial delay elapses', () => {
    const fire = vi.fn();
    startKeyRepeat(fire);
    vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS - 1);
    expect(fire).not.toHaveBeenCalled();
  });

  it('fires once when the initial delay elapses', () => {
    const fire = vi.fn();
    startKeyRepeat(fire);
    vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('fires once per interval after the initial delay', () => {
    const fire = vi.fn();
    startKeyRepeat(fire);
    vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS * 3);
    expect(fire).toHaveBeenCalledTimes(4);
  });

  it('stop() before the delay fires nothing at all', () => {
    const fire = vi.fn();
    const { stop } = startKeyRepeat(fire);
    stop();
    vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS * 5);
    expect(fire).not.toHaveBeenCalled();
  });

  it('stop() mid-repeat halts further fires', () => {
    const fire = vi.fn();
    const { stop } = startKeyRepeat(fire);
    vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS);
    expect(fire).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(KEY_REPEAT_INTERVAL_MS * 5);
    expect(fire).toHaveBeenCalledTimes(2);
  });
});
