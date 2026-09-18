import { describe, it, expect, vi } from 'vitest';
import { PerchStore } from './store.svelte';
import { ConnectionManager } from './core/connection-manager';
import { WorkspaceAggregator } from './core/workspace-aggregator';
import { SettingsStore } from './core/settings-store';
import type { StoragePort } from './core/ports/storage';
import type { Socket } from './core/ports/socket';
import type { ImageLoader, ImageLoadResult } from './core/ports/image-loader';
import { FetchImageLoader } from './adapters/fetch-image-loader';
import type { CacheLike } from './core/shared-file';
import { MAX_UPLOAD_BYTES } from './core/upload-limit';

function fakeCache(bytes: Uint8Array, name: string): CacheLike & { deleteCount: () => number } {
  const res = {
    arrayBuffer: async () => {
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      return ab;
    },
    headers: { get: (k: string) => (k.toLowerCase() === 'x-filename' ? name : null) },
  };
  let present = true;
  let deletes = 0;
  return {
    deleteCount: () => deletes,
    match: async () => (present ? res : undefined),
    delete: async () => ((present = false), (deletes += 1), true),
  };
}

function fakeImageLoader(result: ImageLoadResult | Error): ImageLoader {
  return {
    load: vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    ),
  };
}

function memStorage(seed: unknown[] = []): StoragePort {
  const map = new Map<string, string>();
  if (seed.length) map.set('perch.machines', JSON.stringify(seed));
  return { read: (k) => map.get(k) ?? null, write: (k, v) => void map.set(k, v) };
}

// A timer the test drives by hand, so grace-period transitions are deterministic.
function manualTimer() {
  const entries: { fn: () => void }[] = [];
  return {
    startTimer: (fn: () => void) => {
      const entry = { fn };
      entries.push(entry);
      return () => {
        const i = entries.indexOf(entry);
        if (i >= 0) entries.splice(i, 1);
      };
    },
    pending: () => entries.length,
    fireAll: () => {
      for (const entry of entries.splice(0)) entry.fn();
    },
  };
}

function build(
  seed: unknown[] = [],
  applyUpdate?: () => void,
  imageLoader: ImageLoader = new FetchImageLoader(),
  startTimer?: (fn: () => void, ms: number) => () => void,
  log?: {
    connectionLog: import('./core/connection-log').ConnectionLog;
    flushLog: (m: import('./core/settings-store').MachineConfig) => void;
  },
) {
  const sockets: Record<string, { open: () => void; deliver: (m: unknown) => void; sent: string[] }> = {};
  const aggregator = new WorkspaceAggregator();
  const settings = new SettingsStore(memStorage(seed));
  const socketFactory = (url: string) => {
    let onMessage: (d: string) => void = () => undefined;
    let onOpen: () => void = () => undefined;
    const sent: string[] = [];
    const socket: Socket = {
      send: (d) => sent.push(d),
      close: () => undefined,
      onMessage: (cb) => void (onMessage = cb),
      onOpen: (cb) => void (onOpen = cb),
      onClose: () => undefined,
    };
    sockets[url] = { open: () => onOpen(), deliver: (m) => onMessage(JSON.stringify(m)), sent };
    return socket;
  };
  const manager = new ConnectionManager({
    socketFactory,
    aggregator,
    onMessage: (id, m) => store.handleMessage(id, m),
    onStatus: (id, s) => {
      store.statuses[id] = s;
    },
    schedule: () => undefined,
  });
  const store = new PerchStore({ settings, manager, aggregator, applyUpdate, imageLoader, startTimer, socketFactory, ...log });
  return { store, sockets, manager };
}

const mac = { id: 'mac', name: 'Mac', url: 'wss://mac', token: 't' };

describe('PerchStore', () => {
  it('starts, connects machines, and reflects pushed workspaces', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'needs-feedback' },
      ],
    });
    expect(store.workspaces.map((w) => w.id)).toEqual(['perch-a']);
  });

  it('navigates and routes terminal output to the sink', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    let out = '';
    store.onOutput = (d) => (out += d);
    store.open(ws);
    expect(store.view).toBe('terminal');
    // Output carries the pty's UTF-8 bytes; non-ASCII (box-drawing, accents) must decode
    // intact, not become mojibake (the bug was atob's latin1 decode).
    store.handleMessage('mac', { type: 'output', workspaceId: 'perch-a', data: Buffer.from('hi─é', 'utf8').toString('base64') });
    expect(out).toBe('hi─é');
  });

  it('sendPutFile sends a base64 putFile for the active workspace', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    store.sendPutFile('pasted-image.png', new Uint8Array([1, 2, 3]));
    const sent = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({
      type: 'putFile',
      workspaceId: 'perch-a',
      name: 'pasted-image.png',
      data: btoa(String.fromCharCode(1, 2, 3)),
    });
  });

  // The cap exists because putFile base64s the whole file over the terminal WebSocket.
  // Rejecting here rather than at each call site covers paste, the picker and the share
  // target at once, since all three funnel through sendPutFile.
  it('sendPutFile refuses an oversized file without touching the socket', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    const before = sockets['wss://mac']!.sent.length;
    store.sendPutFile('huge.zip', new Uint8Array(MAX_UPLOAD_BYTES + 1));
    expect(sockets['wss://mac']!.sent.length).toBe(before);
    expect(store.actionError).toBe('File is too large to attach (20 MB max)');
  });

  it('sendPutFile accepts a non-image file at the size limit', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    store.sendPutFile('archive.zip', new Uint8Array(MAX_UPLOAD_BYTES));
    const sent = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent.some((m) => m.type === 'putFile' && m.name === 'archive.zip')).toBe(true);
    expect(store.actionError).toBeNull();
  });

  it('fileStored types the stored path into the terminal as input', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    store.handleMessage('mac', { type: 'fileStored', workspaceId: 'perch-a', path: '.tmp/files/pasted-image.png' });
    const sent = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({
      type: 'input',
      workspaceId: 'perch-a',
      data: btoa(String.fromCharCode(...new TextEncoder().encode('.tmp/files/pasted-image.png'))),
    });
  });

  it('loadSharedFile stashes a shared image as pending without sending OR deleting it', async () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const c = fakeCache(new Uint8Array([7, 8]), 'shot.png');
    await store.loadSharedFile(c);
    expect(store.pendingSharedFile).toEqual({ name: 'shot.png', bytes: new Uint8Array([7, 8]) });
    expect(sockets['wss://mac']!.sent.map((s) => JSON.parse(s)).some((m) => m.type === 'putFile')).toBe(false);
    // Non-destructive read: the cache entry survives until the image is actually attached, so a
    // re-open before attaching still surfaces it (and two boots can't race to delete it).
    expect(c.deleteCount()).toBe(0);
  });

  it('flushes the pending shared image as putFile and drops the cache entry when opened online', async () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    store.statuses['mac'] = 'online';
    const c = fakeCache(new Uint8Array([1, 2, 3]), 'shot.png');
    await store.loadSharedFile(c);
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    const sent = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'putFile', workspaceId: 'perch-a', name: 'shot.png', data: btoa(String.fromCharCode(1, 2, 3)) });
    expect(store.pendingSharedFile).toBeNull();
    expect(c.deleteCount()).toBe(1);
  });

  it('defers the flush (and the cache delete) until the opened workspace machine is online', async () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    store.statuses['mac'] = 'offline';
    const c = fakeCache(new Uint8Array([5]), 'shot.png');
    await store.loadSharedFile(c);
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    expect(store.pendingSharedFile).not.toBeNull();
    expect(sockets['wss://mac']!.sent.map((s) => JSON.parse(s)).some((m) => m.type === 'putFile')).toBe(false);
    expect(c.deleteCount()).toBe(0);
    store.setStatus('mac', 'online');
    const sent = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'putFile', workspaceId: 'perch-a', name: 'shot.png', data: btoa(String.fromCharCode(5)) });
    expect(store.pendingSharedFile).toBeNull();
    expect(c.deleteCount()).toBe(1);
  });

  // The cache entry is the only copy of a shared file, so a refused send must not consume it:
  // clearing on a no-op send would destroy the bytes and leave the user nothing to retry with.
  it('keeps an oversized shared file (and its cache entry) when the flush is refused', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    store.statuses['mac'] = 'online';
    const c = fakeCache(new Uint8Array(MAX_UPLOAD_BYTES + 1), 'huge.zip');
    return store.loadSharedFile(c).then(() => {
      const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
      store.open(ws);
      expect(sockets['wss://mac']!.sent.map((s) => JSON.parse(s)).some((m) => m.type === 'putFile')).toBe(false);
      expect(store.actionError).toBe('File is too large to attach (20 MB max)');
      expect(store.pendingSharedFile).not.toBeNull();
      expect(c.deleteCount()).toBe(0);
    });
  });

  it('loadSharedFile is a no-op when there is no cache', async () => {
    const { store } = build([mac]);
    store.start();
    await store.loadSharedFile(null);
    expect(store.pendingSharedFile).toBeNull();
  });

  it('marks the terminal moved on detached opened-elsewhere', () => {
    const { store } = build([mac]);
    store.start();
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    store.handleMessage('mac', { type: 'detached', workspaceId: 'perch-a', reason: 'opened-elsewhere' });
    expect(store.terminalState).toBe('moved');
  });

  it('takeOver flips back to live and re-attaches to reclaim the workspace', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    store.handleMessage('mac', { type: 'detached', workspaceId: 'perch-a', reason: 'opened-elsewhere' });
    expect(store.terminalState).toBe('moved');

    store.takeOver(80, 24);
    expect(store.terminalState).toBe('live');
    const attach = sockets['wss://mac']!.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'attach');
    expect(attach).toMatchObject({ type: 'attach', workspaceId: 'perch-a', cols: 80, rows: 24 });
  });

  it('records a connection error and clears it on online', () => {
    const { store } = build([mac]);
    store.setStatus('mac', 'offline');
    store.setConnectionError('mac', { message: 'connection failed (likely network or permission block — unreachable)', code: 1006, at: 1000 });
    expect(store.lastConnectionError['mac']?.code).toBe(1006);
    store.setStatus('mac', 'online');
    expect(store.lastConnectionError['mac']).toBeUndefined();
  });

  it('updateMachine persists new url/token and reconnects via the manager', () => {
    const { store, sockets } = build([mac]);
    store.start();
    store.updateMachine('mac', { url: 'wss://mac-new', token: 't2' });
    expect(store.machines).toEqual([{ id: 'mac', name: 'Mac', url: 'wss://mac-new', token: 't2' }]);
    // setMachines reconnects with the new url → a socket for it now exists.
    expect(sockets['wss://mac-new']).toBeDefined();
  });

  it('updateMachine keeps the existing token when omitted', () => {
    const { store } = build([mac]);
    store.start();
    store.updateMachine('mac', { url: 'wss://mac-new' });
    expect(store.machines[0]).toEqual({ id: 'mac', name: 'Mac', url: 'wss://mac-new', token: 't' });
  });

  it('opens an existing workspace without auto-focusing the terminal', () => {
    const { store } = build([mac]);
    store.start();
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    expect(store.view).toBe('terminal');
    expect(store.autoFocus).toBe(false);
  });

  it('auto-opens the just-created workspace with the keyboard focused', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    // An existing workspace at the same path must NOT be mistaken for the new one.
    sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-old', name: 'old', projectPath: '/p', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' },
      ],
    });
    store.requestCreate('mac', '/p', 'claude');
    expect(store.view).toBe('list');
    sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-old', name: 'old', projectPath: '/p', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' },
        { machineId: 'mac', id: 'perch-new', name: 'new', projectPath: '/p', command: 'claude', createdAt: 1, lastActivityAt: 1, status: 'idle' },
      ],
    });
    expect(store.view).toBe('terminal');
    expect(store.active?.id).toBe('perch-new');
    expect(store.autoFocus).toBe(true);
  });

  it('stays on the create form and surfaces a create error, clearing the pending create', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    store.goCreate();
    store.requestCreate('mac', '/home/u/nope', 'claude');
    expect(store.view).toBe('create');
    sockets['wss://mac']!.deliver({
      type: 'error',
      code: 'internal',
      message: 'directory does not exist: /home/u/nope',
    });
    expect(store.createError).toBe('directory does not exist: /home/u/nope');
    expect(store.view).toBe('create');
    // A fresh attempt clears the stale error.
    store.requestCreate('mac', '/home/u/exists', 'claude');
    expect(store.createError).toBeNull();
  });

  it('cancelCreate returns to the workspace you came from, still attached', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    store.goCreate();
    expect(store.view).toBe('create');
    store.cancelCreate();
    expect(store.view).toBe('terminal');
    expect(store.active?.id).toBe('perch-a');
    // Backing out of the form must not tear down the attachment — the agent keeps
    // one attachment per connection and the terminal simply remounts.
    const sent = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent).not.toContainEqual({ type: 'detach', workspaceId: 'perch-a' });
  });

  it('cancelCreate goes home when the form was opened from the list', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    store.goCreate();
    store.cancelCreate();
    expect(store.view).toBe('list');
    expect(store.active).toBeNull();
  });

  it('opens the created workspace even while still on the create form', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    store.goCreate();
    store.requestCreate('mac', '/p', 'claude');
    expect(store.view).toBe('create');
    sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-new', name: 'new', projectPath: '/p', command: 'claude', createdAt: 1, lastActivityAt: 1, status: 'idle' },
      ],
    });
    expect(store.view).toBe('terminal');
    expect(store.active?.id).toBe('perch-new');
  });

  it('focuses the keyboard anchor on create, while the tap gesture is live', () => {
    const { store } = build([mac]);
    store.start();
    let focused = 0;
    store.setKeyboardAnchor(() => (focused += 1));
    store.requestCreate('mac', '/p', 'claude');
    expect(focused).toBe(1);
  });

  it('records the last used machine on create', () => {
    const { store } = build([mac]);
    store.start();
    expect(store.lastMachineId).toBeNull();
    store.requestCreate('mac', '/p', 'claude');
    expect(store.lastMachineId).toBe('mac');
  });

  it('records the last used command on create', () => {
    const storage = memStorage([mac]);
    const settings = new SettingsStore(storage);
    const aggregator = new WorkspaceAggregator();
    const manager = new ConnectionManager({
      socketFactory: () => ({ send: () => undefined, close: () => undefined, onMessage: () => undefined, onOpen: () => undefined, onClose: () => undefined }),
      aggregator,
      onMessage: () => undefined,
      onStatus: () => undefined,
      schedule: () => undefined,
    });
    const store = new PerchStore({ settings, manager, aggregator, imageLoader: new FetchImageLoader() });
    store.start();
    expect(store.lastCommand).toBeNull();
    store.requestCreate('mac', '/p', 'codex');
    expect(store.lastCommand).toBe('codex');
    expect(new SettingsStore(storage).lastCommand()).toBe('codex');
  });

  it('loads the last used command on start', () => {
    const storage = memStorage([mac]);
    new SettingsStore(storage).setLastCommand('zsh');
    const settings = new SettingsStore(storage);
    const aggregator = new WorkspaceAggregator();
    const manager = new ConnectionManager({
      socketFactory: () => ({ send: () => undefined, close: () => undefined, onMessage: () => undefined, onOpen: () => undefined, onClose: () => undefined }),
      aggregator,
      onMessage: () => undefined,
      onStatus: () => undefined,
      schedule: () => undefined,
    });
    const store = new PerchStore({ settings, manager, aggregator, imageLoader: new FetchImageLoader() });
    store.start();
    expect(store.lastCommand).toBe('zsh');
  });

  it('closeActive sends only close, no detach', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    const sentBeforeClose = sockets['wss://mac']!.sent.length;
    store.closeActive();
    const sentAfterClose = sockets['wss://mac']!.sent.slice(sentBeforeClose);
    const parsed = sentAfterClose.map((s) => JSON.parse(s));
    expect(parsed).toContainEqual({ type: 'close', workspaceId: 'perch-a' });
    expect(parsed.some((m: unknown) => typeof m === 'object' && m !== null && (m as Record<string, unknown>).type === 'detach')).toBe(false);
  });

  it('toggleMachine disables a machine and persists the flag', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    store.toggleMachine('mac');
    expect(store.machines[0]?.enabled).toBe(false);
  });

  it('toggleMachine re-enables a disabled machine and reconnects', () => {
    const { store, sockets } = build([{ ...mac, enabled: false }]);
    store.start();
    expect(sockets['wss://mac']).toBeUndefined();
    store.toggleMachine('mac');
    expect(store.machines[0]?.enabled).toBe(true);
    expect(sockets['wss://mac']).toBeDefined();
  });
});

describe('PerchStore file browser', () => {
  function openWorkspace(imageLoader?: ImageLoader) {
    const { store, sockets } = build([mac], undefined, imageLoader);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/home/u/proj', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    return { store, sockets, ws };
  }

  it('openBrowser confines to the project path and requests its entries', () => {
    const { store, sockets } = openWorkspace();
    store.openBrowser();
    expect(store.view).toBe('browser');
    expect(store.browserRoot).toBe('/home/u/proj');
    const parsed = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(parsed).toContainEqual({ type: 'browseDir', path: '/home/u/proj' });
  });

  it('keeps the active workspace while browsing (no detach)', () => {
    const { store, sockets } = openWorkspace();
    store.openBrowser();
    const parsed = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(parsed.some((m) => m.type === 'detach')).toBe(false);
    expect(store.active?.id).toBe('perch-a');
  });

  it('browseInto requests a subdirectory on the active machine', () => {
    const { store, sockets } = openWorkspace();
    store.openBrowser();
    store.browseInto('/home/u/proj/src');
    const parsed = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(parsed).toContainEqual({ type: 'browseDir', path: '/home/u/proj/src' });
  });

  it('stores dirEntries with files from the agent', () => {
    const { store } = openWorkspace();
    store.openBrowser();
    store.handleMessage('mac', { type: 'dirEntries', path: '/home/u/proj', subdirs: ['/home/u/proj/src'], files: ['/home/u/proj/README.md'] });
    expect(store.dirEntries).toEqual({ path: '/home/u/proj', subdirs: ['/home/u/proj/src'], files: ['/home/u/proj/README.md'] });
  });

  it('closeBrowser returns to the terminal without clearing active', () => {
    const { store } = openWorkspace();
    store.openBrowser();
    store.closeBrowser();
    expect(store.view).toBe('terminal');
    expect(store.active?.id).toBe('perch-a');
  });

  it('surfaces an agent error while browsing instead of hanging', () => {
    const { store } = openWorkspace();
    store.openBrowser();
    store.handleMessage('mac', { type: 'error', code: 'internal', message: 'path outside allowed roots: /x' });
    expect(store.browseError).toBe('path outside allowed roots: /x');
  });

  it('clears a prior browse error when entries arrive', () => {
    const { store } = openWorkspace();
    store.openBrowser();
    store.handleMessage('mac', { type: 'error', code: 'internal', message: 'boom' });
    store.handleMessage('mac', { type: 'dirEntries', path: '/home/u/proj', subdirs: [], files: [] });
    expect(store.browseError).toBeNull();
  });

  it('ignores agent errors when not browsing', () => {
    const { store } = openWorkspace();
    store.handleMessage('mac', { type: 'error', code: 'internal', message: 'unrelated' });
    expect(store.browseError).toBeNull();
  });

  // Without this, an agent refusal (e.g. parking a workspace with no resumable Claude
  // session) is dropped on the floor and the action silently appears to do nothing.
  it('surfaces an agent error with no owning view as an action error', () => {
    const { store } = openWorkspace();
    store.handleMessage('mac', {
      type: 'error',
      code: 'not-restorable',
      message: 'cannot park: no Claude session to resume',
    });
    expect(store.actionError).toBe('cannot park: no Claude session to resume');
  });

  it('dismisses an action error', () => {
    const { store } = openWorkspace();
    store.handleMessage('mac', { type: 'error', code: 'not-restorable', message: 'nope' });
    store.dismissActionError();
    expect(store.actionError).toBeNull();
  });

  it('never surfaces bad_message as an action error', () => {
    const { store } = openWorkspace();
    store.handleMessage('mac', { type: 'error', code: 'bad_message', message: 'protocol noise' });
    expect(store.actionError).toBeNull();
  });

  it('ignores a bad_message protocol error (version-skew heartbeat) without surfacing it', () => {
    // An agent that predates `ping` answers it with a bad_message error. That's harmless
    // protocol noise, not a failed user action, so it must not pop up in an open view.
    const { store } = openWorkspace();
    store.openBrowser();
    store.handleMessage('mac', { type: 'error', code: 'bad_message', message: 'Invalid input' });
    expect(store.browseError).toBeNull();
  });
});

describe('PerchStore folder picker', () => {
  function connected() {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    return { store, sockets };
  }

  it('goCreate asks each machine for its project roots', () => {
    const { store, sockets } = connected();
    store.goCreate();
    const parsed = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(parsed).toContainEqual({ type: 'listRoots' });
  });

  it('goNewMachine switches to the newMachine view', () => {
    const { store } = build();
    store.goNewMachine();
    expect(store.view).toBe('newMachine');
  });

  it('stores the roots a machine reports', () => {
    const { store } = connected();
    store.handleMessage('mac', { type: 'roots', roots: ['/home/u/workspace', '/srv/code'] });
    expect(store.machineRoots['mac']).toEqual(['/home/u/workspace', '/srv/code']);
  });

  it('stores the command shortcuts a machine reports', () => {
    const { store } = connected();
    store.handleMessage('mac', {
      type: 'commands',
      commands: [
        { command: '/myplugin:task', submit: false },
        { command: '/rename', submit: true },
      ],
    });
    expect(store.machineCommands['mac']).toEqual([
      { command: '/myplugin:task', submit: false },
      { command: '/rename', submit: true },
    ]);
  });

  // Keyed by connection id, so two machines' drop-downs never bleed into each other.
  it('keeps each machine command shortcuts separate', () => {
    const { store } = connected();
    store.handleMessage('mac', { type: 'commands', commands: [{ command: '/mac-only', submit: false }] });
    store.handleMessage('mini', { type: 'commands', commands: [{ command: '/mini-only', submit: true }] });
    expect(store.machineCommands['mac']).toEqual([{ command: '/mac-only', submit: false }]);
    expect(store.machineCommands['mini']).toEqual([{ command: '/mini-only', submit: true }]);
  });

  it('openFolderPicker marks the picker active and clears stale entries', () => {
    const { store } = connected();
    store.dirEntries = { path: '/x', subdirs: [], files: [] };
    store.browseError = 'old';
    store.openFolderPicker();
    expect(store.pickerActive).toBe(true);
    expect(store.dirEntries).toBeNull();
    expect(store.browseError).toBeNull();
  });

  it('pickerBrowse requests a directory on the chosen machine', () => {
    const { store, sockets } = connected();
    store.openFolderPicker();
    store.pickerBrowse('mac', '/home/u/workspace/perch');
    const parsed = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(parsed).toContainEqual({ type: 'browseDir', path: '/home/u/workspace/perch' });
  });

  it('pickerMakeDir asks the agent to create a folder in the chosen parent', () => {
    const { store, sockets } = connected();
    store.openFolderPicker();
    store.pickerMakeDir('mac', '/home/u/workspace', 'new-folder');
    const parsed = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(parsed).toContainEqual({ type: 'makeDir', parent: '/home/u/workspace', name: 'new-folder' });
  });

  it('stores dirEntries from the agent while picking', () => {
    const { store } = connected();
    store.openFolderPicker();
    store.pickerBrowse('mac', '/home/u/workspace');
    store.handleMessage('mac', { type: 'dirEntries', path: '/home/u/workspace', subdirs: ['/home/u/workspace/perch'], files: [] });
    expect(store.dirEntries).toEqual({ path: '/home/u/workspace', subdirs: ['/home/u/workspace/perch'], files: [] });
  });

  it('surfaces an agent error while picking instead of hanging', () => {
    const { store } = connected();
    store.openFolderPicker();
    store.pickerBrowse('mac', '/outside');
    store.handleMessage('mac', { type: 'error', code: 'internal', message: 'path outside allowed roots: /outside' });
    expect(store.browseError).toBe('path outside allowed roots: /outside');
    expect(store.viewError).toBeNull();
  });

  it('closeFolderPicker clears the active flag', () => {
    const { store } = connected();
    store.openFolderPicker();
    store.closeFolderPicker();
    expect(store.pickerActive).toBe(false);
  });

  it('does not treat agent errors as a browse failure once the picker is closed', () => {
    const { store } = connected();
    store.openFolderPicker();
    store.closeFolderPicker();
    store.handleMessage('mac', { type: 'error', code: 'internal', message: 'unrelated' });
    expect(store.browseError).toBeNull();
  });
});

describe('PerchStore file viewer', () => {
  function openWorkspace(imageLoader?: ImageLoader) {
    const { store, sockets } = build([mac], undefined, imageLoader);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/home/u/proj', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    return { store, sockets, ws };
  }

  it('openFile requests the file and switches to the viewer', () => {
    const { store, sockets } = openWorkspace();
    store.openFile('/home/u/proj/a.txt');
    expect(store.view).toBe('viewer');
    const parsed = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(parsed).toContainEqual({ type: 'readFile', path: '/home/u/proj/a.txt' });
  });

  it('showImageNeighbor opens the next/previous image and reports position', () => {
    const { store } = openWorkspace();
    store.dirEntries = {
      path: '/home/u/proj',
      subdirs: [],
      files: ['/home/u/proj/README.md', '/home/u/proj/a.png', '/home/u/proj/b.png'],
    };
    store.openFile('/home/u/proj/a.png');
    expect(store.imagePosition).toEqual({ index: 1, count: 2 });

    store.showImageNeighbor(1);
    expect(store.fileView?.path).toBe('/home/u/proj/b.png');
    expect(store.imagePosition).toEqual({ index: 2, count: 2 });

    store.showImageNeighbor(1); // at the end → no-op
    expect(store.fileView?.path).toBe('/home/u/proj/b.png');
  });

  it('showAudioNeighbor opens the next/previous audio by filename and reports position', () => {
    const { store } = openWorkspace();
    store.dirEntries = {
      path: '/home/u/proj',
      subdirs: [],
      files: ['/home/u/proj/README.md', '/home/u/proj/track10.mp3', '/home/u/proj/track2.mp3'],
    };
    // Ordered by filename: track2 before track10.
    store.openFile('/home/u/proj/track2.mp3');
    expect(store.audioPosition).toEqual({ index: 1, count: 2 });

    store.showAudioNeighbor(1);
    expect(store.fileView?.path).toBe('/home/u/proj/track10.mp3');
    expect(store.audioPosition).toEqual({ index: 2, count: 2 });

    store.showAudioNeighbor(-1);
    expect(store.fileView?.path).toBe('/home/u/proj/track2.mp3');

    store.showAudioNeighbor(-1); // at the start → no-op
    expect(store.fileView?.path).toBe('/home/u/proj/track2.mp3');
  });

  it('showAudioNeighbor is a no-op without dirEntries', () => {
    const { store } = openWorkspace();
    store.openFile('/home/u/proj/track2.mp3');
    store.showAudioNeighbor(1);
    expect(store.fileView?.path).toBe('/home/u/proj/track2.mp3');
    expect(store.audioPosition).toBeNull();
  });

  it('showImageNeighbor is a no-op without dirEntries', () => {
    const { store } = openWorkspace();
    store.openFile('/home/u/proj/a.png');
    store.showImageNeighbor(1);
    expect(store.fileView?.path).toBe('/home/u/proj/a.png');
    expect(store.imagePosition).toBeNull();
  });

  it('decodes fileContents to UTF-8 text (no mojibake)', () => {
    const { store } = openWorkspace();
    store.openFile('/home/u/proj/a.txt');
    const data = Buffer.from('café ✓\n', 'utf8').toString('base64');
    store.handleMessage('mac', { type: 'fileContents', path: '/home/u/proj/a.txt', data, truncated: false, binary: false });
    expect(store.fileView).toEqual({ path: '/home/u/proj/a.txt', text: 'café ✓\n', mediaType: '', blobUrl: '', truncated: false, binary: false });
  });

  it('marks a binary fileContents with empty text', () => {
    const { store } = openWorkspace();
    store.openFile('/home/u/proj/blob.bin');
    store.handleMessage('mac', { type: 'fileContents', path: '/home/u/proj/blob.bin', data: '', truncated: false, binary: true });
    expect(store.fileView?.binary).toBe(true);
    expect(store.fileView?.text).toBe('');
  });

  it('passes the truncated flag through', () => {
    const { store } = openWorkspace();
    store.openFile('/home/u/proj/big.log');
    const data = Buffer.from('partial', 'utf8').toString('base64');
    store.handleMessage('mac', { type: 'fileContents', path: '/home/u/proj/big.log', data, truncated: true, binary: false });
    expect(store.fileView?.truncated).toBe(true);
  });

  it('opens an image over HTTP (bearer-authenticated) and exposes a blob object URL', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const { store, sockets } = openWorkspace();

    store.openFile('/home/u/proj/a.png');
    // Synchronously enters the viewer as an image, before the bytes arrive.
    expect(store.view).toBe('viewer');
    expect(store.fileView).toMatchObject({ path: '/home/u/proj/a.png', mediaType: 'image/png', blobUrl: '' });
    // No readFile over the WS for an image.
    expect(sockets['wss://mac']!.sent.map((s) => JSON.parse(s)).some((m) => m.type === 'readFile')).toBe(false);

    await vi.waitFor(() => expect(store.fileView?.blobUrl).toBe('blob:fake'));
    expect(fetchMock).toHaveBeenCalledWith('https://mac/file?path=%2Fhome%2Fu%2Fproj%2Fa.png', {
      headers: { Authorization: 'Bearer t' },
    });
    vi.unstubAllGlobals();
  });

  it('marks an over-cap image (HTTP 413) truncated with no url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 413 })));
    const { store } = openWorkspace();
    store.openFile('/home/u/proj/big.jpg');
    await vi.waitFor(() => expect(store.fileView?.truncated).toBe(true));
    expect(store.fileView?.blobUrl).toBe('');
    vi.unstubAllGlobals();
  });

  it('opens a pdf over HTTP and exposes a blob object URL (no readFile over the WS)', async () => {
    const loader = fakeImageLoader({ status: 200, blob: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]) });
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
    const { store, sockets } = openWorkspace(loader);

    store.openFile('/home/u/proj/doc.pdf');
    expect(store.view).toBe('viewer');
    expect(store.fileView).toMatchObject({ path: '/home/u/proj/doc.pdf', mediaType: 'application/pdf', blobUrl: '' });
    expect(sockets['wss://mac']!.sent.map((s) => JSON.parse(s)).some((m) => m.type === 'readFile')).toBe(false);

    await vi.waitFor(() => expect(store.fileView?.blobUrl).toBe('blob:pdf'));
    expect(loader.load).toHaveBeenCalledWith('https://mac/file?path=%2Fhome%2Fu%2Fproj%2Fdoc.pdf', 't');
  });

  it('opens an audio file over HTTP and exposes a blob object URL (no readFile over the WS)', async () => {
    const loader = fakeImageLoader({ status: 200, blob: new Blob([new Uint8Array([0x49, 0x44, 0x33])]) });
    URL.createObjectURL = vi.fn(() => 'blob:audio');
    URL.revokeObjectURL = vi.fn();
    const { store, sockets } = openWorkspace(loader);

    store.openFile('/home/u/proj/clip.mp3');
    expect(store.view).toBe('viewer');
    expect(store.fileView).toMatchObject({ path: '/home/u/proj/clip.mp3', mediaType: 'audio/mpeg', blobUrl: '' });
    expect(sockets['wss://mac']!.sent.map((s) => JSON.parse(s)).some((m) => m.type === 'readFile')).toBe(false);

    await vi.waitFor(() => expect(store.fileView?.blobUrl).toBe('blob:audio'));
    expect(loader.load).toHaveBeenCalledWith('https://mac/file?path=%2Fhome%2Fu%2Fproj%2Fclip.mp3', 't');
  });

  it('marks an over-cap pdf (HTTP 413) truncated with no url', async () => {
    const { store } = openWorkspace(fakeImageLoader({ status: 413, blob: null }));
    store.openFile('/home/u/proj/big.pdf');
    await vi.waitFor(() => expect(store.fileView?.truncated).toBe(true));
    expect(store.fileView?.blobUrl).toBe('');
  });

  it('strips a trailing slash on the machine URL so the path is /file, not //file', async () => {
    const loader = fakeImageLoader({ status: 200, blob: new Blob([new Uint8Array([1])]) });
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const macSlash = { id: 'mac', name: 'Mac', url: 'wss://mac:8442/', token: 't' };
    const { store, sockets } = build([macSlash], undefined, loader);
    store.start();
    sockets['wss://mac:8442/']!.open();
    sockets['wss://mac:8442/']!.deliver({ type: 'authResult', ok: true });
    store.open({ machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/home/u/proj', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' });

    store.openFile('/home/u/proj/a.png');
    await vi.waitFor(() => expect(loader.load).toHaveBeenCalled());
    const calledUrl = (loader.load as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toBe('https://mac:8442/file?path=%2Fhome%2Fu%2Fproj%2Fa.png');
    expect(calledUrl).not.toContain('//file');
  });

  it('sets viewError with the status on a non-OK image response', async () => {
    const { store } = openWorkspace(fakeImageLoader({ status: 500, blob: null }));
    store.openFile('/home/u/proj/a.png');
    await vi.waitFor(() => expect(store.viewError).toMatch(/HTTP 500/));
  });

  it('sets viewError when the image loader throws (host unreachable)', async () => {
    const { store } = openWorkspace(fakeImageLoader(new TypeError('Load failed')));
    store.openFile('/home/u/proj/a.png');
    await vi.waitFor(() => expect(store.viewError).toBe("Couldn't load this file."));
  });

  it('surfaces an agent error while viewing instead of hanging', () => {
    const { store } = openWorkspace();
    store.openFile('/home/u/proj/a.txt');
    store.handleMessage('mac', { type: 'error', code: 'internal', message: 'denied' });
    expect(store.viewError).toBe('denied');
  });

  it('closeViewer returns to the browser', () => {
    const { store } = openWorkspace();
    store.openFile('/home/u/proj/a.txt');
    store.closeViewer();
    expect(store.view).toBe('browser');
  });

  it('loads the wrap preference on start (defaults on)', () => {
    const { store } = build([mac]);
    store.start();
    expect(store.fileWrap).toBe(true);
  });

  it('setFileWrap updates state and persists across a reload', () => {
    const storage = memStorage([mac]);
    const settings = new SettingsStore(storage);
    const aggregator = new WorkspaceAggregator();
    const manager = new ConnectionManager({
      socketFactory: () => ({ send: () => undefined, close: () => undefined, onMessage: () => undefined, onOpen: () => undefined, onClose: () => undefined }),
      aggregator,
      onMessage: () => undefined,
      onStatus: () => undefined,
      schedule: () => undefined,
    });
    const store = new PerchStore({ settings, manager, aggregator, imageLoader: new FetchImageLoader() });
    store.start();
    store.setFileWrap(false);
    expect(store.fileWrap).toBe(false);
    expect(new SettingsStore(storage).fileWrap()).toBe(false);
  });

  it('loads the folder filter on start (defaults to empty)', () => {
    const { store } = build([mac]);
    store.start();
    expect(store.folderFilter).toEqual([]);
  });

  it('setFolderFilter updates state and persists across a reload', () => {
    const storage = memStorage([mac]);
    const settings = new SettingsStore(storage);
    const aggregator = new WorkspaceAggregator();
    const manager = new ConnectionManager({
      socketFactory: () => ({ send: () => undefined, close: () => undefined, onMessage: () => undefined, onOpen: () => undefined, onClose: () => undefined }),
      aggregator,
      onMessage: () => undefined,
      onStatus: () => undefined,
      schedule: () => undefined,
    });
    const store = new PerchStore({ settings, manager, aggregator, imageLoader: new FetchImageLoader() });
    store.start();
    store.setFolderFilter(['api']);
    expect(store.folderFilter).toEqual(['api']);
    expect(new SettingsStore(storage).folderFilter()).toEqual(['api']);
  });

  it('loads the terminal font size on start (defaults to 13)', () => {
    const { store } = build([mac]);
    store.start();
    expect(store.terminalFontSize).toBe(13);
  });

  it('setTerminalFontSize updates state, persists, and clamps to bounds', () => {
    const storage = memStorage([mac]);
    const settings = new SettingsStore(storage);
    const aggregator = new WorkspaceAggregator();
    const manager = new ConnectionManager({
      socketFactory: () => ({ send: () => undefined, close: () => undefined, onMessage: () => undefined, onOpen: () => undefined, onClose: () => undefined }),
      aggregator,
      onMessage: () => undefined,
      onStatus: () => undefined,
      schedule: () => undefined,
    });
    const store = new PerchStore({ settings, manager, aggregator, imageLoader: new FetchImageLoader() });
    store.start();
    store.setTerminalFontSize(18);
    expect(store.terminalFontSize).toBe(18);
    expect(new SettingsStore(storage).terminalFontSize()).toBe(18);
    store.setTerminalFontSize(100);
    expect(store.terminalFontSize).toBe(24);
    store.setTerminalFontSize(2);
    expect(store.terminalFontSize).toBe(8);
  });
});

describe('PerchStore dictation', () => {
  function build(transcript: string, transcriber: { transcribe: () => Promise<string> } = { transcribe: () => Promise.resolve(transcript) }) {
    const sent: string[] = [];
    const aggregator = new WorkspaceAggregator();
    const settings = new SettingsStore(memStorage([mac]));
    const manager = new ConnectionManager({
      socketFactory: () => ({
        send: (d) => void sent.push(d),
        close: () => undefined,
        onMessage: () => undefined,
        onOpen: () => undefined,
        onClose: () => undefined,
      }),
      aggregator,
      onMessage: () => undefined,
      onStatus: () => undefined,
      schedule: () => undefined,
    });
    const recorder = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(new Blob(['x'], { type: 'audio/webm' })),
    };
    const store = new PerchStore({ settings, manager, aggregator, recorder, transcriber, imageLoader: new FetchImageLoader() });
    store.start();
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);
    return { store, sent };
  }

  it('starts idle', () => {
    expect(build('').store.dictationState).toBe('idle');
  });

  it('records on the first toggle and inserts the transcript on the second', async () => {
    const { store, sent } = build('hello there');
    await store.toggleDictation();
    expect(store.dictationState).toBe('recording');
    await store.toggleDictation();
    expect(store.dictationState).toBe('idle');
    const parsed = sent.map((s) => JSON.parse(s));
    expect(parsed).toContainEqual({
      type: 'input',
      workspaceId: 'perch-a',
      data: Buffer.from('hello there', 'utf8').toString('base64'),
    });
  });

  it('does not insert an empty transcript', async () => {
    const { store, sent } = build('  ');
    await store.toggleDictation();
    await store.toggleDictation();
    const parsed = sent.map((s) => JSON.parse(s));
    expect(parsed.some((m) => m.type === 'input')).toBe(false);
  });

  it('surfaces a failed transcription and clears it on dismiss', async () => {
    const { store } = build('', { transcribe: () => Promise.reject(new Error('ElevenLabs quota exceeded')) });
    await store.toggleDictation();
    await store.toggleDictation();
    expect(store.dictationState).toBe('error');
    expect(store.dictationError).toBe('ElevenLabs quota exceeded');
    store.dismissDictationError();
    expect(store.dictationState).toBe('idle');
    expect(store.dictationError).toBeNull();
  });
});

describe('PerchStore update banner', () => {
  it('starts with no update pending', () => {
    const { store } = build();
    expect(store.updateReady).toBe(false);
    expect(store.incomingBuildLabel).toBeNull();
  });

  it('notifyUpdateAvailable surfaces the incoming label', () => {
    const { store } = build();
    store.notifyUpdateAvailable('feat-x');
    expect(store.updateReady).toBe(true);
    expect(store.incomingBuildLabel).toBe('feat-x');
  });

  it('applyUpdate invokes the injected updater', () => {
    let applied = 0;
    const { store } = build([], () => { applied += 1; });
    store.applyUpdate();
    expect(applied).toBe(1);
  });

  it('dismissUpdate hides the banner without applying', () => {
    let applied = 0;
    const { store } = build([], () => { applied += 1; });
    store.notifyUpdateAvailable('feat-x');
    store.dismissUpdate();
    expect(store.updateReady).toBe(false);
    expect(applied).toBe(0);
  });

  it('re-shows the banner when a later update is detected after dismiss', () => {
    const { store } = build();
    store.notifyUpdateAvailable('feat-x');
    store.dismissUpdate();
    store.notifyUpdateAvailable('feat-y');
    expect(store.updateReady).toBe(true);
    expect(store.incomingBuildLabel).toBe('feat-y');
  });

  it('setWorkspaceStatus sends setStatus for the active workspace and reflects the synced status', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);

    store.setWorkspaceStatus('blocked');
    const sent = () => sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent()).toContainEqual({ type: 'setStatus', workspaceId: 'perch-a', status: 'blocked' });

    // The agent echoes the synced workspace; the active view must reflect the new status so
    // the header picker shows it.
    sockets['wss://mac']!.deliver({ type: 'workspaceUpdated', workspace: { ...ws, status: 'blocked' } });
    expect(store.active?.status).toBe('blocked');
  });

  it('setWorkspaceUrgent sends setUrgent for the active workspace and reflects the synced flag', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    const ws = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };
    store.open(ws);

    store.setWorkspaceUrgent(true);
    const sent = () => sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent()).toContainEqual({ type: 'setUrgent', workspaceId: 'perch-a', urgent: true });

    // The agent echoes the synced workspace; the active view must reflect the pin so the
    // drawer toggle shows it as on.
    sockets['wss://mac']!.deliver({ type: 'workspaceUpdated', workspace: { ...ws, urgent: true } });
    expect(store.active?.urgent).toBe(true);
  });

  const openWs = { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' as const };

  it('re-attaches the active terminal after its machine drops and reconnects', () => {
    const { store } = build([mac]);
    store.start();
    store.open(openWs);
    let reattached = 0;
    store.onReattach = () => (reattached += 1);
    store.setStatus('mac', 'offline');
    store.setStatus('mac', 'connecting');
    store.setStatus('mac', 'online');
    expect(reattached).toBe(1);
  });

  it('does not re-attach when a machine first reaches online (no prior drop)', () => {
    const { store } = build([mac]);
    store.start();
    store.open(openWs);
    let reattached = 0;
    store.onReattach = () => (reattached += 1);
    store.setStatus('mac', 'connecting');
    store.setStatus('mac', 'online');
    expect(reattached).toBe(0);
  });

  it('does not re-attach when the recovered machine is not the active one', () => {
    const { store } = build([mac]);
    store.start();
    store.open(openWs);
    let reattached = 0;
    store.onReattach = () => (reattached += 1);
    store.setStatus('other', 'offline');
    store.setStatus('other', 'online');
    expect(reattached).toBe(0);
  });

  it('checkActiveLiveness probes the active machine connection', () => {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    store.open(openWs);
    store.checkActiveLiveness();
    const sent = sockets['wss://mac']!.sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'ping' });
  });
});

describe('PerchStore browser view', () => {
  function connected() {
    const { store, sockets } = build([mac]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mac']!.deliver({ type: 'authResult', ok: true });
    return { store, sockets };
  }

  it('stores browser sessions under the connection id despite a mismatched agent machineId', () => {
    const { store, sockets } = connected();
    // The agent self-reports a different machine id; routing must key on the connection id.
    sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'agent-mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' },
      ],
    });
    sockets['wss://mac']!.deliver({ type: 'browserSessions', sessions: [{ name: 'perch-a' }, { name: 'github' }] });
    expect(store.browserSessions['mac']).toEqual([{ name: 'perch-a' }, { name: 'github' }]);
    const ws = store.workspaces[0]!;
    expect(ws.machineId).toBe('mac');
    expect(store.browserSessionsFor(ws)).toEqual(['perch-a']);
  });

  it('flags browser support only once a browserSessions message arrives (even empty)', () => {
    const { store, sockets } = connected();
    expect(store.supportsBrowser('mac')).toBe(false);
    sockets['wss://mac']!.deliver({ type: 'browserSessions', sessions: [] });
    expect(store.supportsBrowser('mac')).toBe(true);
    expect(store.browserSessionsFor({ machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' })).toEqual([]);
  });

  it('startBrowser sends on the chosen connection only', () => {
    const { store, sockets } = build([mac, { id: 'mini', name: 'Mini', url: 'wss://mini', token: 't2' }]);
    store.start();
    sockets['wss://mac']!.open();
    sockets['wss://mini']!.open();
    store.startBrowser('mini', 'perch-z');
    expect(sockets['wss://mini']!.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'startBrowser', workspaceId: 'perch-z' });
    expect(sockets['wss://mac']!.sent.map((s) => JSON.parse(s)).some((m) => m.type === 'startBrowser')).toBe(false);
  });

  it('lists unattached sessions per connection', () => {
    const { store, sockets } = connected();
    sockets['wss://mac']!.deliver({
      type: 'workspaces',
      workspaces: [
        { machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' },
      ],
    });
    sockets['wss://mac']!.deliver({ type: 'browserSessions', sessions: [{ name: 'perch-a' }, { name: 'github' }] });
    expect(store.unattachedBrowserSessions()).toEqual([{ connectionId: 'mac', name: 'github' }]);
  });

  it('openBrowserView targets a session and closeBrowserView returns to the previous view', () => {
    const { store } = connected();
    store.openBrowserView('mac', 'github');
    expect(store.view).toBe('browserView');
    expect(store.browserTarget).toEqual({ connectionId: 'mac', session: 'github' });
    store.closeBrowserView();
    expect(store.view).toBe('list');
    expect(store.browserTarget).toBeNull();

    // From an open terminal, closing returns to the terminal.
    store.open({ machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude', createdAt: 0, lastActivityAt: 0, status: 'idle' });
    store.openBrowserView('mac', 'perch-a');
    store.closeBrowserView();
    expect(store.view).toBe('terminal');
  });


  it('openBrowserStream dials /browser?session= on the machine url and auths with its token', () => {
    const { store, sockets } = connected();
    store.openBrowserView('mac', 'perch-a');
    const stream = store.openBrowserStream({ onFrame: () => undefined, onUrl: () => undefined, onState: () => undefined });
    expect(stream).not.toBeNull();
    stream!.open();
    const s = sockets['wss://mac/browser?session=perch-a'];
    expect(s).toBeDefined();
    s!.open();
    expect(s!.sent).toEqual([JSON.stringify({ type: 'auth', token: 't' })]);
  });

  it('openBrowserStream strips a trailing slash from the machine url', () => {
    const macSlash = { id: 'mac', name: 'Mac', url: 'wss://mac:8442/', token: 't' };
    const { store, sockets } = build([macSlash]);
    store.start();
    store.openBrowserView('mac', 'perch-a');
    store.openBrowserStream({ onFrame: () => undefined, onUrl: () => undefined, onState: () => undefined })!.open();
    expect(sockets['wss://mac:8442/browser?session=perch-a']).toBeDefined();
  });

  it('openBrowserStream returns null without an open target', () => {
    const { store } = connected();
    expect(store.openBrowserStream({ onFrame: () => undefined, onUrl: () => undefined, onState: () => undefined })).toBeNull();
  });

  it('browserSessionClosed re-lists the target connection and leaves the view', () => {
    const { store, sockets } = connected();
    store.openBrowserView('mac', 'perch-a');
    sockets['wss://mac']!.sent.length = 0;
    store.browserSessionClosed();
    expect(sockets['wss://mac']!.sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'list' });
    expect(store.view).toBe('list');
    expect(store.browserTarget).toBeNull();
  });
});

const mini = { id: 'mini', name: 'Mini', url: 'wss://mini', token: 't' };

describe('PerchStore home view', () => {
  it('prompts to add a machine when none are configured, with no grace timer', () => {
    const timer = manualTimer();
    const { store } = build([], undefined, undefined, timer.startTimer);
    store.start();
    expect(store.homeView).toBe('add-machine');
    expect(timer.pending()).toBe(0);
  });

  it('arms the grace timer and shows connecting while no machine is online', () => {
    const timer = manualTimer();
    const { store } = build([mac], undefined, undefined, timer.startTimer);
    store.start();
    expect(store.homeView).toBe('connecting');
    expect(timer.pending()).toBe(1);
  });

  it('shows unreachable once the grace period elapses with nothing online', () => {
    const timer = manualTimer();
    const { store } = build([mac], undefined, undefined, timer.startTimer);
    store.start();
    timer.fireAll();
    expect(store.homeView).toBe('unreachable');
  });

  it('a machine coming online cancels grace and shows create when it reports no workspaces', () => {
    const timer = manualTimer();
    const { store } = build([mac], undefined, undefined, timer.startTimer);
    store.start();
    store.setStatus('mac', 'online');
    expect(timer.pending()).toBe(0);
    expect(store.homeView).toBe('create');
  });

  it('shows reconnecting after a machine drops, then falls through to unreachable after the long grace', () => {
    const timer = manualTimer();
    const { store } = build([mac], undefined, undefined, timer.startTimer);
    store.start();
    store.setStatus('mac', 'online');
    store.setStatus('mac', 'offline');
    // Known-reachable this session → a calm "Reconnecting…" within the (longer) grace window.
    expect(store.homeView).toBe('reconnecting');
    // …but a genuine extended outage must still surface the actionable "Can't reach" screen,
    // not an eternal spinner. The long reconnect grace elapsing does exactly that.
    timer.fireAll();
    expect(store.homeView).toBe('unreachable');
  });

  it('reconnectAll only reconnects enabled machines that are not online', () => {
    const timer = manualTimer();
    const { store, manager } = build([mac, mini], undefined, undefined, timer.startTimer);
    store.start();
    store.setStatus('mac', 'online');
    store.setStatus('mini', 'offline');
    const spy = vi.spyOn(manager, 'reconnect');
    store.reconnectAll();
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['mini']);
  });

  it('reconnectAll resets grace so the unreachable screen returns to connecting', () => {
    const timer = manualTimer();
    const { store, manager } = build([mac], undefined, undefined, timer.startTimer);
    store.start();
    timer.fireAll();
    expect(store.homeView).toBe('unreachable');
    store.setStatus('mac', 'offline'); // idling between backoff attempts → reconnectable
    const spy = vi.spyOn(manager, 'reconnect');
    store.reconnectAll();
    expect(spy).toHaveBeenCalledWith('mac');
    expect(store.homeView).toBe('connecting');
    expect(timer.pending()).toBe(1);
  });
});

describe('PerchStore connection logging', () => {
  function fakeLog() {
    const pushed: { machineId: string | null; kind: string; extra?: { code?: number; reason?: string } }[] = [];
    const connectionLog = {
      push(machineId: string | null, kind: string, extra?: { code?: number; reason?: string }) {
        pushed.push({ machineId, kind, extra });
        return { sess: 'x', seq: 0, t: 0, kind, online: true, vis: 'visible' };
      },
      pendingFor: () => [],
      markFlushed: () => undefined,
      snapshot: () => [],
    };
    const flushed: string[] = [];
    const flushLog = (m: { id: string }) => void flushed.push(m.id);
    return { connectionLog, flushLog, pushed, flushed };
  }

  it('records a connect event on connecting, and an online event that flushes the machine', () => {
    const lg = fakeLog();
    const { store } = build([mac], undefined, undefined, undefined, lg);
    store.start();
    store.setStatus('mac', 'connecting');
    store.setStatus('mac', 'online');
    expect(lg.pushed).toEqual([
      { machineId: 'mac', kind: 'connect', extra: undefined },
      { machineId: 'mac', kind: 'online', extra: undefined },
    ]);
    expect(lg.flushed).toEqual(['mac']);
  });

  it('records a close event carrying the diagnostic code and reason', () => {
    const lg = fakeLog();
    const { store } = build([mac], undefined, undefined, undefined, lg);
    store.start();
    store.setConnectionError('mac', { message: 'opened then dropped', code: 1006, at: 1 });
    expect(lg.pushed).toEqual([{ machineId: 'mac', kind: 'close', extra: { code: 1006, reason: 'opened then dropped' } }]);
  });

  it('logConnectivity records an app-global event and flushes online machines only', () => {
    const lg = fakeLog();
    const { store } = build([mac], undefined, undefined, undefined, lg);
    store.start();
    store.setStatus('mac', 'online');
    lg.flushed.length = 0; // ignore the flush from going online
    store.logConnectivity('hidden');
    expect(lg.pushed.at(-1)).toEqual({ machineId: null, kind: 'hidden', extra: undefined });
    expect(lg.flushed).toEqual(['mac']);
  });

  it('records a manual-reconnect event when the Reconnect button is used', () => {
    const lg = fakeLog();
    const { store } = build([mac], undefined, undefined, undefined, lg);
    store.start();
    store.reconnectMachine('mac');
    expect(lg.pushed).toContainEqual({ machineId: 'mac', kind: 'manual-reconnect', extra: undefined });
  });

  it('records an auto-reconnect event per machine reconnected by reconnectAll', () => {
    const lg = fakeLog();
    const { store } = build([mac], undefined, undefined, undefined, lg);
    store.start();
    store.setStatus('mac', 'offline'); // idle-offline → reconnectAll targets it
    store.reconnectAll();
    expect(lg.pushed).toContainEqual({ machineId: 'mac', kind: 'auto-reconnect', extra: undefined });
  });

  it('reconnectAll(true) records a manual-reconnect (the home Reconnect button)', () => {
    const lg = fakeLog();
    const { store } = build([mac], undefined, undefined, undefined, lg);
    store.start();
    store.setStatus('mac', 'offline');
    store.reconnectAll(true);
    expect(lg.pushed).toContainEqual({ machineId: 'mac', kind: 'manual-reconnect', extra: undefined });
  });
});

describe('PerchStore reconnect UX', () => {
  it('reconnectAll leaves a machine that is already connecting alone (no interrupt)', () => {
    const { store, manager } = build([mac]);
    store.start();
    store.setStatus('mac', 'connecting');
    const spy = vi.spyOn(manager, 'reconnect');
    store.reconnectAll();
    expect(spy).not.toHaveBeenCalled();
  });

  it('reconnectAll still reconnects an offline machine', () => {
    const { store, manager } = build([mac]);
    store.start();
    store.setStatus('mac', 'offline');
    const spy = vi.spyOn(manager, 'reconnect');
    store.reconnectAll();
    expect(spy).toHaveBeenCalledWith('mac');
  });

  it('shows the reconnecting home view while a machine that had connected is briefly down', () => {
    const { store } = build([mac]);
    store.start();
    store.setStatus('mac', 'online'); // now known-reachable this session
    store.setStatus('mac', 'offline'); // within the reconnect grace window
    expect(store.homeView).toBe('reconnecting');
  });

  it('shows unreachable (not reconnecting) for a machine that never connected', () => {
    const { store } = build([mac]);
    store.start();
    store.setStatus('mac', 'connecting');
    store.setStatus('mac', 'offline');
    store.graceElapsed = true;
    expect(store.homeView).toBe('unreachable');
  });
});
