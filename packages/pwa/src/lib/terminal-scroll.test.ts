import { describe, it, expect, beforeEach } from 'vitest';
import { attachTerminalScroll } from './terminal-scroll';

function setup() {
  const container = document.createElement('div');
  const viewport = document.createElement('div');
  viewport.className = 'xterm-viewport';
  container.appendChild(viewport);
  document.body.appendChild(container);

  const wheels: { deltaY: number; deltaMode: number }[] = [];
  viewport.addEventListener('wheel', (e) => {
    const w = e as WheelEvent;
    wheels.push({ deltaY: w.deltaY, deltaMode: w.deltaMode });
  });
  const deltas = () => wheels.map((w) => w.deltaY);
  return { container, wheels, deltas };
}

function touch(container: HTMLElement, type: string, clientY: number | null) {
  const touches = clientY === null ? [] : [{ clientY } as Touch];
  container.dispatchEvent(
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches }),
  );
}

describe('attachTerminalScroll', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('amplifies a one-finger drag into proportional line-mode wheel events', () => {
    const { container, wheels, deltas } = setup();
    // AMPLIFY (2) × 30px drag ÷ 10px rows = 6 lines up; one line-mode wheel per line so a
    // mouse-mode app scrolls exactly 6 lines (no row-height estimate, no fractional sticking).
    attachTerminalScroll(container, () => true, () => 10);

    touch(container, 'touchstart', 100);
    touch(container, 'touchmove', 130); // finger moved down 30px → scroll up

    expect(deltas()).toEqual([-1, -1, -1, -1, -1, -1]);
    // deltaMode 1 (DOM_DELTA_LINE) is the crux of the fix.
    expect(wheels.every((w) => w.deltaMode === 1)).toBe(true);
  });

  it('drag up scrolls down, carrying the sub-row remainder across moves', () => {
    const { container, deltas } = setup();
    attachTerminalScroll(container, () => true, () => 10);

    touch(container, 'touchstart', 100);
    touch(container, 'touchmove', 92); // up 8px → ×2 = 16 → 1 line, remainder 6
    expect(deltas()).toEqual([1]);

    touch(container, 'touchmove', 84); // up 8px → ×2 = 16, +6 = 22 → 2 lines, remainder 2
    expect(deltas()).toEqual([1, 1, 1]);
  });

  it('scrollLines emits one line-mode wheel per line so mouse-mode apps scroll N lines', () => {
    const { container, wheels, deltas } = setup();
    const scroll = attachTerminalScroll(container);

    // Mouse-tracking apps (e.g. Claude Code) map each line-mode wheel to exactly one line,
    // so a button must fire one event per line to scroll more than one line.
    scroll.scrollLines(5);
    expect(deltas()).toEqual([1, 1, 1, 1, 1]);
    expect(wheels.every((w) => w.deltaMode === 1)).toBe(true);

    wheels.length = 0;
    scroll.scrollLines(-3); // negative → scroll up
    expect(deltas()).toEqual([-1, -1, -1]);
  });

  it('scrollLines is a no-op for zero lines', () => {
    const { container, deltas } = setup();
    const scroll = attachTerminalScroll(container);

    scroll.scrollLines(0);
    expect(deltas()).toEqual([]);
  });

  it('skips touch interception while disabled but keeps scrollLines working', () => {
    const { container, deltas } = setup();
    let enabled = false;
    const scroll = attachTerminalScroll(container, () => enabled);

    // Touch interception is off → native selection/scroll is left to the browser.
    touch(container, 'touchstart', 100);
    touch(container, 'touchmove', 130);
    expect(deltas()).toEqual([]);

    // The floating scroll buttons still drive the viewport.
    scroll.scrollLines(2);
    expect(deltas()).toEqual([1, 1]);

    // Re-enabling restores drag-to-scroll (default 16px rows: 2 × 30px ÷ 16 = 3 lines up).
    enabled = true;
    touch(container, 'touchstart', 100);
    touch(container, 'touchmove', 130);
    expect(deltas()).toEqual([1, 1, -1, -1, -1]);
  });

  it('ignores multi-touch and stops dispatching after destroy', () => {
    const { container, deltas } = setup();
    const scroll = attachTerminalScroll(container);

    touch(container, 'touchstart', null); // two-finger / unsupported → no anchor
    touch(container, 'touchmove', 50);
    expect(deltas()).toEqual([]);

    scroll.destroy();
    touch(container, 'touchstart', 100);
    touch(container, 'touchmove', 120);
    expect(deltas()).toEqual([]);
  });
});
