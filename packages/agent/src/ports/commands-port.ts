import type { CommandEntry } from '@perch/contracts';

export interface CommandsPort {
  // The command shortcuts the PWA's keyboard-bar drop-down offers, in file order.
  // Empty when the config file is absent — the drop-down is then hidden.
  list(): Promise<CommandEntry[]>;
}
