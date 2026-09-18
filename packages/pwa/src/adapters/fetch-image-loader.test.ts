import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchImageLoader } from './fetch-image-loader';

afterEach(() => vi.restoreAllMocks());

describe('FetchImageLoader', () => {
  it('GETs with a bearer header and returns status + blob on ok', async () => {
    const blob = new Blob(['img'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(blob, { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await new FetchImageLoader().load('https://agent/file?path=x', 'tok');

    expect(fetchMock).toHaveBeenCalledWith('https://agent/file?path=x', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    expect(res.blob).toBeInstanceOf(Blob);
  });

  it('returns the status with a null blob on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 413 })));
    const res = await new FetchImageLoader().load('https://agent/file?path=x', 'tok');
    expect(res.status).toBe(413);
    expect(res.blob).toBeNull();
  });

  it('propagates a transport rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')));
    await expect(new FetchImageLoader().load('https://agent/file', 'tok')).rejects.toThrow(
      'Load failed',
    );
  });
});
