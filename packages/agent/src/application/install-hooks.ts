const HOOK_EVENTS = [
  'Stop',
  'Notification',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
] as const;

// Marker that identifies a Perch-registered hook command, regardless of the
// path form (stable `~/.perch/...` or a legacy absolute repo path). Used to
// strip stale entries so re-running install-hooks is idempotent.
const PERCH_HOOK_MARKER = 'perch-hook.sh';

interface HookEntry {
  hooks: Array<{ type: 'command'; command: string }>;
}

function isPerchEntry(entry: HookEntry): boolean {
  return entry.hooks.some((h) => h.command.includes(PERCH_HOOK_MARKER));
}

export function installHooks(
  deps: { settings: Record<string, unknown> },
  params: { hookCommand: string; port: number },
): Record<string, unknown> {
  const settings = { ...deps.settings };
  const existingHooks = (settings.hooks as Record<string, HookEntry[]> | undefined) ?? {};
  const hooks: Record<string, HookEntry[]> = { ...existingHooks };

  for (const event of HOOK_EVENTS) {
    const command = `${params.hookCommand} ${event} ${params.port}`;
    // Drop any prior Perch entry (including legacy absolute-path commands) so
    // the stable, machine-identical command fully replaces it.
    const entries = (hooks[event] ?? []).filter((entry) => !isPerchEntry(entry));
    entries.push({ hooks: [{ type: 'command', command }] });
    hooks[event] = entries;
  }

  settings.hooks = hooks;
  return settings;
}
