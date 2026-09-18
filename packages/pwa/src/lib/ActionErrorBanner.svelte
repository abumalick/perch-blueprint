<script lang="ts">
  import type { PerchStore } from '../store.svelte';

  let { store }: { store: PerchStore } = $props();
</script>

{#if store.actionError}
  <div class="banner" role="alert">
    <span class="msg">⚠️ {store.actionError}</span>
    <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => store.dismissActionError()}>✕</button>
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
    background: #3a1f22;
    border: 1px solid var(--danger, #e5484d);
    color: #eee;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 10;
  }
  .msg { flex: 1; font-size: 0.9rem; }
  .dismiss {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #ddd;
    font-size: 16px;
    touch-action: manipulation;
  }
  .dismiss:active { background: #4a2b2e; }
</style>
