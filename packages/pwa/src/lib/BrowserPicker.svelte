<script lang="ts">
  import { browserSessionLabel } from '../core/browser-sessions';

  let {
    sessions,
    workspaceId,
    canStart,
    onOpen,
    onStart,
  }: {
    sessions: string[];
    workspaceId: string;
    canStart: boolean;
    onOpen: (name: string) => void;
    onStart: () => void;
  } = $props();

  let open = $state(false);

  // Buttons must not steal focus from the terminal, or the soft keyboard closes.
  const keepFocus = (e: Event) => e.preventDefault();

  // One session opens straight to the viewer; several drop a menu to choose; none offers a
  // start (only rendered when the agent supports it).
  function trigger(): void {
    if (sessions.length === 0) onStart();
    else if (sessions.length === 1) onOpen(sessions[0]!);
    else open = !open;
  }

  function choose(name: string): void {
    open = false;
    onOpen(name);
  }

  const label = $derived(
    sessions.length === 0 ? 'Start browser' : sessions.length > 1 ? `Browser (${sessions.length})` : 'Browser',
  );
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

{#if sessions.length > 0 || canStart}
  <div class="picker">
    <button
      type="button"
      class="pill"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      onpointerdown={keepFocus}
      onclick={trigger}
    >
      <span class="glyph" aria-hidden="true">🌐</span>
      <span class="label">{label}</span>
    </button>

    {#if open}
      <button type="button" class="backdrop" aria-label="Close browser menu" onclick={() => (open = false)}></button>
      <ul class="menu" role="menu" aria-label="Browser sessions">
        {#each sessions as name (name)}
          <li>
            <button type="button" role="menuitem" onpointerdown={keepFocus} onclick={() => choose(name)}>
              <span class="dot" aria-hidden="true">🌐</span>
              {browserSessionLabel(name, workspaceId)}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  /* Mirrors StatusPicker: an anchored dropdown that drops from its trigger. */
  .picker { position: relative; flex: 0 0 auto; }
  .pill {
    height: 44px;
    min-width: 44px;
    padding: 0 0.7rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    touch-action: manipulation;
  }
  .pill:active { background: var(--surface-press); }
  .glyph { font-size: 20px; line-height: 1; }
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
    min-width: 12rem;
    max-height: 60vh;
    overflow-y: auto;
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
  .dot { font-size: 0.9rem; }
</style>
