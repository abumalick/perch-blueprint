import { describe, it, expect } from 'vitest';
import { imageMediaType } from './image-media-type';

describe('imageMediaType', () => {
  it('maps known image extensions (case-insensitive)', () => {
    expect(imageMediaType('/a/b.png')).toBe('image/png');
    expect(imageMediaType('/a/b.JPG')).toBe('image/jpeg');
    expect(imageMediaType('photo.jpeg')).toBe('image/jpeg');
    expect(imageMediaType('x.webp')).toBe('image/webp');
    expect(imageMediaType('x.avif')).toBe('image/avif');
    expect(imageMediaType('x.gif')).toBe('image/gif');
    expect(imageMediaType('x.bmp')).toBe('image/bmp');
    expect(imageMediaType('icon.svg')).toBe('image/svg+xml');
  });

  it('returns empty for non-images and extensionless paths', () => {
    expect(imageMediaType('/a/b.txt')).toBe('');
    expect(imageMediaType('/a/README')).toBe('');
    expect(imageMediaType('/a/.pngrc')).toBe('');
  });
});
