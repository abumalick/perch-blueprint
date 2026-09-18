import { describe, it, expect } from 'vitest';
import { NOTCH_PX, startGesture, moveGesture } from './cursor-pad';

const N = NOTCH_PX;

describe('cursor-pad', () => {
  it('starts a gesture with no axis locked', () => {
    expect(startGesture(0, 0).axis).toBeNull();
  });

  it('emits nothing before the first notch is crossed', () => {
    const s = startGesture(100, 100);
    expect(moveGesture(s, 100 + N - 1, 100).emit).toEqual([]);
  });

  it('emits one direction when a single notch is crossed', () => {
    const s = startGesture(100, 100);
    expect(moveGesture(s, 100 - N, 100).emit).toEqual(['left']);
  });

  it('emits one direction per notch when one move crosses several', () => {
    const s = startGesture(100, 100);
    expect(moveGesture(s, 100 + 3 * N, 100).emit).toEqual(['right', 'right', 'right']);
  });

  it('advances the reference so travel accumulates across moves', () => {
    let s = startGesture(100, 100);
    const first = moveGesture(s, 100 + N, 100);
    expect(first.emit).toEqual(['right']);
    s = first.state;
    expect(moveGesture(s, 100 + 2 * N, 100).emit).toEqual(['right']);
  });

  it('emits the opposite direction when the drag reverses past a notch', () => {
    let s = startGesture(100, 100);
    s = moveGesture(s, 100 + N, 100).state;
    expect(moveGesture(s, 100, 100).emit).toEqual(['left']);
  });

  it('locks the axis on the first notch and ignores the perpendicular axis', () => {
    let s = startGesture(100, 100);
    s = moveGesture(s, 100 + N, 100).state; // locks 'x'
    expect(moveGesture(s, 100 + N, 100 + 3 * N).emit).toEqual([]);
  });

  it('locks the vertical axis when the drag starts vertical', () => {
    const s = startGesture(100, 100);
    expect(moveGesture(s, 100, 100 - 2 * N).emit).toEqual(['up', 'up']);
  });

  it('emits down for a downward drag', () => {
    const s = startGesture(100, 100);
    expect(moveGesture(s, 100, 100 + N).emit).toEqual(['down']);
  });

  it('picks the dominant axis when one move crosses a notch on both', () => {
    const s = startGesture(100, 100);
    expect(moveGesture(s, 100 + 2 * N, 100 + N).emit).toEqual(['right', 'right']);
  });
});
