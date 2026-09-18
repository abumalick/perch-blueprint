// Trackpad-style cursor control for the keyboard bar: pointer travel becomes arrow
// keypresses. Modelled as a moving reference point rather than distance-from-origin —
// each emitted notch advances the reference, which is what makes reversing the drag
// emit the opposite direction for free. Pure and DOM-free so it unit-tests directly.

// THE tuning knob: px of drag travel per emitted arrow key. Lower = faster and twitchier,
// higher = slower and more precise. Safe to change alone — the unit tests derive from it.
export const NOTCH_PX = 33;

export type PadDirection = 'left' | 'right' | 'up' | 'down';

type Axis = 'x' | 'y';

export type PadState = { x: number; y: number; axis: Axis | null };

const DIRECTION = { x: ['left', 'right'], y: ['up', 'down'] } as const;

export function startGesture(x: number, y: number): PadState {
  return { x, y, axis: null };
}

export function moveGesture(
  state: PadState,
  x: number,
  y: number,
): { state: PadState; emit: PadDirection[] } {
  const dx = x - state.x;
  const dy = y - state.y;

  // The first notch crossed locks the axis for the rest of the gesture, so a sloppy
  // diagonal can't spray perpendicular arrows.
  const axis = state.axis ?? lockAxis(dx, dy);
  if (!axis) return { state, emit: [] };

  const delta = axis === 'x' ? dx : dy;
  const count = Math.floor(Math.abs(delta) / NOTCH_PX);
  const direction = DIRECTION[axis][delta < 0 ? 0 : 1];
  const advance = count * (delta < 0 ? -NOTCH_PX : NOTCH_PX);

  return {
    state: {
      x: axis === 'x' ? state.x + advance : state.x,
      y: axis === 'y' ? state.y + advance : state.y,
      axis,
    },
    emit: Array.from({ length: count }, () => direction),
  };
}

function lockAxis(dx: number, dy: number): Axis | null {
  if (Math.abs(dx) >= NOTCH_PX && Math.abs(dx) >= Math.abs(dy)) return 'x';
  if (Math.abs(dy) >= NOTCH_PX) return 'y';
  return null;
}
