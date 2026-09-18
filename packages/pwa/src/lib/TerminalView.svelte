<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { isIOSWebKit, openTerminalLink } from './terminal-link';
  import '@xterm/xterm/css/xterm.css';
  import type { PerchStore } from '../store.svelte';
  import { TERMINAL_FONT_MIN, TERMINAL_FONT_MAX } from '../core/settings-store';
  import KeyboardBar from './KeyboardBar.svelte';
  import StatusPicker from './StatusPicker.svelte';
  import BrowserPicker from './BrowserPicker.svelte';
  import WorkspaceMenu from './WorkspaceMenu.svelte';
  import { trackViewport, trackWide } from './viewport';
  import { attachTerminalScroll, type TerminalScroll } from './terminal-scroll';
  import { attachCopyOnSelect, type CopyOnSelect } from './copy-on-select';
  import {
    editChordFromEvent,
    processTerminalInput,
    type ModifierState,
  } from '../core/keyboard-modifiers';
  import { pasteFromClipboard } from '../core/clipboard-paste';
  import { fileToUpload } from '../core/shared-file';
  import { attachAndroidInput, isAndroid, type AndroidInput } from './android-input';
  import { attachAndroidTouchSelect, type AndroidTouchSelect } from './android-select';
  import { inputLog } from '../core/terminal-input-log';

  let { store }: { store: PerchStore } = $props();
  // Android has no working OS-native text selection over xterm, so select mode there
  // drives xterm's own line selection from touch + a keyboard-bar Copy button. iOS keeps
  // the native long-press path; desktop keeps copy-on-select.
  const androidDevice = isAndroid(navigator.userAgent);
  let container: HTMLDivElement;
  let androidInput: AndroidInput | null = null;
  let androidSelect: AndroidTouchSelect | null = null;
  let ctrl = $state<ModifierState>('off');
  let alt = $state<ModifierState>('off');
  let meta = $state<ModifierState>('off');
  let scroll = $state<TerminalScroll | null>(null);
  // Select mode pauses touch-drag scrolling so iOS's native long-press selection
  // (and its Copy callout) can grab xterm's DOM-rendered rows.
  let selectMode = $state(false);
  let copySelect: CopyOnSelect | null = null;
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  // The overflow drawer holds the controls that don't fit the header. On wide
  // viewports the header keeps Files/Browser/Status/Close inline and the drawer
  // carries only Refresh + Font; on phones everything lives in the drawer.
  let menuOpen = $state(false);
  let wide = $state(false);

  // Desktop copy-on-select: write the settled mouse selection to the clipboard with a
  // brief confirmation. Inside a mouse-mode app (Claude Code) a plain drag is captured
  // by the app; ⌥-drag forces a local selection (macOptionClickForcesSelection below).
  const showCopied = () => {
    copied = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1000);
  };
  const writeClipboard = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      showCopied();
    } catch {
      // clipboard write denied/unavailable — nothing copied, no error surfaced
    }
  };

  // Buttons must not steal focus from the terminal, or the soft keyboard closes.
  const keepFocus = (e: Event) => e.preventDefault();

  // Entering select mode blurs the terminal so the soft keyboard drops: with xterm's hidden
  // textarea focused, iOS/iPadOS routes a long-press into that field and never starts a text
  // selection on the rows. Leaving select mode refocuses so typing (and the keyboard) resume.
  const toggleSelect = () => {
    selectMode = !selectMode;
    if (selectMode) term?.blur();
    else {
      term?.focus();
      // Clear the xterm selection we drove from touch so no stale highlight lingers.
      if (androidDevice) term?.clearSelection();
    }
  };

  // The Copy button (Android select mode). Read xterm's own selection first — the line
  // selection populates it — then fall back to any DOM selection. writeClipboard shows the
  // "Copied" toast and no-ops on empty.
  const copySelection = () => {
    const text = term?.getSelection() || window.getSelection()?.toString() || '';
    void writeClipboard(text);
  };

  // Attached agent-browser sessions for this workspace (name === workspace id or `<id>__…`).
  // The BrowserPicker routes on the count: none → start, one → open, several → a dropdown.
  const browserSessions = $derived(store.active ? store.browserSessionsFor(store.active) : []);
  const canStartBrowser = $derived(!!store.active && store.supportsBrowser(store.active.machineId));
  // Per-machine: the shortcuts come from the agent the active workspace lives on.
  const commandShortcuts = $derived(
    store.active ? (store.machineCommands[store.active.machineId] ?? []) : [],
  );
  const openBrowserSession = (name: string) => {
    const ws = store.active;
    if (ws) store.openBrowserView(ws.machineId, name);
  };
  const startBrowser = () => {
    const ws = store.active;
    if (ws) store.startBrowser(ws.machineId, ws.id);
  };
  // Real rendered cell height, used to turn a touch drag's pixels into a line count. Measured
  // from a rendered row rather than container.clientHeight / term.rows: that estimate balloons
  // for ~150ms after the keyboard closes (container already full height, term.rows not refit
  // yet), making a swipe barely scroll. The cell height depends only on the font, so it stays
  // correct through resizes and the height transition. Falls back to the estimate, then 16.
  const rowHeight = () => {
    const row = container?.querySelector('.xterm-rows')?.firstElementChild as HTMLElement | null;
    const measured = row?.getBoundingClientRect().height ?? 0;
    if (measured > 0) return measured;
    return term && term.rows ? container.clientHeight / term.rows : 16;
  };
  // Real rendered cell width, for mapping a touch's X to a terminal column (Android
  // span-select). xterm sizes .xterm-screen to exactly cols × cellWidth, so its width ÷
  // cols is the cell width. Falls back to the container estimate, then 8.
  const cellWidth = () => {
    const screen = container?.querySelector('.xterm-screen') as HTMLElement | null;
    const measured = screen?.getBoundingClientRect().width ?? 0;
    if (term && term.cols && measured > 0) return measured / term.cols;
    return term && term.cols ? container.clientWidth / term.cols : 8;
  };
  const zoom = (delta: 1 | -1) => store.setTerminalFontSize(store.terminalFontSize + delta);

  // Apply zoom: changing the font reflows the grid, so refit to recompute cols/rows
  // (which fires onResize → store.resize → pty resize). Guarded so it skips the initial
  // run where the terminal already mounted at this size.
  $effect(() => {
    const size = store.terminalFontSize;
    if (term && fit && term.options.fontSize !== size) {
      term.options.fontSize = size;
      fit.fit();
    }
  });

  // Unstick a wedged display: clear xterm and re-attach. The agent tears down the old
  // tmux client and spawns a fresh one, which makes tmux redraw the full screen — the
  // same path as leaving and re-entering, but in place. reset() clears stale rows so the
  // redraw lands clean.
  const refresh = () => {
    if (!term) return;
    term.reset();
    store.attach(term.cols, term.rows);
  };

  // Re-claim a workspace that was opened on another device: clear the stale rows and
  // re-attach (which evicts the other viewer on the agent), then drop the overlay.
  const takeOver = () => {
    if (!term) return;
    term.reset();
    store.takeOver(term.cols, term.rows);
  };

  // iOS has no native long-press paste into xterm's hidden textarea, so paste is a
  // bar button: the tap is the user gesture clipboard reads require. An image on the
  // clipboard is uploaded to the workspace (store.sendPutFile, which types the saved
  // path back via fileStored); plain text goes through xterm's paste path (incl.
  // bracketed-paste). A denied/empty clipboard is a no-op, not an error.
  const paste = async () => {
    try {
      if (navigator.clipboard?.read) {
        const result = await pasteFromClipboard(await navigator.clipboard.read());
        if (result.kind === 'file') {
          store.sendPutFile(result.name, result.bytes);
          return;
        }
        if (result.kind === 'text') {
          term?.paste(result.text);
          return;
        }
        return;
      }
    } catch {
      // read() unavailable/denied — fall through to the text-only path below
    }
    try {
      const text = await navigator.clipboard?.readText();
      if (text) term?.paste(text);
    } catch {
      // clipboard read denied or unavailable — nothing to paste
    }
  };

  // Attach a file chosen from the OS file picker (gallery/camera/documents). Same upload path
  // as paste: bytes → agent .tmp/files/ → the stored path is typed into the terminal. Any type
  // is allowed; sendPutFile enforces the size ceiling.
  const pickFile = async (file: File) => {
    const { name, bytes } = await fileToUpload(file);
    store.sendPutFile(name, bytes);
  };

  onMount(() => {
    const ios = isIOSWebKit(navigator.userAgent, navigator.maxTouchPoints);
    const t = new Terminal({
      cursorBlink: true,
      fontSize: store.terminalFontSize,
      convertEol: false,
      // Let ⌥-drag force a local selection even when a foreground app (Claude Code)
      // has mouse tracking on, so desktop copy-on-select still works in a session.
      macOptionClickForcesSelection: true,
      // Hardware ⌥/Alt + key sends ESC+key (Meta) instead of the macOS-composed
      // character (⌥e → ´), so readline/word-motion chords (⌥b/⌥f/⌥d/⌥.) reach the
      // shell. ⌥+arrow/backspace are caught by attachCustomKeyEventHandler below
      // before xterm sees them, so this only governs ⌥+printable. Dead keys
      // (⌥e/⌥u/⌥i/⌥n) still compose and are intentionally out of scope.
      macOptionIsMeta: true,
      // OSC 8 hyperlinks (a label carrying a hidden URL, e.g. Claude Code's file/doc links)
      // are inert unless a linkHandler is set — the WebLinksAddon only handles plain-text
      // URLs. Both route through openTerminalLink, which picks the platform-correct open
      // strategy (see terminal-link.ts).
      linkHandler: {
        activate: (_event, uri) => openTerminalLink(uri, { ios }),
      },
    });
    term = t;
    const f = new FitAddon();
    fit = f;
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon((_event, uri) => openTerminalLink(uri, { ios })));
    t.open(container);
    f.fit();
    store.onOutput = (data) => t.write(data);
    // Sticky Ctrl/Alt transform for a single typed character (keyboard bar modifiers).
    // processTerminalInput is a no-op for multi-char data, so it is safe for composed words.
    const sendTyped = (data: string) => {
      const result = processTerminalInput(data, { ctrl, alt });
      ctrl = result.ctrl;
      alt = result.alt;
      store.sendInput(result.output);
    };
    t.onData(sendTyped);
    // On Android, xterm's composition handling desyncs from the pty; take over the hidden
    // textarea and drive input ourselves. iOS keeps xterm's native path. onData still
    // carries paste (xterm's paste handler is left intact).
    if (isAndroid(navigator.userAgent) && t.textarea) {
      // Listen on `container` (an ancestor of xterm's textarea) so our capture-phase handlers
      // run before xterm's textarea listeners and can shield them (see android-input.ts).
      androidInput = attachAndroidInput(container, t.textarea, { send: sendTyped, log: inputLog });
    }
    // Hardware-keyboard ⌘/⌥ + arrow/backspace → macOS word/line editing chords.
    // We send the sequence ourselves and swallow the event (preventDefault stops the
    // browser's own ⌘+← back-navigation); everything else falls through to xterm.
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const seq = editChordFromEvent(e.key, { meta: e.metaKey, alt: e.altKey });
      if (seq === null) return true;
      e.preventDefault();
      store.sendInput(seq);
      return false;
    });
    t.onResize(({ cols, rows }) => store.resize(cols, rows));
    store.attach(t.cols, t.rows);
    // Self-heal: when the active machine recovers from a drop, re-attach in place (same as the
    // manual 🔄) so the terminal resumes instead of staying frozen on its last frame.
    store.onReattach = refresh;

    const onWindowResize = () => f.fit();
    window.addEventListener('resize', onWindowResize);
    // Returning to the foreground (iOS suspends a backgrounded PWA, which can leave the socket
    // half-open): probe the link so a dead one is detected and reconnected fast, and re-attach
    // to pull a fresh frame for a socket that's alive but showing stale content.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      store.checkActiveLiveness();
      refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Refit when the keyboard opens/closes and the visible area changes.
    const stopViewport = trackViewport(() => f.fit());
    // Drive the header/drawer split off the shared 980px "wide" breakpoint.
    const stopWide = trackWide((m) => (wide = m));
    // The .terminal-screen height is animated (transition: height), so the fit() above
    // runs while the container is still mid-animation and computes too few rows. Re-fit
    // once the height settles so xterm fills the final size. transitionend bubbles up
    // from .terminal-screen (an ancestor of `container`).
    const onTransitionEnd = (e: Event) => {
      if ((e as TransitionEvent).propertyName === 'height') f.fit();
    };
    const screen = container.closest('.terminal-screen');
    screen?.addEventListener('transitionend', onTransitionEnd);
    scroll = attachTerminalScroll(container, () => !selectMode, rowHeight);
    copySelect = attachCopyOnSelect(container, t, (text) => void writeClipboard(text));
    // Android: in select mode, press/drag on the rows selects a character span (xterm's
    // own selection), which the Copy button then reads. Scroll is already off in select mode.
    if (androidDevice) {
      androidSelect = attachAndroidTouchSelect(container, t, {
        isActive: () => selectMode,
        rowHeight,
        cellWidth,
        log: inputLog,
      });
    }
    if (store.autoFocus) t.focus();

    return () => {
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('visibilitychange', onVisible);
      screen?.removeEventListener('transitionend', onTransitionEnd);
      stopViewport();
      stopWide();
      scroll?.destroy();
      scroll = null;
      copySelect?.destroy();
      copySelect = null;
      androidInput?.destroy();
      androidInput = null;
      androidSelect?.destroy();
      androidSelect = null;
      if (copiedTimer) clearTimeout(copiedTimer);
      store.onOutput = null;
      store.onReattach = null;
      term = null;
      fit = null;
      t.dispose();
    };
  });
</script>

<div class="terminal-screen">
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={() => store.back()}>‹</button>
    <span class="title">{store.active?.name ?? ''}</span>
    {#if wide}
      <button type="button" class="icon" aria-label="Files" onclick={() => store.openBrowser()}>📁</button>
      {#if store.active}
        <BrowserPicker
          sessions={browserSessions}
          workspaceId={store.active.id}
          canStart={canStartBrowser}
          onOpen={openBrowserSession}
          onStart={startBrowser}
        />
      {/if}
      {#if store.active}
        <StatusPicker status={store.active.status} onSelect={(s) => store.setWorkspaceStatus(s)} />
      {/if}
      <button type="button" class="icon" aria-label="Close" onclick={() => store.closeActive()}>✕</button>
    {/if}
    <button type="button" class="icon" aria-label="Menu" aria-haspopup="dialog" aria-expanded={menuOpen} onpointerdown={keepFocus} onclick={() => (menuOpen = !menuOpen)}>☰</button>
  </header>
  <div class="term" class:android={androidDevice} class:selecting={selectMode && !androidDevice} class:selecting-touch={selectMode && androidDevice} bind:this={container}>
    {#if copied}<div class="copied-toast" role="status">Copied</div>{/if}
  </div>
  <WorkspaceMenu
    bind:open={menuOpen}
    {wide}
    fontSize={store.terminalFontSize}
    canZoomIn={store.terminalFontSize < TERMINAL_FONT_MAX}
    canZoomOut={store.terminalFontSize > TERMINAL_FONT_MIN}
    status={store.active?.status ?? 'idle'}
    urgent={store.active?.urgent ?? false}
    github={store.active?.github}
    browserSessions={browserSessions}
    browserWorkspaceId={store.active?.id ?? ''}
    canStartBrowser={canStartBrowser}
    onRefresh={refresh}
    onZoomIn={() => zoom(1)}
    onZoomOut={() => zoom(-1)}
    onFiles={() => store.openBrowser()}
    onNewWorkspace={() => store.goCreate()}
    onOpenBrowser={openBrowserSession}
    onStartBrowser={startBrowser}
    onSetStatus={(s) => store.setWorkspaceStatus(s)}
    onSetUrgent={(u) => store.setWorkspaceUrgent(u)}
    onClose={() => store.closeActive()}
  />
  <KeyboardBar
    send={(seq) => {
      // The bar writes straight to the pty, so the Android adapter never sees these keys.
      // Enter especially leaves its retained IME context stale — drop it (a no-op while a
      // composition is open, so a mid-word cursor move still keeps its baseline).
      androidInput?.resetContext();
      store.sendInput(seq);
    }}
    {paste}
    {selectMode}
    onToggleSelect={toggleSelect}
    showCopy={androidDevice && selectMode}
    onCopy={copySelection}
    dictation={store.dictationState}
    onDictate={() => store.toggleDictation()}
    commands={commandShortcuts}
    onPickFile={pickFile}

    bind:ctrl
    bind:alt
    bind:meta
  />
  {#if store.terminalState === 'moved'}
    <div class="overlay">
      <p>Opened on another device.</p>
      <div class="overlay-actions">
        <button type="button" class="primary" onclick={takeOver}>Take over</button>
        <button type="button" onclick={() => store.back()}>Back to list</button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* --app-height mirrors the visible viewport (visualViewport.height while the
     keyboard is up, innerHeight otherwise — see viewport.ts). We subtract the chrome
     that App.svelte's <main> adds around us (top safe-area inset + 0.75rem bottom
     padding) so the screen fits exactly inside the visible area; otherwise the bottom
     (incl. the keyboard bar) is pushed under the on-screen keyboard. Falls back to dvh. */
  /* App.svelte's <main> drops its bottom padding for the terminal view (.flush), so
     we only subtract the top inset here and the screen fills down to the viewport
     bottom; the keyboard bar's own bottom inset clears the home indicator. */
  .terminal-screen {
    position: relative;
    display: flex;
    flex-direction: column;
    height: calc(var(--app-height, 100dvh) - env(safe-area-inset-top, 0px));
    overflow: hidden;
    transition: height 0.15s ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .terminal-screen { transition: none; }
  }
  header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
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
  .title { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* touch-action: none keeps a one-finger drag ours: without it iOS WebKit can decide
     mid-gesture to scroll on the compositor thread and then ignores our touchmove
     preventDefault, stranding the swipe after one line.
     -webkit-touch-callout: none stops iOS from holding back a touch that starts on a text
     cell for the callout/text-interaction heuristic, which otherwise swallows the first
     touchmoves of the drag — so a swipe begun on text scrolls as fast as one begun on a
     blank row. In select mode we hand both back to the browser so iOS's native long-press
     text selection works. */
  .term {
    flex: 1;
    min-height: 0;
    position: relative;
    touch-action: none;
    -webkit-touch-callout: none;
  }
  .term.selecting { touch-action: auto; -webkit-touch-callout: default; }
  /* Android select mode: we drive xterm's own selection from touch (android-select.ts),
     so keep touch-action:none — the adapter owns the gesture — and do NOT enable native
     user-select (xterm draws its own selection layer). */
  .term.selecting-touch { touch-action: none; }
  /* xterm hides its DOM-rendered text from selection (user-select: none on .xterm).
     In select mode we re-enable it so iOS long-press selection works on the rows. */
  .term.selecting :global(.xterm),
  .term.selecting :global(.xterm-rows),
  .term.selecting :global(.xterm-screen) {
    user-select: text;
    -webkit-user-select: text;
  }
  /* DO NOT remove or "simplify" this rule — it fixes inverted (LTR) Arabic/RTL rendering on
     Android. It looks like a no-op because the bug only reproduces when an Arabic word splits
     across per-character spans, which needs a device font (jsdom and desktop Blink render a
     merged single span correctly, so no test catches a regression here).
     Android-only RTL fix. xterm renders each row's cells as spans and injects
     `.xterm-rows span { display: inline-block }`. An inline-block span is an atomic bidi
     object, so the engine lays sibling spans out in the row's ltr order and never reorders
     across them. It only *looks* right when a whole Arabic word lands in ONE span — which
     happens when its glyph widths are uniform (iOS fonts, desktop). When glyph widths vary
     (Android's monospace Arabic fallback), xterm's per-cell width correction differs per
     char, so the word can't be merged and splits into per-character spans — each a separate
     inline-block box, laid out left-to-right → the word reads reversed. Forcing the spans
     back to `display: inline` lets the browser's bidi reorder the Arabic run across the
     span boundaries (verified in Blink for both pure and mixed lines). Gated to .android so
     WebKit's already-correct path is untouched. Cost: `height:100%` no-ops on inline, so a
     cell's background box follows the line box instead (~1px), acceptable for readable RTL.
     jsdom has no bidi/layout engine; the visual result is validated on-device. */
  .term.android :global(.xterm-rows span) {
    display: inline !important;
  }
  .copied-toast {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    z-index: 10;
    padding: 0.3rem 0.8rem;
    border-radius: 999px;
    background: rgba(31, 157, 85, 0.95);
    color: #fff;
    font: 600 13px system-ui, sans-serif;
    pointer-events: none;
  }
  .overlay {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 1.25rem;
    background: rgba(0, 0, 0, 0.85); color: #fff;
  }
  .overlay p { margin: 0; font-size: 1.05rem; }
  .overlay-actions { display: flex; gap: 0.75rem; }
  .overlay-actions button {
    height: 44px;
    padding: 0 1.1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: 600 16px system-ui, sans-serif;
    touch-action: manipulation;
  }
  .overlay-actions button:active { background: var(--surface-press); }
  .overlay-actions button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .overlay-actions button.primary:active { background: var(--accent-press); }
</style>
