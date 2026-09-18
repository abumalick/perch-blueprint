// An attached file is base64-encoded onto the *terminal* WebSocket (putFile), the same
// stream that carries pty output — which is why image downloads were moved off it onto
// HTTP. Uploads still ride it, so they need a ceiling: without one, attaching a large
// archive stalls the terminal for as long as the transfer takes. While the picker was
// image-only the file sizes bounded themselves; accepting every extension removes that.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Null when the size is acceptable, otherwise the message to show the user.
export function checkUploadSize(bytes: number): string | null {
  if (bytes <= MAX_UPLOAD_BYTES) return null;
  return `File is too large to attach (${MAX_UPLOAD_BYTES / 1024 / 1024} MB max)`;
}
