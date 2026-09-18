import type { StoragePort } from '../core/ports/storage';
import type { LogStore, PersistedLogState } from '../core/connection-log';

const KEY = 'perch.connlog';

// Persists the connection-log ring in a StoragePort (localStorage in production) so the buffer
// survives a full app kill. A read/parse failure yields null (fresh start) and a write failure
// (e.g. quota) is swallowed — logging must never break the app.
export function createStorageLogStore(storage: StoragePort, key: string = KEY): LogStore {
  return {
    load() {
      const raw = storage.read(key);
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as PersistedLogState;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        storage.write(key, JSON.stringify(state));
      } catch {
        // storage unavailable/full — drop this persistence, keep running
      }
    },
  };
}
