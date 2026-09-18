import { describe, it, expect } from 'vitest';
import { readServableFile, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_AUDIO_BYTES } from './read-servable-file';
import type { FileReaderPort } from '../ports/file-reader-port';

const reader = (bytes: Uint8Array, truncated = false): FileReaderPort => ({
  read: async () => ({ bytes, truncated }),
});

describe('readServableFile', () => {
  it('rejects a path outside the allowed roots as forbidden', async () => {
    const result = await readServableFile({ reader: reader(new Uint8Array()) }, '/etc/evil.png', ['/home/u/proj']);
    expect(result).toEqual({ kind: 'forbidden' });
  });

  it('reports a non-servable path within roots as not-servable', async () => {
    const result = await readServableFile({ reader: reader(new Uint8Array()) }, '/home/u/proj/a.txt', ['/home/u/proj']);
    expect(result).toEqual({ kind: 'not-servable' });
  });

  it('returns the bytes and mediaType for an allowed image', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await readServableFile({ reader: reader(bytes) }, '/home/u/proj/a.png', ['/home/u/proj']);
    expect(result).toEqual({ kind: 'ok', mediaType: 'image/png', bytes });
  });

  it('returns the bytes and mediaType for an allowed pdf', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const result = await readServableFile({ reader: reader(bytes) }, '/home/u/proj/doc.pdf', ['/home/u/proj']);
    expect(result).toEqual({ kind: 'ok', mediaType: 'application/pdf', bytes });
  });

  it('returns the bytes and mediaType for an allowed audio file', async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33]); // ID3
    const result = await readServableFile({ reader: reader(bytes) }, '/home/u/proj/clip.mp3', ['/home/u/proj']);
    expect(result).toEqual({ kind: 'ok', mediaType: 'audio/mpeg', bytes });
  });

  it('reports an over-cap file as too-large', async () => {
    const result = await readServableFile(
      { reader: reader(new Uint8Array([1, 2, 3]), true) },
      '/home/u/proj/big.pdf',
      ['/home/u/proj'],
    );
    expect(result).toEqual({ kind: 'too-large' });
  });

  it('exposes a 5 MB image cap, a 20 MB pdf cap, and a 30 MB audio cap', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_PDF_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_AUDIO_BYTES).toBe(30 * 1024 * 1024);
  });
});
