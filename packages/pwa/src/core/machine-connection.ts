import { parseAgentMessage, type AgentMessage, type ClientMessage } from '@perch/contracts';
import type { CloseInfo, Socket, SocketFactory } from './ports/socket';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

// A human-readable explanation of why a connection failed, surfaced in the UI so a
// user can tell apart "never reached the machine" from "agent dropped us" from "auth
// rejected". `code` is the WebSocket close code when one was reported.
export interface ConnectionDiagnostic {
  message: string;
  code?: number;
  at: number;
}

export interface MachineConnectionDeps {
  url: string;
  token: string;
  socketFactory: SocketFactory;
  onMessage: (message: AgentMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  onDiagnostic?: (diagnostic: ConnectionDiagnostic) => void;
  schedule?: (fn: () => void, ms: number) => void;
  // Arms a one-shot timer and returns a canceller. Used for the connect deadline; kept
  // separate from `schedule` (the reconnect backoff) so it can be cancelled once open.
  startTimer?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
}

const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 10_000;
// A socket that never reaches `open` within this window is reaped and retried. Without it,
// iOS WebKit can leave a socket hanging in CONNECTING indefinitely when the tailnet path is
// briefly flaky, stranding the machine on "connecting" forever with no retry.
const CONNECT_TIMEOUT_MS = 10_000;
// Failed attempts before a machine that has NEVER connected gives up auto-retrying and
// waits for a manual `reconnect()`. An unreachable peer that kept retrying would churn the
// tailnet path and starve the other machines' connections; going quiet keeps the app usable.
// A machine that has connected before is exempt (see `everConnected`) — it retries forever.
const MAX_CONNECT_ATTEMPTS = 4;
// Liveness heartbeat. While online, ping every interval and expect *some* inbound traffic
// within the timeout; a missed reply means the socket is dead — often a half-open TCP that
// never fires `close` (common when a phone backgrounds the PWA or switches networks). We
// then close it ourselves so the reconnect path takes over. Any inbound frame counts as
// proof of life (even an older agent's error reply to the unknown `ping`), so the worst case
// is a needless reconnect, never a stuck terminal.
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

export class MachineConnection {
  private socket: Socket | null = null;
  private backoff = BASE_BACKOFF_MS;
  private failCount = 0;
  // Heartbeat state: the canceller for the currently-armed heartbeat timer (either the
  // idle interval before the next ping, or the post-ping reply deadline), and whether any
  // inbound frame has arrived since the last ping was sent.
  private heartbeatCancel: (() => void) | null = null;
  private pongSeen = false;
  // Once a machine has connected, it's known-reachable: keep auto-retrying through later
  // drops (e.g. a phone switching WiFi↔cellular) so it self-heals. Only a machine that has
  // never connected gives up, so a peer you add while it's offline can't churn the network.
  private everConnected = false;
  private rejected = false;
  // Monotonic token identifying the current connect "chain". Bumped by reconnect()/close() so a
  // pending backoff retry (an uncancellable fire-and-forget timer) fired after a supersede is a
  // no-op instead of spawning a second, overlapping connect chain. Overlapping chains left
  // stalled sockets in CONNECTING that WebKit never tears down, wedging reconnect until the
  // machine was toggled off/on (which called close() — the only thing that quiesced them).
  private generation = 0;
  private closedByUser = false;
  // Per-attempt diagnostic state, reset on each `connect()`.
  private opened = false;
  private errored = false;
  private timedOut = false;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly startTimer: (fn: () => void, ms: number) => () => void;
  private readonly now: () => number;

  constructor(private readonly deps: MachineConnectionDeps) {
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.startTimer =
      deps.startTimer ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    this.now = deps.now ?? (() => Date.now());
  }

  connect(): void {
    this.stopHeartbeat();
    this.deps.onStatus('connecting');
    this.opened = false;
    this.errored = false;
    this.timedOut = false;
    const socket = this.deps.socketFactory(this.deps.url);
    this.socket = socket;
    // Reap a connection that stalls in CONNECTING: close it so the `onClose` path below
    // marks the machine offline and schedules a retry, instead of hanging forever.
    const cancelDeadline = this.startTimer(() => {
      if (this.socket === socket && !this.opened) {
        this.timedOut = true;
        socket.close();
      }
    }, CONNECT_TIMEOUT_MS);
    socket.onOpen(() => {
      // Ignore a late open from a socket we've already superseded (reconnect/close swapped it
      // out): it must not authenticate or become the live connection.
      if (this.socket !== socket) return;
      cancelDeadline();
      this.opened = true;
      socket.send(JSON.stringify({ type: 'auth', token: this.deps.token } satisfies ClientMessage));
    });
    socket.onError?.(() => {
      this.errored = true;
    });
    socket.onMessage((data) => {
      if (this.socket !== socket) return;
      this.handle(socket, data);
    });
    socket.onClose((info) => {
      cancelDeadline();
      if (this.socket !== socket) {
        return;
      }
      this.stopHeartbeat();
      this.socket = null;
      if (this.closedByUser) {
        return;
      }
      if (this.rejected) {
        // Auth failure is reported in `handle`; the close that follows is expected.
        return;
      }
      this.deps.onDiagnostic?.(this.diagnose(info));
      this.deps.onStatus('offline');
      this.failCount += 1;
      if (!this.everConnected && this.failCount >= MAX_CONNECT_ATTEMPTS) {
        // Give up only for a machine that has never connected: it stops churning the
        // network and waits for an explicit `reconnect()`. A machine that connected
        // before keeps retrying so it recovers on its own from a transient drop.
        return;
      }
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      // Tie this retry to the current chain: a reconnect() or close() before it fires bumps
      // `generation`, turning the (uncancellable) timer into a no-op so chains never stack.
      const gen = this.generation;
      this.schedule(() => {
        if (this.generation === gen) this.connect();
      }, delay);
    });
  }

  // Resume connecting after a manual trigger (e.g. a "Reconnect" tap), clearing the
  // give-up state so a machine that went quiet — or was auth-rejected — tries again.
  reconnect(): void {
    // Supersede any pending backoff retry and in-flight socket so we replace the current chain
    // rather than stacking a second one on top of it (the wedge this whole mechanism prevents).
    this.generation += 1;
    this.closedByUser = false;
    this.rejected = false;
    this.failCount = 0;
    this.backoff = BASE_BACKOFF_MS;
    this.stopHeartbeat();
    const existing = this.socket;
    this.socket = null;
    existing?.close();
    this.connect();
  }

  // Probe the link immediately instead of waiting for the next heartbeat interval. Used when
  // the app returns to the foreground, where the socket may have silently died while the PWA
  // was backgrounded — this surfaces that within the reply timeout rather than up to a full
  // interval later. No-op unless a heartbeat is running (i.e. the machine is online).
  checkLiveness(): void {
    const socket = this.socket;
    if (!socket || !this.heartbeatCancel) return;
    this.stopHeartbeat();
    this.sendPingAndAwait(socket);
  }

  private diagnose(info?: CloseInfo): ConnectionDiagnostic {
    const code = info?.code;
    const reason = info?.reason?.trim();
    let message: string;
    if (this.timedOut) {
      // We reaped the socket ourselves after it stalled in CONNECTING.
      message = 'connection timed out';
    } else if (!this.opened) {
      // Closed before ever opening: never reached the agent. A 1006 abnormal closure
      // here is the signature of a public-origin -> tailnet block (unreachable/blocked).
      const why =
        this.errored || code === 1006
          ? 'likely network or permission block — unreachable'
          : 'never opened';
      message = `connection failed (${why})`;
    } else if (reason) {
      message = `closed by agent — ${reason}`;
    } else {
      message = 'opened then dropped';
    }
    return { message, code, at: this.now() };
  }

  send(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  close(): void {
    // Bump the chain token so a pending backoff retry can't resurrect the connection after close.
    this.generation += 1;
    this.closedByUser = true;
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  private handle(socket: Socket, data: string): void {
    // Any inbound frame is proof the link is alive, satisfying a pending heartbeat — recorded
    // before parsing so even a frame we can't parse still counts.
    this.pongSeen = true;
    let message: AgentMessage;
    try {
      message = parseAgentMessage(JSON.parse(data));
    } catch {
      return;
    }
    if (message.type === 'authResult') {
      if (message.ok) {
        this.backoff = BASE_BACKOFF_MS;
        this.failCount = 0;
        this.everConnected = true;
        this.startHeartbeat(socket);
        this.deps.onStatus('online');
      } else {
        this.rejected = true;
        this.deps.onDiagnostic?.({ message: 'auth rejected', at: this.now() });
        this.deps.onStatus('offline');
        this.socket?.close();
      }
      return;
    }
    // `pong` is purely a liveness reply (handled above); don't forward it to the app.
    if (message.type === 'pong') {
      return;
    }
    this.deps.onMessage(message);
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
    socket.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
    this.heartbeatCancel = this.startTimer(() => {
      if (this.socket !== socket) return;
      if (this.pongSeen) {
        this.armPing(socket);
      } else {
        // The ping went unanswered: the link is dead. Closing it routes through `onClose`,
        // which marks the machine offline and schedules a reconnect.
        socket.close();
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private stopHeartbeat(): void {
    this.heartbeatCancel?.();
    this.heartbeatCancel = null;
  }
}
