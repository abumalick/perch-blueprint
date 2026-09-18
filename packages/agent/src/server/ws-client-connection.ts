import type { WebSocket } from 'ws';
import type { AgentMessage } from '@perch/contracts';
import type { ClientConnection } from '../ports/client-connection';

export class WsClientConnection implements ClientConnection {
  constructor(private readonly socket: WebSocket) {}

  send(message: AgentMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  onMessage(listener: (raw: unknown) => void): void {
    this.socket.on('message', (data: unknown) => {
      const text = String(data);
      try {
        listener(JSON.parse(text));
      } catch {
        listener(text);
      }
    });
  }

  onClose(listener: () => void): void {
    this.socket.on('close', listener);
  }
}
