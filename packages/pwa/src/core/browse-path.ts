// Posix path helpers for the file browser. Agent paths are posix (Mac/Ubuntu targets).
function trimTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.replace(/\/+$/, '') : p;
}

export function basename(p: string): string {
  const trimmed = trimTrailingSlash(p);
  if (trimmed === '/') return '/';
  const i = trimmed.lastIndexOf('/');
  return i < 0 ? trimmed : trimmed.slice(i + 1);
}

export function parent(p: string): string {
  const trimmed = trimTrailingSlash(p);
  const i = trimmed.lastIndexOf('/');
  if (i <= 0) return '/';
  return trimmed.slice(0, i);
}
