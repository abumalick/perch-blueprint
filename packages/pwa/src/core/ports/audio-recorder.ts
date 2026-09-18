// Records microphone audio. `start` begins capture; `stop` ends it and resolves with the
// recorded audio as a Blob. Implemented in the browser by a MediaRecorder adapter; faked
// in tests.
export interface AudioRecorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
}
