import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackViewport, trackWide, trackDimensions } from './viewport';

describe('trackViewport', () => {
  let vvHandlers: Record<string, () => void>;
  let stop: (() => void) | undefined;

  const appHeight = () => document.documentElement.style.getPropertyValue('--app-height');

  beforeEach(() => {
    vvHandlers = {};
    // Run the rAF-coalesced writes synchronously so assertions are immediate.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 1));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 400, // keyboard-up height; stays stale after dismissal on iOS
        addEventListener: (e: string, h: () => void) => (vvHandlers[e] = h),
        removeEventListener: (e: string) => delete vvHandlers[e],
      },
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800, writable: true });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    stop?.();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--app-height');
  });

  it('uses visualViewport height while an input is focused (keyboard up)', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    stop = trackViewport();
    expect(appHeight()).toBe('400px');
  });

  it('uses innerHeight when nothing is focused', () => {
    stop = trackViewport();
    expect(appHeight()).toBe('800px');
  });

  it('restores full height on blur even when visualViewport stays shrunk', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    stop = trackViewport();
    expect(appHeight()).toBe('400px');

    ta.blur(); // dismiss keyboard; visualViewport.height is still 400
    vvHandlers.resize?.(); // even a stale visualViewport resize must not re-shrink
    expect(appHeight()).toBe('800px');
  });

  it('does not opt into VirtualKeyboard overlaysContent (would keep visualViewport full on Chrome)', () => {
    // On Android/Chrome navigator.virtualKeyboard exists. Setting overlaysContent = true
    // stops Chrome resizing the visual viewport, so visualViewport.height stays full and
    // --app-height never shrinks — the terminal + bar sit behind the keyboard. Keep the
    // default (resizes-visual) so the visualViewport-driven height logic works everywhere.
    const vk = { overlaysContent: false };
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: vk });
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    stop = trackViewport();
    expect(vk.overlaysContent).toBe(false);
    expect(appHeight()).toBe('400px');
    delete (navigator as { virtualKeyboard?: unknown }).virtualKeyboard;
  });
});

describe('trackDimensions', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 893, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 533, writable: true });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.5, writable: true });
  });

  afterEach(() => stop?.());

  it('reports the current dimensions immediately', () => {
    const seen: Array<{ width: number; height: number; dpr: number }> = [];
    stop = trackDimensions((d) => seen.push(d));
    expect(seen).toEqual([{ width: 893, height: 533, dpr: 1.5 }]);
  });

  it('fires onChange on resize (e.g. orientation change)', () => {
    const seen: Array<{ width: number; height: number }> = [];
    stop = trackDimensions((d) => seen.push({ width: d.width, height: d.height }));
    (window as unknown as { innerWidth: number }).innerWidth = 533;
    (window as unknown as { innerHeight: number }).innerHeight = 893;
    window.dispatchEvent(new Event('resize'));
    expect(seen).toEqual([
      { width: 893, height: 533 },
      { width: 533, height: 893 },
    ]);
  });

  it('falls back to dpr 1 when devicePixelRatio is absent', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0, writable: true });
    const seen: Array<{ dpr: number }> = [];
    stop = trackDimensions((d) => seen.push({ dpr: d.dpr }));
    expect(seen[0]?.dpr).toBe(1);
  });

  it('removes its resize listener on teardown', () => {
    let calls = 0;
    stop = trackDimensions(() => calls++);
    expect(calls).toBe(1); // immediate
    stop();
    window.dispatchEvent(new Event('resize')); // must be ignored after teardown
    expect(calls).toBe(1);
  });
});

describe('trackWide', () => {
  let handlers: Array<(e: { matches: boolean }) => void>;
  let mql: { matches: boolean; addEventListener: unknown; removeEventListener: unknown };
  let stop: (() => void) | undefined;

  beforeEach(() => {
    handlers = [];
    mql = {
      matches: false,
      addEventListener: (_e: string, h: (e: { matches: boolean }) => void) => handlers.push(h),
      removeEventListener: (_e: string, h: (e: { matches: boolean }) => void) => {
        handlers = handlers.filter((x) => x !== h);
      },
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mql));
  });

  afterEach(() => {
    stop?.();
    vi.unstubAllGlobals();
  });

  it('reports the current match immediately', () => {
    mql.matches = true;
    const seen: boolean[] = [];
    stop = trackWide((m) => seen.push(m));
    expect(seen).toEqual([true]);
  });

  it('queries the 980px two-pane threshold (tablet landscape in, phones out)', () => {
    stop = trackWide(() => {});
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 980px)');
  });

  it('fires onChange when the media query flips', () => {
    const seen: boolean[] = [];
    stop = trackWide((m) => seen.push(m));
    mql.matches = true;
    handlers.forEach((h) => h({ matches: true }));
    expect(seen).toEqual([false, true]);
  });

  it('falls back to false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const seen: boolean[] = [];
    stop = trackWide((m) => seen.push(m));
    expect(seen).toEqual([false]);
  });

  it('removes its listener on teardown', () => {
    stop = trackWide(() => {});
    expect(handlers.length).toBe(1);
    stop();
    expect(handlers.length).toBe(0);
  });
});
