import { beforeEach, describe, expect, test } from 'vitest';
import { attachAndroidTouchSelect, type TouchSelectTerm } from './android-select';
import { createInputLog } from '../core/terminal-input-log';

// jsdom has no PointerEvent with coordinates; synthesize like copy-on-select.test.ts does
// for pointer events. getBoundingClientRect().left/top are 0 in jsdom, so clientX/Y map
// straight to offsets. cellWidth 10, rowHeight 20 below make the cell math easy to read.
function pointer(
  type: string,
  { x = 0, y = 0, id = 1, primary = true, ptype = 'touch' } = {},
) {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    clientX: x,
    clientY: y,
    pointerId: id,
    isPrimary: primary,
    pointerType: ptype,
  });
}

describe('attachAndroidTouchSelect', () => {
  let container: HTMLDivElement;
  let spans: Array<[number, number, number]>; // select(col, row, length)
  let lines: Array<[number, number]>; // selectLines(start, end)
  let term: TouchSelectTerm;
  let active: boolean;
  let viewportY: number;
  let adapter: { destroy: () => void };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    spans = [];
    lines = [];
    viewportY = 0;
    active = true;
    term = {
      cols: 80,
      rows: 24,
      get buffer() {
        return { active: { viewportY } };
      },
      select: (col, row, length) => spans.push([col, row, length]),
      selectLines: (start, end) => lines.push([start, end]),
    };
    adapter = attachAndroidTouchSelect(container, term, {
      isActive: () => active,
      rowHeight: () => 20,
      cellWidth: () => 10,
    });
  });

  test('a tap (no drag) selects the whole line under the finger', () => {
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45 })); // row 2
    container.dispatchEvent(pointer('pointerup', { x: 25, y: 45 }));
    expect(lines).toEqual([[2, 2]]);
    expect(spans).toEqual([]);
  });

  test('tiny jitter within the threshold still counts as a line tap', () => {
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45 }));
    container.dispatchEvent(pointer('pointermove', { x: 28, y: 46 })); // < threshold
    container.dispatchEvent(pointer('pointerup', { x: 28, y: 46 }));
    expect(lines).toEqual([[2, 2]]);
    expect(spans).toEqual([]);
  });

  test('a drag selects the character span from the anchor to the current cell', () => {
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45 })); // col 2, row 2
    container.dispatchEvent(pointer('pointermove', { x: 65, y: 45 })); // col 6, row 2
    container.dispatchEvent(pointer('pointerup', { x: 65, y: 45 }));
    expect(spans.at(-1)).toEqual([2, 2, 5]); // cols 2..6 inclusive
    expect(lines).toEqual([]); // a drag is not a line tap
  });

  test('offsets rows by the buffer viewportY for scrolled-back content', () => {
    viewportY = 100;
    container.dispatchEvent(pointer('pointerdown', { x: 5, y: 5 })); // row 0 → 100
    container.dispatchEvent(pointer('pointerup', { x: 5, y: 5 }));
    expect(lines).toEqual([[100, 100]]);
  });

  test('a fresh press re-anchors instead of extending the previous span', () => {
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45 }));
    container.dispatchEvent(pointer('pointermove', { x: 65, y: 45 }));
    container.dispatchEvent(pointer('pointerup', { x: 65, y: 45 }));
    container.dispatchEvent(pointer('pointerdown', { x: 55, y: 85 })); // col 5, row 4
    container.dispatchEvent(pointer('pointermove', { x: 75, y: 85 })); // col 7, row 4
    expect(spans.at(-1)).toEqual([5, 4, 3]);
  });

  test('does nothing when select mode is inactive', () => {
    active = false;
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45 }));
    container.dispatchEvent(pointer('pointermove', { x: 65, y: 45 }));
    container.dispatchEvent(pointer('pointerup', { x: 65, y: 45 }));
    expect(spans).toEqual([]);
    expect(lines).toEqual([]);
  });

  test('ignores mouse pointers so desktop selection stays xterm’s', () => {
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45, ptype: 'mouse' }));
    container.dispatchEvent(pointer('pointerup', { x: 25, y: 45, ptype: 'mouse' }));
    expect(lines).toEqual([]);
    expect(spans).toEqual([]);
  });

  test('ignores non-primary pointers (second finger of a pinch)', () => {
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45, primary: false }));
    expect(lines).toEqual([]);
    expect(spans).toEqual([]);
  });

  test('preventDefaults an active press (keeps the keyboard down, blocks native scroll)', () => {
    const down = pointer('pointerdown', { x: 25, y: 45 });
    container.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  test('leaves pointers untouched when inactive', () => {
    active = false;
    const down = pointer('pointerdown', { x: 25, y: 45 });
    container.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });

  test('destroy detaches the listeners', () => {
    adapter.destroy();
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45 }));
    container.dispatchEvent(pointer('pointerup', { x: 25, y: 45 }));
    expect(lines).toEqual([]);
  });

  test('logs the gesture for on-device diagnostics', () => {
    const log = createInputLog(50);
    adapter.destroy(); // replace the default adapter with one that has a log
    adapter = attachAndroidTouchSelect(container, term, {
      isActive: () => active,
      rowHeight: () => 20,
      cellWidth: () => 10,
      log,
    });
    container.dispatchEvent(pointer('pointerdown', { x: 25, y: 45 }));
    container.dispatchEvent(pointer('pointermove', { x: 65, y: 45 }));
    container.dispatchEvent(pointer('pointerup', { x: 65, y: 45 }));
    const kinds = log.snapshot().map((r) => r.kind);
    expect(kinds).toContain('pointerdown');
    expect(kinds).toContain('pointerup');
  });
});
