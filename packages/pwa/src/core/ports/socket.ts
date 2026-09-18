// The browser `error` event is opaque (no detail), but `close` carries a code and
// reason. We surface those so the connection layer can label failures.
export interface CloseInfo {
  code?: number;
  reason?: string;
}

export interface Socket {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onOpen(cb: () => void): void;
  onClose(cb: (info?: CloseInfo) => void): void;
  onError?(cb: () => void): void;
}

export type SocketFactory = (url: string) => Socket;
