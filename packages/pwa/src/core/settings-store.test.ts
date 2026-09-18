import { describe, it, expect } from 'vitest';
import { SettingsStore } from './settings-store';
import type { StoragePort } from './ports/storage';

function memStorage(): StoragePort {
  const map = new Map<string, string>();
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('SettingsStore', () => {
  it('starts empty', () => {
    expect(new SettingsStore(memStorage()).list()).toEqual([]);
  });

  it('defaults file word-wrap to on', () => {
    expect(new SettingsStore(memStorage()).fileWrap()).toBe(true);
  });

  it('persists the file word-wrap preference', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.setFileWrap(false);
    expect(store.fileWrap()).toBe(false);
    expect(new SettingsStore(storage).fileWrap()).toBe(false);
    store.setFileWrap(true);
    expect(new SettingsStore(storage).fileWrap()).toBe(true);
  });

  it('defaults the terminal font size to 13', () => {
    expect(new SettingsStore(memStorage()).terminalFontSize()).toBe(13);
  });

  it('persists the terminal font size across a fresh store', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.setTerminalFontSize(18);
    expect(store.terminalFontSize()).toBe(18);
    expect(new SettingsStore(storage).terminalFontSize()).toBe(18);
  });

  it('clamps an out-of-range or unparsable stored font size on read', () => {
    const storage = memStorage();
    storage.write('perch.terminalFontSize', '999');
    expect(new SettingsStore(storage).terminalFontSize()).toBe(24);
    storage.write('perch.terminalFontSize', '1');
    expect(new SettingsStore(storage).terminalFontSize()).toBe(8);
    storage.write('perch.terminalFontSize', 'abc');
    expect(new SettingsStore(storage).terminalFontSize()).toBe(13);
  });

  it('adds and lists machines, persisting to storage', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.add({ id: 'mac', name: 'MacBook', url: 'wss://mac.ts.net', token: 't1' });
    store.add({ id: 'mini', name: 'Mini PC', url: 'wss://mini.ts.net', token: 't2' });
    expect(store.list().map((m) => m.id)).toEqual(['mac', 'mini']);
    // a fresh store over the same storage sees the persisted machines
    expect(new SettingsStore(storage).list()).toHaveLength(2);
  });

  it('replaces an existing machine with the same id on add', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'Old', url: 'wss://old', token: 't' });
    store.add({ id: 'mac', name: 'New', url: 'wss://new', token: 't' });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.name).toBe('New');
  });

  it('updates url and token of an existing machine, preserving id and name', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'MacBook', url: 'wss://old', token: 'old' });
    store.update('mac', { url: 'wss://new', token: 'new' });
    expect(store.list()).toEqual([{ id: 'mac', name: 'MacBook', url: 'wss://new', token: 'new' }]);
  });

  it('keeps the existing token when update omits it', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'MacBook', url: 'wss://old', token: 'keepme' });
    store.update('mac', { url: 'wss://new' });
    expect(store.list()[0]).toEqual({ id: 'mac', name: 'MacBook', url: 'wss://new', token: 'keepme' });
  });

  it('leaves other machines untouched on update', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't1' });
    store.add({ id: 'mini', name: 'Mini', url: 'wss://mini', token: 't2' });
    store.update('mac', { url: 'wss://mac2', token: 't1b' });
    expect(store.list()).toEqual([
      { id: 'mac', name: 'Mac', url: 'wss://mac2', token: 't1b' },
      { id: 'mini', name: 'Mini', url: 'wss://mini', token: 't2' },
    ]);
  });

  it('is a no-op when updating an unknown id', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' });
    store.update('ghost', { url: 'wss://nope', token: 'x' });
    expect(store.list()).toEqual([{ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' }]);
  });

  it('round-trips an optional default path through add and list', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.add({ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't', defaultPath: '/home/u/ws' });
    expect(new SettingsStore(storage).list()[0]?.defaultPath).toBe('/home/u/ws');
  });

  it('updates the default path of an existing machine', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't', defaultPath: '/old' });
    store.update('mac', { url: 'wss://mac', defaultPath: '/new' });
    expect(store.list()[0]?.defaultPath).toBe('/new');
  });

  it('clears the default path when update passes an empty string', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't', defaultPath: '/old' });
    store.update('mac', { url: 'wss://mac', defaultPath: '' });
    expect(store.list()[0]?.defaultPath).toBe('');
  });

  it('removes a machine by id', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'M', url: 'wss://m', token: 't' });
    store.remove('mac');
    expect(store.list()).toEqual([]);
  });

  it('returns [] on corrupt storage', () => {
    const storage = memStorage();
    storage.write('perch.machines', 'not json');
    expect(new SettingsStore(storage).list()).toEqual([]);
  });

  it('round-trips the enabled flag through setEnabled', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.add({ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' });
    store.setEnabled('mac', false);
    expect(new SettingsStore(storage).list()[0]?.enabled).toBe(false);
    store.setEnabled('mac', true);
    expect(new SettingsStore(storage).list()[0]?.enabled).toBe(true);
  });

  it('is a no-op when setEnabled targets an unknown id', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' });
    store.setEnabled('ghost', false);
    expect(store.list()).toEqual([{ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' }]);
  });

  it('preserves the enabled flag through an unrelated update', () => {
    const store = new SettingsStore(memStorage());
    store.add({ id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' });
    store.setEnabled('mac', false);
    store.update('mac', { url: 'wss://mac2' });
    expect(store.list()[0]?.enabled).toBe(false);
  });

  it('defaults the ElevenLabs API key to null', () => {
    expect(new SettingsStore(memStorage()).elevenLabsApiKey()).toBeNull();
  });

  it('persists the ElevenLabs API key across a fresh store', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.setElevenLabsApiKey('sk_test');
    expect(store.elevenLabsApiKey()).toBe('sk_test');
    expect(new SettingsStore(storage).elevenLabsApiKey()).toBe('sk_test');
  });

  it('clears the ElevenLabs API key when set to empty', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.setElevenLabsApiKey('sk_test');
    store.setElevenLabsApiKey('');
    expect(new SettingsStore(storage).elevenLabsApiKey()).toBeNull();
  });

  it('persists and reads the last used machine', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    expect(store.lastMachine()).toBeNull();
    store.setLastMachine('mini');
    expect(store.lastMachine()).toBe('mini');
    // a fresh store over the same storage sees the persisted last machine
    expect(new SettingsStore(storage).lastMachine()).toBe('mini');
  });

  it('persists and reads the last used command', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    expect(store.lastCommand()).toBeNull();
    store.setLastCommand('codex');
    expect(store.lastCommand()).toBe('codex');
    // a fresh store over the same storage sees the persisted last command
    expect(new SettingsStore(storage).lastCommand()).toBe('codex');
  });

  it('defaults the folder filter to empty', () => {
    expect(new SettingsStore(memStorage()).folderFilter()).toEqual([]);
  });

  it('persists the folder filter across a fresh store', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.setFolderFilter(['api', 'web']);
    expect(store.folderFilter()).toEqual(['api', 'web']);
    expect(new SettingsStore(storage).folderFilter()).toEqual(['api', 'web']);
  });

  it('overwrites a previous folder filter selection', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.setFolderFilter(['api']);
    store.setFolderFilter([]);
    expect(new SettingsStore(storage).folderFilter()).toEqual([]);
  });

  it('returns [] on a corrupt folder filter value', () => {
    const storage = memStorage();
    storage.write('perch.folderFilter', 'not json');
    expect(new SettingsStore(storage).folderFilter()).toEqual([]);
  });
});
