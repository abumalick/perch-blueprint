// Both sides of the browser stream relay: the downstream PWA viewer socket and the
// upstream agent-browser stream socket share this shape, so the relay pipes strings
// between two RelaySockets without knowing about `ws`.
export interface RelaySocket {
  send(data: string): void;
  // Bytes accepted by send() but not yet flushed to the network. Absent means the
  // socket never backpressures (upstream loopback, fakes).
  bufferedAmount?(): number;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

export type ConnectUpstream = (port: number) => Promise<RelaySocket>;
