import { beforeEach, describe, expect, test } from 'vitest';
import { attachAndroidInput, isAndroid } from './android-input';
import { createInputLog } from '../core/terminal-input-log';

describe('isAndroid', () => {
  test('detects Android user agents', () => {
    expect(isAndroid('Mozilla/5.0 (Linux; Android 14; SM-S911B) Chrome/120')).toBe(true);
  });
  test('rejects iOS user agents', () => {
    expect(isAndroid('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')).toBe(false);
  });
});

describe('attachAndroidInput', () => {
  let root: HTMLDivElement;
  let textarea: HTMLTextAreaElement;
  let sent: string[];
  let xtermSaw: string[]; // events a pre-registered xterm-like listener received
  let adapter: ReturnType<typeof attachAndroidInput>;

  beforeEach(() => {
    // Mirror the real DOM: xterm's textarea nested in a container, and xterm's own
    // listeners registered on the textarea BEFORE our adapter attaches.
    root = document.createElement('div');
    textarea = document.createElement('textarea');
    root.appendChild(textarea);
    document.body.appendChild(root);
    xtermSaw = [];
    for (const type of ['compositionupdate', 'compositionend', 'input', 'keydown', 'keypress', 'beforeinput']) {
      textarea.addEventListener(type, (e) => xtermSaw.push(e.type));
    }
    sent = [];
    adapter = attachAndroidInput(root, textarea, { send: (d) => sent.push(d) });
  });

  function compose(type: string, data: string) {
    textarea.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
  }

  test('forwards each composition update as a diffed delta and nothing extra on end', () => {
    compose('compositionstart', '');
    compose('compositionupdate', 'g');
    compose('compositionupdate', 'gi');
    compose('compositionupdate', 'git');
    compose('compositionend', 'git');
    expect(sent.join('')).toBe('git');
  });

  test('shields xterm from the events so the pty is not double-fed', () => {
    // Regression: xterm registers its textarea listeners before us, so at the target node
    // they run first and stopImmediatePropagation cannot stop them. We must intercept on an
    // ancestor in the capture phase. Some keyboards emit a letter as an open composition (no end).
    compose('compositionstart', '');
    compose('compositionupdate', 'a');
    expect(sent.join('')).toBe('a'); // exactly one 'a', not 'aa'
    expect(xtermSaw).not.toContain('compositionupdate');
    expect(xtermSaw).not.toContain('compositionstart');
  });

  test('reconciles an autocorrect swap at commit with backspaces', () => {
    compose('compositionstart', '');
    compose('compositionupdate', 'git');
    compose('compositionend', 'gut');
    expect(sent.join('')).toBe(`git\x7f\x7fut`);
  });

  test('forwards a non-composed insertText and prevents the textarea write', () => {
    const ev = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: '/',
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(ev);
    expect(sent).toEqual(['/']);
    expect(ev.defaultPrevented).toBe(true);
  });

  test('ignores composition-origin beforeinput (handled by composition events)', () => {
    textarea.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: 'g', bubbles: true }),
    );
    expect(sent).toEqual([]);
  });

  test('stops keydown from reaching xterm listeners on the textarea', () => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', keyCode: 229, bubbles: true }));
    expect(xtermSaw).not.toContain('keydown');
    expect(sent).toEqual([]);
  });

  // One soft-keyboard Enter fires keydown(13) → keypress(13) → beforeinput(insertLineBreak).
  // xterm answers a keypress with its own key whenever it did not handle the keydown, and it
  // never does here because the keydown is swallowed above — so the line was submitted twice.
  test('sends exactly one carriage return for a soft-keyboard Enter', () => {
    textarea.addEventListener('keypress', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') sent.push('\r');
    });
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    textarea.dispatchEvent(
      new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, charCode: 13, bubbles: true, cancelable: true }),
    );
    textarea.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true }));
    expect(sent).toEqual(['\r']);
    expect(xtermSaw).not.toContain('keypress');
  });

  // A soft keyboard can move the cursor with real arrow key events (HeliBoard's dpad joystick
  // sends one per notch). Those used to die with every other keydown above.
  test.each([
    ['ArrowLeft', '\x1b[D'],
    ['ArrowRight', '\x1b[C'],
    ['ArrowUp', '\x1b[A'],
    ['ArrowDown', '\x1b[B'],
  ])('sends a %s keydown from the keyboard as its cursor sequence', (key, seq) => {
    const ev = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
    textarea.dispatchEvent(ev);
    expect(sent).toEqual([seq]);
    expect(xtermSaw).not.toContain('keydown');
    expect(ev.defaultPrevented).toBe(true);
  });

  test('an arrow keydown drops the IME context, like a keyboard-bar cursor move', () => {
    commit('hello');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true, bubbles: true }));
    expect(textarea.value).toBe('');
  });

  test('keeps the baseline so continuing a word after a keyboard-bar cursor move sends only the new letter', () => {
    // Regression for the arrow-corruption: while composing "bc" the user taps the keyboard
    // bar's left arrow (an out-of-band pty write, not seen here) and types "b" again. The IME
    // extends its buffer to "bcb"; we must send only the delta "b", not re-send "bc".
    compose('compositionstart', '');
    compose('compositionupdate', 'b');
    compose('compositionupdate', 'bc');
    sent.length = 0;
    compose('compositionupdate', 'bcx');
    expect(sent.join('')).toBe('x');
  });

  test('records events in the diagnostics log when provided', () => {
    const log = createInputLog(50);
    const r = document.createElement('div');
    const ta = document.createElement('textarea');
    r.appendChild(ta);
    document.body.appendChild(r);
    attachAndroidInput(r, ta, { send: () => {}, log });
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'x', bubbles: true }));
    const snapshot = log.snapshot();
    expect(snapshot.at(-1)).toMatchObject({ kind: 'compositionupdate', detail: 'x', out: 'x' });
  });

  // Gesture (swipe) typing: the keyboard emits the inter-word space as its own insertText
  // between two compositions, but only when it can see a word character before the cursor.
  // Blanking the textarea made every word look like the start of the field, so the space was
  // never produced. We keep the committed word there as context instead.
  test('retains the committed word as IME context', () => {
    compose('compositionstart', '');
    compose('compositionupdate', 'hello');
    compose('compositionend', 'hello');
    expect(textarea.value).toBe('hello');
  });

  test('keeps the context through the input event that follows compositionend', () => {
    // Chrome order is beforeinput → compositionend → input. The trailing input event used to
    // blank the textarea, wiping the context one line after it was set.
    compose('compositionstart', '');
    compose('compositionupdate', 'hello');
    compose('compositionend', 'hello');
    textarea.dispatchEvent(
      new InputEvent('input', {
        inputType: 'insertCompositionText',
        isComposing: false,
        bubbles: true,
      }),
    );
    expect(textarea.value).toBe('hello');
  });

  test('forwards the phantom space the keyboard emits between swiped words', () => {
    compose('compositionstart', '');
    compose('compositionupdate', 'hello');
    compose('compositionend', 'hello');
    sent.length = 0;
    textarea.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: ' ',
        cancelable: true,
        bubbles: true,
      }),
    );
    expect(sent.join('')).toBe(' ');
  });

  test('clears the context on Enter so the next word does not start with a space', () => {
    compose('compositionstart', '');
    compose('compositionupdate', 'hello');
    compose('compositionend', 'hello');
    textarea.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true }),
    );
    expect(textarea.value).toBe('');
  });

  test('resetContext clears the context when idle', () => {
    compose('compositionstart', '');
    compose('compositionupdate', 'hello');
    compose('compositionend', 'hello');
    adapter.resetContext();
    expect(textarea.value).toBe('');
  });

  test('resetContext is a no-op mid-composition', () => {
    // The keyboard bar writes to the pty out-of-band; a cursor move mid-word must not disturb
    // the IME's in-progress composition (see the baseline regression test above).
    compose('compositionstart', '');
    compose('compositionupdate', 'bc');
    textarea.value = 'bc'; // jsdom has no IME: stand in for the browser's composing text
    adapter.resetContext();
    expect(textarea.value).toBe('bc');
  });

  // The retained context should mirror the tail of the pty line, not just the last committed
  // word: the keyboard reads it for next-word prediction and for targeting autocorrect, so a
  // field that reads "helloworld" instead of "hello world" misleads it.
  function beforeInput(init: InputEventInit & { inputType: string }, targetRange?: number) {
    const ev = new InputEvent('beforeinput', { cancelable: true, bubbles: true, ...init });
    if (targetRange !== undefined) {
      Object.defineProperty(ev, 'getTargetRanges', {
        value: () => [
          { startContainer: textarea, endContainer: textarea, startOffset: 0, endOffset: targetRange },
        ],
      });
    }
    textarea.dispatchEvent(ev);
    return ev;
  }

  function commit(word: string) {
    compose('compositionstart', '');
    compose('compositionupdate', word);
    compose('compositionend', word);
  }

  test('keeps the inter-word space in the context so the field reads like a sentence', () => {
    commit('hello');
    beforeInput({ inputType: 'insertText', data: ' ' });
    expect(textarea.value).toBe('hello ');
  });

  test('accumulates across words, so every inter-word space keeps being emitted', () => {
    // Regression: retaining only the last committed word reset the field to a one-word window,
    // and the keyboard then stopped emitting its inter-word space from the second word on. Two
    // words looked fine — the failure only shows from the third. Measured on-device against a
    // plain textarea, which produces "one two three four" where the one-word window produced
    // "one twothreefour".
    commit('one');
    beforeInput({ inputType: 'insertText', data: ' ' });
    commit('two');
    beforeInput({ inputType: 'insertText', data: ' ' });
    commit('three');
    expect(textarea.value).toBe('one two three');
  });

  test('a submitted line drops the whole accumulated context, not just the last word', () => {
    commit('one');
    beforeInput({ inputType: 'insertText', data: ' ' });
    commit('two');
    beforeInput({ inputType: 'insertLineBreak' });
    expect(textarea.value).toBe('');
  });

  test('shrinks the context on backspace', () => {
    commit('hello');
    beforeInput({ inputType: 'deleteContentBackward' });
    expect(textarea.value).toBe('hell');
  });

  test('applies an autocorrect replacement to the context', () => {
    commit('hello');
    beforeInput({ inputType: 'insertReplacementText', data: 'hullo' }, 5);
    expect(textarea.value).toBe('hullo');
  });

  test('still sends the pty bytes while tracking the context', () => {
    commit('hello');
    sent.length = 0;
    beforeInput({ inputType: 'insertText', data: ' ' });
    beforeInput({ inputType: 'deleteContentBackward' });
    expect(sent.join('')).toBe(' \x7f');
  });

  // HeliBoard recorrection: backspacing into a committed word re-opens it as a composition and
  // re-announces its full text. Replays the on-device event log for "hello world" + backspace,
  // which used to leave the pty at "hellohello". The device sends no beforeinput and no target
  // range for that composition, so the retained context is the only evidence it is a reclaim.
  test('does not re-type a word the IME reclaims after a backspace', () => {
    commit('hello');
    beforeInput({ inputType: 'insertText', data: ' ' });
    compose('compositionstart', '');
    compose('compositionupdate', 'world');
    compose('compositionupdate', ''); // backspace wipes the composing word
    compose('compositionend', '');
    beforeInput({ inputType: 'deleteContentBackward' }); // and then the space
    sent.length = 0;

    compose('compositionstart', '');
    compose('compositionupdate', 'hello');
    compose('compositionend', 'hello');

    expect(sent.join('')).toBe('');
    expect(textarea.value).toBe('hello'); // context still mirrors the pty line
  });

  test('sends only the delta when a reclaimed word is then edited', () => {
    commit('hello');
    sent.length = 0;
    compose('compositionstart', '');
    compose('compositionupdate', 'hello');
    compose('compositionupdate', 'hell');
    compose('compositionend', 'help');
    expect(sent.join('')).toBe('\x7f\x7fp');
    expect(textarea.value).toBe('help');
  });

  test('typing on past a reclaimed word sends only the new letters', () => {
    commit('hel');
    sent.length = 0;
    compose('compositionstart', '');
    compose('compositionupdate', 'hell');
    compose('compositionupdate', 'hello');
    compose('compositionend', 'hello');
    expect(sent.join('')).toBe('lo');
    expect(textarea.value).toBe('hello');
  });

  test('a new word after a space is never mistaken for a reclaim', () => {
    // The swipe case: the inter-word space ends the context's trailing word, so even a word
    // that starts with the previous one ("two" → "twofold") types in full.
    commit('two');
    beforeInput({ inputType: 'insertText', data: ' ' });
    sent.length = 0;
    compose('compositionstart', '');
    compose('compositionupdate', 'twofold');
    compose('compositionend', 'twofold');
    expect(sent.join('')).toBe('twofold');
    expect(textarea.value).toBe('two twofold');
  });

  // HeliBoard's paste key sends Ctrl+V: xterm sends the text from the `paste` event and blanks
  // the field, then the browser's default action re-inserts it. Replays the on-device capture,
  // where HeliBoard then re-opened the last pasted word and the pty got "alpha beta gammagamma".
  function paste(text: string) {
    textarea.value = '';
    sent.push(text); // what xterm's own paste listener sends
    const ev = beforeInput({ inputType: 'insertFromPaste', data: text });
    if (!ev.defaultPrevented) textarea.value += text; // jsdom has no default action
    return ev;
  }

  test('a pasted text joins the context, so the IME re-opening its last word sends nothing', () => {
    commit('say');
    beforeInput({ inputType: 'insertText', data: ' ' });
    paste('alpha beta gamma');
    sent.length = 0;

    compose('compositionstart', '');
    compose('compositionupdate', 'gamma');
    compose('compositionend', 'gamma');

    expect(sent.join('')).toBe('');
    expect(textarea.value).toBe('say alpha beta gamma');
  });

  test('leaves the paste bytes to xterm', () => {
    const ev = paste('alpha');
    expect(sent).toEqual(['alpha']);
    expect(ev.defaultPrevented).toBe(true);
  });

  test('destroy removes listeners', () => {
    adapter.destroy();
    compose('compositionstart', '');
    compose('compositionupdate', 'z');
    expect(sent).toEqual([]);
  });
});
