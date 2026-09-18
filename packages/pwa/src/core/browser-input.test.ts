import { describe, it, expect } from 'vitest';
import {
  frameScale,
  toDevicePoint,
  tapMessages,
  dragScrollMessage,
  wheelMessage,
  keyMessages,
} from './browser-input';

describe('frameScale', () => {
  it('maps 1:1 when canvas and device sizes match', () => {
    expect(frameScale(390, 600, 390, 600)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      deviceWidth: 390,
      deviceHeight: 600,
    });
  });

  it('scales down a larger device frame with no letterbox at equal aspect', () => {
    expect(frameScale(390, 600, 780, 1200)).toEqual({
      scale: 0.5,
      offsetX: 0,
      offsetY: 0,
      deviceWidth: 780,
      deviceHeight: 1200,
    });
  });

  it('centers horizontally when the canvas is wider than the frame (pillarbox)', () => {
    // Drawn size 300x300 inside 400x300 → 50px bars left and right.
    expect(frameScale(400, 300, 200, 200)).toEqual({
      scale: 1.5,
      offsetX: 50,
      offsetY: 0,
      deviceWidth: 200,
      deviceHeight: 200,
    });
  });

  it('centers vertically when the canvas is taller than the frame (letterbox)', () => {
    // Drawn size 200x100 inside 200x300 → 100px bars top and bottom.
    expect(frameScale(200, 300, 400, 200)).toEqual({
      scale: 0.5,
      offsetX: 0,
      offsetY: 100,
      deviceWidth: 400,
      deviceHeight: 200,
    });
  });

  it('degrades to identity for zero device dimensions', () => {
    expect(frameScale(400, 300, 0, 0)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      deviceWidth: 0,
      deviceHeight: 0,
    });
  });
});

describe('toDevicePoint', () => {
  const fs = frameScale(400, 300, 200, 200); // scale 1.5, offsetX 50

  it('maps a CSS point inside the drawn frame to device pixels', () => {
    expect(toDevicePoint(350, 300, fs)).toEqual({ x: 200, y: 200 });
    expect(toDevicePoint(50, 0, fs)).toEqual({ x: 0, y: 0 });
    expect(toDevicePoint(200, 150, fs)).toEqual({ x: 100, y: 100 });
  });

  it('clamps a point in the letterbox bars to the frame edge', () => {
    expect(toDevicePoint(10, 150, fs)).toEqual({ x: 0, y: 100 });
    expect(toDevicePoint(399, 150, fs)).toEqual({ x: 200, y: 100 });
  });
});

describe('tapMessages', () => {
  it('builds mouseMoved + mousePressed + mouseReleased with clickCount 1 at scaled coords', () => {
    const fs = frameScale(390, 600, 780, 1200); // scale 0.5
    expect(tapMessages(39, 60, fs)).toEqual([
      { type: 'input_mouse', eventType: 'mouseMoved', x: 78, y: 120 },
      {
        type: 'input_mouse',
        eventType: 'mousePressed',
        x: 78,
        y: 120,
        button: 'left',
        clickCount: 1,
      },
      {
        type: 'input_mouse',
        eventType: 'mouseReleased',
        x: 78,
        y: 120,
        button: 'left',
        clickCount: 1,
      },
    ]);
  });

  it('clamps a tap on the letterbox bar to the frame edge', () => {
    const fs = frameScale(400, 300, 200, 200); // offsetX 50
    const [moved] = tapMessages(10, 150, fs);
    expect(moved).toMatchObject({ x: 0, y: 100 });
  });
});

describe('dragScrollMessage', () => {
  it('builds a mouseWheel with deltas inverted (touch-natural) and scaled to device px', () => {
    const fs = frameScale(390, 600, 780, 1200); // scale 0.5
    // Finger moves down/right by (10, 30) CSS px → content scrolls up/left.
    expect(dragScrollMessage(10, 30, 100, 200, fs)).toEqual({
      type: 'input_mouse',
      eventType: 'mouseWheel',
      x: 200,
      y: 400,
      deltaX: -20,
      deltaY: -60,
    });
  });
});

describe('wheelMessage', () => {
  it('passes DOM wheel deltas through unflipped, scaled to device px', () => {
    const fs = frameScale(390, 600, 780, 1200); // scale 0.5
    expect(wheelMessage({ x: 100, y: 200, deltaX: 4, deltaY: 10 }, fs)).toEqual({
      type: 'input_mouse',
      eventType: 'mouseWheel',
      x: 200,
      y: 400,
      deltaX: 8,
      deltaY: 20,
    });
  });
});

describe('keyMessages', () => {
  it('builds keyDown + keyUp with text on keyDown for a printable key', () => {
    expect(keyMessages({ key: 'a', code: 'KeyA' })).toEqual([
      { type: 'input_keyboard', eventType: 'keyDown', key: 'a', code: 'KeyA', text: 'a', modifiers: 0 },
      { type: 'input_keyboard', eventType: 'keyUp', key: 'a', code: 'KeyA', modifiers: 0 },
    ]);
  });

  it('omits text for a control key', () => {
    const [down, up] = keyMessages({ key: 'Enter', code: 'Enter' });
    expect(down).toEqual({
      type: 'input_keyboard',
      eventType: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      modifiers: 0,
    });
    expect(up).toEqual({
      type: 'input_keyboard',
      eventType: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      modifiers: 0,
    });
  });

  it('maps held modifiers to CDP bits (Alt=1, Ctrl=2, Meta=4, Shift=8)', () => {
    expect(keyMessages({ key: 'A', code: 'KeyA', shiftKey: true })[0]).toMatchObject({
      modifiers: 8,
    });
    expect(
      keyMessages({ key: 'c', code: 'KeyC', ctrlKey: true, altKey: true })[0],
    ).toMatchObject({ modifiers: 3 });
    expect(keyMessages({ key: 'v', code: 'KeyV', metaKey: true })[0]).toMatchObject({
      modifiers: 4,
    });
  });
});
