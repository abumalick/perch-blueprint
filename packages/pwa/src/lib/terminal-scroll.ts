// Touch swipes never produce `wheel` events, so a full-screen TUI like Claude Code
// — which runs in the alternate screen with mouse tracking on — never sees them and
// the browser scrolls/rubber-bands the page instead. On desktop xterm forwards a real
// `wheel` over the terminal to the app as mouse-scroll sequences (and scrolls local
// scrollback otherwise). We reproduce that on touch by translating a one-finger drag
// into synthetic `wheel` events on the scroll container; xterm then handles them the
// same way it handles a physical wheel. `touch-action: none` on the terminal (CSS)
// stops the browser from claiming the gesture before we can.
//
// We dispatch line-mode wheels (deltaMode 1, ±1 per line). xterm maps each to exactly one
// row in both local scrollback and a mouse-tracking app's alt screen. Pixel-mode wheels are
// not reliable here: for a mouse-mode app xterm divides the pixel delta by its own (unexposed)
// row height and floors it, accumulating the remainder — so a delta built from a row-height
// estimate that is even slightly too small scrolls <1 line and the gesture sticks. Line mode
// has no such division, so one finger-row of drag = one terminal line, deterministically.

// A swipe scrolls ~AMPLIFY× its finger distance in lines, so long histories are reachable
// without repeated swipes. Bump for punchier scrolling.
const AMPLIFY = 2;

export type TerminalScroll = {
  scrollLines: (lines: number) => void;
  destroy: () => void;
};

// `enabled` lets the caller pause touch interception (e.g. in select mode) so the
// browser keeps the drag for native text selection. scrollLines stays live either
// way, so the floating scroll buttons work in both modes. `rowHeight` (an estimate,
// container height ÷ rows) only converts drag pixels into a line count — line-mode
// wheels make the scroll itself independent of how accurate it is.
export function attachTerminalScroll(
  container: HTMLElement,
  enabled: () => boolean = () => true,
  rowHeight: () => number = () => 16,
): TerminalScroll {
  // The element a physical wheel lands on; bubbling from here also reaches xterm's
  // mouse-mode wheel handler on the `.xterm` root. Null before xterm has opened.
  const viewport = () => container.querySelector('.xterm-viewport') as HTMLElement | null;

  const scrollLines = (lines: number) => {
    const n = Math.trunc(lines);
    if (n === 0) return;
    const deltaY = Math.sign(n);
    for (let i = 0; i < Math.abs(n); i++) {
      viewport()?.dispatchEvent(
        new WheelEvent('wheel', { deltaY, deltaMode: 1, bubbles: true, cancelable: true }),
      );
    }
  };

  let lastY: number | null = null;
  // Amplified drag pixels not yet spent as whole lines; carried across moves so a slow
  // drag still scrolls and nothing is rounded away.
  let acc = 0;
  // Row height sampled once per gesture. rowHeight() reads layout (getBoundingClientRect),
  // which forces a synchronous reflow; calling it on every touchmove while xterm rewrites its
  // rows makes a drag over a text-heavy screen reflow-bound and slower than one over blank
  // rows. The font can't change mid-drag, so one sample per gesture keeps the speed uniform.
  let rh = 0;
  const onTouchStart = (e: TouchEvent) => {
    if (!enabled() || e.touches.length !== 1) {
      lastY = null;
      return;
    }
    lastY = e.touches[0]!.clientY;
    acc = 0;
    rh = rowHeight();
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!enabled() || lastY === null || e.touches.length !== 1) return;
    const y = e.touches[0]!.clientY;
    // Drag down (y grows) reveals content above → wheel up (negative), matching
    // natural touch scrolling.
    const deltaY = lastY - y;
    lastY = y;
    if (deltaY === 0) return;
    // We own this gesture; stop the browser from scrolling/rubber-banding the page.
    e.preventDefault();
    if (!Number.isFinite(rh) || rh <= 0) return;
    acc += deltaY * AMPLIFY;
    const lines = Math.trunc(acc / rh);
    if (lines === 0) return;
    acc -= lines * rh;
    scrollLines(lines);
  };
  const onTouchEnd = () => {
    lastY = null;
    acc = 0;
  };

  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd, { passive: true });
  container.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return {
    scrollLines,
    destroy() {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    },
  };
}
