import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { BrowserClientMessage, BrowserEndedReason } from '@perch/contracts';
import BrowserView from './BrowserView.svelte';

type Handlers = {
  onFrame: (data: string, meta: { deviceWidth: number; deviceHeight: number }) => void;
  onUrl: (url: string) => void;
  onState: (state: 'connecting' | 'online' | 'ended') => void;
  endedReason?: (reason: BrowserEndedReason) => void;
};

const ctx2d = { clearRect: vi.fn(), drawImage: vi.fn() };
const bitmap = { width: 8, height: 8, close: vi.fn() };
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalGetRect = HTMLCanvasElement.prototype.getBoundingClientRect;

beforeEach(() => {
  ctx2d.clearRect.mockClear();
  ctx2d.drawImage.mockClear();
  // jsdom has no canvas 2d context or layout; give the component a 100×100 CSS box and
  // a recording context so letterboxed draws are observable.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx2d) as never;
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(
    () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) }) as DOMRect,
  );
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.getBoundingClientRect = originalGetRect;
  vi.unstubAllGlobals();
});

function setup(session = 'perch-a') {
  const sent: BrowserClientMessage[] = [];
  const stream = {
    open: vi.fn(),
    close: vi.fn(),
    send: vi.fn((m: BrowserClientMessage) => sent.push(m)),
  };
  let handlers: Handlers | null = null;
  const store = {
    browserTarget: { connectionId: 'mac', session },
    closeBrowserView: vi.fn(),
    browserSessionClosed: vi.fn(),
    openBrowserStream: vi.fn((cbs: Handlers) => {
      handlers = cbs;
      return stream;
    }),
  };
  const utils = render(BrowserView, { props: { store: store as never } });
  return { ...utils, store, stream, sent, handlers: () => handlers! };
}

function pointerEvent(type: string, x: number, y: number): Event {
  return Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }), {
    pointerId: 1,
  });
}

async function goOnline(h: ReturnType<typeof setup>, deviceW = 8, deviceH = 8) {
  h.handlers().onState('online');
  h.handlers().onFrame(btoa('jpeg-bytes'), { deviceWidth: deviceW, deviceHeight: deviceH });
  await vi.waitFor(() => expect(ctx2d.drawImage).toHaveBeenCalled());
}

describe('BrowserView', () => {
  it('opens the stream on mount and closes it on unmount', () => {
    const h = setup();
    expect(h.store.openBrowserStream).toHaveBeenCalled();
    expect(h.stream.open).toHaveBeenCalledTimes(1);
    h.unmount();
    expect(h.stream.close).toHaveBeenCalled();
  });

  it('shows a connecting state before the stream is online', () => {
    setup();
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('draws a received frame letterboxed on the canvas', async () => {
    const h = setup();
    await goOnline(h);
    const canvas = h.container.querySelector('canvas') as HTMLCanvasElement;
    // Backing store matches the CSS box; 8×8 frame in a 100×100 box scales 12.5× with no bars.
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(100);
    expect(ctx2d.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 100, 100);
  });

  it('shows the streamed url and submits an edited one as navigate', async () => {
    const h = setup();
    h.handlers().onState('online');
    h.handlers().onUrl('https://old.example');
    await tick();
    const input = screen.getByRole('textbox', { name: /url/i }) as HTMLInputElement;
    expect(input.value).toBe('https://old.example');
    await fireEvent.input(input, { target: { value: 'https://example.com' } });
    await fireEvent.submit(input.closest('form')!);
    expect(h.sent).toContainEqual({ type: 'navigate', url: 'https://example.com' });
  });

  it('prefixes https:// when the submitted url has no scheme', async () => {
    const h = setup();
    h.handlers().onState('online');
    await tick();
    const input = screen.getByRole('textbox', { name: /url/i });
    await fireEvent.input(input, { target: { value: 'example.com' } });
    await fireEvent.submit(input.closest('form')!);
    expect(h.sent).toContainEqual({ type: 'navigate', url: 'https://example.com' });
  });

  it('sends a mousePressed/mouseReleased pair for a tap, scaled to device pixels', async () => {
    const h = setup();
    await goOnline(h);
    const canvas = h.container.querySelector('canvas')!;
    await fireEvent(canvas, pointerEvent('pointerdown', 50, 50));
    await fireEvent(canvas, pointerEvent('pointerup', 50, 50));
    expect(h.sent).toContainEqual({ type: 'input_mouse', eventType: 'mousePressed', x: 4, y: 4, button: 'left', clickCount: 1 });
    expect(h.sent).toContainEqual({ type: 'input_mouse', eventType: 'mouseReleased', x: 4, y: 4, button: 'left', clickCount: 1 });
  });

  it('clicks at the pointer-DOWN position when the finger rolls within the threshold', async () => {
    const h = setup();
    await goOnline(h);
    const canvas = h.container.querySelector('canvas')!;
    await fireEvent(canvas, pointerEvent('pointerdown', 50, 50));
    await fireEvent(canvas, pointerEvent('pointermove', 54, 53));
    await fireEvent(canvas, pointerEvent('pointerup', 54, 53));
    // The press position is the user's intent; a release shifted by finger roll is not.
    expect(h.sent).toContainEqual(
      expect.objectContaining({ type: 'input_mouse', eventType: 'mousePressed', x: 4, y: 4 }),
    );
  });

  it('sends no click when the pointer is cancelled (iOS gesture interception)', async () => {
    const h = setup();
    await goOnline(h);
    const canvas = h.container.querySelector('canvas')!;
    await fireEvent(canvas, pointerEvent('pointerdown', 50, 50));
    await fireEvent(canvas, pointerEvent('pointercancel', 50, 50));
    expect(h.sent.some((m) => m.type === 'input_mouse' && m.eventType === 'mousePressed')).toBe(false);
  });

  it('sends wheel scrolls for a drag past the tap threshold, and no click', async () => {
    const h = setup();
    await goOnline(h);
    const canvas = h.container.querySelector('canvas')!;
    await fireEvent(canvas, pointerEvent('pointerdown', 50, 50));
    await fireEvent(canvas, pointerEvent('pointermove', 50, 80));
    await fireEvent(canvas, pointerEvent('pointerup', 50, 80));
    // 30 CSS px at 12.5× scale, inverted to touch-natural wheel direction.
    expect(h.sent).toContainEqual(
      expect.objectContaining({ type: 'input_mouse', eventType: 'mouseWheel', x: 4, y: 6.4, deltaY: -2.4 }),
    );
    expect(h.sent.some((m) => m.type === 'input_mouse' && m.eventType === 'mousePressed')).toBe(false);
  });

  it('sends key events for a keyboard-bar tap', async () => {
    const h = setup();
    await goOnline(h);
    await fireEvent.click(screen.getByText('⏎'));
    expect(h.sent).toContainEqual({ type: 'input_keyboard', eventType: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 0 });
    expect(h.sent).toContainEqual({ type: 'input_keyboard', eventType: 'keyUp', key: 'Enter', code: 'Enter', modifiers: 0 });
  });

  // The bar's back-tab key exists for the terminal's sake; in a browser the natural
  // equivalent is Shift+Tab, which moves field focus backwards.
  it('sends a shifted Tab for a keyboard-bar back-tab tap', async () => {
    const h = setup();
    await goOnline(h);
    await fireEvent.click(screen.getByText('\u21e4'));
    expect(h.sent).toContainEqual({ type: 'input_keyboard', eventType: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8 });
    expect(h.sent).toContainEqual({ type: 'input_keyboard', eventType: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8 });
  });

  it('shows the ended state with a retry that reopens the stream', async () => {
    const h = setup();
    h.handlers().endedReason?.('closed');
    h.handlers().onState('ended');
    await tick();
    expect(screen.getByText(/session ended/i)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.stream.open).toHaveBeenCalledTimes(2);
  });

  it('labels a not-found end distinctly', async () => {
    const h = setup();
    h.handlers().endedReason?.('not-found');
    h.handlers().onState('ended');
    await tick();
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('closes the view from the back button', async () => {
    const h = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(h.store.closeBrowserView).toHaveBeenCalled();
  });

  it('sends back/forward for the history nav buttons', async () => {
    const h = setup();
    await goOnline(h);
    await fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }));
    expect(h.sent).toContainEqual({ type: 'back' });
    expect(h.sent).toContainEqual({ type: 'forward' });
  });

  it('Close session sends closeSession and leaves the view via the store', async () => {
    const h = setup();
    await goOnline(h);
    await fireEvent.click(screen.getByRole('button', { name: 'Close session' }));
    expect(h.sent).toContainEqual({ type: 'closeSession' });
    expect(h.store.browserSessionClosed).toHaveBeenCalled();
  });

  it('sends setViewport with the canvas CSS size when the stream comes online', async () => {
    const h = setup();
    h.handlers().onState('online');
    // The stubbed canvas rect is 100×100 CSS pixels.
    expect(h.sent).toContainEqual({ type: 'setViewport', width: 100, height: 100 });
  });

  it('labels an opened-elsewhere end as opened on another device, with a Retry', async () => {
    const h = setup();
    h.handlers().endedReason?.('opened-elsewhere');
    h.handlers().onState('ended');
    await tick();
    expect(screen.getByText('Opened on another device.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.stream.open).toHaveBeenCalledTimes(2);
  });
});
