import type { ImageLoader, ImageLoadResult } from '../core/ports/image-loader';

// Browser path: a plain authenticated fetch. The keeper for normal browsers and the
// Playwright e2e. Returns a null blob for any non-2xx so the store applies its own
// 413 / error branching; throws (via fetch) only when the host is unreachable.
export class FetchImageLoader implements ImageLoader {
  async load(url: string, token: string): Promise<ImageLoadResult> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, blob: res.ok ? await res.blob() : null };
  }
}
