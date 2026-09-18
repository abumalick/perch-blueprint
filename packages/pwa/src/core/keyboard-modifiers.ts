// Pure state machine for the terminal bar's sticky Ctrl/Alt modifiers.
// Mobile soft keyboards have no Ctrl/Alt, so the bar arms a modifier and the next
// character typed is transformed. Tapping cycles off → armed (one-shot) → locked
// (double-tap, persists) → off. Kept UI-free so it can be unit-tested directly.

export type ModifierState = 'off' | 'armed' | 'locked';

export function cycleModifier(state: ModifierState): ModifierState {
  switch (state) {
    case 'off':
      return 'armed';
    case 'armed':
      return 'locked';
    case 'locked':
      return 'off';
  }
}

export function isModifierActive(state: ModifierState): boolean {
  return state !== 'off';
}

type Modifiers = { ctrl: ModifierState; alt: ModifierState };
type ProcessResult = { output: string } & Modifiers;

// Apply active modifiers to a single typed character and consume one-shot (armed)
// modifiers. Multi-char input (e.g. paste) passes through untouched.
export function processTerminalInput(data: string, { ctrl, alt }: Modifiers): ProcessResult {
  if (data.length !== 1 || (!isModifierActive(ctrl) && !isModifierActive(alt))) {
    return { output: data, ctrl, alt };
  }

  let output = data;
  if (isModifierActive(ctrl)) output = String.fromCharCode(output.charCodeAt(0) & 0x1f);
  if (isModifierActive(alt)) output = '\x1b' + output;

  return {
    output,
    ctrl: consume(ctrl),
    alt: consume(alt),
  };
}

function consume(state: ModifierState): ModifierState {
  return state === 'armed' ? 'off' : state;
}

// macOS-style line/word editing chords. A logical edit key (left/right/backspace)
// resolves to a different escape sequence depending on the active modifier:
// Alt = word motion / delete-word, Meta (Command) = line start/end / delete-to-start.
export type EditKey = 'left' | 'right' | 'backspace' | 'forwardDelete';

const PLAIN: Record<EditKey, string> = {
  left: '\x1b[D',
  right: '\x1b[C',
  backspace: '\x7f',
  forwardDelete: '\x1b[3~',
};
const ALT_CHORD: Record<EditKey, string> = {
  left: '\x1bb',
  right: '\x1bf',
  backspace: '\x1b\x7f',
  forwardDelete: '\x1bd',
};
const META_CHORD: Record<EditKey, string> = {
  left: '\x01',
  right: '\x05',
  backspace: '\x15',
  forwardDelete: '\x0b',
};

const DOM_KEY: Record<string, EditKey> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Backspace: 'backspace',
  Delete: 'forwardDelete',
};

// Hardware-keyboard path: map a DOM keydown (key + meta/alt) to its chord sequence,
// or null when it's not an edit key or no relevant modifier is held (leave it to
// xterm/native). Meta takes precedence over Alt when both are down.
export function editChordFromEvent(
  domKey: string,
  { meta, alt }: { meta: boolean; alt: boolean },
): string | null {
  const key = DOM_KEY[domKey];
  if (!key) return null;
  if (meta) return META_CHORD[key];
  if (alt) return ALT_CHORD[key];
  return null;
}

type EditModifiers = { ctrl: ModifierState; alt: ModifierState; meta: ModifierState };
type EditResult = { output: string } & EditModifiers;

// On-screen-bar path: resolve an edit key against the sticky modifiers and consume
// any one-shot (armed) alt/meta. Ctrl has no chord for edit keys, so it passes
// through untouched. Meta takes precedence over Alt.
export function applyEditKey(key: EditKey, { ctrl, alt, meta }: EditModifiers): EditResult {
  let output = PLAIN[key];
  if (isModifierActive(meta)) output = META_CHORD[key];
  else if (isModifierActive(alt)) output = ALT_CHORD[key];

  return { output, ctrl, alt: consume(alt), meta: consume(meta) };
}
