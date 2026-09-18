import { describe, it, expect } from 'vitest';
import { MachineConnection, type ConnectionDiagnostic } from './machine-connection';
import type { CloseInfo, Socket } from './ports/socket';
import type { AgentMessage } from '@perch/contracts';

function fakeSocket() {
  const sent: string[] = [];
  let onMessage: (d: string) => void = () => undefined;
  let onOpen: () => void = () => undefined;
  let onClose: (info?: CloseInfo) => void = () => undefined;
  let onError: () => void = () => undefined;
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
    onError: (cb) => {
      onError = cb;
    },
  };
  return {
    socket,
    sent,
    isClosed: () => closed,
    open: () => onOpen(),
    deliver: (m: unknown) => onMessage(JSON.stringify(m)),
    fireClose: (info?: CloseInfo) => onClose(info),
    fireError: () => onError(),
  };
}

function harness() {
  const sockets: ReturnType<typeof fakeSocket>[] = [];
  const messages: AgentMessage[] = [];
  const statuses: string[] = [];
  const diagnostics: ConnectionDiagnostic[] = [];
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const conn = new MachineConnection({
    url: 'wss://m1.ts.net',
    token: 'secret',
    socketFactory: () => {
      const f = fakeSocket();
      sockets.push(f);
      return f.socket;
    },
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    onDiagnostic: (d) => diagnostics.push(d),
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
    startTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    now: () => 1000,
  });
  return { conn, sockets, messages, statuses, diagnostics, scheduled, timers };
}

describe('MachineConnection', () => {
  it('authenticates on open and reaches online', () => {
    const h = harness();
    h.conn.connect();
    expect(h.statuses).toContain('connecting');
    const s0 = h.sockets[0]!;
    s0.open();
    expect(JSON.parse(s0.sent[0]!)).toEqual({ type: 'auth', token: 'secret' });
    s0.deliver({ type: 'authResult', ok: true });
    expect(h.statuses).toContain('online');
  });

  it('forwards non-auth agent messages', () => {
    const h = harness();
    h.conn.connect();
    const s0 = h.sockets[0]!;
    s0.open();
    s0.deliver({ type: 'authResult', ok: true });
    s0.deliver({ type: 'workspaces', workspaces: [] });
    expect(h.messages).toContainEqual({ type: 'workspaces', workspaces: [] });
  });

  it('ignores malformed frames without throwing', () => {
    const h = harness();
    h.conn.connect();
    const s0 = h.sockets[0]!;
    s0.open();
    s0.deliver({ type: 'authResult', ok: true });
    expect(() => s0.deliver({ type: 'nonsense' })).not.toThrow();
    expect(h.messages).toEqual([]);
  });

  it('drops an outdated agent\'s legacy-shape workspace message without crashing', () => {
    // After the status flattening, an old agent still sends attention/blocked and no status.
    // The strict parser rejects it; handle() must swallow the throw and forward nothing
    // (the machine just shows no workspaces) rather than take the PWA down.
    const h = harness();
    h.conn.connect();
    const s0 = h.sockets[0]!;
    s0.open();
    s0.deliver({ type: 'authResult', ok: true });
    const legacy = {
      machineId: 'mac', id: 'perch-a', name: 'a', projectPath: '/a', command: 'claude',
      createdAt: 0, lastActivityAt: 0, attention: 'needs-feedback', blocked: false,
    };
    expect(() => s0.deliver({ type: 'workspaces', workspaces: [legacy] })).not.toThrow();
    expect(h.messages).toEqual([]);
  });

  it('schedules a backoff reconnect on close', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.sockets[0]!.fireClose();
    expect(h.statuses).toContain('offline');
    expect(h.scheduled[0]?.ms).toBe(250);
    h.scheduled[0]!.fn(); // run the reconnect
    expect(h.sockets).toHaveLength(2); // a new socket was created
  });

  it('does not reconnect after an auth rejection', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: false });
    expect(h.sockets[0]!.isClosed()).toBe(true);
    h.sockets[0]!.fireClose();
    expect(h.scheduled).toHaveLength(0);
  });

  it('sends client messages as JSON when connected', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.conn.send({ type: 'list' });
    expect(JSON.parse(h.sockets[0]!.sent.at(-1)!)).toEqual({ type: 'list' });
  });

  it('doubles backoff between the bounded retry attempts', () => {
    const h = harness();
    h.conn.connect(); // attempt 1
    h.sockets[0]!.fireClose({ code: 1006 });
    h.scheduled[0]!.fn(); // attempt 2
    h.sockets[1]!.fireClose({ code: 1006 });
    expect(h.scheduled.map((s) => s.ms)).toEqual([250, 500]);
  });

  it('gives up after the attempt budget is exhausted and stops churning', () => {
    const h = harness();
    h.conn.connect(); // attempt 1
    h.sockets[0]!.fireClose({ code: 1006 });
    h.scheduled[0]!.fn(); // attempt 2
    h.sockets[1]!.fireClose({ code: 1006 });
    h.scheduled[1]!.fn(); // attempt 3
    h.sockets[2]!.fireClose({ code: 1006 });
    h.scheduled[2]!.fn(); // attempt 4
    h.sockets[3]!.fireClose({ code: 1006 });

    // Budget (4) exhausted: no further reconnect is scheduled — the dead machine
    // goes quiet instead of hammering the network.
    expect(h.sockets).toHaveLength(4);
    expect(h.scheduled.map((s) => s.ms)).toEqual([250, 500, 1000]);
    expect(h.statuses.at(-1)).toBe('offline');
  });

  it('reconnect() resumes a machine that gave up, with a fresh budget', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.fireClose({ code: 1006 });
    h.scheduled[0]!.fn();
    h.sockets[1]!.fireClose({ code: 1006 });
    h.scheduled[1]!.fn();
    h.sockets[2]!.fireClose({ code: 1006 });
    h.scheduled[2]!.fn();
    h.sockets[3]!.fireClose({ code: 1006 }); // gave up
    expect(h.sockets).toHaveLength(4);

    h.conn.reconnect();
    expect(h.sockets).toHaveLength(5); // a fresh attempt was made
    h.sockets[4]!.fireClose({ code: 1006 });
    expect(h.scheduled.at(-1)!.ms).toBe(250); // backoff reset to base
  });

  it('never gives up on a machine that has connected before (rides through drops)', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true }); // now known-reachable

    // Drop and fail to reconnect far past the give-up budget (e.g. a WiFi↔cellular switch).
    for (let i = 0; i < 7; i += 1) {
      h.sockets[i]!.fireClose({ code: 1006 });
      expect(h.scheduled[i]).toBeDefined(); // a retry is always scheduled — never gives up
      h.scheduled[i]!.fn(); // run the reconnect → next socket
    }
    expect(h.sockets).toHaveLength(8); // kept reconnecting; a never-connected machine stops at 4
  });

  it('reaching online resets the attempt budget', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.fireClose({ code: 1006 }); // fail 1
    h.scheduled[0]!.fn();
    h.sockets[1]!.fireClose({ code: 1006 }); // fail 2
    h.scheduled[1]!.fn();
    h.sockets[2]!.open();
    h.sockets[2]!.deliver({ type: 'authResult', ok: true }); // online -> budget resets
    h.sockets[2]!.fireClose({ code: 1006 }); // fail 1 again, not 3

    // Still retrying (budget was reset), and backoff restarted at base.
    expect(h.scheduled.at(-1)!.ms).toBe(250);
  });

  it('close() suppresses reconnect after socket closes', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.conn.close();
    h.sockets[0]!.fireClose();
    expect(h.scheduled).toHaveLength(0);
  });

  it('reconnect() invalidates a pending backoff retry (no stacked connect chains)', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.sockets[0]!.fireClose({ code: 1006 }); // schedules a backoff retry
    expect(h.scheduled).toHaveLength(1);

    h.conn.reconnect(); // starts a fresh chain — the pending retry is now stale
    expect(h.sockets).toHaveLength(2);
    h.scheduled[0]!.fn(); // the stale retry fires late — must be a no-op
    expect(h.sockets).toHaveLength(2); // NOT 3: no orphaned second chain
  });

  it('close() invalidates a pending backoff retry (fully quiesces)', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.sockets[0]!.fireClose({ code: 1006 }); // schedules a backoff retry
    h.conn.close();
    h.scheduled[0]!.fn(); // the pending retry must not resurrect the connection
    expect(h.sockets).toHaveLength(1);
  });

  it('ignores a late open from a superseded socket (no auth on an orphan)', () => {
    const h = harness();
    h.conn.connect(); // socket 0
    h.conn.reconnect(); // socket 1 supersedes socket 0
    h.sockets[0]!.open(); // the orphaned socket opens late
    expect(h.sockets[0]!.sent).toHaveLength(0); // must not send auth
  });

  it('ignores messages from a superseded socket', () => {
    const h = harness();
    h.conn.connect(); // socket 0
    h.conn.reconnect(); // socket 1 supersedes socket 0
    h.sockets[0]!.deliver({ type: 'authResult', ok: true }); // orphan tries to authenticate
    expect(h.statuses).not.toContain('online'); // the orphan can't drive us online
  });

  it('labels a 1006 close before open as a likely block', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.fireClose({ code: 1006 });
    expect(h.diagnostics).toEqual([
      { message: 'connection failed (likely network or permission block — unreachable)', code: 1006, at: 1000 },
    ]);
  });

  it('labels a close after an error event as a likely block', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.fireError();
    h.sockets[0]!.fireClose();
    expect(h.diagnostics[0]!.message).toBe('connection failed (likely network or permission block — unreachable)');
  });

  it('distinguishes opened-then-dropped from never-opened', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.sockets[0]!.fireClose({ code: 1001, reason: 'going away' });
    expect(h.diagnostics[0]!.message).toBe('closed by agent — going away');
    expect(h.diagnostics[0]!.code).toBe(1001);
  });

  it('reports an auth rejection diagnostic', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: false });
    expect(h.diagnostics).toEqual([{ message: 'auth rejected', at: 1000 }]);
  });

  it('reaps a connection stalled in "connecting" after the connect timeout and retries', () => {
    const h = harness();
    h.conn.connect();
    expect(h.statuses).toEqual(['connecting']);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(10000);

    h.timers[0]!.fn(); // deadline fires; the socket never opened
    expect(h.sockets[0]!.isClosed()).toBe(true);

    h.sockets[0]!.fireClose({ code: 1006 }); // the browser emits close after close()
    expect(h.statuses).toContain('offline');
    expect(h.diagnostics.at(-1)!.message).toBe('connection timed out');
    expect(h.scheduled[0]?.ms).toBe(250); // a backoff reconnect is scheduled

    h.scheduled[0]!.fn();
    expect(h.sockets).toHaveLength(2); // it reconnected on its own
  });

  it('pings after reaching online', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.timers.at(-1)!.fn(); // heartbeat interval elapses → a ping is sent
    expect(JSON.parse(h.sockets[0]!.sent.at(-1)!)).toEqual({ type: 'ping' });
  });

  it('closes a half-open socket whose ping goes unanswered', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.timers.at(-1)!.fn(); // ping sent, pong deadline armed
    h.timers.at(-1)!.fn(); // deadline elapses with no reply → force close
    expect(h.sockets[0]!.isClosed()).toBe(true);
  });

  it('stays alive and keeps pinging when the ping is answered', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.timers.at(-1)!.fn(); // ping sent, pong deadline armed
    h.sockets[0]!.deliver({ type: 'pong' });
    const before = h.timers.length;
    h.timers.at(-1)!.fn(); // deadline elapses, but a reply arrived → healthy
    expect(h.sockets[0]!.isClosed()).toBe(false);
    expect(h.timers.length).toBe(before + 1); // the next ping is armed
  });

  it('does not forward pong replies to the message sink', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.sockets[0]!.deliver({ type: 'pong' });
    expect(h.messages).toEqual([]);
  });

  it('checkLiveness pings immediately and closes if unanswered', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    h.conn.checkLiveness();
    expect(JSON.parse(h.sockets[0]!.sent.at(-1)!)).toEqual({ type: 'ping' });
    h.timers.at(-1)!.fn(); // pong deadline elapses with no reply → force close
    expect(h.sockets[0]!.isClosed()).toBe(true);
  });

  it('checkLiveness is a no-op when offline', () => {
    const h = harness();
    h.conn.connect(); // connecting, never authed
    expect(() => h.conn.checkLiveness()).not.toThrow();
    expect(h.sockets[0]!.sent.some((s) => JSON.parse(s).type === 'ping')).toBe(false);
  });

  it('stops the heartbeat once the socket closes', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    h.sockets[0]!.deliver({ type: 'authResult', ok: true });
    const pingTimer = h.timers.at(-1)!;
    h.conn.close();
    pingTimer.fn(); // a racing heartbeat timer must not ping a closed socket
    expect(h.sockets[0]!.sent.some((s) => JSON.parse(s).type === 'ping')).toBe(false);
  });

  it('cancels the connect deadline once the socket opens, sparing a healthy connection', () => {
    const h = harness();
    h.conn.connect();
    h.sockets[0]!.open();
    expect(h.timers[0]!.cancelled).toBe(true);

    h.timers[0]!.fn(); // a late/cancelled deadline must not disturb an open socket
    expect(h.sockets[0]!.isClosed()).toBe(false);
  });
});
