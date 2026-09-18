const BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

// The image MIME for a path's extension, or '' when it is not a known image (or has no
// extension — a leading dot like ".pngrc" is a dotfile, not an extension). Shared by the
// agent (which serves image bytes over HTTP) and the PWA (which routes images to the viewer).
export function imageMediaType(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (dot <= slash + 1) return '';
  return BY_EXT[path.slice(dot + 1).toLowerCase()] ?? '';
}
