<script lang="ts">
  import type { WorkspaceStatus } from '@perch/contracts';
  import { STATUS_LABELS, STATUS_ORDER } from './workspace-status-display';

  let { status, onSelect }: { status: WorkspaceStatus; onSelect: (s: WorkspaceStatus) => void } =
    $props();

  let open = $state(false);

  // Buttons must not steal focus from the terminal, or the soft keyboard closes.
  const keepFocus = (e: Event) => e.preventDefault();

  function choose(next: WorkspaceStatus) {
    open = false;
    onSelect(next);
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="picker">
  <button
    type="button"
    class="pill"
    data-status={status}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="Status: {STATUS_LABELS[status]}"
    onpointerdown={keepFocus}
    onclick={() => (open = !open)}
  >{STATUS_LABELS[status]}</button>

  {#if open}
    <button type="button" class="backdrop" aria-label="Close status menu" onclick={() => (open = false)}></button>
    <ul class="menu" role="listbox" aria-label="Set status">
      {#each STATUS_ORDER as option (option)}
        <li>
          <button
            type="button"
            role="option"
            aria-selected={option === status}
            data-status={option}
            class:current={option === status}
            onpointerdown={keepFocus}
            onclick={() => choose(option)}
          >
            <span class="dot" data-status={option} aria-hidden="true">●</span>
            {STATUS_LABELS[option]}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker { position: relative; flex: 0 0 auto; }
  .pill {
    height: 44px;
    min-width: 44px;
    padding: 0 0.7rem;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    touch-action: manipulation;
  }
  .pill:active { background: var(--surface-press); }
  /* The backdrop is a transparent full-screen catcher so an outside tap closes the menu. */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    border: 0;
    background: transparent;
    padding: 0;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 21;
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    min-width: 11rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .menu button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.6rem;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--text);
    font-size: 0.95rem;
    text-align: left;
    touch-action: manipulation;
  }
  .menu button:active { background: var(--surface-press); }
  .menu button.current { background: var(--surface-press); }
  .dot { font-size: 0.7rem; }

  /* Status palette, scoped to this component. Colors the pill text and the menu dots; the
     option rows keep neutral text (".menu button" wins on specificity) so only the dot
     carries the color. Mirrors the list badge palette in WorkspaceList. */
  [data-status='needs-feedback'] { color: var(--attention); }
  [data-status='needs-hands'] { color: var(--hands); }
  [data-status='finished'] { color: var(--ok); }
  [data-status='working'] { color: var(--accent); }
  [data-status='review'] { color: var(--warn); }
  [data-status='blocked'] { color: var(--danger); }
  [data-status='idle'] { color: var(--idle); }
  [data-status='parked'] { color: var(--text-dim); }
</style>
