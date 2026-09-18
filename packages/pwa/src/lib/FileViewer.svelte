<script lang="ts">
  import type { PerchStore } from '../store.svelte';
  import { basename } from '../core/browse-path';
  import { isMarkdownPath, renderMarkdown } from '../core/markdown';

  let { store }: { store: PerchStore } = $props();

  let file = $derived(store.fileView);
  let wrap = $derived(store.fileWrap);
  // The raw preference is per-file: holding the path (rather than a boolean) makes opening
  // another file fall back to the rendered view without an effect to reset it.
  let rawPath = $state<string | null>(null);
  let markdown = $derived(!!file && !file.binary && isMarkdownPath(file.path));
  let rendered = $derived(markdown && rawPath !== file?.path);
  // One line number per line, joined into a single text node so the gutter stays light
  // regardless of file length.
  let gutter = $derived(
    file && !file.binary
      ? Array.from({ length: file.text.split('\n').length }, (_, i) => i + 1).join('\n')
      : '',
  );
</script>

<section class="viewer">
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={() => store.closeViewer()}>‹</button>
    <span class="title">{file ? basename(file.path) : ''}</span>
    {#if markdown}
      <button type="button" class="wrap-toggle" aria-label="Toggle raw source" aria-pressed={!rendered} onclick={() => (rawPath = rendered ? (file?.path ?? null) : null)}>
        Raw
      </button>
    {/if}
    {#if file && !file.binary && !rendered}
      <button type="button" class="wrap-toggle" aria-label="Toggle word wrap" aria-pressed={wrap} onclick={() => store.setFileWrap(!wrap)}>
        Wrap
      </button>
    {/if}
  </header>

  {#if store.viewError}
    <p class="error">Couldn't open this file.<br /><span>{store.viewError}</span></p>
  {:else if !file}
    <p class="empty">Loading…</p>
  {:else if file.binary}
    <p class="empty">Binary file — not shown.</p>
  {:else}
    {#if file.truncated}
      <p class="banner">Truncated to 512 KB.</p>
    {/if}
    {#if rendered}
      <div class="prose">{@html renderMarkdown(file.text)}</div>
    {:else}
      <div class="code" class:wrap>
        {#if !wrap}
          <pre class="gutter" aria-hidden="true">{gutter}</pre>
        {/if}
        <pre class="content">{file.text}</pre>
      </div>
    {/if}
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
  .title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wrap-toggle {
    flex: 0 0 auto;
    min-height: 36px;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-dim);
    font-size: 0.8rem;
    touch-action: manipulation;
  }
  .wrap-toggle[aria-pressed='true'] { color: var(--text); border-color: var(--accent); }
  .wrap-toggle:active { background: var(--surface-press); }
  .empty { color: var(--text-dim); }
  .error { color: var(--danger); }
  .error span { color: var(--text-dim); font-size: 0.8rem; word-break: break-all; }
  .banner { color: var(--text-dim); font-size: 0.8rem; margin: 0.5rem 0 0; }
  /* Two side-by-side <pre> elements share one scroll box. The gutter sticks to the left so
     the line numbers stay put while the code scrolls horizontally. */
  .code {
    display: flex;
    margin-top: 0.5rem;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    max-height: calc(100dvh - 8rem);
  }
  .code pre {
    margin: 0;
    padding: 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
    line-height: 1.4;
    white-space: pre;
  }
  .gutter {
    position: sticky;
    left: 0;
    flex: 0 0 auto;
    text-align: right;
    color: var(--text-dim);
    background: var(--surface);
    border-right: 1px solid var(--border);
    user-select: none;
  }
  .content { flex: 1 0 auto; color: var(--text); }
  /* Rendered markdown. Sized like .code — a percentage height collapses to 0 in the narrow
     phone layout, where <main> has no height. */
  .prose {
    margin-top: 0.5rem;
    padding: 0.75rem 0.9rem;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    max-height: calc(100dvh - 8rem);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .prose :global(h1), .prose :global(h2), .prose :global(h3),
  .prose :global(h4), .prose :global(h5), .prose :global(h6) {
    margin: 1.2em 0 0.5em;
    line-height: 1.3;
  }
  .prose :global(h1) { font-size: 1.4rem; }
  .prose :global(h2) { font-size: 1.2rem; }
  .prose :global(h3) { font-size: 1.05rem; }
  .prose :global(> :first-child) { margin-top: 0; }
  .prose :global(a) { color: var(--accent); }
  .prose :global(hr) { border: 0; border-top: 1px solid var(--border); margin: 1.2em 0; }
  .prose :global(blockquote) {
    margin: 1em 0;
    padding-left: 0.8rem;
    border-left: 3px solid var(--border);
    color: var(--text-dim);
  }
  .prose :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
  }
  .prose :global(:not(pre) > code) {
    padding: 0.1em 0.3em;
    border-radius: 4px;
    background: var(--surface-press);
  }
  /* Code blocks and tables get their own horizontal scroller so the page never scrolls sideways. */
  .prose :global(pre) {
    margin: 1em 0;
    padding: 0.6rem;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-press);
  }
  .prose :global(pre code) { white-space: pre; overflow-wrap: normal; }
  .prose :global(table) { display: block; overflow-x: auto; border-collapse: collapse; margin: 1em 0; }
  .prose :global(th), .prose :global(td) {
    border: 1px solid var(--border);
    padding: 0.3rem 0.5rem;
    text-align: left;
  }
  .prose :global(img) { max-width: 100%; height: auto; }
  .prose :global(ul), .prose :global(ol) { padding-left: 1.4rem; }
  /* Wrap mode: soft-wrap long lines (the gutter is dropped — line numbers can't map 1:1 to
     wrapped visual rows). */
  .code.wrap .content { flex: 1 1 auto; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
