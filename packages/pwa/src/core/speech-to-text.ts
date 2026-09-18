import type { AudioRecorder } from './ports/audio-recorder';
import type { Transcriber } from './ports/transcriber';

export type DictationState = 'idle' | 'recording' | 'transcribing' | 'error';

// Drives the record → transcribe → insert lifecycle for push-to-talk dictation. Pure
// orchestration: the microphone and the transcription API are injected ports, so the whole
// state machine is unit-tested with fakes. `onText` receives the transcript (non-empty
// only); `onChange` lets a reactive UI mirror the state.
export class SpeechToText {
  private _state: DictationState = 'idle';
  private _error: string | null = null;

  constructor(
    private readonly recorder: AudioRecorder,
    private readonly transcriber: Transcriber,
    private readonly onText: (text: string) => void,
    private readonly onChange?: () => void,
  ) {}

  get state(): DictationState {
    return this._state;
  }

  get error(): string | null {
    return this._error;
  }

  // One control for the whole flow: idle/error → start recording; recording → stop and
  // transcribe. A toggle while transcribing is ignored (the button is disabled anyway).
  async toggle(): Promise<void> {
    if (this._state === 'recording') return this.stopAndTranscribe();
    if (this._state === 'transcribing') return;
    return this.startRecording();
  }

  // Clear an error back to idle (e.g. the user dismissing the error banner). A no-op in any
  // other state so it can't interrupt an in-flight recording or transcription.
  dismiss(): void {
    if (this._state === 'error') this.set('idle');
  }

  private set(state: DictationState, error: string | null = null): void {
    this._state = state;
    this._error = error;
    this.onChange?.();
  }

  private async startRecording(): Promise<void> {
    try {
      await this.recorder.start();
      this.set('recording');
    } catch {
      this.set('error', 'Microphone blocked');
    }
  }

  private async stopAndTranscribe(): Promise<void> {
    this.set('transcribing');
    try {
      const audio = await this.recorder.stop();
      const text = await this.transcriber.transcribe(audio);
      if (text.trim()) this.onText(text);
      this.set('idle');
    } catch (e) {
      this.set('error', e instanceof Error ? e.message : 'Transcription failed');
    }
  }
}
