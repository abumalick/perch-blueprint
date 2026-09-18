import { describe, it, expect } from 'vitest';
import { BrowserRelayHandler } from './browser-relay-handler';
import { ViewerRegistry } from './viewer-registry';
import type { RelaySocket } from '../ports/browser-stream-port';
import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';
import type { BrowserCommandPort } from '../ports/browser-command-port';

function fakeSocket() {
  const sent: string[] = [];
  let closed = false;
  let buffered = 0;
  const messageListeners: Array<(data: string) => void> = [];
  const closeListeners: Array<() => void> = [];
  const socket: RelaySocket = {
    send: (data) => sent.push(data),
    bufferedAmount: () => buffered,
    onMessage: (l) => messageListeners.push(l),
    onClose: (l) => closeListeners.push(l),
    close: () => {
      closed = true;
    },
  };
  return {
    socket,
    sent,
    parsed: () => sent.map((s) => JSON.parse(s) as Record<string, unknown>),
    isClosed: () => closed,
    setBuffered: (n: number) => {
      buffered = n;
    },
    emit: (message: unknown) => {
      const raw = typeof message === 'string' ? message : JSON.stringify(message);
      for (const l of messageListeners) l(raw);
    },
    triggerClose: () => {
      for (const l of closeListeners) l();
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function stubCommands(overrides: Partial<BrowserCommandPort> = {}): BrowserCommandPort {
  return {
    start: async () => undefined,
    navigate: async () => undefined,
    back: async () => undefined,
    forward: async () => undefined,
    stop: async () => undefined,
    setViewport: async () => undefined,
    ...overrides,
  };
}

function setup(overrides: Partial<ConstructorParameters<typeof BrowserRelayHandler>[0]> = {}) {
  const client = fakeSocket();
  const upstream = fakeSocket();
  const dialed: number[] = [];
  const navigated: Array<{ session: string; url: string }> = [];
  const commanded: Array<{ command: string; session: string; args?: unknown[] }> = [];
  const discovery: BrowserDiscoveryPort = {
    listSessions: async () => [{ name: 'ws1', streamPort: 9300 }],
  };
  const commands: BrowserCommandPort = {
    start: async () => undefined,
    navigate: async (session, url) => {
      navigated.push({ session, url });
    },
    back: async (session) => {
      commanded.push({ command: 'back', session });
    },
    forward: async (session) => {
      commanded.push({ command: 'forward', session });
    },
    stop: async (session) => {
      commanded.push({ command: 'stop', session });
    },
    setViewport: async (session, width, height) => {
      commanded.push({ command: 'setViewport', session, args: [width, height] });
    },
  };
  new BrowserRelayHandler({
    client: client.socket,
    sessionName: 'ws1',
    token: 'secret',
    discovery,
    commands,
    connectUpstream: async (port) => {
      dialed.push(port);
      return upstream.socket;
    },
    registry: new ViewerRegistry(),
    ...overrides,
  });
  return { client, upstream, dialed, navigated, commanded };
}

async function authedSetup(overrides: Parameters<typeof setup>[0] = {}) {
  const f = setup(overrides);
  f.client.emit({ type: 'auth', token: 'secret' });
  await tick();
  f.client.sent.length = 0;
  return f;
}

describe('BrowserRelayHandler auth handshake', () => {
  it('answers authResult ok on a matching token', async () => {
    const { client } = setup();
    client.emit({ type: 'auth', token: 'secret' });
    await tick();
    expect(client.parsed()[0]).toEqual({ type: 'authResult', ok: true });
  });

  it('answers authResult not-ok and closes on a bad token, without dialing upstream', async () => {
    const { client, dialed } = setup();
    client.emit({ type: 'auth', token: 'wrong' });
    await tick();
    expect(client.parsed()).toEqual([{ type: 'authResult', ok: false }]);
    expect(client.isClosed()).toBe(true);
    expect(dialed).toEqual([]);
  });

  it('closes on a non-auth message before auth, without dialing upstream', async () => {
    const { client, dialed, upstream } = setup();
    client.emit({ type: 'ping' });
    await tick();
    expect(client.sent).toEqual([]);
    expect(client.isClosed()).toBe(true);
    expect(dialed).toEqual([]);
    expect(upstream.sent).toEqual([]);
  });

  it('dials the discovered stream port only after a successful auth', async () => {
    const { client, dialed } = setup();
    expect(dialed).toEqual([]);
    client.emit({ type: 'auth', token: 'secret' });
    await tick();
    expect(dialed).toEqual([9300]);
  });

  it('sends ended not-found and closes when the session is not in discovery', async () => {
    const { client, dialed } = setup({ sessionName: 'missing' });
    client.emit({ type: 'auth', token: 'secret' });
    await tick();
    expect(client.parsed()).toEqual([
      { type: 'authResult', ok: true },
      { type: 'ended', reason: 'not-found' },
    ]);
    expect(client.isClosed()).toBe(true);
    expect(dialed).toEqual([]);
  });

  it('sends ended error and closes when the upstream dial fails', async () => {
    const { client } = setup({
      connectUpstream: async () => {
        throw new Error('refused');
      },
    });
    client.emit({ type: 'auth', token: 'secret' });
    await tick();
    expect(client.parsed()).toEqual([
      { type: 'authResult', ok: true },
      { type: 'ended', reason: 'error' },
    ]);
    expect(client.isClosed()).toBe(true);
  });
});

describe('BrowserRelayHandler client → upstream', () => {
  it('forwards validated input_* messages verbatim upstream', async () => {
    const { client, upstream } = await authedSetup();
    const mouse = '{"type":"input_mouse","eventType":"mousePressed","x":10,"y":20,"button":"left","clickCount":1}';
    const keyboard = '{"type":"input_keyboard","eventType":"keyDown","key":"a","text":"a"}';
    const touch = '{"type":"input_touch","eventType":"touchStart","touchPoints":[{"x":1,"y":2}]}';
    client.emit(mouse);
    client.emit(keyboard);
    client.emit(touch);
    expect(upstream.sent).toEqual([mouse, keyboard, touch]);
  });

  it('drops a malformed client message silently', async () => {
    const { client, upstream } = await authedSetup();
    client.emit('not json {');
    client.emit({ type: 'no-such-type' });
    expect(client.sent).toEqual([]);
    expect(upstream.sent).toEqual([]);
    expect(client.isClosed()).toBe(false);
  });

  it('runs navigate through the command port and never forwards it upstream', async () => {
    const { client, upstream, navigated } = await authedSetup();
    client.emit({ type: 'navigate', url: 'https://example.com' });
    await tick();
    expect(navigated).toEqual([{ session: 'ws1', url: 'https://example.com' }]);
    expect(upstream.sent).toEqual([]);
  });

  it('survives a rejected navigate without crashing or forwarding', async () => {
    const { client, upstream } = await authedSetup({
      commands: stubCommands({
        navigate: async () => {
          throw new Error('non-http url');
        },
      }),
    });
    client.emit({ type: 'navigate', url: 'file:///etc/passwd' });
    await tick();
    expect(upstream.sent).toEqual([]);
    expect(client.isClosed()).toBe(false);
  });

  it.each([
    [{ type: 'back' }, { command: 'back', session: 'ws1' }],
    [{ type: 'forward' }, { command: 'forward', session: 'ws1' }],
    [{ type: 'closeSession' }, { command: 'stop', session: 'ws1' }],
    [
      { type: 'setViewport', width: 390, height: 844 },
      { command: 'setViewport', session: 'ws1', args: [390, 844] },
    ],
  ])('runs %o through the command port and never forwards it upstream', async (message, expected) => {
    const { client, upstream, commanded } = await authedSetup();
    client.emit(message);
    await tick();
    expect(commanded).toEqual([expected]);
    expect(upstream.sent).toEqual([]);
  });

  it.each(['back', 'forward', 'setViewport', 'closeSession'])(
    'survives a rejected %s command without crashing',
    async (type) => {
      const failing = async () => {
        throw new Error('cli failed');
      };
      const { client } = await authedSetup({
        commands: stubCommands({ back: failing, forward: failing, stop: failing, setViewport: failing }),
      });
      client.emit(type === 'setViewport' ? { type, width: 1, height: 1 } : { type });
      await tick();
      expect(client.sent).toEqual([]);
      expect(client.isClosed()).toBe(false);
    },
  );

  it('answers ping with pong locally', async () => {
    const { client, upstream } = await authedSetup();
    client.emit({ type: 'ping' });
    await tick();
    expect(client.parsed()).toEqual([{ type: 'pong' }]);
    expect(upstream.sent).toEqual([]);
  });
});

describe('BrowserRelayHandler upstream → client', () => {
  it('relays frame, tabs, url and status verbatim and drops other upstream types', async () => {
    const { client, upstream } = await authedSetup();
    const frame = '{"type":"frame","data":"aaaa","metadata":{"deviceWidth":390,"deviceHeight":844,"extra":1}}';
    const tabs = '{"type":"tabs","tabs":[]}';
    const url = '{"type":"url","url":"https://a.example"}';
    const status = '{"type":"status","detail":"ok"}';
    upstream.emit(frame);
    upstream.emit(tabs);
    upstream.emit(url);
    upstream.emit(status);
    upstream.emit({ type: 'console', text: 'noise' });
    upstream.emit({ type: 'pong' });
    upstream.emit('garbage {');
    expect(client.sent).toEqual([frame, tabs, url, status]);
  });

  it('replaces (not queues) frames while the client is backpressured, flushing the latest on a later send', async () => {
    const { client, upstream } = await authedSetup();
    client.setBuffered(300_000);
    const frame1 = '{"type":"frame","data":"one","metadata":{"deviceWidth":1,"deviceHeight":1}}';
    const frame2 = '{"type":"frame","data":"two","metadata":{"deviceWidth":1,"deviceHeight":1}}';
    upstream.emit(frame1);
    upstream.emit(frame2);
    expect(client.sent).toEqual([]);
    client.setBuffered(0);
    const url = '{"type":"url","url":"https://a.example"}';
    upstream.emit(url);
    expect(client.sent).toEqual([frame2, url]);
  });

  it('sends a fresh frame directly once backpressure clears, dropping the stale pending one', async () => {
    const { client, upstream } = await authedSetup();
    client.setBuffered(300_000);
    const stale = '{"type":"frame","data":"stale","metadata":{"deviceWidth":1,"deviceHeight":1}}';
    upstream.emit(stale);
    client.setBuffered(0);
    const fresh = '{"type":"frame","data":"fresh","metadata":{"deviceWidth":1,"deviceHeight":1}}';
    upstream.emit(fresh);
    expect(client.sent).toEqual([fresh]);
  });

  it('always relays non-frame messages, even while backpressured', async () => {
    const { client, upstream } = await authedSetup();
    client.setBuffered(300_000);
    const url = '{"type":"url","url":"https://a.example"}';
    upstream.emit(url);
    expect(client.sent).toEqual([url]);
  });
});

describe('BrowserRelayHandler lifecycle', () => {
  it('sends ended closed and closes the client when the upstream closes', async () => {
    const { client, upstream } = await authedSetup();
    upstream.triggerClose();
    expect(client.parsed()).toEqual([{ type: 'ended', reason: 'closed' }]);
    expect(client.isClosed()).toBe(true);
  });

  it('closes the upstream when the client disconnects, without sending ended', async () => {
    const { client, upstream } = await authedSetup();
    client.triggerClose();
    expect(upstream.isClosed()).toBe(true);
    upstream.triggerClose();
    expect(client.sent).toEqual([]);
  });

  it('closes an upstream that connects after the client already disconnected', async () => {
    const client = fakeSocket();
    const upstream = fakeSocket();
    let release: () => void = () => undefined;
    new BrowserRelayHandler({
      client: client.socket,
      sessionName: 'ws1',
      token: 'secret',
      discovery: { listSessions: async () => [{ name: 'ws1', streamPort: 9300 }] },
      commands: stubCommands(),
      connectUpstream: () =>
        new Promise((resolve) => {
          release = () => resolve(upstream.socket);
        }),
      registry: new ViewerRegistry(),
    });
    client.emit({ type: 'auth', token: 'secret' });
    await tick();
    client.triggerClose();
    release();
    await tick();
    expect(upstream.isClosed()).toBe(true);
  });
});

describe('BrowserRelayHandler single viewer', () => {
  it('kicks the prior viewer of the same session with opened-elsewhere; the new one streams fine', async () => {
    const registry = new ViewerRegistry();
    const first = await authedSetup({ registry });
    const second = await authedSetup({ registry });

    expect(first.client.parsed()).toEqual([{ type: 'ended', reason: 'opened-elsewhere' }]);
    expect(first.client.isClosed()).toBe(true);
    expect(first.upstream.isClosed()).toBe(true);

    const frame = '{"type":"frame","data":"aaaa","metadata":{"deviceWidth":390,"deviceHeight":844}}';
    second.upstream.emit(frame);
    expect(second.client.sent).toEqual([frame]);
    expect(second.client.isClosed()).toBe(false);
  });

  it('lets viewers of different sessions coexist', async () => {
    const registry = new ViewerRegistry();
    const a = await authedSetup({ registry });
    const b = await authedSetup({
      registry,
      sessionName: 'ws2',
      discovery: { listSessions: async () => [{ name: 'ws2', streamPort: 9301 }] },
    });

    expect(a.client.sent).toEqual([]);
    expect(a.client.isClosed()).toBe(false);
    expect(b.client.isClosed()).toBe(false);
  });

  it('releases the session on disconnect so a later viewer is not kicked by a stale holder', async () => {
    const registry = new ViewerRegistry();
    const first = await authedSetup({ registry });
    first.client.triggerClose();
    const second = await authedSetup({ registry });
    expect(second.client.isClosed()).toBe(false);
    expect(second.client.sent).toEqual([]);
  });
});
