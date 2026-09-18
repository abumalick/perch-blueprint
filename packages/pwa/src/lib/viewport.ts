// Track the usable height into the `--app-height` CSS variable so the terminal
// screen shrinks to the area *above* the on-screen keyboard. On iOS Safari the
// layout viewport does NOT shrink when the keyboard opens (only the visual viewport
// does), so `100dvh` sits *behind* the keyboard — hence visualViewport.height while
// the keyboard is up, and window.innerHeight once it's dismissed (see write()).
//
// visualViewport covers both platforms, so we use it as the single baseline. We do NOT
// opt into the Chromium VirtualKeyboard API's overlaysContent mode: that stops Chrome from
// resizing the visual viewport, so visualViewport.height would stay full and the terminal
// (bar included) would sit behind the on-screen keyboard. The default (resizes-visual) is
// what shrinks visualViewport on keyboard open — exactly what write() below reads.

// Watch whether the viewport is wide enough for the persistent two-pane layout
// (workspace list as a left sidebar instead of a full-screen view). 980px sits in the
// gap between the widest phones in landscape (~956px) and small tablets in landscape
// (~1007px): tablets and desktops get the sidebar, while phones (incl. landscape) and
// portrait tablets stay single-pane.
// Width-only on purpose — `interactive-widget=resizes-content` shrinks innerHeight when
// the Android keyboard opens, so a height-based query would collapse the layout mid-type;
// width is unaffected by the keyboard. Calls onChange immediately with the current match,
// then on every change; returns a teardown. Falls back to `false` where matchMedia is
// absent (jsdom under unit tests).
const WIDE_QUERY = '(min-width: 980px)';

export function trackWide(onChange: (matches: boolean) => void): () => void {
  const mm = window.matchMedia;
  if (!mm) {
    onChange(false);
    return () => {};
  }
  const mql = mm.call(window, WIDE_QUERY);
  onChange(mql.matches);
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}

export interface Dimensions {
  width: number;
  height: number;
  dpr: number;
}

// Report the live layout-viewport size (CSS px) and device pixel ratio, updating on
// resize (which also covers orientation changes). Surfaced in the Settings diagnostics
// readout so the CSS dimensions that drive the responsive breakpoints are visible
// on-device (e.g. to see why a small tablet lands below the two-pane threshold). Calls
// onChange immediately, then on every change; returns a teardown.
export function trackDimensions(onChange: (d: Dimensions) => void): () => void {
  const read = (): Dimensions => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  });
  onChange(read());
  const handler = () => onChange(read());
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}

export function trackViewport(onChange?: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.setProperty('--app-height', '100dvh');
    return () => {};
  }

  // visualViewport.height only matters while an input is focused (keyboard up). After
  // the keyboard is dismissed by *blurring* the input, iOS Safari leaves
  // visualViewport.height stuck at its shrunk value, so the screen never grows back.
  // With no input focused there is no keyboard, so window.innerHeight (the full layout
  // viewport, which iOS never shrinks) is the correct — and lag-free — height.
  const keyboardOpen = () => {
    const el = document.activeElement;
    return (
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    );
  };

  // The keyboard animation fires many resize events per frame. Coalesce to one
  // DOM write + refit per animation frame so the bar follows smoothly instead of
  // thrashing layout. A CSS transition on the height (see TerminalView) eases the
  // discrete steps iOS reports.
  let frame = 0;
  const write = () => {
    frame = 0;
    const open = keyboardOpen();
    const height = open ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
    // While the keyboard is up it covers the home-indicator area, so the bottom
    // safe-area inset is dead space that pushes the keyboard bar off the keyboard.
    // Expose the state so the bar can drop that inset (see KeyboardBar.svelte).
    document.documentElement.classList.toggle('keyboard-open', open);
    onChange?.();
  };
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(write);
  };

  write();
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  // Focus changes drive the keyboard, but the matching visualViewport event can be
  // late or stale on iOS — re-measure on focus too so dismissal restores full height.
  window.addEventListener('focusin', schedule);
  window.addEventListener('focusout', schedule);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    window.removeEventListener('focusin', schedule);
    window.removeEventListener('focusout', schedule);
    document.documentElement.style.removeProperty('--app-height');
    document.documentElement.classList.remove('keyboard-open');
  };
}
