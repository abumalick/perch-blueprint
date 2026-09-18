import { describe, expect, test } from 'vitest';
import {
  applyEditKey,
  cycleModifier,
  editChordFromEvent,
  isModifierActive,
  processTerminalInput,
} from './keyboard-modifiers';

describe('cycleModifier', () => {
  test('off tapped once arms the modifier', () => {
    expect(cycleModifier('off')).toBe('armed');
  });

  test('armed tapped again locks the modifier (double-tap)', () => {
    expect(cycleModifier('armed')).toBe('locked');
  });

  test('locked tapped turns the modifier off', () => {
    expect(cycleModifier('locked')).toBe('off');
  });
});

describe('isModifierActive', () => {
  test('off is not active', () => {
    expect(isModifierActive('off')).toBe(false);
  });

  test('armed is active', () => {
    expect(isModifierActive('armed')).toBe(true);
  });

  test('locked is active', () => {
    expect(isModifierActive('locked')).toBe(true);
  });
});

describe('processTerminalInput', () => {
  test('passes input through unchanged when no modifier is active', () => {
    const result = processTerminalInput('c', { ctrl: 'off', alt: 'off' });
    expect(result).toEqual({ output: 'c', ctrl: 'off', alt: 'off' });
  });

  test('armed Ctrl maps a letter to its control code', () => {
    const result = processTerminalInput('c', { ctrl: 'armed', alt: 'off' });
    expect(result.output).toBe('\x03');
  });

  test('armed Alt prefixes the character with ESC', () => {
    const result = processTerminalInput('a', { ctrl: 'off', alt: 'armed' });
    expect(result.output).toBe('\x1ba');
  });

  test('Ctrl and Alt together map the control code and prefix ESC', () => {
    const result = processTerminalInput('c', { ctrl: 'armed', alt: 'armed' });
    expect(result.output).toBe('\x1b\x03');
  });

  test('armed modifier is consumed (one-shot) after a single character', () => {
    const result = processTerminalInput('c', { ctrl: 'armed', alt: 'off' });
    expect(result.ctrl).toBe('off');
  });

  test('locked modifier persists after a character', () => {
    const result = processTerminalInput('c', { ctrl: 'locked', alt: 'off' });
    expect(result.output).toBe('\x03');
    expect(result.ctrl).toBe('locked');
  });

  test('multi-character input (paste) is not modified and does not consume the modifier', () => {
    const result = processTerminalInput('abc', { ctrl: 'armed', alt: 'off' });
    expect(result).toEqual({ output: 'abc', ctrl: 'armed', alt: 'off' });
  });
});

describe('editChordFromEvent', () => {
  test('returns null for a non-edit key', () => {
    expect(editChordFromEvent('a', { meta: true, alt: false })).toBeNull();
  });

  test('returns null when neither modifier is down', () => {
    expect(editChordFromEvent('ArrowLeft', { meta: false, alt: false })).toBeNull();
  });

  test('Alt + Left is backward-word (ESC b)', () => {
    expect(editChordFromEvent('ArrowLeft', { meta: false, alt: true })).toBe('\x1bb');
  });

  test('Alt + Right is forward-word (ESC f)', () => {
    expect(editChordFromEvent('ArrowRight', { meta: false, alt: true })).toBe('\x1bf');
  });

  test('Meta + Left is start-of-line (Ctrl-A)', () => {
    expect(editChordFromEvent('ArrowLeft', { meta: true, alt: false })).toBe('\x01');
  });

  test('Meta + Right is end-of-line (Ctrl-E)', () => {
    expect(editChordFromEvent('ArrowRight', { meta: true, alt: false })).toBe('\x05');
  });

  test('Alt + Backspace deletes the previous word (ESC DEL)', () => {
    expect(editChordFromEvent('Backspace', { meta: false, alt: true })).toBe('\x1b\x7f');
  });

  test('Meta + Backspace deletes to line start (Ctrl-U)', () => {
    expect(editChordFromEvent('Backspace', { meta: true, alt: false })).toBe('\x15');
  });

  test('Meta takes precedence over Alt when both are down', () => {
    expect(editChordFromEvent('ArrowLeft', { meta: true, alt: true })).toBe('\x01');
  });

  test('returns null for plain Delete (no modifier)', () => {
    expect(editChordFromEvent('Delete', { meta: false, alt: false })).toBeNull();
  });

  test('Alt + Delete deletes the next word (ESC d)', () => {
    expect(editChordFromEvent('Delete', { meta: false, alt: true })).toBe('\x1bd');
  });

  test('Meta + Delete deletes to end of line (Ctrl-K)', () => {
    expect(editChordFromEvent('Delete', { meta: true, alt: false })).toBe('\x0b');
  });
});

describe('applyEditKey', () => {
  const off = { ctrl: 'off', alt: 'off', meta: 'off' } as const;

  test('emits the plain sequence when no modifier is active', () => {
    const result = applyEditKey('left', off);
    expect(result).toEqual({ output: '\x1b[D', ctrl: 'off', alt: 'off', meta: 'off' });
  });

  test('armed Alt emits the word chord and is consumed', () => {
    const result = applyEditKey('right', { ctrl: 'off', alt: 'armed', meta: 'off' });
    expect(result.output).toBe('\x1bf');
    expect(result.alt).toBe('off');
  });

  test('armed Meta emits the line chord and is consumed', () => {
    const result = applyEditKey('left', { ctrl: 'off', alt: 'off', meta: 'armed' });
    expect(result.output).toBe('\x01');
    expect(result.meta).toBe('off');
  });

  test('locked Meta persists after use', () => {
    const result = applyEditKey('right', { ctrl: 'off', alt: 'off', meta: 'locked' });
    expect(result.output).toBe('\x05');
    expect(result.meta).toBe('locked');
  });

  test('Meta takes precedence over Alt and only Meta resolves the chord', () => {
    const result = applyEditKey('backspace', { ctrl: 'off', alt: 'armed', meta: 'armed' });
    expect(result.output).toBe('\x15');
  });

  test('ctrl is passed through untouched (no ctrl chord for edit keys)', () => {
    const result = applyEditKey('left', { ctrl: 'armed', alt: 'off', meta: 'off' });
    expect(result.output).toBe('\x1b[D');
    expect(result.ctrl).toBe('armed');
  });

  test('forwardDelete emits the plain sequence when no modifier is active', () => {
    const result = applyEditKey('forwardDelete', off);
    expect(result).toEqual({ output: '\x1b[3~', ctrl: 'off', alt: 'off', meta: 'off' });
  });

  test('forwardDelete: armed Alt emits the word-forward chord and is consumed', () => {
    const result = applyEditKey('forwardDelete', { ctrl: 'off', alt: 'armed', meta: 'off' });
    expect(result.output).toBe('\x1bd');
    expect(result.alt).toBe('off');
  });

  test('forwardDelete: armed Meta emits the kill-line chord and is consumed', () => {
    const result = applyEditKey('forwardDelete', { ctrl: 'off', alt: 'off', meta: 'armed' });
    expect(result.output).toBe('\x0b');
    expect(result.meta).toBe('off');
  });

  test('forwardDelete: Meta takes precedence over Alt', () => {
    const result = applyEditKey('forwardDelete', { ctrl: 'off', alt: 'armed', meta: 'armed' });
    expect(result.output).toBe('\x0b');
  });
});
