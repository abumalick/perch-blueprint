<script lang="ts">
  import { onMount } from 'svelte';
  import type { PerchStore } from './store.svelte';
  import WorkspaceList from './lib/WorkspaceList.svelte';
  import TerminalView from './lib/TerminalView.svelte';
  import Settings from './lib/Settings.svelte';
  import AddMachine from './lib/AddMachine.svelte';
  import CreateWorkspace from './lib/CreateWorkspace.svelte';
  import FileBrowser from './lib/FileBrowser.svelte';
  import FileViewer from './lib/FileViewer.svelte';
  import ImageViewer from './lib/ImageViewer.svelte';
  import PdfViewer from './lib/PdfViewer.svelte';
  import AudioViewer from './lib/AudioViewer.svelte';
  import BrowserView from './lib/BrowserView.svelte';
  import UpdateBanner from './lib/UpdateBanner.svelte';
  import DictationErrorBanner from './lib/DictationErrorBanner.svelte';
  import ActionErrorBanner from './lib/ActionErrorBanner.svelte';
  import { trackWide } from './lib/viewport';

  let { store }: { store: PerchStore } = $props();
  let kbAnchor: HTMLTextAreaElement;
  // ≥980px: the workspace list is a persistent left sidebar and the active view renders
  // beside it. Below: today's single-pane, full-screen stack (the list IS the home view).
  let wide = $state(false);
  onMount(() => {
    store.start();
    // iOS only raises the soft keyboard from a user gesture. The create tap focuses this
    // hidden input to open the keyboard immediately and keep it up across the agent
    // round-trip; the terminal takes focus from it when it mounts (see store.requestCreate).
    store.setKeyboardAnchor(() => kbAnchor.focus());
    const stopWide = trackWide((m) => (wide = m));
    // Auto-recover the tailnet link: when the app returns to the foreground (the iPhone
    // backgrounds the PWA while you toggle Tailscale) or the browser regains connectivity,
    // re-attempt every non-online machine so a machine that gave up retrying comes back on
    // its own — no need to tap Reconnect in the common case.
    const onVisible = () => {
      const visible = document.visibilityState === 'visible';
      store.logConnectivity(visible ? 'visible' : 'hidden');
      if (visible) store.reconnectAll();
    };
    const onOnline = () => {
      store.logConnectivity('net-online');
      store.reconnectAll();
    };
    const onOffline = () => store.logConnectivity('net-offline');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      store.setKeyboardAnchor(null);
      stopWide();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  });
</script>

{#snippet activeView()}
  {#if store.view === 'terminal'}
    <!-- Keyed on the workspace id so switching sessions (possible while the persistent
         sidebar stays open in the wide layout) tears down the old terminal and remounts
         a fresh one that attaches to the newly selected workspace. -->
    {#key store.active?.id}
      <TerminalView {store} />
    {/key}
  {:else if store.view === 'settings'}
    <Settings {store} />
  {:else if store.view === 'newMachine'}
    <AddMachine {store} />
  {:else if store.view === 'create'}
    <CreateWorkspace {store} />
  {:else if store.view === 'browser'}
    <FileBrowser {store} />
  {:else if store.view === 'browserView'}
    <!-- Keyed on the target so switching sessions tears down the old stream. -->
    {#key store.browserTarget?.connectionId + ':' + store.browserTarget?.session}
      <BrowserView {store} />
    {/key}
  {:else if store.view === 'viewer'}
    {#if store.fileView?.mediaType.startsWith('image/')}
      <ImageViewer {store} />
    {:else if store.fileView?.mediaType === 'application/pdf'}
      <PdfViewer {store} />
    {:else if store.fileView?.mediaType.startsWith('audio/')}
      <AudioViewer {store} />
    {:else}
      <FileViewer {store} />
    {/if}
  {/if}
{/snippet}

{#if wide}
  <div class="layout">
    <aside class="sidebar">
      <WorkspaceList {store} />
    </aside>
    <main class="pane" class:flush={store.view === 'terminal' || store.view === 'browserView'}>
      {#if store.view === 'list'}
        <p class="placeholder">Select a workspace</p>
      {:else}
        {@render activeView()}
      {/if}
    </main>
  </div>
{:else}
  <main class:flush={store.view === 'terminal' || store.view === 'browserView'}>
    {#if store.view === 'list'}
      <WorkspaceList {store} />
    {:else}
      {@render activeView()}
    {/if}
  </main>
{/if}
<UpdateBanner {store} />
<DictationErrorBanner {store} />
<ActionErrorBanner {store} />
<textarea bind:this={kbAnchor} class="kb-anchor" aria-hidden="true" tabindex="-1"></textarea>

<style>
  /* Dark-only design tokens. Layered surfaces (bg → surface → surface-press) give depth
     without color; blue is the primary interactive accent, amber is reserved for the
     "needs you" attention hero so it's the one thing that stands out on the list. */
  :global(:root) {
    --bg: #0d0d0f;
    --surface: #1a1a1d;
    --surface-press: #26262a;
    --border: #2c2c30;
    --text: #ececec;
    --text-dim: #8a8a90;
    --accent: #2d6cdf;
    --accent-press: #2559b0;
    --attention: #f5a623;
    --attention-tint: rgba(245, 166, 35, 0.13);
    /* Hands: a violet for work that only a keyboard at the machine can clear. Every other
       hue already carries a status, and it stays clear of the amber attention hero. */
    --hands: #c58cf0;
    --ok: #2ecc71;
    --warn: #f1c40f;
    --danger: #e74c3c;
    /* Idle: a calm teal so a live-but-quiet session reads as present, distinct from the
       royal-blue accent (working) and the muted gray of the parked status. */
    --idle: #4fb0c6;
    --radius: 8px;
  }
  :global(body) { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; }
  /* Dark form controls. Native inputs default to a light background, which looks broken
     on the dark canvas; 16px font keeps iOS from zooming on focus. */
  :global(input), :global(select) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 0.7rem;
    font-size: 16px;
  }
  :global(input:focus), :global(select:focus) {
    outline: none;
    border-color: var(--accent);
  }
  /* A long-press on a button is a mis-tap, never a selection: iOS otherwise selects the
     label and raises the callout. Global because Svelte scopes styles per component, and
     the keyboard bar's row is built from several of them. */
  :global(button) {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  main { padding: env(safe-area-inset-top) 0.75rem 0.75rem; }
  /* The terminal and browser views fill the screen: drop the bottom padding so the
     keyboard bar sits flush at the bottom. The bar's own safe-area inset clears the home
     indicator when the keyboard is down; the views' height calc drops the matching 0.75rem. */
  main.flush { padding-bottom: 0; }

  /* Wide (≥980px) two-pane layout: persistent sidebar | active view. The sidebar owns
     its own scroll so a long workspace list never pushes the right pane. It's narrower on
     small tablets (the ≥980px band) and widens to 320px on desktops (≥1024px). */
  .layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    height: 100dvh;
  }
  @media (min-width: 1024px) {
    .layout { grid-template-columns: 320px 1fr; }
  }
  .sidebar {
    overflow-y: auto;
    border-right: 1px solid var(--border);
    padding: env(safe-area-inset-top) 0.75rem 0.75rem;
  }
  .pane { overflow-y: auto; min-width: 0; }
  /* The terminal manages its own height/scroll (see TerminalView); let it fill the pane. */
  .pane.flush { overflow: hidden; }
  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    margin: 0;
    color: var(--text-dim);
  }

  /* Off-screen but focusable (not display:none/readonly, which suppress the iOS keyboard).
     16px font dodges iOS focus-zoom even though it's invisible. */
  .kb-anchor {
    position: fixed;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    border: 0;
    padding: 0;
    margin: 0;
    pointer-events: none;
    font-size: 16px;
    caret-color: transparent;
  }
</style>
