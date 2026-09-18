import { describe, it, expect } from 'vitest';
import {
  readSharedFile,
  consumeSharedFile,
  fileToUpload,
  type CacheLike,
  type ResponseLike,
  type FileLike,
} from './shared-file';

function response(bytes: Uint8Array, headers: Record<string, string>): ResponseLike {
  return {
    arrayBuffer: async () => {
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      return ab;
    },
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  };
}

function cache(stored: ResponseLike | undefined): CacheLike & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    match: async () => stored,
    delete: async (req) => {
      deleted.push(req);
      return stored !== undefined;
    },
  };
}

describe('readSharedFile', () => {
  it('returns the stashed file with its filename WITHOUT deleting it (non-destructive read)', async () => {
    const c = cache(response(new Uint8Array([1, 2, 3]), { 'x-filename': 'photo.jpg', 'content-type': 'image/jpeg' }));
    const res = await readSharedFile(c);
    expect(res).toEqual({ name: 'photo.jpg', bytes: new Uint8Array([1, 2, 3]) });
    expect(c.deleted).toEqual([]);
  });

  it('derives a name from the MIME type when x-filename is empty', async () => {
    const c = cache(response(new Uint8Array([9]), { 'x-filename': '', 'content-type': 'image/png' }));
    const res = await readSharedFile(c);
    expect(res?.name).toBe('shared-file.png');
  });

  it('derives a name from a non-image MIME type too', async () => {
    const c = cache(response(new Uint8Array([9]), { 'content-type': 'application/zip' }));
    const res = await readSharedFile(c);
    expect(res?.name).toBe('shared-file.zip');
  });

  it('ignores MIME parameters when deriving the extension', async () => {
    const c = cache(response(new Uint8Array([9]), { 'content-type': 'text/csv; charset=utf-8' }));
    const res = await readSharedFile(c);
    expect(res?.name).toBe('shared-file.csv');
  });

  // Long structured subtypes (vnd.*, +xml) make absurd extensions; better no extension at
  // all than `shared-file.vnd.openxmlformats-officedocument.wordprocessingml.document`.
  it('skips the extension when the subtype is not extension-shaped', async () => {
    const c = cache(
      response(new Uint8Array([9]), {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    const res = await readSharedFile(c);
    expect(res?.name).toBe('shared-file');
  });

  it('falls back to a generic name when neither filename nor a usable MIME is present', async () => {
    const c = cache(response(new Uint8Array([9]), {}));
    const res = await readSharedFile(c);
    expect(res?.name).toBe('shared-file');
  });

  it('returns null when nothing is stashed', async () => {
    const c = cache(undefined);
    expect(await readSharedFile(c)).toBeNull();
    expect(c.deleted).toEqual([]);
  });
});

describe('consumeSharedFile', () => {
  it('deletes the stashed entry', async () => {
    const c = cache(response(new Uint8Array([1]), {}));
    await consumeSharedFile(c);
    expect(c.deleted).toEqual(['/shared-file']);
  });
});

describe('fileToUpload', () => {
  it('maps a File to its name and bytes', async () => {
    const file: FileLike = {
      name: 'screenshot.png',
      arrayBuffer: async () => new Uint8Array([4, 5]).buffer,
    };
    expect(await fileToUpload(file)).toEqual({ name: 'screenshot.png', bytes: new Uint8Array([4, 5]) });
  });
});
