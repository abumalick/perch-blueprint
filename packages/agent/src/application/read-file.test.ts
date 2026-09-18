import { describe, it, expect } from 'vitest';
import { readFile, MAX_FILE_BYTES } from './read-file';
import type { FileReaderPort } from '../ports/file-reader-port';

const reader = (bytes: Uint8Array, truncated = false): FileReaderPort => ({
  read: async () => ({ bytes, truncated }),
});

describe('readFile', () => {
  it('rejects a path outside the allowed roots', async () => {
    await expect(
      readFile({ reader: reader(new Uint8Array()) }, '/etc/passwd', ['/home/u/proj']),
    ).rejects.toThrow(/outside allowed roots/);
  });

  it('returns text contents for an allowed path', async () => {
    const result = await readFile(
      { reader: reader(new TextEncoder().encode('hi')) },
      '/home/u/proj/a.txt',
      ['/home/u/proj'],
    );
    expect(result).toEqual({ binary: false, data: Buffer.from('hi').toString('base64'), truncated: false });
  });

  it('passes the truncated flag through', async () => {
    const result = await readFile(
      { reader: reader(new TextEncoder().encode('hi'), true) },
      '/home/u/proj/a.txt',
      ['/home/u/proj'],
    );
    expect(result.truncated).toBe(true);
  });

  it('reports a binary file with empty data', async () => {
    const result = await readFile(
      { reader: reader(new Uint8Array([0x00, 0x01])) },
      '/home/u/proj/blob.bin',
      ['/home/u/proj'],
    );
    expect(result).toEqual({ binary: true, data: '', truncated: false });
  });

  it('exposes a 512 KB cap', () => {
    expect(MAX_FILE_BYTES).toBe(512 * 1024);
  });
});
