import { describe, it, expect } from 'vitest';
import { audioFiles } from './audio-nav';

describe('audioFiles', () => {
  it('keeps only audio files, sorted by filename (numeric-aware)', () => {
    const files = [
      '/p/README.md',
      '/p/track10.mp3',
      '/p/track2.mp3',
      '/p/cover.png',
      '/p/song.wav',
    ];
    expect(audioFiles(files)).toEqual(['/p/song.wav', '/p/track2.mp3', '/p/track10.mp3']);
  });

  it('sorts by basename, not by full path', () => {
    const files = ['/z/a.mp3', '/a/z.mp3'];
    expect(audioFiles(files)).toEqual(['/z/a.mp3', '/a/z.mp3']);
  });

  it('returns an empty list when there are no audio files', () => {
    expect(audioFiles(['/p/README.md', '/p/a.png'])).toEqual([]);
  });
});
