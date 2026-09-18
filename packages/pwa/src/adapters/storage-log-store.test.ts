import { describe, it, expect } from 'vitest';
import type { StoragePort } from '../core/ports/storage';
import type { PersistedLogState } from '../core/connection-log';
import { createStorageLogStore } from './storage-log-store';

function fakeStorage(initial: Record<string, string> = {}): StoragePort & { data: Record<string, string> } {
  return {
    data: { ...initial },
    read(key) {
      return this.data[key] ?? null;
    },
    write(key, value) {
      this.data[key] = value;
    },
  };
}

const state: PersistedLogState = {
  seq: 3,
  ring: [{ sess: 'A', seq: 2, t: 1, kind: 'close', online: true, vis: 'visible' }],
  flushed: { dev: 1 },
};

describe('createStorageLogStore', () => {
  it('round-trips persisted state through storage', () => {
    const storage = fakeStorage();
    const store = createStorageLogStore(storage);
    store.save(state);
    expect(createStorageLogStore(storage).load()).toEqual(state);
  });

  it('returns null when nothing is stored', () => {
    expect(createStorageLogStore(fakeStorage()).load()).toBeNull();
  });

  it('returns null on malformed stored JSON', () => {
    expect(createStorageLogStore(fakeStorage({ 'perch.connlog': '{not json' })).load()).toBeNull();
  });

  it('swallows a storage write failure (logging must never break the app)', () => {
    const storage: StoragePort = {
      read: () => null,
      write: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(() => createStorageLogStore(storage).save(state)).not.toThrow();
  });
});
