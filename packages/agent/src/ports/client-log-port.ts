import type { ClientLogBatch } from '@perch/contracts';

export interface ClientLogPort {
  // Appends a client's flushed connection-log batch to durable storage. Each event becomes one
  // self-contained record (event fields + the batch's ua/shell + a server receive time).
  append(batch: ClientLogBatch): Promise<void>;
}
