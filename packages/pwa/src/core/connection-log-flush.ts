import type { ClientLogBatch } from '@perch/contracts';
import type { ConnectionLog } from './connection-log';

// Narrow fetch shape (avoids leaking the DOM global `fetch` type through this exported API and
// keeps the port trivial to fake in tests).
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean }>;

// Flushes a machine's pending connection-log events to its agent's POST /clientlog. A no-op
// (returns false) when nothing is pending. On a 2xx the sent events are marked flushed so they
// are never re-sent; on any failure they stay buffered and drain on the next reconnect — the
// diagnostics deliberately don't depend on the (flaky) WebSocket succeeding.
export async function flushConnectionLog(deps: {
  log: ConnectionLog;
  machineId: string;
  httpBase: string;
  token: string;
  fetch: FetchLike;
  meta?: { ua?: string; shell?: string };
}): Promise<boolean> {
  const { log, machineId, httpBase, token, fetch, meta } = deps;
  const events = log.pendingFor(machineId);
  if (events.length === 0) return false;
  const batch: ClientLogBatch = { ...meta, events };
  try {
    const res = await fetch(`${httpBase}/clientlog`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  log.markFlushed(machineId, Math.max(...events.map((e) => e.seq)));
  return true;
}
