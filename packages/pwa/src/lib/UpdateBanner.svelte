<script lang="ts">
  import type { PerchStore } from '../store.svelte';
  import { isTestBuild } from '../core/build-label';

  let { store }: { store: PerchStore } = $props();

  // Name the incoming worktree build when it's a test build; otherwise stay generic
  // (a plain `main` production update doesn't need a slug).
  let message = $derived(
    store.incomingBuildLabel && isTestBuild(store.incomingBuildLabel)
      ? `New build from ${store.incomingBuildLabel}`
      : 'New version available',
  );
</script>

{#if store.updateReady}
  <div class="banner" role="status">
    <span class="msg">{message}</span>
    <button type="button" class="reload" onclick={() => store.applyUpdate()}>Reload</button>
    <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => store.dismissUpdate()}>✕</button>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    left: 0.75rem;
    right: 0.75rem;
    top: calc(0.75rem + env(safe-area-inset-top));
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    background: #1f2a3a;
    border: 1px solid #345;
    color: #eee;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 10;
  }
  .msg { flex: 1; font-size: 0.9rem; }
  .reload {
    min-height: 36px;
    padding: 0 0.9rem;
    border: 0;
    border-radius: 5px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    touch-action: manipulation;
  }
  .reload:active { background: var(--accent-press); }
  .dismiss {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #aaa;
    font-size: 16px;
    touch-action: manipulation;
  }
  .dismiss:active { background: #2a3543; }
</style>
