<script lang="ts">
  // The keyboard bar's command shortcuts drop-down. Entries come from the agent machine's
  // ~/.perch/commands.json and are shown verbatim, so the row reads as what gets typed.
  import type { CommandEntry } from '@perch/contracts';

  let { commands, onSelect }: { commands: CommandEntry[]; onSelect: (e: CommandEntry) => void } =
    $props();

  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  // The menu is positioned against the viewport, not the trigger's box: the keyboard bar is
  // a horizontal scroller (overflow-x: auto), and CSS forces the cross axis to a clipping
  // value — so an absolutely-positioned menu inside the bar is invisibly clipped. Measuring
  // the trigger on open also keeps it anchored while the bar is scrolled or the soft
  // keyboard resizes the viewport.
  let anchor = $state({ bottom: 0, right: 0 });

  // Buttons must not steal focus from the terminal, or the soft keyboard closes.
  const keepFocus = (e: Event) => e.preventDefault();

  function toggle() {
    const rect = trigger?.getBoundingClientRect();
    if (!open && rect) {
      anchor = {
        bottom: window.innerHeight - rect.top + 4,
        right: Math.max(4, window.innerWidth - rect.right),
      };
    }
    open = !open;
  }

  function choose(entry: CommandEntry) {
    open = false;
    onSelect(entry);
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="picker">
  <button
    type="button"
    class="trigger"
    bind:this={trigger}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="Commands"
    onpointerdown={keepFocus}
    onclick={toggle}
  >/</button>

  {#if open}
    <button type="button" class="backdrop" aria-label="Close command menu" onclick={() => (open = false)}></button>
    <ul
      class="menu"
      role="listbox"
      aria-label="Commands"
      style="bottom: {anchor.bottom}px; right: {anchor.right}px"
    >
      {#each commands as entry (entry.command)}
        <li>
          <button
            type="button"
            role="option"
            aria-selected="false"
            onpointerdown={keepFocus}
            onclick={() => choose(entry)}
          >{entry.command}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker { position: relative; flex: 0 0 auto; }
  /* Matches the keyboard bar's own buttons — this sits in that row. */
  .trigger {
    flex: 0 0 auto;
    min-width: 2.75rem;
    height: 2.75rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface-press);
    color: var(--text);
    font: 600 15px ui-monospace, monospace;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  /* The backdrop is a transparent full-screen catcher so an outside tap closes the menu. */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    border: 0;
    background: transparent;
    padding: 0;
  }
  /* Fixed, not absolute: the bar clips its own overflow (see the anchor comment above).
     Opens upward — the bar sits at the bottom, above the soft keyboard. */
  .menu {
    position: fixed;
    z-index: 21;
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    min-width: 14rem;
    max-height: 50vh;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .menu button {
    width: 100%;
    padding: 0.6rem;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--text);
    font: 400 0.95rem ui-monospace, monospace;
    text-align: left;
    white-space: nowrap;
    touch-action: manipulation;
  }
  .menu button:active { background: var(--surface-press); }
</style>
