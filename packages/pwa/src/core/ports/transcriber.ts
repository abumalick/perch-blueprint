// Turns recorded audio into text. Implemented by the ElevenLabs adapter; faked in tests.
// Throws when it cannot transcribe (e.g. no API key configured, or the API rejects).
export interface Transcriber {
  transcribe(audio: Blob): Promise<string>;
}
