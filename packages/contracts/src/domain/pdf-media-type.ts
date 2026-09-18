// 'application/pdf' for a path's `.pdf` extension, or '' otherwise (including no extension —
// a leading dot like ".pdfrc" is a dotfile, not an extension). Shared by the agent (which
// serves PDF bytes over HTTP) and the PWA (which routes PDFs to the viewer), mirroring
// imageMediaType.
export function pdfMediaType(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (dot <= slash + 1) return '';
  return path.slice(dot + 1).toLowerCase() === 'pdf' ? 'application/pdf' : '';
}
