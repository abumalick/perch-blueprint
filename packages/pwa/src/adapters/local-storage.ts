import type { StoragePort } from '../core/ports/storage';

export class LocalStorageAdapter implements StoragePort {
  read(key: string): string | null {
    return window.localStorage.getItem(key);
  }

  write(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }
}
