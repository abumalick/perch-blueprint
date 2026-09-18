// Android IME adapter for xterm's hidden textarea.
//
// xterm's composition handling desyncs from the pty on Android (see
// core/android-terminal-input.ts). On Android we take over the textarea entirely: we
// drive the pty from composition + `beforeinput` events through the pure reducer, and
// silence xterm's own keyboard/composition path in the capture phase so nothing
// double-sends. iOS keeps xterm's normal path — this adapter never attaches there.
//
// Trade-off: stopping every keydown and keypress disables xterm's hardware-key handling on Android,
// so a physical (BT) keyboard's Ctrl-combos/Esc/Tab won't reach the terminal; the on-screen
// keyboard bar covers them. Arrow keys are the exception — we send those ourselves, because
// soft keyboards move the cursor with real arrow key events too. Soft-keyboard typing — the
// actual Android use case — is fully handled. Paste bytes are left to xterm's paste listener;
// we only keep the field in step with them.

import {
  initialInputState,
  normalizeBeforeInput,
  reduceInput,
  type InputEvent as PtyInputEvent,
} from '../core/android-terminal-input';
import type { InputLog } from '../core/terminal-input-log';

export function isAndroid(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}

function isCompositionInput(inputType: string): boolean {
  return inputType === 'insertCompositionText' || inputType === 'deleteCompositionText';
}

// Length of the range an autocorrect replacement targets, from the beforeinput event.
function targetRangeLength(ev: globalThis.InputEvent): number {
  const ranges = ev.getTargetRanges?.() ?? [];
  const range = ranges[0];
  if (range && range.startContainer === range.endContainer) {
    return range.endOffset - range.startOffset;
  }
  return 0;
}

// Make control bytes readable for the diagnostics log.
function printable(s: string): string {
  return s
    .replace(/\x7f/g, '⌫')
    .replace(/\r/g, '⏎')
    .replace(/\x1b/g, '⎋')
    .replace(/\t/g, '⇥');
}

// The same sequences the keyboard bar's cursor pad sends.
const ARROW_SEQUENCES: Record<string, string> = {
  ArrowLeft: '\x1b[D',
  ArrowRight: '\x1b[C',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
};

export interface AndroidInput {
  destroy(): void;
  /** Drop the retained IME context — call when the pty line changes out-of-band. */
  resetContext(): void;
}

export function attachAndroidInput(
  root: HTMLElement,
  textarea: HTMLTextAreaElement,
  opts: { send: (data: string) => void; log?: InputLog },
): AndroidInput {
  let state = initialInputState();

  // The line as typed since the last submission, kept in the textarea as context for the IME.
  // Gesture (swipe) typing emits the inter-word space as its own insertText between two
  // compositions, but only when the keyboard can see a word character before the cursor —
  // blanking the field made every word look like the start of the input, so the space was
  // never produced and swiped words ran together.
  //
  // Retaining only the *last committed word* is not enough, and looks deceptively fine: the
  // first space appears and every later one is dropped, so a two-word test passes while real
  // sentences still run together. The keyboard tracks the field as a whole, so it has to see
  // the accumulated line, not a one-word window. Measured against a plain textarea on-device.
  //
  // Growth is bounded by the resets below (Enter, and resetContext() from the keyboard bar),
  // which are also what keep it from drifting when the pty line changes out-of-band.
  let context = '';
  const applyContext = (): void => {
    textarea.value = context;
    textarea.setSelectionRange(context.length, context.length);
  };

  // Mid-composition the textarea holds the IME's in-progress word; clearing it there would
  // desync the composition, which is exactly what a cursor move must not do.
  const resetContext = (): void => {
    if (state.composing) return;
    context = '';
    applyContext();
  };

  const emit = (kind: string, detail: string, ev: PtyInputEvent): void => {
    const result = reduceInput(state, ev);
    state = result.state;
    if (result.output) opts.send(result.output);
    opts.log?.push({ kind, detail, out: printable(result.output) });
  };

  // xterm registers its own listeners on the textarea during open(), before we attach.
  // At the target node, listeners run in registration order regardless of capture flag,
  // so stopping propagation on the textarea would fire too late — xterm would already have
  // processed (and re-sent) the event. We listen on an ancestor in the capture phase, which
  // runs before the event reaches the textarea, and stopPropagation() shields xterm entirely.
  const forThisTextarea = (e: Event): boolean => e.target === textarea;

  // The word the composition took over from the pty line, if this update is the IME re-opening
  // already-committed text. Backspacing back into a word makes it recompose that word and
  // re-announce it in full, with no beforeinput and no target range to say so — the only
  // evidence is that the update starts with the word sitting at the end of our context.
  // A trailing word only exists there while the caret is attached to it: any committed space
  // ends the run, so a genuinely new word (the swipe case, which always brings its own space)
  // can never match.
  const reclaimedBy = (data: string): string => {
    const tail = /\S*$/.exec(context)?.[0] ?? '';
    return tail && data.startsWith(tail) ? tail : '';
  };

  // Set between compositionstart and the first update — only a composition's opening update can
  // reclaim; later ones are diffed against the baseline it established.
  let opening = false;

  const onCompositionStart = (e: Event): void => {
    if (!forThisTextarea(e)) return;
    e.stopPropagation();
    opening = true;
    emit('compositionstart', '', { type: 'compositionStart' });
  };
  const onCompositionUpdate = (e: Event): void => {
    if (!forThisTextarea(e)) return;
    e.stopPropagation();
    const data = (e as CompositionEvent).data ?? '';
    if (opening) {
      opening = false;
      const text = reclaimedBy(data);
      if (text) {
        // Already on the pty line, so it is the composition's baseline, not text to send.
        // It leaves the context here and compositionend appends the whole word back.
        context = context.slice(0, context.length - text.length);
        emit('reclaim', text, { type: 'compositionReclaim', text });
      }
    }
    emit('compositionupdate', data, { type: 'compositionUpdate', data });
  };
  const onCompositionEnd = (e: Event): void => {
    if (!forThisTextarea(e)) return;
    e.stopPropagation();
    opening = false;
    const data = (e as CompositionEvent).data ?? '';
    emit('compositionend', data, { type: 'compositionEnd', data });
    context += data;
    applyContext();
  };

  const onBeforeInput = (e: Event): void => {
    if (!forThisTextarea(e)) return;
    const ev = e as globalThis.InputEvent;
    if (isCompositionInput(ev.inputType)) return; // driven by composition events
    if (ev.inputType === 'insertFromPaste') {
      // xterm already sent the text from its `paste` listener and blanked the field, and the
      // default action would then put back only the pasted text. The keyboard re-opens the last
      // word it sees there, so the context has to be the whole line or that word gets re-sent.
      e.preventDefault();
      context += ev.data ?? '';
      applyContext();
      return;
    }
    const normalized = normalizeBeforeInput(ev.inputType, ev.data, targetRangeLength(ev));
    if (!normalized) return; // not ours (formatting, drops, …) — let xterm handle it
    if (ev.cancelable) e.preventDefault(); // we own the textarea's value, no double via input
    e.stopPropagation();
    emit(`beforeinput:${ev.inputType}`, ev.data ?? '', normalized);
    // Mirror the same edit onto the retained context. We preventDefault above, so the browser
    // never applies it for us — and the keyboard reads this field back for next-word prediction
    // and to target autocorrect, so it has to keep matching the tail of the pty line. Notably
    // the inter-word space belongs here: without it the field reads "helloworld" mid-composition.
    switch (normalized.type) {
      case 'insertText':
        context += normalized.data;
        break;
      case 'replaceRange':
        context = context.slice(0, Math.max(0, context.length - normalized.deleteCount)) + normalized.data;
        break;
      case 'deleteBackward':
        context = context.slice(0, -1);
        break;
      case 'enter':
        // The line is submitted: the pty is back at a fresh prompt, so the retained word is
        // stale. Leaving it would make the keyboard prepend a space to the next line.
        context = '';
        break;
    }
    applyContext();
  };

  const onInput = (e: Event): void => {
    if (!forThisTextarea(e)) return;
    const ev = e as globalThis.InputEvent;
    // Shield composition-origin input from xterm (it would re-send the composed text).
    if (ev.isComposing || isCompositionInput(ev.inputType)) {
      e.stopPropagation();
      // Chrome's order is beforeinput → compositionend → input, so this trailing event lands
      // after onCompositionEnd set the context. Re-apply it rather than blanking the field,
      // or the context would be wiped the moment it was established.
      if (!ev.isComposing) applyContext();
    }
  };

  const onKeyDown = (e: Event): void => {
    if (!forThisTextarea(e)) return;
    // Disable xterm's keyboard path on Android; we own input via composition/beforeinput.
    e.stopPropagation();
    const ke = e as KeyboardEvent;
    const seq = ARROW_SEQUENCES[ke.key] ?? '';
    if (seq) {
      // The cursor moves on the pty, not in the textarea: keep the caret put and drop the
      // context, exactly as a keyboard-bar cursor move does.
      e.preventDefault();
      resetContext();
      opts.send(seq);
    }
    opts.log?.push({ kind: 'keydown', detail: `${ke.key} (${ke.keyCode})`, out: printable(seq) });
  };

  // xterm sends a key from `keypress` whenever it did not handle the matching keydown, which is
  // always the case here since that keydown is stopped above. For Enter it duplicated the '\r'
  // the beforeinput path sends, submitting the line twice. No preventDefault: cancelling the
  // keypress would also cancel the beforeinput that carries the Enter.
  const onKeyPress = (e: Event): void => {
    if (forThisTextarea(e)) e.stopPropagation();
  };

  root.addEventListener('compositionstart', onCompositionStart, true);
  root.addEventListener('compositionupdate', onCompositionUpdate, true);
  root.addEventListener('compositionend', onCompositionEnd, true);
  root.addEventListener('beforeinput', onBeforeInput, true);
  root.addEventListener('input', onInput, true);
  root.addEventListener('keydown', onKeyDown, true);
  root.addEventListener('keypress', onKeyPress, true);

  return {
    resetContext,
    destroy() {
      root.removeEventListener('compositionstart', onCompositionStart, true);
      root.removeEventListener('compositionupdate', onCompositionUpdate, true);
      root.removeEventListener('compositionend', onCompositionEnd, true);
      root.removeEventListener('beforeinput', onBeforeInput, true);
      root.removeEventListener('input', onInput, true);
      root.removeEventListener('keydown', onKeyDown, true);
      root.removeEventListener('keypress', onKeyPress, true);
    },
  };
}
