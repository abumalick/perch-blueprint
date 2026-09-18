<script lang="ts">
  import type { WorkspaceStatus } from '@perch/contracts';
  import StatusPicker from './StatusPicker.svelte';
  import BrowserPicker from './BrowserPicker.svelte';
  import { githubLinks } from '../core/github-links';

  let {
    open = $bindable(),
    wide,
    fontSize,
    canZoomIn,
    canZoomOut,
    status,
    urgent,
    github,
    browserSessions,
    browserWorkspaceId,
    canStartBrowser,
    onRefresh,
    onZoomIn,
    onZoomOut,
    onFiles,
    onNewWorkspace,
    onOpenBrowser,
    onStartBrowser,
    onSetStatus,
    onSetUrgent,
    onClose,
  }: {
    open: boolean;
    wide: boolean;
    fontSize: number;
    canZoomIn: boolean;
    canZoomOut: boolean;
    status: WorkspaceStatus;
    urgent: boolean;
    github?: { owner: string; repo: string; ownerType?: 'user' | 'org' };
    browserSessions: string[];
    browserWorkspaceId: string;
    canStartBrowser: boolean;
    onRefresh: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFiles: () => void;
    onNewWorkspace: () => void;
    onOpenBrowser: (name: string) => void;
    onStartBrowser: () => void;
    onSetStatus: (s: WorkspaceStatus) => void;
    onSetUrgent: (urgent: boolean) => void;
    onClose: () => void;
  } = $props();

  // Refresh and the zoom buttons must not steal focus from the terminal, or the
  // soft keyboard closes — same as their old header/overlay counterparts. The
  // navigating rows (Files/Browser/Close) intentionally let focus move.
  const keepFocus = (e: Event) => e.preventDefault();

  // Navigating actions leave the terminal view, so they also dismiss the drawer.
  const navigate = (fn: () => void) => {
    open = false;
    fn();
  };

  // GitHub Issues/Projects links, present only when the workspace's repo has a GitHub remote.
  const links = $derived(github ? githubLinks(github) : null);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

{#if open}
  <button type="button" class="scrim" aria-label="Dismiss menu" onclick={() => (open = false)}></button>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Workspace actions">
    <button type="button" class="row" onpointerdown={keepFocus} onclick={onRefresh}>
      <span class="icon" aria-hidden="true">🔄</span> Refresh
    </button>

    <button
      type="button"
      class="row urgent"
      class:on={urgent}
      aria-pressed={urgent}
      onpointerdown={keepFocus}
      onclick={() => onSetUrgent(!urgent)}
    >
      <span class="icon star" aria-hidden="true">{urgent ? '★' : '☆'}</span>
      {urgent ? 'Urgent — pinned to top' : 'Mark urgent'}
    </button>

    <div class="row font">
      <span class="icon" aria-hidden="true">🔠</span>
      <span class="font-label">Font</span>
      <span class="font-controls">
        <button type="button" aria-label="Zoom out" onpointerdown={keepFocus} onclick={onZoomOut} disabled={!canZoomOut}>A−</button>
        <span class="font-size">{fontSize}</span>
        <button type="button" aria-label="Zoom in" onpointerdown={keepFocus} onclick={onZoomIn} disabled={!canZoomIn}>A+</button>
      </span>
    </div>

    {#if links}
      <a class="row" href={links.issues} target="_blank" rel="noopener" onclick={() => (open = false)}>
        <span class="icon" aria-hidden="true">🐛</span> Issues
      </a>
      <a class="row" href={links.projects} target="_blank" rel="noopener" onclick={() => (open = false)}>
        <span class="icon" aria-hidden="true">📋</span> Projects
      </a>
    {/if}

    {#if !wide}
      <button type="button" class="row" onclick={() => navigate(onFiles)}>
        <span class="icon" aria-hidden="true">📁</span> Files
      </button>

      <!-- Wide layout omits this: its persistent sidebar already carries a ＋ button. -->
      <button type="button" class="row" onclick={() => navigate(onNewWorkspace)}>
        <span class="icon" aria-hidden="true">＋</span> New workspace
      </button>

      <div class="picker-wrap">
        <BrowserPicker
          sessions={browserSessions}
          workspaceId={browserWorkspaceId}
          canStart={canStartBrowser}
          onOpen={(name) => navigate(() => onOpenBrowser(name))}
          onStart={onStartBrowser}
        />
      </div>

      <div class="picker-wrap">
        <StatusPicker {status} onSelect={onSetStatus} />
      </div>

      <button type="button" class="row danger" onclick={() => navigate(onClose)}>
        <span class="icon" aria-hidden="true">✕</span> Close
      </button>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
    border: 0;
    padding: 0;
    background: rgba(0, 0, 0, 0.5);
    animation: fade-in 0.15s ease-out;
  }
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 31;
    box-sizing: border-box;
    height: 100%;
    width: min(80vw, 280px);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.75rem;
    padding-top: max(0.75rem, env(safe-area-inset-top, 0px));
    background: var(--surface);
    border-left: 1px solid var(--border);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.4);
    overflow-y: auto;
    animation: slide-in 0.15s ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .panel { animation: none; }
  }
  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 44px;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: 600 15px system-ui, sans-serif;
    text-align: left;
    text-decoration: none;
    touch-action: manipulation;
  }
  button.row:active,
  a.row:active { background: var(--surface-press); }
  .row.danger { color: var(--danger); }
  /* The urgent toggle: a muted outline star that lights up (filled + attention color)
     when the workspace is pinned. */
  .row.urgent.on { color: var(--attention); border-color: var(--attention); }
  .row.urgent .star { color: var(--text-dim); }
  .row.urgent.on .star { color: var(--attention); }
  .icon { font-size: 20px; line-height: 1; width: 24px; text-align: center; flex: 0 0 auto; }
  .font .font-label { flex: 1; }
  .font-controls { display: flex; align-items: center; gap: 0.4rem; }
  .font-controls button {
    width: 40px;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: 600 15px ui-monospace, monospace;
    touch-action: manipulation;
  }
  .font-controls button:active { background: var(--surface-press); }
  .font-controls button:disabled { opacity: 0.35; }
  .font-size { min-width: 1.5rem; text-align: center; font: 600 14px ui-monospace, monospace; }
  /* The Status/Browser pickers are their own styled controls; stretch them to fill the row. */
  .picker-wrap { display: flex; }
  .picker-wrap :global(.picker) { flex: 1; }
  .picker-wrap :global(.pill) { width: 100%; }
</style>
