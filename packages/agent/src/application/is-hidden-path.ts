// True when any path segment of `path` equals one of the hidden folder `names`.
// Hides the named folder itself, everything nested under it, and any folder of that
// name wherever it sits in the tree. An empty `names` list hides nothing (feature off).
export function isHiddenPath(path: string, names: string[]): boolean {
  if (names.length === 0) return false;
  const hidden = new Set(names);
  return path.split('/').some((segment) => hidden.has(segment));
}
