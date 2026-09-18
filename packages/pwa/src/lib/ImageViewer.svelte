<script lang="ts">
  import type { PerchStore } from '../store.svelte';
  import { basename } from '../core/browse-path';
  import { fit, baseScale, zoomAt, panBy, type Transform, type ViewContext } from '../core/zoom-pan';
  import { initialSwipe, accrue, markPinched, decideSwipe } from '../core/swipe-gesture';

  let { store }: { store: PerchStore } = $props();
  let file = $derived(store.fileView);
  let pos = $derived(store.imagePosition);

  const SWIPE_THRESHOLD = 60;
  let swipe = initialSwipe();

  let frame = $state<HTMLDivElement>();
  let natural = $state({ width: 0, height: 0 });
  let container = $state({ width: 0, height: 0 });
  let t = $state<Transform>({ scale: 1, tx: 0, ty: 0 });
  // Active pointers by id; one → drag-pan, two → pinch-zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let pinchMid = { x: 0, y: 0 };
  let lastTap = 0;

  function ctx(): ViewContext {
    const minScale = baseScale(container, natural);
    // Can't zoom out past the initial fit; allow up to 8× the fit (at least 1×) to inspect detail.
    return { container, image: natural, minScale, maxScale: Math.max(minScale * 8, 1) };
  }

  function reset(): void {
    if (container.width && natural.width) t = fit(container, natural);
  }

  function measure(): void {
    if (frame) container = { width: frame.clientWidth, height: frame.clientHeight };
    reset();
  }

  function onLoad(e: Event): void {
    const img = e.currentTarget as HTMLImageElement;
    natural = { width: img.naturalWidth, height: img.naturalHeight };
    // The frame is laid out before the (async) image load resolves, so its size is known here.
    measure();
  }

  function rel(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = frame!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // The two live pointers as a tuple (or null), so the pinch math is null-safe under
  // noUncheckedIndexedAccess.
  function pinchPair(): [{ x: number; y: number }, { x: number; y: number }] | null {
    const pts = [...pointers.values()];
    return pts.length === 2 ? [pts[0]!, pts[1]!] : null;
  }

  function onPointerDown(e: PointerEvent): void {
    frame!.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, rel(e));
    if (pointers.size === 1) swipe = initialSwipe();
    const pair = pinchPair();
    if (pair) {
      swipe = markPinched(swipe);
      const [a, b] = pair;
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else {
      // Double-tap (or double-click) resets to the contained fit.
      if (e.timeStamp - lastTap < 300) reset();
      lastTap = e.timeStamp;
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    const cur = rel(e);
    pointers.set(e.pointerId, cur);
    const pair = pinchPair();
    if (pair) {
      const [a, b] = pair;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDist > 0) t = zoomAt(t, mid, dist / pinchDist, ctx());
      t = panBy(t, mid.x - pinchMid.x, mid.y - pinchMid.y, ctx());
      pinchDist = dist;
      pinchMid = mid;
    } else {
      const next = panBy(t, cur.x - prev.x, cur.y - prev.y, ctx());
      swipe = accrue(swipe, cur.x - prev.x, cur.y - prev.y, next.tx - t.tx);
      t = next;
    }
  }

  function onPointerUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      const dir = decideSwipe(swipe, SWIPE_THRESHOLD);
      if (dir !== 0) store.showImageNeighbor(dir);
      swipe = initialSwipe();
    }
  }

  function onWheel(e: WheelEvent): void {
    // Desktop zoom is modifier+wheel; a bare wheel scrolls the page as usual.
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    t = zoomAt(t, rel(e), Math.exp(-e.deltaY / 200), ctx());
  }
</script>

<svelte:window onresize={measure} />

<section class="viewer">
  <header>
    <button type="button" class="icon" aria-label="Back" onclick={() => store.closeViewer()}>‹</button>
    <span class="title">{file ? basename(file.path) : ''}</span>
  </header>

  {#if store.viewError}
    <p class="error">Couldn't open this file.<br /><span>{store.viewError}</span></p>
  {:else if file?.truncated}
    <p class="empty">Image too large to preview (over 5&nbsp;MB).</p>
  {:else if file?.blobUrl}
    <div
      class="frame"
      role="application"
      aria-label="Zoomable image"
      bind:this={frame}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onwheel={onWheel}
    >
      <img
        src={file.blobUrl}
        alt={basename(file.path)}
        draggable="false"
        onload={onLoad}
        style="transform: translate({t.tx}px, {t.ty}px) scale({t.scale}); transform-origin: 0 0;"
      />
      {#if pos && pos.count > 1}
        <div class="counter">{pos.index} / {pos.count}</div>
      {/if}
    </div>
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
  .title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--text-dim); }
  .error { color: var(--danger); }
  .error span { color: var(--text-dim); font-size: 0.8rem; word-break: break-all; }
  /* The frame clips the transformed image and owns the gestures. touch-action:none stops the
     browser from claiming pinch/scroll for its own page zoom. Its height is sized to the
     viewport (like FileViewer's .code) rather than flex:1/height:100% — the narrow layout's
     <main> has no height, so a percentage height would collapse the frame to 0. */
  .frame {
    position: relative; height: calc(100dvh - 8rem); margin-top: 0.5rem; overflow: hidden;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); touch-action: none;
  }
  .frame img { position: absolute; top: 0; left: 0; will-change: transform; user-select: none; }
  /* Position counter; pointer-events:none so it never eats a swipe. */
  .counter {
    position: absolute; bottom: 0.5rem; left: 50%; transform: translateX(-50%);
    padding: 0.15rem 0.6rem; border-radius: 999px; pointer-events: none;
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    color: var(--text-dim); font-size: 0.8rem; font-variant-numeric: tabular-nums;
  }
</style>
