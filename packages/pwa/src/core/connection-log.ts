import type { ClientLogEvent } from '@perch/contracts';

// Persisted so the buffer survives a full app kill (iOS may terminate a backgrounded PWA).
// `seq` is a single monotonic counter that continues across launches — the flush high-water
// marks are seq numbers, so a per-launch reset would break cross-launch pruning.
export interface PersistedLogState {
  seq: number;
  ring: ClientLogEvent[];
  flushed: Record<string, number>;
}

export interface LogStore {
  load(): PersistedLogState | null;
  save(state: PersistedLogState): void;
}

export interface EnvProbe {
  now(): number;
  readEnv(): { online: boolean; vis: string };
}

export interface ConnectionLog {
  push(machineId: string | null, kind: string, extra?: { code?: number; reason?: string }): ClientLogEvent;
  pendingFor(machineId: string): ClientLogEvent[];
  markFlushed(machineId: string, upToSeq: number): void;
  snapshot(): ClientLogEvent[];
}

const DEFAULT_CAP = 300;

// A durable ring buffer of connection lifecycle events plus per-machine flush high-water
// marks. Pure and DOM-free: the clock and environment (online/visibility) are injected, and
// persistence is a port. App-global events (visibility/online transitions) are stored with no
// machineId and delivered to every machine's flush, so each agent's log is self-contained.
export function createConnectionLog(deps: {
  store: LogStore;
  env: EnvProbe;
  sess: string;
  cap?: number;
}): ConnectionLog {
  const { store, env, sess } = deps;
  const cap = deps.cap ?? DEFAULT_CAP;
  const loaded = store.load();
  let seq = loaded?.seq ?? 0;
  const ring: ClientLogEvent[] = loaded?.ring ?? [];
  const flushed: Record<string, number> = loaded?.flushed ?? {};

  function persist(): void {
    store.save({ seq, ring, flushed });
  }

  return {
    push(machineId, kind, extra) {
      const { online, vis } = env.readEnv();
      const event: ClientLogEvent = {
        sess,
        seq: seq++,
        t: env.now(),
        kind,
        online,
        vis,
        ...(machineId != null ? { machineId } : {}),
        ...(extra?.code != null ? { code: extra.code } : {}),
        ...(extra?.reason != null ? { reason: extra.reason } : {}),
      };
      ring.push(event);
      if (ring.length > cap) ring.shift();
      persist();
      return event;
    },
    pendingFor(machineId) {
      const mark = flushed[machineId] ?? -1;
      return ring.filter((e) => e.seq > mark && (e.machineId === machineId || e.machineId === undefined));
    },
    markFlushed(machineId, upToSeq) {
      flushed[machineId] = Math.max(flushed[machineId] ?? -1, upToSeq);
      persist();
    },
    snapshot() {
      return ring.slice();
    },
  };
}
