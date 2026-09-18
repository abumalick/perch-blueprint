import { basename } from 'node:path';

// Claude Code sets the terminal title to "<status-glyph> <task title>" (e.g.
// "✳ ui improvements"). Strip that leading glyph to recover the task title.
// Plain shells leave the pane title at the machine hostname (no glyph prefix),
// in which case we fall back to the session's directory name.
const STATUS_PREFIX = /^[^\p{L}\p{N}]+\s+/u;

export function deriveWorkspaceName(paneTitle: string, startPath: string): string {
  if (STATUS_PREFIX.test(paneTitle)) {
    const stripped = paneTitle.replace(STATUS_PREFIX, '').trim();
    if (stripped) return stripped;
  }
  return basename(startPath);
}
