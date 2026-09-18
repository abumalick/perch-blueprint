import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import KeyboardBar, { TAP_SLOP_PX } from './KeyboardBar.svelte';
import { KEY_REPEAT_DELAY_MS, KEY_REPEAT_INTERVAL_MS } from '../core/key-repeat';
import { NOTCH_PX } from '../core/cursor-pad';

const base = {
  send: vi.fn(),
  paste: vi.fn(),
  selectMode: false,
  onToggleSelect: vi.fn(),
  dictation: 'idle' as const,
  onDictate: vi.fn(),
};

// jsdom does not implement PointerEvent, so fireEvent's pointer helpers drop clientX/Y.
// A MouseEvent dispatched under the pointer event's type name carries the coordinates
// and still triggers the component's pointerdown/pointermove listeners.
function pointer(node: Element, type: string, clientX: number, clientY: number) {
  node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
}

describe('KeyboardBar', () => {
  it('sends the escape sequence for a normal key', async () => {
    const send = vi.fn();
    render(KeyboardBar, { props: { ...base, send } });
    await fireEvent.click(screen.getByRole('button', { name: '⏎' }));
    expect(send).toHaveBeenCalledWith('\r');
  });

  it('sends a literal space when the Space key is tapped', async () => {
    const send = vi.fn();
    render(KeyboardBar, { props: { ...base, send } });
    await fireEvent.click(screen.getByRole('button', { name: '␣' }));
    expect(send).toHaveBeenCalledWith(' ');
  });

  // Claude Code cycles its permission modes on Shift+Tab, which no soft keyboard and no
  // sticky modifier here can produce; back-tab is the only way to reach it from a phone.
  it('sends the back-tab sequence when the Shift+Tab key is tapped', async () => {
    const send = vi.fn();
    render(KeyboardBar, { props: { ...base, send } });
    await fireEvent.click(screen.getByRole('button', { name: '\u21e4' }));
    expect(send).toHaveBeenCalledWith('\x1b[Z');
  });

  it('invokes the paste callback when the Paste key is tapped', async () => {
    const paste = vi.fn();
    render(KeyboardBar, { props: { ...base, paste } });
    await fireEvent.click(screen.getByRole('button', { name: /paste/i }));
    expect(paste).toHaveBeenCalled();
  });

  it('toggles selection: reflects selectMode and calls onToggleSelect', async () => {
    const onToggleSelect = vi.fn();
    render(KeyboardBar, { props: { ...base, selectMode: true, onToggleSelect } });
    const toggle = screen.getByRole('button', { name: /select text/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(toggle);
    expect(onToggleSelect).toHaveBeenCalled();
  });

  it('shows a Copy button when showCopy is set and fires onCopy', async () => {
    const onCopy = vi.fn();
    render(KeyboardBar, { props: { ...base, showCopy: true, onCopy } });
    await fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(onCopy).toHaveBeenCalled();
  });

  it('omits the Copy button by default (non-Android / not in select mode)', () => {
    render(KeyboardBar, { props: { ...base } });
    expect(screen.queryByRole('button', { name: /^copy$/i })).toBeNull();
  });

  it('keeps the Copy button before the pinned Commands trigger', () => {
    render(KeyboardBar, {
      props: { ...base, showCopy: true, commands: [{ command: '/rename', submit: true }] },
    });
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(labels.at(-1)).toBe('Commands');
    expect(labels.indexOf('Copy')).toBeLessThan(labels.indexOf('Commands'));
  });

  it('shows an Attach file button when onPickFile is wired and passes the chosen file', async () => {
    const onPickFile = vi.fn();
    render(KeyboardBar, { props: { ...base, onPickFile } });
    const button = screen.getByRole('button', { name: /attach file/i });
    expect(button).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2])], 'shot.png', { type: 'image/png' });
    await fireEvent.change(input, { target: { files: [file] } });
    expect(onPickFile).toHaveBeenCalledWith(file);
  });

  // An `accept` of any kind hides non-matching files in the OS picker, which is what made
  // a zip unattachable from the iPhone's Files app. The input must stay unfiltered.
  it('puts no type restriction on the file input', () => {
    render(KeyboardBar, { props: { ...base, onPickFile: vi.fn() } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.hasAttribute('accept')).toBe(false);
    expect(input.hasAttribute('capture')).toBe(false);
  });

  it('passes through a non-image file', async () => {
    const onPickFile = vi.fn();
    render(KeyboardBar, { props: { ...base, onPickFile } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], 'bundle.zip', { type: 'application/zip' });
    await fireEvent.change(input, { target: { files: [file] } });
    expect(onPickFile).toHaveBeenCalledWith(file);
  });

  it('omits the Attach file button when onPickFile is not wired', () => {
    render(KeyboardBar, { props: { ...base } });
    expect(screen.queryByRole('button', { name: /attach file/i })).toBeNull();
  });

  it('places Attach file right after Paste and before the Commands trigger', () => {
    render(KeyboardBar, {
      props: { ...base, onPickFile: vi.fn(), commands: [{ command: '/rename', submit: true }] },
    });
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(labels.indexOf('Attach file')).toBe(labels.indexOf('Paste') + 1);
    expect(labels.indexOf('Attach file')).toBeLessThan(labels.indexOf('Commands'));
  });

  it('has a Command modifier button', () => {
    render(KeyboardBar, { props: { ...base } });
    expect(screen.getByRole('button', { name: /command/i })).toBeInTheDocument();
  });

  it('Option + Backspace deletes the previous word (ESC DEL)', async () => {
    const send = vi.fn();
    render(KeyboardBar, { props: { ...base, send, alt: 'armed' } });
    await fireEvent.click(screen.getByRole('button', { name: '⌫' }));
    expect(send).toHaveBeenCalledWith('\x1b\x7f');
  });

  it('Option + forward-delete deletes the next word (ESC d)', async () => {
    const send = vi.fn();
    render(KeyboardBar, { props: { ...base, send, alt: 'armed' } });
    await fireEvent.click(screen.getByRole('button', { name: '⌦' }));
    expect(send).toHaveBeenCalledWith('\x1bd');
  });

  it('Command + forward-delete deletes to end of line (Ctrl-K)', async () => {
    const send = vi.fn();
    render(KeyboardBar, { props: { ...base, send, meta: 'armed' } });
    await fireEvent.click(screen.getByRole('button', { name: '⌦' }));
    expect(send).toHaveBeenCalledWith('\x0b');
  });

  it('plain forward-delete with no modifier sends the delete-char sequence', async () => {
    const send = vi.fn();
    render(KeyboardBar, { props: { ...base, send } });
    await fireEvent.click(screen.getByRole('button', { name: '⌦' }));
    expect(send).toHaveBeenCalledWith('\x1b[3~');
  });

  it('consumes a one-shot modifier: the second forward-delete sends the plain sequence', async () => {
    const send = vi.fn();
    render(KeyboardBar, { props: { ...base, send, meta: 'armed' } });
    const del = screen.getByRole('button', { name: '⌦' });
    await fireEvent.click(del);
    await fireEvent.click(del);
    expect(send).toHaveBeenNthCalledWith(1, '\x0b');
    expect(send).toHaveBeenNthCalledWith(2, '\x1b[3~');
  });

  it('invokes onDictate when the mic button is tapped', async () => {
    const onDictate = vi.fn();
    render(KeyboardBar, { props: { ...base, onDictate } });
    await fireEvent.click(screen.getByRole('button', { name: /dictate/i }));
    expect(onDictate).toHaveBeenCalled();
  });

  it('marks the mic button pressed while recording', () => {
    render(KeyboardBar, { props: { ...base, dictation: 'recording' } });
    expect(screen.getByRole('button', { name: /dictate/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables the mic button while transcribing', () => {
    render(KeyboardBar, { props: { ...base, dictation: 'transcribing' } });
    expect(screen.getByRole('button', { name: /dictate/i })).toBeDisabled();
  });

  // The bar is a horizontal scroller: on a phone only the first ~8 buttons are visible
  // without scrolling, so order *is* the feature. Rarely-used keys (Tab, select, paste)
  // are deliberately last, past the fold.
  it('orders the buttons so the rarely-used keys sit past the visible fold', () => {
    render(KeyboardBar, { props: { ...base } });
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(labels).toEqual([
      'Control',
      'Option',
      'Command',
      '␣',
      'Dictate',
      'Cursor pad',
      '⏎',
      '⎋',
      '⌦',
      '⌫',
      '⇥',
      '⇤',
      'Select text',
      'Paste',
    ]);
  });

  // Placement is a deliberate exception to the fold rationale above: the commands
  // trigger goes last. Pinned here so it stays deliberate rather than drifting.
  it('puts the commands trigger last in the bar', () => {
    render(KeyboardBar, { props: { ...base, commands: [{ command: '/rename', submit: true }] } });
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(labels.at(-1)).toBe('Commands');
  });

  // No config file on that machine → nothing to offer, so the bar is unchanged.
  it('omits the commands trigger when the machine has no shortcuts', () => {
    render(KeyboardBar, { props: { ...base, commands: [] } });
    expect(screen.queryByRole('button', { name: /commands/i })).toBeNull();
  });

  it('sends the command text when a shortcut is picked', async () => {
    const send = vi.fn();
    render(KeyboardBar, {
      props: { ...base, send, commands: [{ command: '/rename', submit: true }] },
    });
    await fireEvent.click(screen.getByRole('button', { name: /commands/i }));
    await fireEvent.click(screen.getByRole('option', { name: '/rename' }));
    expect(send).toHaveBeenCalledWith('/rename\r');
  });

  it('leaves an argument-taking command in the prompt with a trailing space', async () => {
    const send = vi.fn();
    render(KeyboardBar, {
      props: { ...base, send, commands: [{ command: '/myplugin:task', submit: false }] },
    });
    await fireEvent.click(screen.getByRole('button', { name: /commands/i }));
    await fireEvent.click(screen.getByRole('option', { name: '/myplugin:task' }));
    expect(send).toHaveBeenCalledWith('/myplugin:task ');
  });

  it('does not render the special-character keys after Enter', () => {
    render(KeyboardBar, { props: { ...base } });
    for (const label of ['`', '~', '@', '#', '$', '^', ';', ':', '-', '_', '|']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  describe('key-repeat on long press', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sends a key once on release, not on press', async () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      const back = screen.getByRole('button', { name: '⌫' });
      await fireEvent.pointerDown(back);
      expect(send).not.toHaveBeenCalled();
      await fireEvent.pointerUp(back);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('\x7f');
    });

    it('stops repeating once the key is released', async () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      const back = screen.getByRole('button', { name: '⌫' });
      await fireEvent.pointerDown(back);
      vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS);
      await fireEvent.pointerUp(back);
      const after = send.mock.calls.length;
      vi.advanceTimersByTime(KEY_REPEAT_INTERVAL_MS * 5);
      expect(send).toHaveBeenCalledTimes(after);
    });

    // ⌦/⌫ sit beside back-tab in the same `keys` array and both repeat, so the odds of
    // someone "consistency-fixing" this one are high. A repeating Shift+Tab would spin
    // through Claude Code's whole permission-mode cycle on a single hold.
    it('does not repeat back-tab while held', async () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      await fireEvent.pointerDown(screen.getByRole('button', { name: '\u21e4' }));
      vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS * 5);
      expect(send).not.toHaveBeenCalled();
    });

    it('does not double-send: the click synthesized after a real press is suppressed', async () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      const back = screen.getByRole('button', { name: '⌫' });
      await fireEvent.pointerDown(back);
      await fireEvent.pointerUp(back);
      await fireEvent.click(back);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('repeats backspace while held', async () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      await fireEvent.pointerDown(screen.getByRole('button', { name: '⌫' }));
      vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith('\x7f');
    });

    it('repeats forward-delete while held', async () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      await fireEvent.pointerDown(screen.getByRole('button', { name: '⌦' }));
      vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith('\x1b[3~');
    });

    // A hold that already auto-repeated must not send one more on release.
    it('does not add a release hit to a key that already repeated', async () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      const back = screen.getByRole('button', { name: '⌫' });
      await fireEvent.pointerDown(back);
      vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS);
      expect(send).toHaveBeenCalledTimes(1);
      await fireEvent.pointerUp(back);
      expect(send).toHaveBeenCalledTimes(1);
    });

    // Space deliberately does NOT repeat, unlike backspace/forward-delete: Claude Code
    // CLI binds a held Space to push-to-talk voice dictation, detected by watching for
    // rapid key-repeat events. An auto-repeating Space would trigger that feature (and
    // its ALSA mic-open attempt) every time the button is held.
    for (const [label, seq] of [
      ['␣', ' '],
      ['⏎', '\r'],
      ['⎋', '\x1b'],
    ]) {
      it(`fires ${label} once on release and never repeats it`, async () => {
        const send = vi.fn();
        render(KeyboardBar, { props: { ...base, send } });
        const key = screen.getByRole('button', { name: label });
        await fireEvent.pointerDown(key);
        vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS * 10);
        expect(send).not.toHaveBeenCalled();
        await fireEvent.pointerUp(key);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(seq);
        vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS * 10);
        expect(send).toHaveBeenCalledTimes(1);
      });
    }
  });

  // The bar is a horizontal scroller, so a drag that starts on a key is usually the user
  // scrolling the bar, not typing. Firing on pointerdown sent the key before the gesture
  // could reveal itself as a scroll; the key now commits on release and any drag cancels it.
  describe('a drag cancels the tap', () => {
    const key = () => screen.getByRole('button', { name: '␣' });

    it('sends nothing when the pointer travels past the slop before release', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      pointer(key(), 'pointerdown', 100, 100);
      pointer(key(), 'pointermove', 100 + TAP_SLOP_PX + 5, 100);
      pointer(key(), 'pointerup', 100 + TAP_SLOP_PX + 5, 100);
      expect(send).not.toHaveBeenCalled();
    });

    // The real device path: once WebKit's scroller claims the gesture it fires pointercancel,
    // often with no pointermove at all — so cancellation cannot rest on the slop check alone.
    it('sends nothing on pointercancel, even with no movement at all', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      pointer(key(), 'pointerdown', 100, 100);
      pointer(key(), 'pointercancel', 100, 100);
      expect(send).not.toHaveBeenCalled();
    });

    it('still fires when the finger wobbles within the slop', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      pointer(key(), 'pointerdown', 100, 100);
      pointer(key(), 'pointermove', 100 + TAP_SLOP_PX - 2, 100);
      pointer(key(), 'pointerup', 100 + TAP_SLOP_PX - 2, 100);
      expect(send).toHaveBeenCalledTimes(1);
    });

    // A mouse drag that stays inside the button still synthesizes a click on release; without
    // suppressing it the cancelled press would send the key anyway.
    it('swallows the click synthesized after a cancelled press', async () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      pointer(key(), 'pointerdown', 100, 100);
      pointer(key(), 'pointermove', 100 + TAP_SLOP_PX + 5, 100);
      pointer(key(), 'pointerup', 100 + TAP_SLOP_PX + 5, 100);
      await fireEvent.click(key());
      expect(send).not.toHaveBeenCalled();
    });

    it('cancels a pending auto-repeat', () => {
      vi.useFakeTimers();
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      const back = screen.getByRole('button', { name: '⌫' });
      pointer(back, 'pointerdown', 100, 100);
      pointer(back, 'pointermove', 100 + TAP_SLOP_PX + 5, 100);
      vi.advanceTimersByTime(KEY_REPEAT_DELAY_MS + KEY_REPEAT_INTERVAL_MS * 5);
      pointer(back, 'pointerup', 100 + TAP_SLOP_PX + 5, 100);
      expect(send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('cursor pad', () => {
    const N = NOTCH_PX;

    function pad() {
      return screen.getByRole('button', { name: 'Cursor pad' });
    }

    it('emits nothing on a tap with no movement', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      pointer(pad(), 'pointerdown', 100, 100);
      pointer(pad(), 'pointerup', 100, 100);
      expect(send).not.toHaveBeenCalled();
    });

    it('sends one left arrow per notch dragged left', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      pointer(pad(), 'pointerdown', 100, 100);
      pointer(pad(), 'pointermove', 100 - 2 * N, 100);
      expect(send.mock.calls).toEqual([['\x1b[D'], ['\x1b[D']]);
    });

    it('sends up arrows for a vertical drag', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      pointer(pad(), 'pointerdown', 100, 100);
      pointer(pad(), 'pointermove', 100, 100 - N);
      expect(send).toHaveBeenCalledWith('\x1b[A');
    });

    it('ignores movement after the pointer is released', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send } });
      pointer(pad(), 'pointerdown', 100, 100);
      pointer(pad(), 'pointerup', 100, 100);
      pointer(pad(), 'pointermove', 100 - 3 * N, 100);
      expect(send).not.toHaveBeenCalled();
    });

    it('consumes an armed Option on the first notch only', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send, alt: 'armed' } });
      pointer(pad(), 'pointerdown', 100, 100);
      pointer(pad(), 'pointermove', 100 - 3 * N, 100);
      // notch 1 = word-back chord, notches 2-3 = plain left
      expect(send.mock.calls).toEqual([['\x1bb'], ['\x1b[D'], ['\x1b[D']]);
    });

    it('keeps a locked Option applied to every notch', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send, alt: 'locked' } });
      pointer(pad(), 'pointerdown', 100, 100);
      pointer(pad(), 'pointermove', 100 - 2 * N, 100);
      expect(send.mock.calls).toEqual([['\x1bb'], ['\x1bb']]);
    });

    it('does not apply modifiers to vertical movement', () => {
      const send = vi.fn();
      render(KeyboardBar, { props: { ...base, send, alt: 'locked' } });
      pointer(pad(), 'pointerdown', 100, 100);
      pointer(pad(), 'pointermove', 100, 100 + N);
      expect(send.mock.calls).toEqual([['\x1b[B']]);
    });
  });
});
