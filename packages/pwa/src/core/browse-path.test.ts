import { describe, it, expect } from 'vitest';
import { basename, parent } from './browse-path';

describe('basename', () => {
  it('returns the last path segment', () => {
    expect(basename('/home/u/workspace/proj')).toBe('proj');
    expect(basename('/home/u/workspace/proj/src')).toBe('src');
  });
  it('ignores a trailing slash', () => {
    expect(basename('/home/u/proj/')).toBe('proj');
  });
  it('returns the root itself for /', () => {
    expect(basename('/')).toBe('/');
  });
});

describe('parent', () => {
  it('returns the containing directory', () => {
    expect(parent('/home/u/workspace/proj/src')).toBe('/home/u/workspace/proj');
  });
  it('ignores a trailing slash', () => {
    expect(parent('/home/u/proj/')).toBe('/home/u');
  });
  it('stops at the root', () => {
    expect(parent('/a')).toBe('/');
    expect(parent('/')).toBe('/');
  });
});
