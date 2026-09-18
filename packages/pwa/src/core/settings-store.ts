import type { StoragePort } from './ports/storage';

export interface MachineConfig {
  id: string;
  name: string;
  url: string;
  token: string;
  defaultPath?: string; // root that relative New-workspace paths resolve against
  enabled?: boolean; // absent = enabled; false = user switched the machine off
}

const KEY = 'perch.machines';
const LAST_MACHINE_KEY = 'perch.lastMachine';
const LAST_COMMAND_KEY = 'perch.lastCommand';
const FILE_WRAP_KEY = 'perch.fileWrap';
const TERMINAL_FONT_SIZE_KEY = 'perch.terminalFontSize';
const ELEVENLABS_API_KEY = 'perch.elevenLabsApiKey';
const FOLDER_FILTER_KEY = 'perch.folderFilter';

export const TERMINAL_FONT_MIN = 8;
export const TERMINAL_FONT_MAX = 24;
export const TERMINAL_FONT_DEFAULT = 13;

export function clampFontSize(size: number): number {
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(size)));
}

export class SettingsStore {
  constructor(private readonly storage: StoragePort) {}

  list(): MachineConfig[] {
    const raw = this.storage.read(KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as MachineConfig[]) : [];
    } catch {
      return [];
    }
  }

  add(config: MachineConfig): void {
    const next = [...this.list().filter((m) => m.id !== config.id), config];
    this.persist(next);
  }

  update(id: string, patch: { url: string; token?: string; defaultPath?: string }): void {
    const machines = this.list();
    if (!machines.some((m) => m.id === id)) return;
    this.persist(
      machines.map((m) =>
        m.id === id
          ? {
              ...m,
              url: patch.url,
              token: patch.token ?? m.token,
              defaultPath: patch.defaultPath ?? m.defaultPath,
            }
          : m,
      ),
    );
  }

  remove(id: string): void {
    this.persist(this.list().filter((m) => m.id !== id));
  }

  setEnabled(id: string, enabled: boolean): void {
    const machines = this.list();
    if (!machines.some((m) => m.id === id)) return;
    this.persist(machines.map((m) => (m.id === id ? { ...m, enabled } : m)));
  }

  lastMachine(): string | null {
    return this.storage.read(LAST_MACHINE_KEY);
  }

  setLastMachine(id: string): void {
    this.storage.write(LAST_MACHINE_KEY, id);
  }

  // The command run for the last create, so the New workspace view can preselect it.
  lastCommand(): string | null {
    return this.storage.read(LAST_COMMAND_KEY);
  }

  setLastCommand(command: string): void {
    this.storage.write(LAST_COMMAND_KEY, command);
  }

  // Project-folder filter pills on the home list, persisted so the selection survives
  // navigation (WorkspaceList remounts on the narrow layout) and app reload.
  folderFilter(): string[] {
    const raw = this.storage.read(FOLDER_FILTER_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }

  setFolderFilter(keys: string[]): void {
    this.storage.write(FOLDER_FILTER_KEY, JSON.stringify(keys));
  }

  // File viewer word-wrap preference. Defaults on (friendlier on a narrow phone); only an
  // explicit '0' means off, so an unset key reads as on.
  fileWrap(): boolean {
    return this.storage.read(FILE_WRAP_KEY) !== '0';
  }

  setFileWrap(on: boolean): void {
    this.storage.write(FILE_WRAP_KEY, on ? '1' : '0');
  }

  // Global terminal font size (zoom). Unset, non-numeric, or out-of-range values fall back
  // to the default; valid values are clamped to the supported range.
  terminalFontSize(): number {
    const raw = this.storage.read(TERMINAL_FONT_SIZE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? clampFontSize(parsed) : TERMINAL_FONT_DEFAULT;
  }

  setTerminalFontSize(size: number): void {
    this.storage.write(TERMINAL_FONT_SIZE_KEY, String(clampFontSize(size)));
  }

  // The ElevenLabs API key for client-side speech-to-text. App-global, stored on-device
  // only (never sent to the agent, never committed). An empty value clears it.
  elevenLabsApiKey(): string | null {
    const raw = this.storage.read(ELEVENLABS_API_KEY);
    return raw ? raw : null;
  }

  setElevenLabsApiKey(key: string): void {
    this.storage.write(ELEVENLABS_API_KEY, key);
  }

  private persist(machines: MachineConfig[]): void {
    this.storage.write(KEY, JSON.stringify(machines));
  }
}
