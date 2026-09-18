// A tiny build-time manifest, emitted to the site root and excluded from the service
// worker precache, so a running PWA can fetch the *incoming* build's identity when an
// update is waiting (the running JS only knows its own, now-stale, BUILD_LABEL).
export const VERSION_FILE = 'version.json';

export function buildVersionJson(label: string, buildId: string): string {
  return JSON.stringify({ label, buildId });
}

// Parse a fetched version.json. Tolerant of missing/wrong-typed fields and non-object
// input (returns null per field) so a malformed response never throws into the poller.
export function parseVersionJson(data: unknown): { label: string | null; buildId: string | null } {
  const obj = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  return {
    label: typeof obj.label === 'string' ? obj.label : null,
    buildId: typeof obj.buildId === 'string' ? obj.buildId : null,
  };
}
