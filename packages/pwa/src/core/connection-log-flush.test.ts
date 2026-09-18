import { describe, it, expect, beforeEach } from 'vitest';
import { createConnectionLog, type ConnectionLog } from './connection-log';
import { flushConnectionLog } from './connection-log-flush';

function makeLog(): ConnectionLog {
  let state: import('./connection-log').PersistedLogState | null = null;
  const store = { load: () => state, save: (s: import('./connection-log').PersistedLogState) => void (state = structuredClone(s)) };
  const env = { now: () => 1000, readEnv: () => ({ online: true, vis: 'visible' }) };
  return createConnectionLog({ store, env, sess: 'A' });
}

describe('flushConnectionLog', () => {
  let log: ConnectionLog;
  beforeEach(() => {
    log = makeLog();
  });

  it('POSTs pending events to the machine /clientlog with a bearer header and marks them flushed', async () => {
    log.push('dev', 'connect');
    log.push('dev', 'close', { code: 1006 });
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 204 } as Response;
    };

    const flushed = await flushConnectionLog({ log, machineId: 'dev', httpBase: 'https://host:8442', token: 'tok', fetch: fetchFn as typeof fetch, meta: { ua: 'iPhone', shell: 'pwa' } });

    expect(flushed).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://host:8442/clientlog');
    expect((call.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({ ua: 'iPhone', shell: 'pwa' });
    expect(body.events.map((e: { kind: string }) => e.kind)).toEqual(['connect', 'close']);
    expect(log.pendingFor('dev')).toEqual([]);
  });

  it('does not fetch when there is nothing pending', async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return { ok: true, status: 204 } as Response;
    }) as typeof fetch;
    expect(await flushConnectionLog({ log, machineId: 'dev', httpBase: 'https://h', token: 't', fetch: fetchFn })).toBe(false);
    expect(called).toBe(false);
  });

  it('leaves events buffered on a non-2xx response', async () => {
    log.push('dev', 'connect');
    const fetchFn = (async () => ({ ok: false, status: 500 }) as Response) as typeof fetch;
    expect(await flushConnectionLog({ log, machineId: 'dev', httpBase: 'https://h', token: 't', fetch: fetchFn })).toBe(false);
    expect(log.pendingFor('dev')).toHaveLength(1);
  });

  it('leaves events buffered when fetch throws', async () => {
    log.push('dev', 'connect');
    const fetchFn = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    expect(await flushConnectionLog({ log, machineId: 'dev', httpBase: 'https://h', token: 't', fetch: fetchFn })).toBe(false);
    expect(log.pendingFor('dev')).toHaveLength(1);
  });
});
