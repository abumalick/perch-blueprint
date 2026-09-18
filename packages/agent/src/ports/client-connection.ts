import type { AgentMessage } from '@perch/contracts';

export interface ClientConnection {
  send(message: AgentMessage): void;
  close(): void;
  onMessage(listener: (raw: unknown) => void): void;
  onClose(listener: () => void): void;
}
