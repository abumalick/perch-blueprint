// Session-name → workspace ownership, mirroring the PWA's rule (browser-sessions.ts): a
// session belongs to workspace `<id>` when its name is exactly the id or starts with
// `<id>__`. Workspace ids never contain the `__` delimiter, so a simple prefix test is
// unambiguous — no need for the PWA's longest-id tiebreak, which only matters for display
// when ids nest (impossible here).
const DELIMITER = '__';

export function browserSessionsForWorkspace(
  sessionNames: readonly string[],
  workspaceId: string,
): string[] {
  return sessionNames.filter(
    (name) => name === workspaceId || name.startsWith(workspaceId + DELIMITER),
  );
}
