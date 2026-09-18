import { describe, it, expect, vi } from 'vitest';
import { SpeechToText } from './speech-to-text';
import type { AudioRecorder } from './ports/audio-recorder';
import type { Transcriber } from './ports/transcriber';

const audio = new Blob(['x'], { type: 'audio/webm' });

function fakeRecorder(over: Partial<AudioRecorder> = {}): AudioRecorder {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(audio),
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(over: { recorder?: AudioRecorder; transcriber?: Transcriber } = {}) {
  const onText = vi.fn();
  const recorder = over.recorder ?? fakeRecorder();
  const transcriber = over.transcriber ?? { transcribe: vi.fn().mockResolvedValue('hello world') };
  const stt = new SpeechToText(recorder, transcriber, onText);
  return { stt, onText, recorder, transcriber };
}

describe('SpeechToText', () => {
  it('starts idle', () => {
    expect(setup().stt.state).toBe('idle');
  });

  it('starts recording on the first toggle', async () => {
    const { stt, recorder } = setup();
    await stt.toggle();
    expect(recorder.start).toHaveBeenCalledOnce();
    expect(stt.state).toBe('recording');
  });

  it('stops, transcribes, and forwards the text on the second toggle', async () => {
    const { stt, onText, recorder } = setup();
    await stt.toggle();
    await stt.toggle();
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(onText).toHaveBeenCalledExactlyOnceWith('hello world');
    expect(stt.state).toBe('idle');
  });

  it('does not forward an empty/whitespace transcript', async () => {
    const { stt, onText } = setup({ transcriber: { transcribe: vi.fn().mockResolvedValue('   ') } });
    await stt.toggle();
    await stt.toggle();
    expect(onText).not.toHaveBeenCalled();
    expect(stt.state).toBe('idle');
  });

  it('goes to error with a friendly message when the mic is blocked', async () => {
    const recorder = fakeRecorder({ start: vi.fn().mockRejectedValue(new Error('NotAllowed')) });
    const { stt } = setup({ recorder });
    await stt.toggle();
    expect(stt.state).toBe('error');
    expect(stt.error).toBe('Microphone blocked');
  });

  it('surfaces the transcriber error message', async () => {
    const transcriber = { transcribe: vi.fn().mockRejectedValue(new Error('Set ElevenLabs key in Settings')) };
    const { stt, onText } = setup({ transcriber });
    await stt.toggle();
    await stt.toggle();
    expect(stt.state).toBe('error');
    expect(stt.error).toBe('Set ElevenLabs key in Settings');
    expect(onText).not.toHaveBeenCalled();
  });

  it('ignores a toggle while transcribing', async () => {
    const pending = deferred<string>();
    const transcriber = { transcribe: vi.fn().mockReturnValue(pending.promise) };
    const recorder = fakeRecorder();
    const { stt } = setup({ recorder, transcriber });
    await stt.toggle(); // recording
    const transcribing = stt.toggle(); // stop -> transcribing (pending)
    expect(stt.state).toBe('transcribing');
    await stt.toggle(); // should be ignored
    expect(recorder.start).toHaveBeenCalledOnce();
    pending.resolve('done');
    await transcribing;
    expect(stt.state).toBe('idle');
  });

  it('recovers from error: the next toggle starts a new recording', async () => {
    const recorder = fakeRecorder({ start: vi.fn().mockRejectedValueOnce(new Error('NotAllowed')) });
    const { stt } = setup({ recorder });
    await stt.toggle(); // error
    expect(stt.state).toBe('error');
    await stt.toggle(); // start again
    expect(stt.state).toBe('recording');
    expect(recorder.start).toHaveBeenCalledTimes(2);
  });

  it('dismiss() clears an error back to idle and notifies', async () => {
    const recorder = fakeRecorder({ start: vi.fn().mockRejectedValue(new Error('NotAllowed')) });
    const onChange = vi.fn();
    const stt = new SpeechToText(recorder, { transcribe: vi.fn() }, vi.fn(), onChange);
    await stt.toggle();
    expect(stt.state).toBe('error');
    onChange.mockClear();
    stt.dismiss();
    expect(stt.state).toBe('idle');
    expect(stt.error).toBeNull();
    expect(onChange).toHaveBeenCalled();
  });

  it('dismiss() is a no-op when not in error', async () => {
    const { stt } = setup();
    await stt.toggle();
    stt.dismiss();
    expect(stt.state).toBe('recording');
  });

  it('notifies onChange across transitions', async () => {
    const onChange = vi.fn();
    const stt = new SpeechToText(fakeRecorder(), { transcribe: vi.fn().mockResolvedValue('hi') }, vi.fn(), onChange);
    await stt.toggle();
    await stt.toggle();
    expect(onChange).toHaveBeenCalled();
  });
});
