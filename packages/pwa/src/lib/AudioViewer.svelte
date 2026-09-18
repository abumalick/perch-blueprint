<script lang="ts">
  import type { PerchStore } from '../store.svelte';
  import { basename } from '../core/browse-path';

  let { store }: { store: PerchStore } = $props();
  let file = $derived(store.fileView);
  let pos = $derived(store.audioPosition);

  let audioEl = $state<HTMLAudioElement>();
  // Set when the user navigates (buttons or end-of-track) so the next track starts playing
  // once its bytes arrive. The first track is never auto-played (no user gesture yet).
  let autoplayNext = false;

  // Start the next track once its blob is ready. The <audio> element is kept mounted across
  // tracks (same DOM node) so iOS WebKit preserves the user-activation that permits this
  // scripted play(); a remounted element would be locked and stay silent.
  $effect(() => {
    if (!file?.blobUrl || !autoplayNext || !audioEl) return;
    autoplayNext = false;
    try {
      const p = audioEl.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Autoplay blocked (or unsupported in the test env) — the user can press play.
    }
  });

  function go(dir: -1 | 1): void {
    autoplayNext = true;
    store.showAudioNeighbor(dir);
  }
</script>

<section class="viewer">
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={() => store.closeViewer()}>‹</button>
    <span class="title">{file ? basename(file.path) : ''}</span>
  </header>

  {#if store.viewError}
    <p class="error">Couldn't open this file.<br /><span>{store.viewError}</span></p>
  {:else if file?.truncated}
    <p class="empty">Audio too large to preview (over 30&nbsp;MB).</p>
  {:else if file}
    <!-- Kept mounted across tracks; src swaps reactively. While the bytes load blobUrl is '',
         and we omit the attribute rather than set src="" — an empty src makes WebKit try to
         load the page URL as media and flash the player's error icon. -->
    <audio class="player" bind:this={audioEl} controls src={file.blobUrl || undefined} onended={() => go(1)}></audio>
    <!-- Always present (fixed height) so the loading text doesn't shift the nav controls
         when it appears/disappears between tracks. -->
    <p class="status" aria-live="polite">{file.blobUrl ? '' : 'Loading…'}</p>
    {#if pos && pos.count > 1}
      <div class="nav">
        <button type="button" aria-label="Previous track" disabled={pos.index <= 1} onclick={() => go(-1)}>‹ Prev</button>
        <span class="counter">{pos.index} / {pos.count}</span>
        <button type="button" aria-label="Next track" disabled={pos.index >= pos.count} onclick={() => go(1)}>Next ›</button>
      </div>
    {/if}
  {:else}
    <p class="empty">Loading…</p>
  {/if}
</section>

<style>
  .viewer { display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 0.5rem; }
  header button.icon {
    flex: 0 0 auto; width: 44px; height: 44px; display: grid; place-items: center;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); color: var(--text); font-size: 22px; line-height: 1;
    touch-action: manipulation;
  }
  header button.icon:active { background: var(--surface-press); }
  .title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--text-dim); }
  .error { color: var(--danger); }
  .error span { color: var(--text-dim); font-size: 0.8rem; word-break: break-all; }
  .player { width: 100%; margin-top: 1rem; }
  /* Reserved slot: constant height whether or not the loading text is shown. */
  .status { min-height: 1.25rem; margin: 0.5rem 0 0; text-align: center; color: var(--text-dim); font-size: 0.9rem; }
  .nav { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 0.5rem; }
  .nav button {
    height: 44px; padding: 0 1rem; border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); color: var(--text); font-size: 0.95rem; touch-action: manipulation;
  }
  .nav button:active { background: var(--surface-press); }
  .nav button:disabled { opacity: 0.4; }
  .counter { color: var(--text-dim); font-size: 0.9rem; font-variant-numeric: tabular-nums; }
</style>
