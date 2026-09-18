import { describe, it, expect } from 'vitest';
import type { TmuxPort } from './tmux-port';
import type { RecentStorePort } from './recent-store-port';
import type { Clock } from './clock';

describe('ports', () => {
  it('can be implemented by in-memory fakes', async () => {
    const clock: Clock = { now: () => 123 };
    const recent: RecentStorePort = {
      list: async () => ['/a'],
      record: async () => undefined,
    };
    const tmux: Pick<TmuxPort, 'hasSession'> = { hasSession: async () => false };

    expect(clock.now()).toBe(123);
    expect(await recent.list()).toEqual(['/a']);
    expect(await tmux.hasSession('x')).toBe(false);
  });
});
