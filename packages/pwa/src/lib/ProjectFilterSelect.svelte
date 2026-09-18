<script lang="ts">
  import type { ProjectFolder } from '../core/project-folders';

  let {
    folders,
    selected,
    ontoggle,
  }: {
    folders: ProjectFolder[];
    selected: ReadonlySet<string>;
    ontoggle: (key: string) => void;
  } = $props();

  // Collapsed summary: no selection means the list is unfiltered; one selection shows its full
  // path (a nested entry's short label alone would be ambiguous); several collapse to a count
  // so the control stays compact.
  const summary = $derived(
    selected.size === 0
      ? 'All projects'
      : selected.size === 1
        ? [...selected][0]
        : `${selected.size} projects`,
  );

  let open = $state(false);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<!-- Nothing to filter with a single project folder. A native <select multiple> renders
     poorly on iOS, so this is a disclosure of checkboxes: compact when closed, scrollable
     when open. -->
{#if folders.length > 1}
  <!-- `open` is fully controlled: the click handler cancels the native disclosure toggle
       and drives `open` itself, so it stays the single source of truth for the backdrop
       and menu below (and so an outside-click/Escape close is a plain state write, not a
       fight with the browser's own toggle). -->
  <details class="project-filter" open={open}>
    <summary
      aria-label="Filter by project"
      onclick={(e) => {
        e.preventDefault();
        open = !open;
      }}
    >
      <span class="summary-text">{summary}</span>
      <span class="chev" aria-hidden="true">▾</span>
    </summary>
    {#if open}
      <button
        type="button"
        class="backdrop"
        aria-label="Close project filter"
        onclick={() => (open = false)}
      ></button>
      <div class="menu" role="group" aria-label="Projects">
        {#each folders as folder (folder.key)}
          <label class="option" style="--depth: {folder.depth}">
            <input
              type="checkbox"
              checked={selected.has(folder.key)}
              onchange={() => ontoggle(folder.key)}
            />
            <span class="label">{folder.label}</span>
            <span class="count">{folder.count}</span>
          </label>
        {/each}
      </div>
    {/if}
  </details>
{/if}

<style>
  .project-filter {
    margin-top: 0.75rem;
    position: relative;
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 40px;
    padding: 0.3rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 600;
    list-style: none;
    cursor: pointer;
    touch-action: manipulation;
  }
  summary::-webkit-details-marker { display: none; }
  summary:active { background: var(--surface-press); }
  .summary-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { flex: 0 0 auto; color: var(--text-dim); font-size: 0.8rem; }
  details[open] .chev { transform: rotate(180deg); }

  /* Transparent full-screen catcher so a tap outside the menu closes it. */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 4;
    border: 0;
    background: transparent;
    padding: 0;
  }

  /* The open menu floats over the list so toggling filters doesn't shove the rows down.
     Capped height keeps a long project list scrollable on a short phone screen. */
  .menu {
    position: absolute;
    z-index: 5;
    left: 0;
    right: 0;
    margin-top: 0.3rem;
    max-height: 50vh;
    overflow-y: auto;
    padding: 0.3rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 40px;
    padding: 0.3rem 0.5rem 0.3rem calc(0.5rem + var(--depth, 0) * 1.25rem);
    border-radius: var(--radius);
    cursor: pointer;
    touch-action: manipulation;
  }
  .option:active { background: var(--surface-press); }
  .option input { width: 18px; height: 18px; flex: 0 0 auto; accent-color: var(--accent); }
  .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    flex: 0 0 auto;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-dim);
    background: var(--surface-press);
    border: 1px solid var(--border);
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
  }
</style>
