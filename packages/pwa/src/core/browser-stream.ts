import {
  parseBrowserAgentMessage,
  type BrowserAgentMessage,
  type BrowserClientMessage,
  type BrowserEndedReason,
} from '@perch/contracts';
import type { Socket, SocketFactory } from './ports/socket';

export type BrowserStreamState = 'connecting' | 'online' | 'ended';

type FrameMetadata = Extract<BrowserAgentMessage, { type: 'frame' }>['metadata'];

export interface BrowserStreamDeps {
  url: string;
  token: string;
  socketFactory: SocketFactory;
  onFrame: (dataB64: string, meta: FrameMetadata) => void;
  onUrl: (url: string) => void;
  onState: (state: BrowserStreamState) => void;
  endedReason?: (reason: BrowserEndedReason) => void;
  // Reconnect backoff (fire-and-forget) and the cancellable heartbeat timer, injected so
  // tests drive them deterministically. Both default to setTimeout.
  schedule?: (fn: () => void, ms: number) => void;
  startTimer?: (fn: () => void, ms: number) => () => void;
}

// Reasons that mean a manual retry is the only sensible recovery, so the viewer stops and
// shows the ended overlay instead of reconnecting: the session is gone (`not-found`) or
// another device took it over (`opened-elsewhere`, where reconnecting would fight forever).
// Everything else — a bare socket drop, or the relay's transient `closed`/`error` — is a
// blip we reconnect through.
const TERMINAL_REASONS = new Set<BrowserEndedReason>(['not-found', 'opened-elsewhere']);

const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 10_000;
// Liveness heartbeat, same shape as MachineConnection: the `/browser` socket only carries
// traffic when the page repaints, so an idle-but-alive session (agent working on a static
// page) would otherwise let an idle proxy on the phone→tailnet path close the connection.
// Pinging keeps it warm; a missed reply reaps a half-open link so the reconnect takes over.
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

// Viewer-scoped browser stream connection. It self-heals through transient drops (heartbeat
// + backoff reconnect, like MachineConnection) and only surfaces `ended` for terminal
// reasons; `close()` (leaving the view) makes it inert until a fresh `open()`.
export class BrowserStream {
  private socket: Socket | null = null;
  // Terminal: a reason-based end or a user `close()`. Blocks send() and reconnect until the
  // next explicit open().
  private terminal = false;
  private backoff = BASE_BACKOFF_MS;
  // Canceller for the current heartbeat timer (idle interval, then post-ping reply deadline),
  // and whether any inbound message has arrived since the last ping (proof of life).
  private heartbeatCancel: (() => void) | null = null;
  private pongSeen = false;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly startTimer: (fn: () => void, ms: number) => () => void;

  constructor(private readonly deps: BrowserStreamDeps) {
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.startTimer =
      deps.startTimer ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
  }

  open(): void {
    this.stopHeartbeat();
    // Drop any previous socket first so its close event can't trigger a reentrant reconnect.
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.terminal = false;
    this.deps.onState('connecting');
    const socket = this.deps.socketFactory(this.deps.url);
    this.socket = socket;
    socket.onOpen(() => {
      socket.send(
        JSON.stringify({ type: 'auth', token: this.deps.token } satisfies BrowserClientMessage),
      );
    });
    socket.onMessage((data) => {
      if (this.socket !== socket) return;
      // Any inbound frame is proof the link is alive, satisfying a pending heartbeat —
      // recorded before parsing so even a frame we can't parse still counts.
      this.pongSeen = true;
      this.handle(socket, data);
    });
    socket.onClose(() => {
      if (this.socket !== socket) return;
      this.stopHeartbeat();
      this.socket = null;
      // A terminal end already tore this down deliberately; anything else is a transient
      // drop we reconnect through.
      if (this.terminal) return;
      this.scheduleReconnect();
    });
  }

  send(message: BrowserClientMessage): void {
    if (this.terminal || !this.socket) return;
    this.socket.send(JSON.stringify(message));
  }

  // Deliberate teardown (leaving the view): closes without reporting `ended` and cancels any
  // pending reconnect.
  close(): void {
    this.terminal = true;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private scheduleReconnect(): void {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.schedule(() => {
      if (!this.terminal) this.open();
    }, delay);
  }

  private handle(socket: Socket, data: string): void {
    let message: BrowserAgentMessage;
    try {
      message = parseBrowserAgentMessage(JSON.parse(data));
    } catch {
      return;
    }
    switch (message.type) {
      case 'authResult':
        if (message.ok) {
          this.backoff = BASE_BACKOFF_MS;
          this.startHeartbeat(socket);
          this.deps.onState('online');
        } else {
          // Auth failure is terminal: reconnecting would loop against the same bad token.
          this.endTerminal('error');
        }
        return;
      case 'frame':
        this.deps.onFrame(message.data, message.metadata);
        return;
      case 'url':
        this.deps.onUrl(message.url);
        return;
      case 'tabs': {
        // The upstream replays `tabs` (never `url`) when a viewer (re)connects, so the
        // active tab is the only source of the current address on attach.
        const url = activeTabUrl(message);
        if (url) this.deps.onUrl(url);
        return;
      }
      case 'ended':
        if (TERMINAL_REASONS.has(message.reason)) {
          this.endTerminal(message.reason);
        }
        // A transient `closed`/`error` is left to the trailing socket close, which the
        // onClose handler reconnects through.
        return;
      default:
        // pong / status: nothing consumes them in v1 (pong's only job is the heartbeat).
        return;
    }
  }

  private endTerminal(reason: BrowserEndedReason): void {
    if (this.terminal) return;
    this.terminal = true;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.deps.endedReason?.(reason);
    this.deps.onState('ended');
  }

  private startHeartbeat(socket: Socket): void {
    this.stopHeartbeat();
    this.armPing(socket);
  }

  private armPing(socket: Socket): void {
    this.heartbeatCancel = this.startTimer(() => {
      if (this.socket !== socket) return;
      this.sendPingAndAwait(socket);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private sendPingAndAwait(socket: Socket): void {
    this.pongSeen = false;
    socket.send(JSON.stringify({ type: 'ping' } satisfies BrowserClientMessage));
    this.heartbeatCancel = this.startTimer(() => {
      if (this.socket !== socket) return;
      if (this.pongSeen) {
        this.armPing(socket);
      } else {
        // Unanswered ping: the link is dead. Closing it routes through `onClose`, which
        // schedules the reconnect.
        socket.close();
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private stopHeartbeat(): void {
    this.heartbeatCancel?.();
    this.heartbeatCancel = null;
  }
}

// The tabs payload is upstream-shaped (passthrough in the schema): extract the active
// tab's url defensively rather than trusting the whole structure.
function activeTabUrl(message: object): string | null {
  const tabs = (message as { tabs?: unknown }).tabs;
  if (!Array.isArray(tabs)) return null;
  for (const tab of tabs) {
    if (tab && typeof tab === 'object' && (tab as { active?: unknown }).active === true) {
      const url = (tab as { url?: unknown }).url;
      if (typeof url === 'string' && url.length > 0) return url;
    }
  }
  return null;
}
