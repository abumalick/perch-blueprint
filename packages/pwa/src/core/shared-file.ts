// Reads a file handed to the app by the OS "Share" sheet. The service-worker helper
// (public/share-target-sw.js) stashes the shared file in the Cache API under
// SHARED_FILE_KEY. The read is non-destructive; the entry is deleted only once the file
// is actually attached to a session (consumeSharedFile, called on flush). This keeps a
// boot read idempotent — a re-open before attaching still surfaces the file, and two boots
// can never race to delete a just-stashed entry. Kept pure (seams below, not the DOM
// Cache/File) so it unit-tests without a real Cache.

export const SHARED_FILE_KEY = '/shared-file';

export interface HeadersLike {
  get(name: string): string | null;
}
export interface ResponseLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: HeadersLike;
}
export interface CacheLike {
  match(request: string): Promise<ResponseLike | undefined>;
  delete(request: string): Promise<boolean>;
}
export interface FileLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export async function readSharedFile(
  cache: CacheLike,
): Promise<{ name: string; bytes: Uint8Array } | null> {
  const res = await cache.match(SHARED_FILE_KEY);
  if (!res) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const name = res.headers.get('x-filename') || nameForShared(res.headers.get('content-type'));
  return { name, bytes };
}

// Drop the stashed file once it's been attached, so it isn't offered again on the next boot.
export async function consumeSharedFile(cache: CacheLike): Promise<void> {
  await cache.delete(SHARED_FILE_KEY);
}

export async function fileToUpload(file: FileLike): Promise<{ name: string; bytes: Uint8Array }> {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

// A share can arrive with no filename; derive one from the MIME subtype (image/png ->
// shared-file.png, application/zip -> shared-file.zip), falling back to a bare stem the
// agent will still name safely. Only extension-shaped subtypes are used: structured ones
// (`vnd.…`, `…+xml`) would otherwise produce a filename longer than the file is useful.
const EXTENSION_SHAPED = /^[a-z0-9]{1,5}$/;

function nameForShared(mime: string | null): string {
  const subtype = mime?.split(';')[0]?.split('/')[1]?.toLowerCase() ?? '';
  return EXTENSION_SHAPED.test(subtype) ? `shared-file.${subtype}` : 'shared-file';
}
