import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ClientLogBatch } from '@perch/contracts';
import type { ClientLogPort } from '../ports/client-log-port';

// Appends client connection-log batches to a JSONL file (default ~/.perch/client-log.jsonl),
// one self-contained record per event: the event fields plus the batch's ua/shell and a server
// receive time (`rt`). Append-only — read/dedup (by sess,seq) happens offline at analysis time.
export class FileClientLogStore implements ClientLogPort {
  constructor(
    private readonly filePath: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async append(batch: ClientLogBatch): Promise<void> {
    const rt = this.now();
    const lines = batch.events.map(
      (event) => JSON.stringify({ ...event, ua: batch.ua, shell: batch.shell, rt }) + '\n',
    );
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, lines.join(''), 'utf8');
  }
}
