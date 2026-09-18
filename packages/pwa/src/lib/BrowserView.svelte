<script lang="ts">
  import { onMount } from 'svelte';
  import type { BrowserEndedReason } from '@perch/contracts';
  import type { PerchStore } from '../store.svelte';
  import type { BrowserStream, BrowserStreamState } from '../core/browser-stream';
  import {
    frameScale,
    tapMessages,
    dragScrollMessage,
    wheelMessage,
    keyMessages,
    type FrameScale,
    type KeyEventLike,
  } from '../core/browser-input';
  import KeyboardBar from './KeyboardBar.svelte';
  import { trackViewport } from './viewport';

  let { store }: { store: PerchStore } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let urlEl = $state<HTMLInputElement>();
  let typeEl = $state<HTMLInputElement>();
  let streamState = $state<BrowserStreamState>('connecting');
  let endReason = $state<BrowserEndedReason | null>(null);
  let urlText = $state('');
  let stream: BrowserStream | null = null;
  // Remote device size from the latest frame's metadata, for CSS→device coordinate mapping.
  let deviceW = 0;
  let deviceH = 0;
  // Decoding is async; only the newest frame may draw, or a slow decode paints stale pixels.
  let drawSeq = 0;

  function scale(): FrameScale {
    const rect = canvas?.getBoundingClientRect();
    return frameScale(rect?.width ?? 0, rect?.height ?? 0, deviceW, deviceH);
  }

  function rel(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  async function drawFrame(dataB64: string, meta: { deviceWidth: number; deviceHeight: number }): Promise<void> {
    deviceW = meta.deviceWidth;
    deviceH = meta.deviceHeight;
    if (!canvas) return;
    const seq = ++drawSeq;
    try {
      const bytes = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      if (seq !== drawSeq || !canvas) {
        bitmap.close?.();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      // Resizing the backing store clears the canvas, so only do it when the box changed.
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const fs = frameScale(rect.width, rect.height, deviceW, deviceH);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, fs.offsetX, fs.offsetY, deviceW * fs.scale, deviceH * fs.scale);
      bitmap.close?.();
    } catch {
      // Undecodable frame: skip it, the next one repaints.
    }
  }

  // Tap vs drag-to-scroll: a pointer that stays within the threshold is a click; past
  // it the gesture becomes a scroll (wheel deltas, touch-natural direction).
  const TAP_THRESHOLD = 10;
  let pointer: { id: number; startX: number; startY: number; lastX: number; lastY: number; dragging: boolean } | null = null;

  function onPointerDown(e: PointerEvent): void {
    if (streamState !== 'online') return;
    try {
      canvas?.setPointerCapture?.(e.pointerId);
    } catch {
      // jsdom / stale pointer id — capture is best-effort
    }
    const p = rel(e);
    pointer = { id: e.pointerId, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, dragging: false };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = rel(e);
    if (!pointer.dragging && Math.hypot(p.x - pointer.startX, p.y - pointer.startY) > TAP_THRESHOLD) {
      pointer.dragging = true;
    }
    if (pointer.dragging) {
      stream?.send(dragScrollMessage(p.x - pointer.lastX, p.y - pointer.lastY, p.x, p.y, scale()));
    }
    pointer.lastX = p.x;
    pointer.lastY = p.y;
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pointer || e.pointerId !== pointer.id) return;
    const { dragging, startX, startY } = pointer;
    pointer = null;
    if (dragging) return;
    // Click at the press position: that's where the user aimed; the release point
    // drifts by finger roll.
    for (const m of tapMessages(startX, startY, scale())) stream?.send(m);
  }

  // A cancelled pointer (iOS long-press callout, system gesture) must not click.
  function onPointerCancel(e: PointerEvent): void {
    if (pointer && e.pointerId === pointer.id) pointer = null;
  }

  function onWheel(e: WheelEvent): void {
    if (streamState !== 'online') return;
    e.preventDefault();
    const p = rel(e);
    stream?.send(wheelMessage({ x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY }, scale()));
  }

  function submitUrl(e: SubmitEvent): void {
    e.preventDefault();
    const raw = urlText.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    stream?.send({ type: 'navigate', url });
    urlEl?.blur();
  }

  function sendKey(key: string, code: string): void {
    for (const m of keyMessages({ key, code })) stream?.send(m);
  }

  // The KeyboardBar speaks terminal escape sequences; map its navigation keys back to
  // DOM key names for the browser. Sequences with no browser equivalent are dropped.
  const SEQ_KEYS: Record<string, KeyEventLike> = {
    '\x1b': { key: 'Escape', code: 'Escape' },
    '\t': { key: 'Tab', code: 'Tab' },
    '\x1b[Z': { key: 'Tab', code: 'Tab', shiftKey: true },
    '\r': { key: 'Enter', code: 'Enter' },
    '\x7f': { key: 'Backspace', code: 'Backspace' },
    '\x1b[A': { key: 'ArrowUp', code: 'ArrowUp' },
    '\x1b[B': { key: 'ArrowDown', code: 'ArrowDown' },
    '\x1b[C': { key: 'ArrowRight', code: 'ArrowRight' },
    '\x1b[D': { key: 'ArrowLeft', code: 'ArrowLeft' },
  };

  function sendSeq(seq: string): void {
    const k = SEQ_KEYS[seq];
    if (k) for (const m of keyMessages(k)) stream?.send(m);
  }

  // Soft-keyboard typing lands on the hidden input's keydown; forward it as key events
  // and swallow it so the input stays empty.
  function onTypeKey(e: KeyboardEvent): void {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    e.preventDefault();
    for (const m of keyMessages(e)) stream?.send(m);
  }

  async function paste(): Promise<void> {
    try {
      const text = await navigator.clipboard?.readText();
      if (!text) return;
      for (const ch of text) {
        if (ch === '\n') sendKey('Enter', 'Enter');
        else sendKey(ch, '');
      }
    } catch {
      // clipboard read denied or unavailable — nothing to paste
    }
  }

  function retry(): void {
    endReason = null;
    stream?.open();
  }

  function closeSession(): void {
    stream?.send({ type: 'closeSession' });
    store.browserSessionClosed();
  }

  // Match the remote browser's viewport to this viewer's canvas so the page renders
  // at whichever device is attached (phone/tablet/desktop). Sent on reaching online
  // and re-sent (debounced) while the window resizes.
  const VIEWPORT_DEBOUNCE_MS = 300;
  let viewportTimer: ReturnType<typeof setTimeout> | null = null;

  function sendViewport(): void {
    if (streamState !== 'online') return;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width <= 0 || height <= 0) return;
    stream?.send({ type: 'setViewport', width, height });
  }

  function endMessage(reason: BrowserEndedReason | null): string {
    if (reason === 'not-found') return 'Browser session not found.';
    if (reason === 'opened-elsewhere') return 'Opened on another device.';
    return 'Browser session ended.';
  }

  onMount(() => {
    stream = store.openBrowserStream({
      onFrame: (data, meta) => void drawFrame(data, meta),
      onUrl: (u) => {
        // Don't clobber an address the user is mid-editing.
        if (document.activeElement !== urlEl) urlText = u;
      },
      onState: (s) => {
        streamState = s;
        if (s !== 'ended') endReason = null;
        if (s === 'online') sendViewport();
      },
      endedReason: (r) => {
        endReason = r;
      },
    });
    stream?.open();
    const onWindowResize = () => {
      if (viewportTimer) clearTimeout(viewportTimer);
      viewportTimer = setTimeout(() => {
        viewportTimer = null;
        sendViewport();
      }, VIEWPORT_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onWindowResize);
    // Keep --app-height mirroring the visible viewport (same as TerminalView) so the
    // view shrinks above the soft keyboard instead of pushing the bar off-screen.
    const stopViewport = trackViewport();
    return () => {
      window.removeEventListener('resize', onWindowResize);
      if (viewportTimer) clearTimeout(viewportTimer);
      stopViewport();
      stream?.close();
      stream = null;
    };
  });
</script>

<section class="browser-view">
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={() => store.closeBrowserView()}>‹</button>
    <button type="button" class="icon" aria-label="Browser back" onclick={() => stream?.send({ type: 'back' })}>◀</button>
    <button type="button" class="icon" aria-label="Browser forward" onclick={() => stream?.send({ type: 'forward' })}>▶</button>
    <span class="title">{store.browserTarget?.session ?? ''}</span>
    <button type="button" class="icon" aria-label="Keyboard" onclick={() => typeEl?.focus()}>⌨</button>
    <button type="button" class="icon" aria-label="Close session" onclick={closeSession}>✕</button>
  </header>
  <form class="url-bar" onsubmit={submitUrl}>
    <input
      bind:this={urlEl}
      bind:value={urlText}
      type="text"
      aria-label="URL"
      placeholder="https://…"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <button type="submit">Go</button>
  </form>
  <div class="frame">
    <canvas
      bind:this={canvas}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerCancel}
      onwheel={onWheel}
    ></canvas>
    {#if streamState === 'connecting'}
      <div class="overlay"><p>Connecting…</p></div>
    {:else if streamState === 'ended'}
      <div class="overlay">
        <p>{endMessage(endReason)}</p>
        <button type="button" class="primary" onclick={retry}>Retry</button>
      </div>
    {/if}
  </div>
  <KeyboardBar send={sendSeq} {paste} selectMode={false} onToggleSelect={() => {}} />
  <input bind:this={typeEl} class="type-input" aria-hidden="true" tabindex="-1" onkeydown={onTypeKey} />
</section>

<style>
  /* Same sizing as TerminalView's .terminal-screen: --app-height mirrors the visible
     viewport (visualViewport while the keyboard is up) and App's <main> drops its
     bottom padding for this view (.flush), so only the top safe-area inset is
     subtracted. The frame then flexes to whatever is left above the KeyboardBar —
     the old `calc(100dvh - 8rem)` frame pushed the bar off-screen. */
  .browser-view {
    display: flex;
    flex-direction: column;
    height: calc(var(--app-height, 100dvh) - env(safe-area-inset-top, 0px));
    overflow: hidden;
    transition: height 0.15s ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .browser-view { transition: none; }
  }
  header { display: flex; align-items: center; gap: 0.5rem; }
  header button.icon {
    flex: 0 0 auto; width: 44px; height: 44px; display: grid; place-items: center;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); color: var(--text); font-size: 22px; line-height: 1;
    touch-action: manipulation;
  }
  header button.icon:active { background: var(--surface-press); }
  .title { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .url-bar { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .url-bar input { flex: 1; min-width: 0; height: 40px; }
  .url-bar button {
    height: 40px; padding: 0 0.9rem; border: 1px solid var(--border);
    border-radius: var(--radius); background: var(--surface); color: var(--text);
    font: 600 14px system-ui, sans-serif; touch-action: manipulation;
  }
  .url-bar button:active { background: var(--surface-press); }
  /* Fills the space between the url bar and the KeyboardBar. flex:1 + min-height:0 is
     safe here (unlike a percentage height) because .browser-view itself has a real
     viewport-derived height; the canvas letterboxes to whatever region results. */
  .frame {
    position: relative; flex: 1; min-height: 0; margin-top: 0.5rem; overflow: hidden;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: #000;
  }
  /* touch-action: none keeps one-finger drags ours for drag-to-scroll (same rationale
     as the terminal); the canvas is the full frame and letterboxes in draw code.
     user-select/touch-callout off so a slow tap doesn't trigger the iOS magnifier or
     callout, which cancels the pointer and eats the click. */
  canvas {
    display: block; width: 100%; height: 100%; touch-action: none;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  }
  .overlay {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 1.25rem;
    background: rgba(0, 0, 0, 0.7); color: #fff;
  }
  .overlay p { margin: 0; font-size: 1.05rem; }
  .overlay button.primary {
    height: 44px; padding: 0 1.1rem; border: 1px solid var(--accent);
    border-radius: var(--radius); background: var(--accent); color: #fff;
    font: 600 16px system-ui, sans-serif; touch-action: manipulation;
  }
  .overlay button.primary:active { background: var(--accent-press); }
  /* Off-screen but focusable, like App's keyboard anchor: focusing it raises the soft
     keyboard so onTypeKey can forward the typing to the remote browser. */
  .type-input {
    position: fixed; top: 0; left: 0; width: 1px; height: 1px; opacity: 0;
    border: 0; padding: 0; margin: 0; pointer-events: none;
    font-size: 16px; caret-color: transparent;
  }
</style>
