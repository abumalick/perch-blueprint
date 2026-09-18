import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { browserSocketFactory } from './browser-socket';

// A socket can linger in CONNECTING (iOS WebKit stalls the tailnet path). The real
// WebSocket.send throws InvalidStateError before OPEN, so this fake does too.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | undefined;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError: still CONNECTING');
    this.sent.push(data);
  }
  close(): void {}
  addEventListener(): void {}
}

let realWebSocket: unknown;

beforeEach(() => {
  realWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  FakeWebSocket.last = undefined;
});

afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket = realWebSocket;
});

describe('browserSocketFactory', () => {
  it('drops sends while the socket is still CONNECTING instead of throwing', () => {
    const socket = browserSocketFactory('ws://x');
    expect(() => socket.send('hello')).not.toThrow();
    expect(FakeWebSocket.last?.sent).toEqual([]);
  });

  it('forwards sends once the socket is OPEN', () => {
    const socket = browserSocketFactory('ws://x');
    const ws = FakeWebSocket.last!;
    ws.readyState = FakeWebSocket.OPEN;
    socket.send('hello');
    expect(ws.sent).toEqual(['hello']);
  });
});
