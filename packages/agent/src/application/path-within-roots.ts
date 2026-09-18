import { resolve } from 'node:path';

// True when `path` is one of `roots` or nested under one of them. Used to authorize a
// browse request against the set of allowed roots (live workspace project paths ∪ the
// configured PERCH_PROJECT_ROOTS). Both sides are resolved to absolute first.
export function pathWithinRoots(path: string, roots: string[]): boolean {
  const target = resolve(path);
  return roots.some((r) => {
    const root = resolve(r);
    return target === root || target.startsWith(`${root}/`);
  });
}
