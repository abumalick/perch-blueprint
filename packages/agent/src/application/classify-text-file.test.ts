import { describe, it, expect } from 'vitest';
import { classifyTextFile } from './classify-text-file';

const enc = (s: string) => new TextEncoder().encode(s);

describe('classifyTextFile', () => {
  it('treats plain ASCII as text and base64-encodes it', () => {
    expect(classifyTextFile(enc('hello\n'), false)).toEqual({
      binary: false,
      data: Buffer.from('hello\n').toString('base64'),
    });
  });

  it('treats multi-byte UTF-8 as text with a correct round-trip', () => {
    const result = classifyTextFile(enc('café — ✓\n'), false);
    expect(result.binary).toBe(false);
    expect(Buffer.from(result.data, 'base64').toString('utf8')).toBe('café — ✓\n');
  });

  it('flags a NUL byte as binary with empty data', () => {
    expect(classifyTextFile(new Uint8Array([0x68, 0x00, 0x69]), false)).toEqual({
      binary: true,
      data: '',
    });
  });

  it('flags invalid UTF-8 (no NUL) as binary', () => {
    expect(classifyTextFile(new Uint8Array([0xff, 0xfe, 0x41]), false).binary).toBe(true);
  });

  it('does not flag a truncated trailing multi-byte char as binary', () => {
    // '✓' is E2 9C 93; keep only the first two bytes to simulate a mid-char cut.
    const full = enc('ok ✓');
    const cut = full.subarray(0, full.length - 1);
    expect(classifyTextFile(cut, true).binary).toBe(false);
  });

  it('still flags a genuinely invalid tail as binary even when truncated', () => {
    expect(classifyTextFile(new Uint8Array([0x41, 0xff, 0xff, 0xff, 0xff]), true).binary).toBe(true);
  });
});
