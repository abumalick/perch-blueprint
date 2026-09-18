// Pure reducer that turns Android IME input events into pty bytes.
//
// Android soft keyboards drive the terminal through composition + `beforeinput`
// events, not per-key `keydown`. xterm.js's own composition handler tracks absolute
// indices into its hidden textarea's accumulating value, which desyncs on Android
// (racing timeouts, first-occurrence diffing, and out-of-band keyboard-bar cursor
// moves). Instead we forward composed text ourselves with common-prefix diffing, so
// every keystroke reaches the pty live (Claude's /-menu can filter) and an autocorrect
// swap at commit is reconciled with backspaces. Kept DOM-free so it can be unit-tested.

const DEL = '\x7f';

export type InputEvent =
  | { type: 'compositionStart' }
  | { type: 'compositionReclaim'; text: string } // existing pty text the composition took over
  | { type: 'compositionUpdate'; data: string } // full running composition string
  | { type: 'compositionEnd'; data: string } // final composition string
  | { type: 'insertText'; data: string } // non-composed direct insert
  | { type: 'replaceRange'; deleteCount: number; data: string } // autocorrect swap
  | { type: 'deleteBackward' }
  | { type: 'enter' };

export interface InputState {
  composing: boolean;
  composed: string; // the composition text already forwarded to the pty
}

export function initialInputState(): InputState {
  return { composing: false, composed: '' };
}

// Bytes that turn `prev` (already on the pty line) into `next`: backspace the diverging
// suffix, then type the new one.
function diff(prev: string, next: string): string {
  let i = 0;
  const max = Math.min(prev.length, next.length);
  while (i < max && prev[i] === next[i]) i++;
  return DEL.repeat(prev.length - i) + next.slice(i);
}

// Maps a `beforeinput` event's inputType to a normalized event, or null when the event
// should be ignored (composition inputTypes are driven by the composition events instead).
// `targetRangeLength` is the length of the range a replacement/deletion targets, taken from
// the event's getTargetRanges() at the call site.
export function normalizeBeforeInput(
  inputType: string,
  data: string | null,
  targetRangeLength: number,
): InputEvent | null {
  switch (inputType) {
    case 'insertText':
      return { type: 'insertText', data: data ?? '' };
    case 'insertReplacementText':
      return { type: 'replaceRange', deleteCount: targetRangeLength, data: data ?? '' };
    case 'deleteContentBackward':
      return { type: 'deleteBackward' };
    case 'insertLineBreak':
    case 'insertParagraph':
      return { type: 'enter' };
    default:
      // insertCompositionText / deleteCompositionText / formatting / unknown → ignore.
      return null;
  }
}

export function reduceInput(
  state: InputState,
  ev: InputEvent,
): { state: InputState; output: string } {
  switch (ev.type) {
    case 'compositionStart':
      return { state: { composing: true, composed: '' }, output: '' };
    case 'compositionReclaim':
      // Backspacing into an already-committed word makes the IME re-open it as an active
      // composition and re-announce its full text. Those characters are already on the pty
      // line, so the composition's baseline is that text — with an empty baseline the first
      // update would diff against nothing and type the whole word a second time.
      return { state: { composing: true, composed: ev.text }, output: '' };
    case 'compositionUpdate':
      return {
        state: { composing: true, composed: ev.data },
        output: diff(state.composed, ev.data),
      };
    case 'compositionEnd':
      return {
        state: { composing: false, composed: '' },
        output: diff(state.composed, ev.data),
      };
    case 'insertText':
      // A direct insert unwinds any pending composition first (it never committed).
      return {
        state: { composing: false, composed: '' },
        output: diff(state.composed, '') + ev.data,
      };
    case 'replaceRange':
      return {
        state: { composing: false, composed: '' },
        output: DEL.repeat(ev.deleteCount) + ev.data,
      };
    case 'deleteBackward':
      return { state, output: DEL };
    case 'enter':
      // The composition (if any) was already forwarded live; just add the return.
      return { state: { composing: false, composed: '' }, output: '\r' };
  }
}
