<script lang="ts">
  import type { PerchStore } from '../store.svelte';
  import { basename, parent } from '../core/browse-path';

  let { store }: { store: PerchStore } = $props();

  let entries = $derived(store.dirEntries);
  let atRoot = $derived(!!entries && entries.path === store.browserRoot);

  // The header arrow sits beside a title showing the current folder, so it must undo the
  // descent rather than close. It only falls back to closing at the confinement root or when
  // no entries loaded (a failed initial browse) — precisely when a dead button would trap the
  // user. "Close" is the way back to the terminal from any depth.
  function back(): void {
    if (!entries || atRoot) store.closeBrowser();
    else store.browseInto(parent(entries.path));
  }
</script>

<section class="browser">
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={back}>‹</button>
    <span class="title">{entries ? basename(entries.path) : ''}</span>
    <button type="button" class="dismiss" onclick={() => store.closeBrowser()}>Close</button>
  </header>

  {#if store.browseError}
    <p class="error">Couldn't open this folder.<br /><span>{store.browseError}</span></p>
  {:else if !entries}
    <p class="empty">Loading…</p>
  {:else}
    <ul>
      {#if !atRoot}
        <li>
          <button type="button" aria-label="Up one level" onclick={back}>
            <span class="glyph" aria-hidden="true">📁</span><span class="name">..</span>
          </button>
        </li>
      {/if}
      {#each entries.subdirs as dir (dir)}
        <li>
          <button type="button" onclick={() => store.browseInto(dir)}>
            <span class="glyph" aria-hidden="true">📁</span><span class="name">{basename(dir)}</span>
          </button>
        </li>
      {/each}
      {#each entries.files as file (file)}
        <li>
          <button type="button" onclick={() => store.openFile(file)}>
            <span class="glyph" aria-hidden="true">📄</span><span class="name">{basename(file)}</span>
          </button>
        </li>
      {/each}
    </ul>
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
</style>
