// Pure event → BrowserClientMessage builders for the browser view. The canvas draws the
// remote frame aspect-preserving and centered (letterboxed), so pointer positions must be
// mapped from canvas CSS pixels to remote device pixels before being sent upstream.

import type { BrowserClientMessage } from '@perch/contracts';

export interface FrameScale {
  // Device px → CSS px multiplier of the drawn frame (CSS→device divides by it).
  scale: number;
  // CSS offset of the drawn frame's top-left inside the canvas (letterbox bars).
  offsetX: number;
  offsetY: number;
  deviceWidth: number;
  deviceHeight: number;
}

export function frameScale(
  canvasCssW: number,
  canvasCssH: number,
  deviceW: number,
  deviceH: number,
): FrameScale {
  if (deviceW <= 0 || deviceH <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0, deviceWidth: deviceW, deviceHeight: deviceH };
  }
  const scale = Math.min(canvasCssW / deviceW, canvasCssH / deviceH);
  return {
    scale,
    offsetX: (canvasCssW - deviceW * scale) / 2,
    offsetY: (canvasCssH - deviceH * scale) / 2,
    deviceWidth: deviceW,
    deviceHeight: deviceH,
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// A point in the letterbox bars clamps to the frame edge instead of going out of bounds.
export function toDevicePoint(
  cssX: number,
  cssY: number,
  fs: FrameScale,
): { x: number; y: number } {
  return {
    x: clamp((cssX - fs.offsetX) / fs.scale, 0, fs.deviceWidth),
    y: clamp((cssY - fs.offsetY) / fs.scale, 0, fs.deviceHeight),
  };
}

export function tapMessages(cssX: number, cssY: number, fs: FrameScale): BrowserClientMessage[] {
  const { x, y } = toDevicePoint(cssX, cssY, fs);
  return [
    // The leading move settles hover/hit-testing at the tap point (the remote cursor is
    // wherever the last drag left it); without it some pages miss the click entirely.
    { type: 'input_mouse', eventType: 'mouseMoved', x, y },
    { type: 'input_mouse', eventType: 'mousePressed', x, y, button: 'left', clickCount: 1 },
    { type: 'input_mouse', eventType: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
  ];
}

// Drag-to-scroll: the finger moving down should reveal content above (touch-natural),
// which is the opposite sign of a wheel delta — hence the inversion.
export function dragScrollMessage(
  cssDx: number,
  cssDy: number,
  cssX: number,
  cssY: number,
  fs: FrameScale,
): BrowserClientMessage {
  const { x, y } = toDevicePoint(cssX, cssY, fs);
  return {
    type: 'input_mouse',
    eventType: 'mouseWheel',
    x,
    y,
    deltaX: -cssDx / fs.scale,
    deltaY: -cssDy / fs.scale,
  };
}

export function wheelMessage(
  ev: { x: number; y: number; deltaX: number; deltaY: number },
  fs: FrameScale,
): BrowserClientMessage {
  const { x, y } = toDevicePoint(ev.x, ev.y, fs);
  return {
    type: 'input_mouse',
    eventType: 'mouseWheel',
    x,
    y,
    deltaX: ev.deltaX / fs.scale,
    deltaY: ev.deltaY / fs.scale,
  };
}

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

// CDP Input.dispatchKeyEvent modifier bits.
function cdpModifiers(ev: KeyEventLike): number {
  return (ev.altKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0) | (ev.metaKey ? 4 : 0) | (ev.shiftKey ? 8 : 0);
}

export function keyMessages(ev: KeyEventLike): BrowserClientMessage[] {
  const modifiers = cdpModifiers(ev);
  // A single-character `key` is the printable character itself; control keys
  // (Enter, Backspace, …) have multi-character names and carry no text.
  const printable = ev.key.length === 1;
  return [
    {
      type: 'input_keyboard',
      eventType: 'keyDown',
      key: ev.key,
      code: ev.code,
      ...(printable ? { text: ev.key } : {}),
      modifiers,
    },
    { type: 'input_keyboard', eventType: 'keyUp', key: ev.key, code: ev.code, modifiers },
  ];
}
