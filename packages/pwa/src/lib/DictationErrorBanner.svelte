<script lang="ts">
  import type { PerchStore } from '../store.svelte';

  let { store }: { store: PerchStore } = $props();

  let message = $derived(store.dictationError ?? 'Dictation failed');
</script>

{#if store.dictationState === 'error'}
  <div class="banner" role="alert">
    <span class="msg">⚠️ {message}</span>
    <button type="button" class="retry" onclick={() => store.toggleDictation()}>Retry</button>
    <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => store.dismissDictationError()}>✕</button>
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
  .retry {
    min-height: 36px;
    padding: 0 0.9rem;
    border: 0;
    border-radius: 5px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    touch-action: manipulation;
  }
  .retry:active { background: var(--accent-press); }
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
