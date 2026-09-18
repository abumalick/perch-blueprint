<script lang="ts">
  import type { PerchStore } from '../store.svelte';
  import { resolveProjectPath, displayProjectPath, relativeProjectPath } from '../core/resolve-path';
  import FolderPicker from './FolderPicker.svelte';

  let { store }: { store: PerchStore } = $props();

  // Only enabled machines the agent currently reports online are selectable — an
  // offline/disabled machine can't create a workspace anyway. Alphabetical by name.
  let connectedMachines = $derived(
    store.machines
      .filter((m) => m.enabled !== false && store.statuses[m.id] === 'online')
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  function initialMachine(list: { id: string }[]): string {
    const last = store.lastMachineId;
    if (last && list.some((m) => m.id === last)) return last;
    return list[0]?.id ?? '';
  }

  // The built-in commands, each with the models it can launch with.
  // A model is appended as `--model '<value>'`; "custom" reveals a free-text field instead.
  // The value is single-quoted because tmux runs the command string through the login shell,
  // and `opus[1m]` is a glob pattern there: under zsh an unmatched glob aborts the whole
  // command line, so the session would die before `claude` ever started. Quoting every model
  // keeps that from coming back with the next value someone adds.
  // Every value is an alias, never a pinned id: the CLI resolves an alias to the newest model
  // in that family at launch, so a new release lands here with no edit. Pinning
  // (`claude-fable-5-1`) would freeze the picker one release behind, forever.
  // Opus 5 and Sonnet 5 are natively 1M, so their `[1m]` suffix is a no-op the CLI strips —
  // kept because it is what ships and works, not because it still buys anything. Haiku is the
  // one 200K entry and can't be raised: Haiku 4.5 has no 1M window, so
  // `claude-haiku-4-5[1m]` is rejected with a 400.
  type Model = { value: string; label: string };
  type Command = { id: 'claude' | 'codex' | 'zsh'; label: string; base: string; models: Model[] };
  const COMMANDS: Command[] = [
    {
      id: 'claude',
      label: 'Claude',
      base: 'claude',
      models: [
        { value: 'opus[1m]', label: 'Opus' },
        { value: 'sonnet[1m]', label: 'Sonnet' },
        { value: 'haiku', label: 'Haiku' },
        { value: 'fable', label: 'Fable' },
      ],
    },
    {
      id: 'codex',
      label: 'Codex',
      base: 'codex',
      models: [
        { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
        { value: 'gpt-5.5', label: 'gpt-5.5' },
        { value: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
        { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      ],
    },
    { id: 'zsh', label: 'ZSH', base: 'zsh', models: [] },
  ];
  type CommandId = Command['id'] | 'custom';

  const firstModelOf = (id: CommandId): string => COMMANDS.find((c) => c.id === id)?.models[0]?.value ?? '';

  // Deliberately a one-time snapshot at mount, not a live reference: the $effect below
  // keeps machineId valid if connectedMachines changes afterward.
  let machineId = $state(initialMachine(connectedMachines));
  let path = $state('');
  // The form always opens at Claude + Opus; switching command resets the model to that
  // command's first option (see selectCommand). Last-used command is intentionally not restored.
  let commandId = $state<CommandId>('claude');
  let model = $state(firstModelOf('claude'));
  let customCommand = $state('');
  let models = $derived(COMMANDS.find((c) => c.id === commandId)?.models ?? []);
  let command = $derived.by(() => {
    if (commandId === 'custom') return customCommand.trim();
    const cmd = COMMANDS.find((c) => c.id === commandId);
    if (!cmd) return '';
    return cmd.models.length > 0 ? `${cmd.base} --model '${model}'` : cmd.base;
  });

  function selectCommand(id: CommandId): void {
    commandId = id;
    if (id !== 'custom') model = firstModelOf(id);
  }
  // Once the user edits the path, stop overriding it with the machine's recent path.
  let pathEdited = $state(false);
  // True while the folder picker has replaced the form. The component stays mounted, so the
  // form's draft (machine, path, command) survives the round-trip.
  let browsing = $state(false);

  let recentPaths = $derived(store.recentPaths[machineId] ?? []);
  let defaultPath = $derived(store.machines.find((m) => m.id === machineId)?.defaultPath ?? '');
  // What actually gets sent: a relative path is joined onto the machine default, an
  // absolute path passes through, an empty path opens the default root.
  let resolved = $derived(resolveProjectPath(defaultPath || undefined, path));
  // The agent's project roots for this machine — the picker's browse points. Browse is only
  // available when the agent reported at least one (an older agent reports none, so the user
  // falls back to typing the path).
  let roots = $derived(store.machineRoots[machineId] ?? []);

  // Preselect the most-recently-used path for the chosen machine; re-runs when the
  // machine changes or recent paths arrive from the agent, until the user types a path.
  $effect(() => {
    if (!pathEdited) path = recentPaths[0] ?? '';
  });

  // Keep the selection valid if the connected set changes while the form is open
  // (e.g. the selected machine drops offline).
  $effect(() => {
    if (!connectedMachines.some((m) => m.id === machineId)) machineId = initialMachine(connectedMachines);
  });

  function create(event: SubmitEvent): void {
    event.preventDefault();
    if (!machineId || !resolved || !command) return;
    store.requestCreate(machineId, resolved, command);
  }

  function openPicker(): void {
    store.openFolderPicker();
    browsing = true;
    // A single root: dive straight in. Several: the picker shows the roots list first.
    const [only] = roots;
    if (roots.length === 1 && only) store.pickerBrowse(machineId, only);
  }

  function pick(picked: string): void {
    path = relativeProjectPath(defaultPath || undefined, picked);
    pathEdited = true;
    store.closeFolderPicker();
    browsing = false;
  }

  function cancelPicker(): void {
    store.closeFolderPicker();
    browsing = false;
  }
</script>

{#if browsing}
  <FolderPicker {store} {roots} {machineId} onpick={pick} oncancel={cancelPicker} />
{:else}
<section>
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={() => store.cancelCreate()}>‹</button>
    <h2>New workspace</h2>
  </header>

  <fieldset class="radios">
    <legend>Machine</legend>
    {#if connectedMachines.length > 0}
      <div class="radio-row">
        {#each connectedMachines as m (m.id)}
          <label class="radio" class:selected={machineId === m.id}>
            <input type="radio" name="machine" value={m.id} checked={machineId === m.id} onchange={() => (machineId = m.id)} />
            {m.name}
          </label>
        {/each}
      </div>
    {:else}
      <p class="empty">No connected machines</p>
    {/if}
  </fieldset>

  {#if recentPaths.length > 0}
    <p class="recent-label">Recent</p>
    <div class="recent">
      {#each recentPaths as recentPath (recentPath)}
        <button type="button" class:selected={path === recentPath} onclick={() => (path = recentPath)}>{displayProjectPath(defaultPath || undefined, recentPath)}</button>
      {/each}
    </div>
  {/if}

  <form onsubmit={create}>
    <label>
      {#if defaultPath}Path (relative to {defaultPath}){:else}Path{/if}
      <div class="path-row">
        <input
          data-testid="path"
          bind:value={path}
          oninput={() => (pathEdited = true)}
          placeholder={defaultPath ? 'project' : '/home/u/workspace/project'}
        />
        <button type="button" class="browse" aria-label="Browse" disabled={roots.length === 0} onclick={openPicker}>Browse…</button>
      </div>
    </label>
    {#if defaultPath}<p class="resolved" data-testid="resolved-preview">→ {resolved}</p>{/if}
    <fieldset class="radios">
      <legend>Command</legend>
      <div class="radio-row">
        {#each COMMANDS as c (c.id)}
          <label class="radio" class:selected={commandId === c.id}>
            <input type="radio" name="command" value={c.id} checked={commandId === c.id} onchange={() => selectCommand(c.id)} />
            {c.label}
          </label>
        {/each}
        <label class="radio" class:selected={commandId === 'custom'}>
          <input type="radio" name="command" value="custom" checked={commandId === 'custom'} onchange={() => selectCommand('custom')} />
          Custom…
        </label>
      </div>
    </fieldset>
    {#if models.length > 0}
      <fieldset class="radios">
        <legend>Model</legend>
        <div class="radio-row">
          {#each models as m (m.value)}
            <label class="radio" class:selected={model === m.value}>
              <input type="radio" name="model" value={m.value} checked={model === m.value} onchange={() => (model = m.value)} />
              {m.label}
            </label>
          {/each}
        </div>
      </fieldset>
    {/if}
    {#if commandId === 'custom'}
      <label>Custom command
        <input data-testid="custom-command" bind:value={customCommand} placeholder="claude --resume" />
      </label>
    {/if}
    {#if store.createError}<p class="error" role="alert">⚠ {store.createError}</p>{/if}
    <button type="submit" class="create" disabled={connectedMachines.length === 0}>Create</button>
  </form>
</section>
{/if}

<style>
  /* Match the workspace pages' header: back button inline with the title. */
  header { display: flex; align-items: center; gap: 0.5rem; }
  header button.icon {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 22px;
    line-height: 1;
    touch-action: manipulation;
  }
  header button.icon:active { background: var(--surface-press); }
  header h2 { margin: 0; font-size: 1rem; font-weight: 600; }
  label { display: block; margin: 0.5rem 0; }
  input { width: 100%; min-height: 44px; box-sizing: border-box; }
  .path-row { display: flex; gap: 0.4rem; }
  .path-row input { flex: 1 1 auto; min-width: 0; }
  .browse {
    flex: 0 0 auto;
    min-height: 44px;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.85rem;
    white-space: nowrap;
    touch-action: manipulation;
  }
  .browse:active { background: var(--surface-press); }
  .browse:disabled { opacity: 0.5; }
  .recent-label { margin: 1rem 0 0.4rem; font-size: 0.8rem; color: var(--text-dim); }
  .recent { display: flex; flex-direction: column; gap: 0.4rem; }
  .recent button {
    display: block;
    width: 100%;
    text-align: left;
    min-height: 44px;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.85rem;
    touch-action: manipulation;
  }
  .recent button:active { background: var(--surface-press); }
  /* The chosen recent path is mirrored into the input; mark it so the source is obvious. */
  .recent button.selected { border-color: var(--accent); color: var(--text); }
  .resolved { margin: 0.25rem 0; font-size: 0.8rem; color: var(--text-dim); word-break: break-all; }
  .error { margin: 0.5rem 0; font-size: 0.85rem; color: var(--danger); word-break: break-all; }
  .radios { border: 0; padding: 0; margin: 0.75rem 0 0; }
  .radios legend { padding: 0; margin-bottom: 0.4rem; font-size: 0.8rem; color: var(--text-dim); }
  .empty { margin: 0; font-size: 0.85rem; color: var(--text-dim); }
  .radio-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .radio {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin: 0;
    padding: 0 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.85rem;
    touch-action: manipulation;
    cursor: pointer;
  }
  .radio:active { background: var(--surface-press); }
  .radio.selected { border-color: var(--accent); background: var(--surface-press); }
  /* The native control fills the chip transparently: selection is shown by the label styling
     above, while the real radio stays the (focusable, tappable) hit target for a11y. */
  .radio input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  button.create {
    width: 100%;
    min-height: 44px;
    margin-top: 1rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--bg);
    font-size: 1rem;
    font-weight: 600;
    touch-action: manipulation;
  }
  button.create:active { opacity: 0.85; }
  button.create:disabled { opacity: 0.5; }
</style>
