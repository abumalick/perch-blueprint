import { describe, it, expect } from 'vitest';
import { ViewerRegistry } from './viewer-registry';

describe('ViewerRegistry', () => {
  it('evicts a prior viewer when a new one acquires the same workspace', () => {
    const reg = new ViewerRegistry();
    const calls: string[] = [];
    const a = { detach: () => calls.push('a') };
    const b = { detach: () => calls.push('b') };

    reg.acquire('ws1', a);
    reg.acquire('ws1', b);

    expect(calls).toEqual(['a']);
  });

  it('does not evict viewers of different workspaces', () => {
    const reg = new ViewerRegistry();
    const calls: string[] = [];
    const a = { detach: () => calls.push('a') };
    const b = { detach: () => calls.push('b') };

    reg.acquire('ws1', a);
    reg.acquire('ws2', b);

    expect(calls).toEqual([]);
  });

  it('release only clears when the viewer is still the holder', () => {
    const reg = new ViewerRegistry();
    const calls: string[] = [];
    const a = { detach: () => calls.push('a') };
    const b = { detach: () => calls.push('b') };

    reg.acquire('ws1', a);
    reg.acquire('ws1', b); // evicts a; b now holds
    reg.release('ws1', a); // a is stale — must NOT clear b
    reg.acquire('ws1', { detach: () => calls.push('c') }); // should evict b

    expect(calls).toEqual(['a', 'b']);
  });
});
