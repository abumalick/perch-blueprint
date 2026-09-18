<script module lang="ts">
  // Px of pointer travel that turns a tap into a drag, cancelling the key. THE tuning knob
  // for the keyboard bar's scroll-vs-type ambiguity: lower rejects more genuine taps, higher
  // lets more scroll gestures type. 10px is the usual touch slop.
  export const TAP_SLOP_PX = 10;
</script>

<script lang="ts">
  // Termux/Blink-style "extra keys" row for a mobile terminal. Direct keys send a
  // fixed escape sequence straight to the PTY. Ctrl/Alt/Cmd are *sticky* modifiers:
  // arming one transforms the next key, since mobile keyboards have no such keys.
  // Ctrl/Alt transform the next character typed on the soft keyboard (handled by the
  // parent in term.onData); all three transform the next arrow/backspace tapped here
  // into the macOS word/line editing chords. Tapping cycles off → armed (one-shot)
  // → locked (double-tap) → off.
  import {
    applyEditKey,
    cycleModifier,
    isModifierActive,
    type EditKey,
    type ModifierState,
  } from '../core/keyboard-modifiers';
  import type { DictationState } from '../core/speech-to-text';
  import type { CommandEntry } from '@perch/contracts';
  import { commandInput } from '../core/command-input';
  import { startKeyRepeat } from '../core/key-repeat';
  import { startGesture, moveGesture, type PadState, type PadDirection } from '../core/cursor-pad';
  import CommandPicker from './CommandPicker.svelte';

  let {
    send,
    paste,
    selectMode,
    onToggleSelect,
    showCopy = false,
    onCopy = () => {},
    dictation = 'idle',
    onDictate = () => {},
    commands = [],
    onPickFile,
    ctrl = $bindable('off'),
    alt = $bindable('off'),
    meta = $bindable('off'),
  }: {
    send: (seq: string) => void;
    paste: () => void;
    selectMode: boolean;
    onToggleSelect: () => void;
    showCopy?: boolean;
    onCopy?: () => void;
    dictation?: DictationState;
    onDictate?: () => void;
    commands?: CommandEntry[];
    // When wired (terminal view), shows an attach-file button backed by the OS file picker.
    // Omitted elsewhere (e.g. BrowserView) so the button doesn't appear where it has no target.
    onPickFile?: (file: File) => void;
    ctrl?: ModifierState;
    alt?: ModifierState;
    meta?: ModifierState;
  } = $props();

  // Hidden <input type=file>, opened by the attach button. Deliberately carries neither
  // `accept` nor `capture`: any `accept` greys out non-matching files in the OS picker (an
  // `image/*` one made archives unreachable in the iPhone's Files app), and omitting
  // `capture` lets Android offer camera + gallery + documents rather than forcing the camera.
  // Reset after each pick so choosing the same file twice still fires `change`.
  let fileInput = $state<HTMLInputElement | null>(null);
  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) onPickFile?.(file);
    input.value = '';
  }

  // A plain key sends a fixed sequence; an `edit` key (arrows/backspace) is routed
  // through the sticky modifiers so ⌥/⌘ produce the macOS word/line editing chords.
  // `repeat` keys auto-fire while held (cursor movement / deletion); the rest fire once.
  type Key = { label: string; seq: string; edit?: EditKey; repeat?: boolean };

  // Navigation keys only: backspace, Enter, Esc, Tab, back-tab. Enter and Esc are rendered right
  // after the cursor pad rather than through the `keys` loop below (see the template),
  // since they are reached more often than delete/tab. Esc is kept because TUIs (vim,
  // etc.) need it; Enter is a carriage return. Tab is last: it is unused in the
  // terminal, but BrowserView maps it back to a real Tab for form-field navigation, so
  // it stays rather than going. Back-tab follows it: no soft keyboard offers Shift, and
  // the sticky modifiers here are ⌃/⌥/⌘ only, so `\x1b[Z` was simply unreachable — which
  // put Claude Code's Shift+Tab permission-mode cycle out of reach from a phone. It does
  // NOT repeat; auto-firing would spin straight through the cycle. The arrows are NOT
  // here — they are driven by the cursor pad below.
  const enterKey: Key = { label: '⏎', seq: '\r' };
  const escKey: Key = { label: '⎋', seq: '\x1b' };
  // Deliberately does NOT repeat: Claude Code CLI binds a held Space to push-to-talk
  // voice dictation (detected via rapid key-repeat events), so an auto-repeating Space
  // here would trigger that feature instead of inserting spaces.
  const spaceKey: Key = { label: '␣', seq: ' ' };
  const keys: Key[] = [
    { label: '⌦', seq: '\x1b[3~', edit: 'forwardDelete', repeat: true },
    { label: '⌫', seq: '\x7f', edit: 'backspace', repeat: true },
    { label: '⇥', seq: '\t' },
    { label: '⇤', seq: '\x1b[Z' },
  ];

  // The arrows, addressed by drag direction instead of by button. Left/right stay edit
  // keys so ⌥/⌘ still produce the macOS word/line chords; up/down deliberately do not.
  const padKeys: Record<PadDirection, Key> = {
    left: { label: '←', seq: '\x1b[D', edit: 'left' },
    right: { label: '→', seq: '\x1b[C', edit: 'right' },
    up: { label: '↑', seq: '\x1b[A' },
    down: { label: '↓', seq: '\x1b[B' },
  };

  function tapKey(key: Key) {
    if (!key.edit) {
      send(key.seq);
      return;
    }
    const result = applyEditKey(key.edit, { ctrl, alt, meta });
    alt = result.alt;
    meta = result.meta;
    send(result.output);
  }

  // A nav key commits on `pointerup`, so the pointer path owns the whole interaction and
  // the browser's trailing synthesized `click` must be swallowed — otherwise a press would
  // double-fire, and a *cancelled* press would fire on the click it never asked for. Set by
  // any real pointerdown on a firing key, so a `click` dispatched on its own (as the unit
  // tests do) is never suppressed.
  let suppressClick = false;

  // Buttons must not steal focus from the terminal textarea, or the soft keyboard
  // closes on every tap. preventDefault on pointerdown keeps focus where it is. The
  // same gesture drives a transient `.pressed` class for immediate visual feedback:
  // iOS Safari fires `:active` late and unreliably for taps, so we toggle it from
  // pointer events ourselves. Pressed state is purely visual and layers on top of any
  // armed modifier styling.
  //
  // A `fire` param makes the key send on release; with `repeat`, holding it past the
  // initial delay auto-repeats until release. It deliberately does NOT send on
  // pointerdown: the bar is a horizontal scroller, so a drag beginning on a key is
  // usually a scroll, and a keystroke already on the wire cannot be taken back. Any
  // travel past TAP_SLOP_PX — or a `pointercancel`, which is what WebKit sends (often
  // with no pointermove at all) once its scroller claims the gesture — cancels the key.
  type PressParams = { fire?: () => void; repeat?: boolean };
  function press(node: HTMLElement, params: PressParams = {}) {
    let current = params;
    let repeater: { stop: () => void } | undefined;
    let origin: { x: number; y: number } | null = null;
    let fired = false;
    const arm = (e: Event) => {
      e.preventDefault();
      node.classList.add('pressed');
      if (!current.fire) return;
      const { clientX, clientY } = e as PointerEvent;
      origin = { x: clientX, y: clientY };
      fired = false;
      suppressClick = true;
      if (current.repeat) {
        repeater = startKeyRepeat(() => {
          fired = true;
          current.fire?.();
        });
      }
    };
    const drag = (e: Event) => {
      if (!origin) return;
      const { clientX, clientY } = e as PointerEvent;
      if (Math.hypot(clientX - origin.x, clientY - origin.y) > TAP_SLOP_PX) cancel();
    };
    const commit = () => {
      if (origin && !fired) current.fire?.();
      cancel();
    };
    const cancel = () => {
      node.classList.remove('pressed');
      repeater?.stop();
      repeater = undefined;
      origin = null;
    };
    node.addEventListener('pointerdown', arm);
    node.addEventListener('pointermove', drag);
    node.addEventListener('pointerup', commit);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('pointerleave', cancel);
    return {
      update(next: PressParams) {
        current = next;
      },
      destroy() {
        repeater?.stop();
        node.removeEventListener('pointerdown', arm);
        node.removeEventListener('pointermove', drag);
        node.removeEventListener('pointerup', commit);
        node.removeEventListener('pointercancel', cancel);
        node.removeEventListener('pointerleave', cancel);
      },
    };
  }

  // Each notch goes through the same tapKey path as a real key press, so the sticky
  // modifiers decay exactly as they would on repeated taps: an armed ⌥ is consumed by the
  // first notch and the rest arrive plain, while a locked ⌥ applies to every notch.
  function emitPad(directions: PadDirection[]) {
    for (const direction of directions) tapKey(padKeys[direction]);
  }

  // Trackpad-style drag. Deliberately NOT the `press` action above: that releases on
  // `pointerleave`, which would abort the drag the instant the finger left the 2.75rem
  // button. Pointer capture makes the whole screen the drag surface, and `touch-action:
  // none` on the button stops the bar's horizontal scroller from eating the gesture.
  function padDrag(node: HTMLElement) {
    let gesture: PadState | null = null;

    const down = (e: PointerEvent) => {
      e.preventDefault();
      node.setPointerCapture?.(e.pointerId);
      node.classList.add('pressed');
      gesture = startGesture(e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (!gesture) return;
      const result = moveGesture(gesture, e.clientX, e.clientY);
      gesture = result.state;
      emitPad(result.emit);
    };
    const release = (e: PointerEvent) => {
      gesture = null;
      node.classList.remove('pressed');
      if (node.hasPointerCapture?.(e.pointerId)) node.releasePointerCapture(e.pointerId);
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    return {
      destroy() {
        node.removeEventListener('pointerdown', down);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', release);
        node.removeEventListener('pointercancel', release);
      },
    };
  }
</script>

<div class="bar" role="toolbar" aria-label="Terminal keys">
  <button
    type="button"
    class="mod"
    class:active={isModifierActive(ctrl)}
    class:locked={ctrl === 'locked'}
    aria-label="Control"
    aria-pressed={isModifierActive(ctrl)}
    use:press
    onclick={() => (ctrl = cycleModifier(ctrl))}>⌃</button>
  <button
    type="button"
    class="mod"
    class:active={isModifierActive(alt)}
    class:locked={alt === 'locked'}
    aria-label="Option"
    aria-pressed={isModifierActive(alt)}
    use:press
    onclick={() => (alt = cycleModifier(alt))}>⌥</button>
  <button
    type="button"
    class="mod"
    class:active={isModifierActive(meta)}
    class:locked={meta === 'locked'}
    aria-label="Command"
    aria-pressed={isModifierActive(meta)}
    use:press
    onclick={() => (meta = cycleModifier(meta))}>⌘</button>
  {@render navKey(spaceKey)}
  <button
    type="button"
    class="mic"
    class:recording={dictation === 'recording'}
    class:error={dictation === 'error'}
    aria-label="Dictate"
    aria-pressed={dictation === 'recording'}
    disabled={dictation === 'transcribing'}
    use:press
    onclick={() => onDictate()}
    >{dictation === 'transcribing' ? '⏳' : dictation === 'error' ? '⚠️' : '🎤'}</button>
  {#snippet navKey(key: Key)}
    <button
      type="button"
      use:press={{ fire: () => tapKey(key), repeat: key.repeat }}
      onclick={() => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        tapKey(key);
      }}>
      {key.label}
    </button>
  {/snippet}
  <button type="button" class="pad" aria-label="Cursor pad" use:padDrag>✥</button>
  {@render navKey(enterKey)}
  {@render navKey(escKey)}
  {#each keys as key (key.label)}
    {@render navKey(key)}
  {/each}
  <button
    type="button"
    class="toggle"
    class:active={selectMode}
    aria-label="Select text"
    aria-pressed={selectMode}
    use:press
    onclick={() => onToggleSelect()}>⌶</button>
  <button type="button" aria-label="Paste" use:press onclick={() => paste()}>📋</button>
  {#if onPickFile}
    <button type="button" aria-label="Attach file" use:press onclick={() => fileInput?.click()}>📎</button>
    <input
      bind:this={fileInput}
      type="file"
      hidden
      aria-hidden="true"
      tabindex="-1"
      onchange={onFileChange}
    />
  {/if}
  <!-- Android-only, and only while select mode is on: OS-native selection is dead on
       Android, so we drive xterm's own line selection (see android-select.ts) and copy it
       from here. iOS/desktop never set showCopy. -->
  {#if showCopy}
    <button type="button" aria-label="Copy" use:press onclick={() => onCopy()}>⧉</button>
  {/if}
  <!-- Last on the right, past the fold: a deliberate exception to the ordering rationale
       above; pinned by a test so it stays deliberate. -->
  {#if commands.length > 0}
    <CommandPicker {commands} onSelect={(entry) => send(commandInput(entry))} />
  {/if}
</div>

<style>
  .bar {
    display: flex;
    gap: 0.3rem;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.2rem;
    padding-bottom: max(0.2rem, env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--border);
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    flex: 0 0 auto;
  }
  .bar::-webkit-scrollbar { display: none; }
  /* The keyboard covers the home indicator while it's up, so the safe-area inset
     would just be a dead band lifting the bar off the keyboard. Drop it then. */
  :global(html.keyboard-open) .bar {
    padding-bottom: 0.2rem;
  }
  button {
    flex: 0 0 auto;
    min-width: 2.75rem;
    height: 2.75rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface-press);
    color: var(--text);
    font: 600 15px ui-monospace, monospace;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: transform 60ms ease, background 60ms ease;
  }
  /* The bar is a horizontal scroller; without this the drag scrolls the bar instead of
     moving the cursor. Pairs with setPointerCapture in the padDrag action. */
  .pad {
    touch-action: none;
  }
  /* Driven from pointer events (see `press`), not `:active`, which iOS Safari fires
     late and unreliably for taps. An obvious flash + shrink confirms each tap.
     `:global` because the class is toggled at runtime, so the compiler can't see it
     statically; still scoped to this bar's buttons. */
  .bar :global(button.pressed) {
    transform: scale(0.9);
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  @media (prefers-reduced-motion: reduce) {
    button { transition: background 60ms ease; }
    .bar :global(button.pressed) { transform: none; }
  }
  .mod.active,
  .toggle.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .mod.locked {
    background: #1f9d55;
    border-color: #1f9d55;
  }
  .mic.recording {
    background: var(--danger, #e5484d);
    border-color: var(--danger, #e5484d);
    animation: mic-pulse 1s ease-in-out infinite;
  }
  .mic.error { border-color: var(--danger, #e5484d); }
  .mic:disabled { opacity: 0.6; }
  @keyframes mic-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }
  @media (prefers-reduced-motion: reduce) {
    .mic.recording { animation: none; }
  }
</style>
