import { mkdir, writeFile, access } from 'node:fs/promises';
import type { FileWriterPort } from '../ports/file-writer-port';

export class FsFileWriter implements FileWriterPort {
  async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }
  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path, bytes);
  }
}
