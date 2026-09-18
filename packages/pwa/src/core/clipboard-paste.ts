// The slice of Blob we use. The DOM Blob and the blobs returned by clipboard.read()
// both satisfy it; typing against this (not the DOM Blob) keeps the helper testable
// without a real Blob implementation.
export interface BlobLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface ClipboardItemLike {
  types: readonly string[];
  getType(type: string): Promise<BlobLike>;
}

export type PasteResult =
  | { kind: 'file'; name: string; bytes: Uint8Array }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

// An image anywhere on the clipboard wins (the feature's purpose); otherwise fall back
// to plain text (today's behavior).
export async function pasteFromClipboard(items: readonly ClipboardItemLike[]): Promise<PasteResult> {
  for (const it of items) {
    const imageType = it.types.find((t) => t.startsWith('image/'));
    if (imageType) {
      const blob = await it.getType(imageType);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { kind: 'file', name: nameForImage(imageType), bytes };
    }
  }
  for (const it of items) {
    if (it.types.includes('text/plain')) {
      return { kind: 'text', text: await (await it.getType('text/plain')).text() };
    }
  }
  return { kind: 'none' };
}

function nameForImage(mime: string): string {
  const subtype = mime.slice('image/'.length).split(';')[0] || 'png';
  return `pasted-image.${subtype}`;
}
