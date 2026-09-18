// A safe new folder name: a single non-empty path segment, no separators or traversal.
// Mirrors the agent's guard in application/make-dir.ts so the picker can gate its input
// before sending; the agent re-validates (never trust the client).
export function isValidFolderName(name: string): boolean {
  const clean = name.trim();
  return clean.length > 0 && !clean.includes('/') && clean !== '.' && clean !== '..';
}
