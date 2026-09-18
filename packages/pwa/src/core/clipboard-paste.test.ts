import { describe, it, expect } from 'vitest';
import { pasteFromClipboard, type BlobLike, type ClipboardItemLike } from './clipboard-paste';

function blob(bytes: Uint8Array, text = ''): BlobLike {
  return {
    arrayBuffer: async () => {
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      return ab;
    },
    text: async () => text,
  };
}

function item(map: Record<string, BlobLike>): ClipboardItemLike {
  return { types: Object.keys(map), getType: async (t) => map[t]! };
}

describe('pasteFromClipboard', () => {
  it('returns an image file with a name derived from the MIME subtype', async () => {
    const res = await pasteFromClipboard([item({ 'image/png': blob(new Uint8Array([1, 2, 3])) })]);
    expect(res.kind).toBe('file');
    if (res.kind !== 'file') throw new Error('expected file');
    expect(res.name).toBe('pasted-image.png');
    expect([...res.bytes]).toEqual([1, 2, 3]);
  });

  it('uses .jpeg for image/jpeg', async () => {
    const res = await pasteFromClipboard([item({ 'image/jpeg': blob(new Uint8Array([9])) })]);
    expect(res.kind === 'file' && res.name).toBe('pasted-image.jpeg');
  });

  it('prefers an image over text when both are present', async () => {
    const res = await pasteFromClipboard([
      item({ 'text/plain': blob(new Uint8Array(), 'hello'), 'image/png': blob(new Uint8Array([1])) }),
    ]);
    expect(res.kind).toBe('file');
  });

  it('returns text when only text is present', async () => {
    const res = await pasteFromClipboard([item({ 'text/plain': blob(new Uint8Array(), 'hello') })]);
    expect(res).toEqual({ kind: 'text', text: 'hello' });
  });

  it('returns none for an empty clipboard', async () => {
    expect(await pasteFromClipboard([])).toEqual({ kind: 'none' });
  });
});
