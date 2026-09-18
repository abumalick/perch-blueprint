// Pure swipe-intent accumulator for the image viewer. Horizontal drag the pan could not
// consume (overflow past the image edge) accrues as swipe intent; on release decideSwipe
// turns it into a navigation direction. Kept DOM-free so it is unit-testable.

export interface SwipeState {
  overflowX: number;
  travelY: number;
  pinched: boolean;
}

export function initialSwipe(): SwipeState {
  return { overflowX: 0, travelY: 0, pinched: false };
}

export function accrue(s: SwipeState, dx: number, dy: number, txDelta: number): SwipeState {
  return {
    overflowX: s.overflowX + (dx - txDelta),
    travelY: s.travelY + Math.abs(dy),
    pinched: s.pinched,
  };
}

export function markPinched(s: SwipeState): SwipeState {
  return { ...s, pinched: true };
}

export function decideSwipe(s: SwipeState, threshold: number): -1 | 0 | 1 {
  if (s.pinched) return 0;
  if (Math.abs(s.overflowX) < threshold) return 0;
  if (Math.abs(s.overflowX) <= s.travelY) return 0;
  return s.overflowX > 0 ? -1 : 1;
}
