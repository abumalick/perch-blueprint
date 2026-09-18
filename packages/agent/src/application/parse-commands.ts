import type { CommandEntry } from '@perch/contracts';

// Validates the raw JSON of ~/.perch/commands.json. Hand-edited, so it degrades entry by
// entry rather than rejecting the file: anything without a usable `command` is dropped, and
// only a literal `true` submits (a bad `submit` costs the flag, not the whole command).
export function parseCommands(raw: unknown): CommandEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): CommandEntry[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { command, submit } = entry as { command?: unknown; submit?: unknown };
    if (typeof command !== 'string' || command.length === 0) return [];
    return [{ command, submit: submit === true }];
  });
}
