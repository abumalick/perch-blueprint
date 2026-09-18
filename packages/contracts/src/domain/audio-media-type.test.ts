import { describe, it, expect } from 'vitest';
import { audioMediaType } from './audio-media-type';

describe('audioMediaType', () => {
  it('maps known audio extensions (case-insensitive)', () => {
    expect(audioMediaType('/a/b.mp3')).toBe('audio/mpeg');
    expect(audioMediaType('song.MP3')).toBe('audio/mpeg');
    expect(audioMediaType('/a/b.m4a')).toBe('audio/mp4');
    expect(audioMediaType('/a/b.aac')).toBe('audio/aac');
    expect(audioMediaType('/a/b.wav')).toBe('audio/wav');
    expect(audioMediaType('/a/b.flac')).toBe('audio/flac');
    expect(audioMediaType('/a/b.ogg')).toBe('audio/ogg');
    expect(audioMediaType('/a/b.oga')).toBe('audio/ogg');
    expect(audioMediaType('/a/b.opus')).toBe('audio/ogg');
  });

  it('returns empty for non-audio, extensionless, and dotfile paths', () => {
    expect(audioMediaType('/a/b.txt')).toBe('');
    expect(audioMediaType('/a/b.png')).toBe('');
    expect(audioMediaType('/a/README')).toBe('');
    expect(audioMediaType('/a/.mp3rc')).toBe('');
  });
});
