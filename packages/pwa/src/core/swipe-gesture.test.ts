import { describe, it, expect } from 'vitest';
import { initialSwipe, accrue, markPinched, decideSwipe } from './swipe-gesture';

const feed = (moves: [number, number, number][]) =>
  moves.reduce((s, [dx, dy, tx]) => accrue(s, dx, dy, tx), initialSwipe());

describe('accrue', () => {
  it('counts only the drag the pan could not consume (past the edge)', () => {
    const s = feed([
      [-30, 0, -30],
      [-50, 0, 0],
    ]);
    expect(s.overflowX).toBe(-50);
    expect(s.travelY).toBe(0);
  });
  it('accumulates vertical travel as absolute distance', () => {
    expect(
      feed([
        [0, -20, 0],
        [0, 15, 0],
      ]).travelY,
    ).toBe(35);
  });
});

describe('decideSwipe', () => {
  it('fires next when dragged left past the threshold', () => {
    expect(decideSwipe(feed([[-80, 0, 0]]), 60)).toBe(1);
  });
  it('fires previous when dragged right past the threshold', () => {
    expect(decideSwipe(feed([[80, 0, 0]]), 60)).toBe(-1);
  });
  it('does nothing below the threshold', () => {
    expect(decideSwipe(feed([[-40, 0, 0]]), 60)).toBe(0);
  });
  it('does nothing when vertical dominates', () => {
    expect(
      decideSwipe(
        feed([
          [-80, 0, 0],
          [0, -90, 0],
        ]),
        60,
      ),
    ).toBe(0);
  });
  it('is suppressed after a pinch', () => {
    const s = markPinched(feed([[-80, 0, 0]]));
    expect(decideSwipe(s, 60)).toBe(0);
  });
});
