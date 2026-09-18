import { describe, it, expect } from 'vitest';
import { imageFiles, neighbor, position } from './image-nav';

const files = ['/d/README.md', '/d/a.png', '/d/notes.txt', '/d/b.jpg', '/d/c.gif'];
const imgs = ['/d/a.png', '/d/b.jpg', '/d/c.gif'];

describe('imageFiles', () => {
  it('keeps only images in folder order', () => {
    expect(imageFiles(files)).toEqual(imgs);
  });
});

describe('neighbor', () => {
  it('returns the next/previous image', () => {
    expect(neighbor(imgs, '/d/a.png', 1)).toBe('/d/b.jpg');
    expect(neighbor(imgs, '/d/b.jpg', -1)).toBe('/d/a.png');
  });
  it('returns null at the ends (stop, no wrap)', () => {
    expect(neighbor(imgs, '/d/a.png', -1)).toBeNull();
    expect(neighbor(imgs, '/d/c.gif', 1)).toBeNull();
  });
  it('returns null when current is not in the list', () => {
    expect(neighbor(imgs, '/d/missing.png', 1)).toBeNull();
  });
});

describe('position', () => {
  it('gives a 1-based index and count', () => {
    expect(position(imgs, '/d/b.jpg')).toEqual({ index: 2, count: 3 });
  });
  it('returns null when current is not an image in the list', () => {
    expect(position(imgs, '/d/missing.png')).toBeNull();
  });
});
