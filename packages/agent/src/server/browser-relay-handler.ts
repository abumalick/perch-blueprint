import {
  parseBrowserClientMessage,
  parseBrowserAgentMessage,
  type BrowserAgentMessage,
  type BrowserEndedReason,
} from '@perch/contracts';
import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';
import type { BrowserCommandPort } from '../ports/browser-command-port';
import type { RelaySocket, ConnectUpstream } from '../ports/browser-stream-port';
import type { Viewer, ViewerRegistry } from './viewer-registry';

// One JPEG frame is 30–100 KB; above this the client socket is considered backpressured
// and frames are replaced-not-queued (latest wins) until it drains.
const BACKPRESSURE_LIMIT = 200_000;

const RELAYED_UPSTREAM_TYPES = new Set(['frame', 'tabs', 'url', 'status']);

export interface BrowserRelayHandlerDeps {
  client: RelaySocket;
  sessionName: string;
  token: string;
  discovery: BrowserDiscoveryPort;
  commands: BrowserCommandPort;
  connectUpstream: ConnectUpstream;
  // Single viewer per session (keyed by session name): a later viewer evicts this one.
  registry: ViewerRegistry;
}

export class BrowserRelayHandler {
  private authed = false;
  private clientClosed = false;
  private upstream: RelaySocket | null = null;
  private pendingFrame: string | null = null;
  // Kicked when another viewer acquires the same session: tell this client why and
  // tear down both sides. Registered after a successful auth + upstream dial.
  private readonly viewer: Viewer = {
    detach: () => {
      const upstream = this.upstream;
      this.upstream = null;
      upstream?.close();
      this.end('opened-elsewhere');
    },
  };

  constructor(private readonly deps: BrowserRelayHandlerDeps) {
    deps.client.onMessage((data) => {
      void this.handleClientMessage(data);
    });
    deps.client.onClose(() => {
      this.clientClosed = true;
      deps.registry.release(deps.sessionName, this.viewer);
      const upstream = this.upstream;
      this.upstream = null;
      upstream?.close();
    });
  }

  private async handleClientMessage(data: string): Promise<void> {
    let message: ReturnType<typeof parseBrowserClientMessage>;
    try {
      message = parseBrowserClientMessage(JSON.parse(data));
    } catch {
      return; // malformed → drop, never crash the relay
    }

    if (!this.authed) {
      if (message.type !== 'auth') {
        this.deps.client.close();
        return;
      }
      if (message.token !== this.deps.token) {
        this.send({ type: 'authResult', ok: false });
        this.deps.client.close();
        return;
      }
      this.authed = true;
      this.send({ type: 'authResult', ok: true });
      await this.dialUpstream();
      return;
    }

    switch (message.type) {
      case 'auth':
        return;
      case 'ping':
        this.send({ type: 'pong' });
        return;
      case 'navigate':
        // Navigation goes through the CLI, never upstream (which has no such message).
        // The browser protocol has no error reply; a rejected URL is silently dropped.
        await this.deps.commands.navigate(this.deps.sessionName, message.url).catch(() => undefined);
        return;
      case 'back':
        await this.deps.commands.back(this.deps.sessionName).catch(() => undefined);
        return;
      case 'forward':
        await this.deps.commands.forward(this.deps.sessionName).catch(() => undefined);
        return;
      case 'setViewport':
        await this.deps.commands
          .setViewport(this.deps.sessionName, message.width, message.height)
          .catch(() => undefined);
        return;
      case 'closeSession':
        // The upstream close that follows the CLI `close` produces the ended{closed}.
        await this.deps.commands.stop(this.deps.sessionName).catch(() => undefined);
        return;
      case 'input_mouse':
      case 'input_keyboard':
      case 'input_touch':
        this.upstream?.send(data); // validated above, forwarded verbatim
        return;
    }
  }

  private async dialUpstream(): Promise<void> {
    let streamPort: number | undefined;
    try {
      const sessions = await this.deps.discovery.listSessions();
      streamPort = sessions.find((s) => s.name === this.deps.sessionName)?.streamPort;
    } catch {
      this.end('error');
      return;
    }
    if (streamPort === undefined) {
      this.end('not-found');
      return;
    }

    let upstream: RelaySocket;
    try {
      upstream = await this.deps.connectUpstream(streamPort);
    } catch {
      this.end('error');
      return;
    }
    if (this.clientClosed) {
      upstream.close();
      return;
    }
    this.upstream = upstream;
    this.deps.registry.acquire(this.deps.sessionName, this.viewer);
    upstream.onMessage((data) => {
      this.relayUpstreamMessage(data);
    });
    upstream.onClose(() => {
      if (this.upstream !== upstream) return; // we closed it ourselves
      this.upstream = null;
      this.end('closed');
    });
  }

  private relayUpstreamMessage(data: string): void {
    let type: BrowserAgentMessage['type'];
    try {
      type = parseBrowserAgentMessage(JSON.parse(data)).type;
    } catch {
      return; // unknown upstream types are dropped (forward compatibility)
    }
    if (!RELAYED_UPSTREAM_TYPES.has(type)) return; // authResult/pong/ended are relay-owned

    if (type === 'frame') {
      if (this.backpressured()) {
        this.pendingFrame = data; // replaced, not queued — the latest frame wins
      } else {
        this.pendingFrame = null; // this frame is newer than any pending one
        this.deps.client.send(data);
      }
      return;
    }
    // Non-frame messages always go through; flush the held frame first once drained.
    if (this.pendingFrame !== null && !this.backpressured()) {
      this.deps.client.send(this.pendingFrame);
      this.pendingFrame = null;
    }
    this.deps.client.send(data);
  }

  private backpressured(): boolean {
    return (this.deps.client.bufferedAmount?.() ?? 0) > BACKPRESSURE_LIMIT;
  }

  private end(reason: BrowserEndedReason): void {
    if (this.clientClosed) return;
    this.send({ type: 'ended', reason });
    this.deps.client.close();
  }

  private send(message: BrowserAgentMessage): void {
    this.deps.client.send(JSON.stringify(message));
  }
}
