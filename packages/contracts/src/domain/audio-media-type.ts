const BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
};

// The audio MIME for a path's extension, or '' when it is not a known audio file (or has no
// extension — a leading dot like ".mp3rc" is a dotfile, not an extension). Shared by the
// agent (which serves audio bytes over HTTP) and the PWA (which routes audio to the player),
// mirroring imageMediaType/pdfMediaType.
export function audioMediaType(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (dot <= slash + 1) return '';
  return BY_EXT[path.slice(dot + 1).toLowerCase()] ?? '';
}
