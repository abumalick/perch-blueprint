import { describe, it, expect, vi } from 'vitest';
import { ElevenLabsTranscriber, SCRIBE_ENDPOINT, SCRIBE_MODEL_ID } from './elevenlabs-transcriber';

const audio = new Blob(['x'], { type: 'audio/webm' });

function okResponse(text: string): Response {
  return { ok: true, json: () => Promise.resolve({ text }) } as unknown as Response;
}

describe('ElevenLabsTranscriber', () => {
  it('throws when no API key is configured, without calling fetch', async () => {
    const fetchFn = vi.fn();
    const t = new ElevenLabsTranscriber(() => null, fetchFn);
    await expect(t.transcribe(audio)).rejects.toThrow('Set ElevenLabs key in Settings');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('posts the audio with the key header and scribe model, returning the transcript', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('hello'));
    const t = new ElevenLabsTranscriber(() => 'sk_live', fetchFn);

    const text = await t.transcribe(audio);

    expect(text).toBe('hello');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(SCRIBE_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe('sk_live');
    const body = init.body as FormData;
    expect(body.get('model_id')).toBe(SCRIBE_MODEL_ID);
    expect(body.get('no_verbatim')).toBe('true');
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('reports an out-of-credit message when the body says the quota is exceeded', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: { status: 'quota_exceeded', message: 'no credits' } }),
    } as unknown as Response);
    const t = new ElevenLabsTranscriber(() => 'sk_live', fetchFn);
    await expect(t.transcribe(audio)).rejects.toThrow('ElevenLabs quota exceeded');
  });

  it('reports an invalid-key message on a 401 without a quota detail', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: { status: 'invalid_api_key' } }),
    } as unknown as Response);
    const t = new ElevenLabsTranscriber(() => 'sk_live', fetchFn);
    await expect(t.transcribe(audio)).rejects.toThrow('Invalid ElevenLabs key');
  });

  it('reports a generic failure with the status for other errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const t = new ElevenLabsTranscriber(() => 'sk_live', fetchFn);
    await expect(t.transcribe(audio)).rejects.toThrow('Transcription failed (HTTP 500)');
  });

  it('aborts and reports a timeout when the request hangs', async () => {
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const t = new ElevenLabsTranscriber(() => 'sk_live', fetchFn as unknown as typeof fetch, 5);
    await expect(t.transcribe(audio)).rejects.toThrow('timed out');
  });

  it('returns an empty string when the response has no text field', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    const t = new ElevenLabsTranscriber(() => 'sk_live', fetchFn);
    expect(await t.transcribe(audio)).toBe('');
  });
});
