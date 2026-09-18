import { describe, it, expect } from 'vitest';
import { parseClientLogBatch, clientLogEventSchema } from './client-log';

const event = {
  sess: 's1',
  seq: 0,
  t: 1000,
  machineId: 'dev',
  kind: 'close',
  code: 1006,
  reason: 'opened then dropped',
  online: true,
  vis: 'visible',
};

describe('client-log wire schema', () => {
  it('parses a valid batch round-trip', () => {
    const batch = { ua: 'iPhone', shell: 'pwa', events: [event] };
    expect(parseClientLogBatch(batch)).toEqual(batch);
  });

  it('accepts an app-global event with no machineId', () => {
    const { machineId, code, reason, ...global } = event;
    const parsed = clientLogEventSchema.parse({ ...global, kind: 'hidden' });
    expect(parsed.machineId).toBeUndefined();
    expect(parsed.kind).toBe('hidden');
  });

  it('accepts an unknown kind string (forward-compatible)', () => {
    expect(() => clientLogEventSchema.parse({ ...event, kind: 'future-kind' })).not.toThrow();
  });

  it('rejects an empty events array', () => {
    expect(() => parseClientLogBatch({ events: [] })).toThrow();
  });

  it('rejects a batch over 500 events', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({ ...event, seq: i }));
    expect(() => parseClientLogBatch({ events })).toThrow();
  });
});
