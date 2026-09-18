<script lang="ts">
  import type { PerchStore } from '../store.svelte';
  import { basename, parent } from '../core/browse-path';
  import { isValidFolderName } from '../core/folder-name';

  let {
    store,
    roots,
    machineId,
    onpick,
    oncancel,
  }: {
    store: PerchStore;
    roots: string[];
    machineId: string;
    onpick: (path: string) => void;
    oncancel: () => void;
  } = $props();

  // The root chosen from a multi-root list (null until chosen). With a single root there is
  // no list, so the picker is always confined to it; the initial browse is kicked by the
  // parent (CreateWorkspace). "Up" from a root clears the selection back to the list.
  let selected = $state<string | null>(null);
  let confinedRoot = $derived(roots.length === 1 ? (roots[0] ?? null) : selected);

  let entries = $derived(store.dirEntries);
  let atRoot = $derived(!!entries && entries.path === confinedRoot);

  function selectRoot(root: string): void {
    selected = root;
    store.pickerBrowse(machineId, root);
  }

  // The header arrow sits beside a title showing the current folder, so it must undo the
  // descent rather than dismiss. It only falls back to dismissing where there is nothing left
  // to ascend to — the roots list, a single confinement root, or a failed initial browse
  // (dirEntries null), which is precisely when a dead button would trap the user.
  function back(): void {
    if (!entries || confinedRoot === null) oncancel();
    else if (!atRoot) store.pickerBrowse(machineId, parent(entries.path));
    else if (roots.length > 1) selected = null;
    else oncancel();
  }

  // Inline "New folder" flow. The agent replies with a dirEntries for the new folder, so the
  // existing dirEntries handling browses into it — no extra client step here.
  let creating = $state(false);
  let newName = $state('');
  let newNameValid = $derived(isValidFolderName(newName));

  // Names already present in the current directory (folders + files). Creating a folder that
  // collides would fail on the agent with EEXIST; catch it here so the user stays in the picker.
  let existingNames = $derived(
    new Set([...(entries?.subdirs ?? []), ...(entries?.files ?? [])].map(basename)),
  );
  let nameTaken = $derived(existingNames.has(newName.trim()));
  let canCreate = $derived(newNameValid && !nameTaken);

  function startCreate(): void {
    creating = true;
    newName = '';
  }

  function submitCreate(): void {
    if (!entries || !canCreate) return;
    store.pickerMakeDir(machineId, entries.path, newName.trim());
    creating = false;
    newName = '';
  }
</script>

<section class="picker">
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={back}>‹</button>
    <span class="title">{confinedRoot && entries ? basename(entries.path) : 'Pick folder'}</span>
    <button type="button" class="dismiss" onclick={() => oncancel()}>Cancel</button>
  </header>

  {#if confinedRoot === null}
    <ul>
      {#each roots as root (root)}
        <li>
          <button type="button" onclick={() => selectRoot(root)}>
            <span class="glyph" aria-hidden="true">📁</span><span class="name">{root}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    {#if store.browseError}
      <p class="error">Couldn't open this folder.<br /><span>{store.browseError}</span></p>
    {:else if !entries}
      <p class="empty">Loading…</p>
    {:else}
      <ul>
        {#if !atRoot || roots.length > 1}
          <li>
            <button type="button" aria-label="Up one level" onclick={back}>
              <span class="glyph" aria-hidden="true">📁</span><span class="name">..</span>
            </button>
          </li>
        {/if}
        {#each entries.subdirs as dir (dir)}
          <li>
            <button type="button" onclick={() => store.pickerBrowse(machineId, dir)}>
              <span class="glyph" aria-hidden="true">📁</span><span class="name">{basename(dir)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if entries && !store.browseError}
      {#if creating}
        <div class="new-folder">
          <input
            type="text"
            aria-label="Folder name"
            placeholder="Folder name"
            bind:value={newName}
            onkeydown={(e) => e.key === 'Enter' && submitCreate()}
          />
          <button type="button" class="confirm" disabled={!canCreate} onclick={submitCreate}>Create</button>
          <button type="button" class="cancel" onclick={() => (creating = false)}>Cancel</button>
        </div>
        {#if nameTaken}
          <p class="dup">"{newName.trim()}" already exists here.</p>
        {/if}
      {:else}
        <button type="button" class="new" onclick={startCreate}>
          <span class="glyph" aria-hidden="true">＋</span>New folder…
        </button>
      {/if}
    {/if}
    <button type="button" class="use" disabled={!entries} onclick={() => entries && onpick(entries.path)}>
      Use this folder
    </button>
  {/if}
</section>

<style>
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
  header button.dismiss {
    flex: 0 0 auto;
    min-height: 44px;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.9rem;
    touch-action: manipulation;
  }
  header button.dismiss:active { background: var(--surface-press); }
  .title { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--text-dim); }
  .error { color: var(--danger); }
  .error span { color: var(--text-dim); font-size: 0.8rem; word-break: break-all; }
  ul { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    min-height: 44px;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.9rem;
    box-sizing: border-box;
    touch-action: manipulation;
  }
  li button:active { background: var(--surface-press); }
  .glyph { font-size: 1rem; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .new {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 44px;
    margin-top: 0.6rem;
    padding: 0 0.7rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-dim);
    font-size: 0.9rem;
    touch-action: manipulation;
  }
  .new:active { background: var(--surface-press); }
  .new-folder {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.6rem;
  }
  .new-folder input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 44px;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.9rem;
    box-sizing: border-box;
  }
  .new-folder button {
    flex: 0 0 auto;
    min-height: 44px;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.9rem;
    touch-action: manipulation;
  }
  .new-folder button.confirm { border-color: var(--accent); }
  .new-folder button:active { background: var(--surface-press); }
  .new-folder button:disabled { opacity: 0.5; }
  .dup { margin: 0.4rem 0 0; color: var(--danger); font-size: 0.8rem; }
  .use {
    width: 100%;
    min-height: 44px;
    margin-top: 1rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
    touch-action: manipulation;
  }
  .use:active { background: var(--surface-press); }
  .use:disabled { opacity: 0.5; }
</style>
