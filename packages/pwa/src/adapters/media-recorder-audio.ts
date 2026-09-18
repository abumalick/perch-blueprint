import type { AudioRecorder } from '../core/ports/audio-recorder';

// Records microphone audio with the browser's MediaRecorder. `start` requests mic access
// (the rejection surfaces as the "Microphone blocked" state upstream) and begins capture;
// `stop` ends it, releases the mic, and resolves with the recorded audio. The mime type is
// left to the platform (Safari → mp4/aac, Chromium → webm/opus), both of which Scribe accepts.
export class MediaRecorderAudio implements AudioRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const recorder = new MediaRecorder(this.stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.start();
    this.recorder = recorder;
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder) {
        reject(new Error('not recording'));
        return;
      }
      recorder.onstop = () => {
        this.stream?.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || this.chunks[0]?.type || 'audio/webm';
        resolve(new Blob(this.chunks, { type }));
        this.recorder = null;
        this.stream = null;
      };
      recorder.stop();
    });
  }
}
