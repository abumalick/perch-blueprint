import { describe, expect, test } from 'vitest';
import {
  initialInputState,
  normalizeBeforeInput,
  reduceInput,
  type InputEvent,
} from './android-terminal-input';

const DEL = '\x7f';

// Run a sequence of events through the reducer, returning the concatenated pty output.
function run(events: InputEvent[]): string {
  let state = initialInputState();
  let output = '';
  for (const ev of events) {
    const result = reduceInput(state, ev);
    state = result.state;
    output += result.output;
  }
  return output;
}

describe('reduceInput — composition typing', () => {
  test('typing a word character-by-character forwards each new letter live', () => {
    expect(
      run([
        { type: 'compositionStart' },
        { type: 'compositionUpdate', data: 'g' },
        { type: 'compositionUpdate', data: 'gi' },
        { type: 'compositionUpdate', data: 'git' },
        { type: 'compositionEnd', data: 'git' },
      ]),
    ).toBe('git');
  });

  test('swipe / whole-word update forwards the entire word at once', () => {
    expect(
      run([
        { type: 'compositionStart' },
        { type: 'compositionUpdate', data: 'hello' },
        { type: 'compositionEnd', data: 'hello' },
      ]),
    ).toBe('hello');
  });

  test('a reclaimed word is not re-typed when the IME re-announces it', () => {
    // Backspacing into a committed word makes HeliBoard re-open it as a composition and
    // re-announce its full text. Without the reclaim baseline this re-typed the word
    // ("hello" → "hellohello").
    expect(
      run([
        { type: 'compositionStart' },
        { type: 'compositionReclaim', text: 'hello' },
        { type: 'compositionUpdate', data: 'hello' },
        { type: 'compositionEnd', data: 'hello' },
      ]),
    ).toBe('');
  });

  test('editing a reclaimed word forwards only the delta', () => {
    expect(
      run([
        { type: 'compositionStart' },
        { type: 'compositionReclaim', text: 'hello' },
        { type: 'compositionUpdate', data: 'hello' },
        { type: 'compositionUpdate', data: 'hell' },
        { type: 'compositionUpdate', data: 'help' },
        { type: 'compositionEnd', data: 'help' },
      ]),
    ).toBe(`${DEL}${DEL}p`);
  });

  test('autocorrect swap at commit backspaces to the common prefix then retypes', () => {
    expect(
      run([
        { type: 'compositionStart' },
        { type: 'compositionUpdate', data: 'g' },
        { type: 'compositionUpdate', data: 'gi' },
        { type: 'compositionUpdate', data: 'git' },
        { type: 'compositionEnd', data: 'gut' },
      ]),
    ).toBe(`git${DEL}${DEL}ut`);
  });

  test('backspacing mid-composition emits a single delete', () => {
    expect(
      run([
        { type: 'compositionStart' },
        { type: 'compositionUpdate', data: 'g' },
        { type: 'compositionUpdate', data: 'gi' },
        { type: 'compositionUpdate', data: 'git' },
        { type: 'compositionUpdate', data: 'gi' },
      ]),
    ).toBe(`git${DEL}`);
  });

  test('compositionEnd equal to the last update emits nothing extra', () => {
    const state = { composing: true, composed: 'git' };
    expect(reduceInput(state, { type: 'compositionEnd', data: 'git' }).output).toBe('');
  });
});

describe('reduceInput — the /slash-command case', () => {
  test('punctuation then a composed word forwards the slash and each letter', () => {
    expect(
      run([
        { type: 'insertText', data: '/' },
        { type: 'compositionStart' },
        { type: 'compositionUpdate', data: 'g' },
        { type: 'compositionUpdate', data: 'gi' },
        { type: 'compositionUpdate', data: 'git' },
        { type: 'compositionEnd', data: 'git' },
      ]),
    ).toBe('/git');
  });
});

describe('reduceInput — non-composed events', () => {
  test('plain insertText forwards the text verbatim', () => {
    expect(reduceInput(initialInputState(), { type: 'insertText', data: 'a' }).output).toBe('a');
  });

  test('deleteBackward emits a delete byte', () => {
    expect(reduceInput(initialInputState(), { type: 'deleteBackward' }).output).toBe(DEL);
  });

  test('replaceRange backspaces the replaced count then inserts the replacement', () => {
    expect(
      reduceInput(initialInputState(), { type: 'replaceRange', deleteCount: 3, data: 'ing' }).output,
    ).toBe(`${DEL}${DEL}${DEL}ing`);
  });

  test('enter emits carriage return', () => {
    expect(reduceInput(initialInputState(), { type: 'enter' }).output).toBe('\r');
  });
});

describe('normalizeBeforeInput — inputType mapping', () => {
  test('insertText maps to an insertText event', () => {
    expect(normalizeBeforeInput('insertText', 'a', 0)).toEqual({ type: 'insertText', data: 'a' });
  });

  test('insertReplacementText maps to a replaceRange with the target-range length', () => {
    expect(normalizeBeforeInput('insertReplacementText', 'ing', 3)).toEqual({
      type: 'replaceRange',
      deleteCount: 3,
      data: 'ing',
    });
  });

  test('deleteContentBackward maps to deleteBackward', () => {
    expect(normalizeBeforeInput('deleteContentBackward', null, 0)).toEqual({ type: 'deleteBackward' });
  });

  test('insertLineBreak and insertParagraph map to enter', () => {
    expect(normalizeBeforeInput('insertLineBreak', null, 0)).toEqual({ type: 'enter' });
    expect(normalizeBeforeInput('insertParagraph', null, 0)).toEqual({ type: 'enter' });
  });

  test('composition inputTypes are ignored (handled by composition events)', () => {
    expect(normalizeBeforeInput('insertCompositionText', 'gi', 0)).toBeNull();
    expect(normalizeBeforeInput('deleteCompositionText', null, 0)).toBeNull();
  });

  test('unknown inputTypes are ignored', () => {
    expect(normalizeBeforeInput('formatBold', null, 0)).toBeNull();
  });

  test('null data on an insert becomes an empty string', () => {
    expect(normalizeBeforeInput('insertText', null, 0)).toEqual({ type: 'insertText', data: '' });
  });
});

describe('reduceInput — state hygiene', () => {
  test('compositionEnd clears composing state', () => {
    const after = reduceInput({ composing: true, composed: 'hi' }, {
      type: 'compositionEnd',
      data: 'hi',
    });
    expect(after.state).toEqual({ composing: false, composed: '' });
  });

  test('enter while composing commits the pending composition, then the return', () => {
    // Pending composition already forwarded as "hi"; enter should just add the return.
    const after = reduceInput({ composing: true, composed: 'hi' }, { type: 'enter' });
    expect(after.output).toBe('\r');
    expect(after.state).toEqual({ composing: false, composed: '' });
  });

  test('is pure — same state and event yield the same output twice', () => {
    const state = { composing: true, composed: 'ab' };
    const ev: InputEvent = { type: 'compositionUpdate', data: 'abc' };
    expect(reduceInput(state, ev)).toEqual(reduceInput(state, ev));
    // input state object is not mutated
    expect(state).toEqual({ composing: true, composed: 'ab' });
  });
});
