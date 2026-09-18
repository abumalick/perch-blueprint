import { describe, it, expect } from 'vitest';
import { fitScale, fit, zoomAt, panBy, type ViewContext } from './zoom-pan';

// A square image in a square container: fit scale 1, no offsets — a clean base for zoom/pan.
const ctx = (over: Partial<ViewContext> = {}): ViewContext => ({
  container: { width: 100, height: 100 },
  image: { width: 100, height: 100 },
  minScale: 1,
  maxScale: 4,
  ...over,
});

describe('fit', () => {
  it('contains by the limiting axis and centers on the other', () => {
    // 100x100 image in a 300x100 container: height is the limit (scale 1), centered horizontally.
    expect(fitScale({ width: 300, height: 100 }, { width: 100, height: 100 })).toBe(1);
    expect(fit({ width: 300, height: 100 }, { width: 100, height: 100 })).toEqual({ scale: 1, tx: 100, ty: 0 });
  });

  it('does not upscale an image smaller than the container (caps at 100%, centered)', () => {
    // 50x50 image in a 200x200 container: shown at natural size, centered — not blown up to fill.
    expect(fit({ width: 200, height: 200 }, { width: 50, height: 50 })).toEqual({ scale: 1, tx: 75, ty: 75 });
  });
});

describe('zoomAt', () => {
  it('keeps the focal point fixed on screen', () => {
    const start = fit({ width: 100, height: 100 }, { width: 100, height: 100 }); // {scale:1, tx:0, ty:0}
    const focal = { x: 50, y: 50 };
    const next = zoomAt(start, focal, 2, ctx());
    const ixBefore = (focal.x - start.tx) / start.scale;
    const ixAfter = (focal.x - next.tx) / next.scale;
    expect(ixAfter).toBeCloseTo(ixBefore, 6);
    expect(next.scale).toBe(2);
  });

  it('clamps scale to [minScale, maxScale]', () => {
    const start = { scale: 1, tx: 0, ty: 0 };
    expect(zoomAt(start, { x: 0, y: 0 }, 0.01, ctx()).scale).toBe(1);
    expect(zoomAt(start, { x: 0, y: 0 }, 100, ctx()).scale).toBe(4);
  });
});

describe('panBy', () => {
  it('re-centers an axis smaller than the container', () => {
    const start = { scale: 0.5, tx: 0, ty: 0 }; // content 50x50 inside 100x100
    const moved = panBy(start, 999, 999, ctx());
    expect(moved.tx).toBe(25);
    expect(moved.ty).toBe(25);
  });

  it('clamps an axis larger than the container to its edges', () => {
    const start = { scale: 4, tx: 0, ty: 0 }; // content 400x400 inside 100x100
    expect(panBy(start, 1000, 1000, ctx()).tx).toBe(0); // can't pan past the left/top edge
    expect(panBy(start, -1000, -1000, ctx()).tx).toBe(-300); // 100 - 400
    expect(panBy(start, -1000, -1000, ctx()).ty).toBe(-300);
  });
});
