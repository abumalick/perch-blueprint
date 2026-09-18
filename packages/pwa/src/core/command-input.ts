import type { CommandEntry } from '@perch/contracts';

// What a picked shortcut writes to the pty. A `submit` command runs on the spot; anything
// else lands in the prompt with a trailing space, ready for its argument.
export function commandInput(entry: CommandEntry): string {
  return entry.submit ? `${entry.command}\r` : `${entry.command} `;
}
