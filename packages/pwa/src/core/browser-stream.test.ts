import { describe, it, expect } from 'vitest';
import type { BrowserEndedReason } from '@perch/contracts';
import { BrowserStream, type BrowserStreamState } from './browser-stream';
import type { Socket } from './ports/socket';

function fakeSocket() {
  const sent: string[] = [];
  let onMessage: (d: string) => void = () => undefined;
  let onOpen: () => void = () => undefined;
  let onClose: () => void = () => undefined;
  let closed = false;
  const socket: Socket = {
    send: (d) => sent.push(d),
    close: () => {
      closed = true;
    },
    onMessage: (cb) => {
      onMessage = cb;
    },
    onOpen: (cb) => {
      onOpen = cb;
    },
    onClose: (cb) => {
      onClose = cb;
    },
  };
  return {
    socket,
    sent,
    isClosed: () => closed,
    open: () => onOpen(),
    deliver: (m: unknown) => onMessage(JSON.stringify(m)),
    fireClose: () => onClose(),
  };
}

// Manual clock: records both cancellable (startTimer) and fire-and-forget (schedule)
// timers so tests drive the heartbeat and reconnect backoff deterministically. Timers are
// fired by their delay, which are all distinct here (interval 15000, reply 10000, backoff
// 250/500/…), so `fireDelay` unambiguously targets one.
function fakeClock() {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      timers.push({ fn, ms, live: true });
    },
    startTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    pendingDelays: () => timers.filter((t) => t.live).map((t) => t.ms),
    fireDelay: (ms: number) => {
      const t = timers.find((x) => x.live && x.ms === ms);
      if (!t)
        throw new Error(`no live timer @${ms}; live: [${timers.filter((x) => x.live).map((x) => x.ms)}]`);
      t.live = false;
      t.fn();
    },
  };
}

function harness() {
  const sockets: ReturnType<typeof fakeSocket>[] = [];
  const frames: Array<{ data: string; meta: { deviceWidth: number; deviceHeight: number } }> = [];
  const urls: string[] = [];
  const states: BrowserStreamState[] = [];
  const reasons: BrowserEndedReason[] = [];
  const clock = fakeClock();
  const stream = new BrowserStream({
    url: 'wss://m1.ts.net/browser?session=ws1',
    token: 'secret',
    socketFactory: () => {
      const f = fakeSocket();
      sockets.push(f);
      return f.socket;
    },
    onFrame: (data, meta) => frames.push({ data, meta }),
    onUrl: (u) => urls.push(u),
    onState: (s) => states.push(s),
    endedReason: (r) => reasons.push(r),
    schedule: clock.schedule,
    startTimer: clock.startTimer,
  });
  return { stream, sockets, frames, urls, states, reasons, clock };
}

function online(h: ReturnType<typeof harness>) {
  h.stream.open();
  const s = h.sockets[h.sockets.length - 1]!;
  s.open();
  s.deliver({ type: 'authResult', ok: true });
  return s;
}

const PING = JSON.stringify({ type: 'ping' });
const AUTH = JSON.stringify({ type: 'auth', token: 'secret' });
const NAV = JSON.stringify({ type: 'navigate', url: 'https://x.example' });
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const BASE_BACKOFF_MS = 250;

describe('BrowserStream', () => {
  it('reports connecting on open, auths first, and goes online on authResult ok', () => {
    const h = harness();
    h.stream.open();
    expect(h.states).toEqual(['connecting']);
    const s = h.sockets[0]!;
    s.open();
    expect(s.sent).toEqual([AUTH]);
    s.deliver({ type: 'authResult', ok: true });
    expect(h.states).toEqual(['connecting', 'online']);
  });

  it('dispatches frames with their passthrough metadata', () => {
    const h = harness();
    const s = online(h);
    s.deliver({
      type: 'frame',
      data: 'anNwZWc=',
      metadata: { deviceWidth: 800, deviceHeight: 600, quality: 60 },
    });
    expect(h.frames).toEqual([
      { data: 'anNwZWc=', meta: { deviceWidth: 800, deviceHeight: 600, quality: 60 } },
    ]);
  });

  it('dispatches url messages', () => {
    const h = harness();
    const s = online(h);
    s.deliver({ type: 'url', url: 'https://example.com' });
    expect(h.urls).toEqual(['https://example.com']);
  });

  it('serializes send() while online', () => {
    const h = harness();
    const s = online(h);
    h.stream.send({ type: 'navigate', url: 'https://x.example' });
    expect(s.sent).toContain(NAV);
  });

  // Transient: a bare socket drop (idle proxy timeout, network blip) is not a terminal
  // end — the viewer reconnects with backoff instead of stranding on Retry.
  it('reconnects (not ended) when the socket closes with no agent reason', () => {
    const h = harness();
    const s = online(h);
    s.fireClose();
    // No terminal overlay: stays online visually until the reconnect attempt.
    expect(h.reasons).toEqual([]);
    expect(h.states).toEqual(['connecting', 'online']);
    // A reconnect is scheduled at the base backoff; firing it dials a second socket.
    expect(h.clock.pendingDelays()).toContain(BASE_BACKOFF_MS);
    h.clock.fireDelay(BASE_BACKOFF_MS);
    expect(h.sockets.length).toBe(2);
    const s2 = h.sockets[1]!;
    s2.open();
    s2.deliver({ type: 'authResult', ok: true });
    expect(h.states).toEqual(['connecting', 'online', 'connecting', 'online']);
  });

  it('reconnects on a transient ended{closed} (upstream stream dropped)', () => {
    const h = harness();
    const s = online(h);
    s.deliver({ type: 'ended', reason: 'closed' });
    s.fireClose(); // the relay closes the client socket after ended
    expect(h.reasons).toEqual([]);
    h.clock.fireDelay(BASE_BACKOFF_MS);
    expect(h.sockets.length).toBe(2);
  });

  it('reconnects on a transient ended{error} (relay dial hiccup)', () => {
    const h = harness();
    const s = online(h);
    s.deliver({ type: 'ended', reason: 'error' });
    s.fireClose();
    expect(h.reasons).toEqual([]);
    h.clock.fireDelay(BASE_BACKOFF_MS);
    expect(h.sockets.length).toBe(2);
  });

  it('ends terminally on not-found and does not reconnect', () => {
    const h = harness();
    const s = online(h);
    s.deliver({ type: 'ended', reason: 'not-found' });
    s.fireClose(); // trailing close is ignored, not a reconnect trigger
    expect(h.states).toEqual(['connecting', 'online', 'ended']);
    expect(h.reasons).toEqual(['not-found']);
    expect(h.clock.pendingDelays()).not.toContain(BASE_BACKOFF_MS);
    expect(h.sockets.length).toBe(1);
  });

  it('ends terminally on opened-elsewhere and does not reconnect', () => {
    const h = harness();
    const s = online(h);
    s.deliver({ type: 'ended', reason: 'opened-elsewhere' });
    s.fireClose();
    expect(h.states).toEqual(['connecting', 'online', 'ended']);
    expect(h.reasons).toEqual(['opened-elsewhere']);
    expect(h.sockets.length).toBe(1);
  });

  it('ends terminally on authResult ok:false, closes the socket, and does not reconnect', () => {
    const h = harness();
    h.stream.open();
    const s = h.sockets[0]!;
    s.open();
    s.deliver({ type: 'authResult', ok: false });
    expect(h.states).toEqual(['connecting', 'ended']);
    expect(h.reasons).toEqual(['error']);
    expect(s.isClosed()).toBe(true);
    s.fireClose();
    expect(h.sockets.length).toBe(1);
  });

  // Heartbeat: while online, an idle interval elapses and we ping to keep the socket warm.
  it('pings after the heartbeat interval while online', () => {
    const h = harness();
    const s = online(h);
    expect(s.sent).not.toContain(PING);
    h.clock.fireDelay(HEARTBEAT_INTERVAL_MS);
    expect(s.sent).toContain(PING);
  });

  it('closes and reconnects when a ping goes unanswered', () => {
    const h = harness();
    const s = online(h);
    h.clock.fireDelay(HEARTBEAT_INTERVAL_MS); // ping sent, reply deadline armed
    h.clock.fireDelay(HEARTBEAT_TIMEOUT_MS); // deadline with no inbound → we close the socket
    expect(s.isClosed()).toBe(true);
    s.fireClose(); // the close event our close() triggers
    h.clock.fireDelay(BASE_BACKOFF_MS);
    expect(h.sockets.length).toBe(2);
  });

  it('treats any inbound message as proof of life for the heartbeat', () => {
    const h = harness();
    const s = online(h);
    h.clock.fireDelay(HEARTBEAT_INTERVAL_MS); // ping sent, reply deadline armed
    s.deliver({ type: 'frame', data: 'x', metadata: { deviceWidth: 1, deviceHeight: 1 } });
    h.clock.fireDelay(HEARTBEAT_TIMEOUT_MS); // deadline, but a frame arrived → survive
    expect(s.isClosed()).toBe(false);
    // And the interval re-arms rather than terminating.
    expect(h.clock.pendingDelays()).toContain(HEARTBEAT_INTERVAL_MS);
  });

  it('backs off exponentially and resets after a successful reconnect', () => {
    const h = harness();
    const s1 = online(h);
    s1.fireClose();
    h.clock.fireDelay(250); // first retry
    const s2 = h.sockets[1]!;
    s2.open();
    s2.fireClose(); // fails again before auth
    h.clock.fireDelay(500); // backoff doubled
    const s3 = h.sockets[2]!;
    s3.open();
    s3.deliver({ type: 'authResult', ok: true }); // success resets backoff
    s3.fireClose();
    expect(h.clock.pendingDelays()).toContain(250); // back to base
  });

  it('close() cancels a pending reconnect', () => {
    const h = harness();
    const s = online(h);
    s.fireClose(); // schedules a reconnect
    h.stream.close();
    h.clock.fireDelay(BASE_BACKOFF_MS); // the scheduled attempt must be a no-op now
    expect(h.sockets.length).toBe(1);
  });

  it('ignores send() after a terminal end', () => {
    const h = harness();
    const s = online(h);
    s.deliver({ type: 'ended', reason: 'not-found' });
    const before = s.sent.length;
    h.stream.send({ type: 'navigate', url: 'https://x.example' });
    expect(s.sent.length).toBe(before);
  });

  it('close() closes the socket without firing ended', () => {
    const h = harness();
    const s = online(h);
    h.stream.close();
    expect(s.isClosed()).toBe(true);
    s.fireClose();
    expect(h.states).toEqual(['connecting', 'online']);
    expect(h.reasons).toEqual([]);
    // And the stream is inert afterwards.
    h.stream.send({ type: 'navigate', url: 'https://x.example' });
    expect(s.sent).toEqual([AUTH]);
  });

  it('a fresh open() after a terminal end starts a new lifecycle', () => {
    const h = harness();
    const first = online(h);
    first.deliver({ type: 'ended', reason: 'not-found' });
    h.stream.open();
    expect(h.sockets.length).toBe(2);
    const second = h.sockets[1]!;
    second.open();
    second.deliver({ type: 'authResult', ok: true });
    h.stream.send({ type: 'navigate', url: 'https://x.example' });
    expect(second.sent).toEqual([AUTH, NAV]);
    expect(h.states).toEqual(['connecting', 'online', 'ended', 'connecting', 'online']);
  });

  it('drops unparseable and irrelevant messages silently', () => {
    const h = harness();
    const s = online(h);
    s.deliver({ type: 'nonsense' });
    s.deliver({ type: 'pong' });
    s.deliver({ type: 'tabs', tabs: [] });
    s.deliver({ type: 'status', ok: true });
    expect(h.frames).toEqual([]);
    expect(h.urls).toEqual([]);
    expect(h.states).toEqual(['connecting', 'online']);
  });

  // The upstream replays `tabs` (not `url`) on connect, so the active tab's url is the
  // only way a reattaching viewer learns the current address.
  it('derives the url from the active tab in a tabs message', () => {
    const h = harness();
    const s = online(h);
    s.deliver({
      type: 'tabs',
      tabs: [
        { url: 'https://a.example/', active: false },
        { url: 'https://b.example/page', active: true },
      ],
    });
    expect(h.urls).toEqual(['https://b.example/page']);
  });

  it('ignores tabs messages without an active tab url', () => {
    const h = harness();
    const s = online(h);
    s.deliver({ type: 'tabs', tabs: [{ active: false }] });
    s.deliver({ type: 'tabs', tabs: [{ active: true }] });
    expect(h.urls).toEqual([]);
  });
});
