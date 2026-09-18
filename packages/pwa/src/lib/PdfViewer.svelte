<script lang="ts">
  import type { PerchStore } from '../store.svelte';
  import { basename } from '../core/browse-path';

  let { store }: { store: PerchStore } = $props();
  let file = $derived(store.fileView);

  function openExternally(): void {
    if (file?.blobUrl) window.open(file.blobUrl, '_blank');
  }
</script>

<section class="viewer">
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={() => store.closeViewer()}>‹</button>
    <span class="title">{file ? basename(file.path) : ''}</span>
    {#if file?.blobUrl}
      <button type="button" class="open" onclick={openExternally}>Open</button>
    {/if}
  </header>

  {#if store.viewError}
    <p class="error">Couldn't open this file.<br /><span>{store.viewError}</span></p>
  {:else if file?.truncated}
    <p class="empty">PDF too large to preview (over 20&nbsp;MB).</p>
  {:else if file?.blobUrl}
    <!-- WebKit renders PDFs natively in an iframe. On iOS the inline frame can be flaky
         (first-page-only/blank), so the header "Open" button is the reliable fallback. -->
    <iframe class="frame" src={file.blobUrl} title={basename(file.path)}></iframe>
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
  header button.open {
    flex: 0 0 auto; height: 44px; padding: 0 0.9rem;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); color: var(--text); font-size: 0.9rem;
    touch-action: manipulation;
  }
  header button.open:active { background: var(--surface-press); }
  .title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--text-dim); }
  .error { color: var(--danger); }
  .error span { color: var(--text-dim); font-size: 0.8rem; word-break: break-all; }
  /* Sized to the viewport (like ImageViewer's .frame / FileViewer's .code) rather than
     flex:1/height:100% — the narrow layout's <main> has no height, so a percentage height
     would collapse the frame to 0 (PDF invisible). */
  .frame {
    width: 100%; height: calc(100dvh - 8rem); margin-top: 0.5rem;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface);
  }
</style>
