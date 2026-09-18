import { imageMediaType, pdfMediaType, audioMediaType } from '@perch/contracts';
import type { FileReaderPort } from '../ports/file-reader-port';
import { pathWithinRoots } from './path-within-roots';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

export type ReadServableFileResult =
  | { kind: 'ok'; mediaType: string; bytes: Uint8Array }
  | { kind: 'forbidden' }
  | { kind: 'not-servable' }
  | { kind: 'too-large' };

// The media type and byte cap for a file the /file endpoint will serve (image, PDF, or
// audio), or null when it is none. PDFs and audio get larger caps than images since they are
// routinely bigger.
function servable(path: string): { mediaType: string; maxBytes: number } | null {
  const image = imageMediaType(path);
  if (image) return { mediaType: image, maxBytes: MAX_IMAGE_BYTES };
  const pdf = pdfMediaType(path);
  if (pdf) return { mediaType: pdf, maxBytes: MAX_PDF_BYTES };
  const audio = audioMediaType(path);
  if (audio) return { mediaType: audio, maxBytes: MAX_AUDIO_BYTES };
  return null;
}

// Reads a servable file's raw bytes for the agent's HTTP /file endpoint. Authorization is
// checked first (don't leak existence outside the roots), then the extension; a file larger
// than its cap is reported rather than truncated (a partial image/PDF render is broken).
export async function readServableFile(
  deps: { reader: FileReaderPort },
  path: string,
  allowedRoots: string[],
): Promise<ReadServableFileResult> {
  if (!pathWithinRoots(path, allowedRoots)) return { kind: 'forbidden' };
  const match = servable(path);
  if (!match) return { kind: 'not-servable' };
  const { bytes, truncated } = await deps.reader.read(path, match.maxBytes);
  if (truncated) return { kind: 'too-large' };
  return { kind: 'ok', mediaType: match.mediaType, bytes };
}
