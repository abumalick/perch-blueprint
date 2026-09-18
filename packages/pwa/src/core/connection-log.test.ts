import { describe, it, expect, beforeEach } from 'vitest';
import { createConnectionLog, type LogStore, type PersistedLogState, type EnvProbe } from './connection-log';

function fakeStore(): LogStore & { state: PersistedLogState | null } {
  return {
    state: null,
    load() {
      return this.state;
    },
    save(s) {
      this.state = structuredClone(s);
    },
  };
}

function fakeEnv(): EnvProbe & { t: number; online: boolean; vis: string } {
  return {
    t: 1000,
    online: true,
    vis: 'visible',
    now() {
      return this.t;
    },
    readEnv() {
      return { online: this.online, vis: this.vis };
    },
  };
}

describe('createConnectionLog', () => {
  let store: ReturnType<typeof fakeStore>;
  let env: ReturnType<typeof fakeEnv>;

  beforeEach(() => {
    store = fakeStore();
    env = fakeEnv();
  });

  it('stamps a monotonic seq, timestamp and env context on each event', () => {
    const log = createConnectionLog({ store, env, sess: 'A' });
    env.t = 2000;
    env.online = false;
    env.vis = 'hidden';
    const e = log.push('dev', 'close', { code: 1006, reason: 'dropped' });
    expect(e).toMatchObject({ sess: 'A', seq: 0, t: 2000, machineId: 'dev', kind: 'close', code: 1006, online: false, vis: 'hidden' });
    expect(log.push('dev', 'connect').seq).toBe(1);
  });

  it('omits machineId for app-global events', () => {
    const log = createConnectionLog({ store, env, sess: 'A' });
    expect('machineId' in log.push(null, 'hidden')).toBe(false);
  });

  it('evicts the oldest event past capacity', () => {
    const log = createConnectionLog({ store, env, sess: 'A', cap: 2 });
    log.push('dev', 'connect');
    log.push('dev', 'online');
    log.push('dev', 'close');
    const seqs = log.snapshot().map((e) => e.seq);
    expect(seqs).toEqual([1, 2]);
  });

  it('pendingFor includes the machine plus app-global events, filtered by high-water', () => {
    const log = createConnectionLog({ store, env, sess: 'A' });
    log.push('dev', 'connect'); // seq 0
    log.push(null, 'hidden'); // seq 1 (global)
    log.push('mac', 'connect'); // seq 2 (other machine)
    const kinds = log.pendingFor('dev').map((e) => e.kind);
    expect(kinds).toEqual(['connect', 'hidden']);
  });

  it('markFlushed advances the high-water and suppresses re-sending', () => {
    const log = createConnectionLog({ store, env, sess: 'A' });
    log.push('dev', 'connect'); // seq 0
    log.push('dev', 'online'); // seq 1
    log.markFlushed('dev', 1);
    expect(log.pendingFor('dev')).toEqual([]);
    const later = log.push('dev', 'close'); // seq 2
    expect(log.pendingFor('dev')).toEqual([later]);
  });

  it('a global event already flushed to dev is still pending for another machine', () => {
    const log = createConnectionLog({ store, env, sess: 'A' });
    log.push(null, 'net-offline'); // seq 0 global
    log.markFlushed('dev', 0);
    expect(log.pendingFor('dev')).toEqual([]);
    expect(log.pendingFor('mac').map((e) => e.kind)).toEqual(['net-offline']);
  });

  it('reloads the ring, seq counter and high-water marks from the store', () => {
    const first = createConnectionLog({ store, env, sess: 'A' });
    first.push('dev', 'connect'); // seq 0
    first.markFlushed('dev', 0);
    first.push('dev', 'online'); // seq 1, unflushed

    const second = createConnectionLog({ store, env, sess: 'B' });
    expect(second.push('dev', 'close').seq).toBe(2); // seq continues across launches
    expect(second.pendingFor('dev').map((e) => e.seq)).toEqual([1, 2]); // seq 0 stays flushed
  });
});
