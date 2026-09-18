import { open, stat } from 'node:fs/promises';
import type { FileReaderPort } from '../ports/file-reader-port';

export class FsFileReader implements FileReaderPort {
  async read(path: string, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    const info = await stat(path);
    const truncated = info.size > maxBytes;
    const toRead = truncated ? maxBytes : info.size;
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, 0);
      return { bytes: buf.subarray(0, bytesRead), truncated };
    } finally {
      await fh.close();
    }
  }
}
