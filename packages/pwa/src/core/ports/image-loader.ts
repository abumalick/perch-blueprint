// Fetches an image's bytes from the agent's bearer-guarded GET /file endpoint.
// Implemented by the browser fetch adapter; faked in the store unit tests. Resolves with the HTTP status and, on a 2xx, the bytes.
// Throws only on a transport failure (host unreachable), mirroring fetch's reject semantics.
export interface ImageLoadResult {
  status: number;
  blob: Blob | null;
}

export interface ImageLoader {
  load(url: string, token: string): Promise<ImageLoadResult>;
}
