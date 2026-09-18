<script lang="ts">
  import type { PerchStore } from '../store.svelte';

  let { store }: { store: PerchStore } = $props();

  let name = $state('');
  let url = $state('');
  let token = $state('');
  let defaultPath = $state('');

  function slug(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '-');
  }

  function add(event: SubmitEvent): void {
    event.preventDefault();
    if (!name || !url || !token) return;
    store.addMachine({ id: slug(name), name, url, token, defaultPath: defaultPath || undefined });
    store.goSettings();
  }
</script>

<section>
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={() => store.goSettings()}>‹</button>
    <h2>Add machine</h2>
  </header>

  <form onsubmit={add}>
    <label>Name <input bind:value={name} /></label>
    <label>URL <input bind:value={url} placeholder="wss://mac.tailnet.ts.net" /></label>
    <label>Token <input bind:value={token} type="password" /></label>
    <label>Default path <input bind:value={defaultPath} placeholder="/home/u/workspace" /></label>
    <button type="submit" class="add" aria-label="Add machine">＋ Add machine</button>
  </form>
</section>

<style>
  header { display: flex; align-items: center; gap: 0.5rem; }
  header h2 { margin: 0; font-size: 1rem; font-weight: 600; }
  label { display: block; margin: 0.5rem 0; }
  input { width: 100%; min-height: 44px; box-sizing: border-box; }
  button.icon {
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
  button.icon:active { background: var(--surface-press); }
  button.add {
    display: block;
    width: 100%;
    margin-top: 0.75rem;
    min-height: 44px;
    padding: 0 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.9rem;
    touch-action: manipulation;
  }
  button.add:active { background: var(--surface-press); }
</style>
