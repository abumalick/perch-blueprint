import { describe, it, expect } from 'vitest';
import { pathWithinRoots } from './path-within-roots';

describe('pathWithinRoots', () => {
  it('allows a root itself', () => {
    expect(pathWithinRoots('/home/u/proj', ['/home/u/proj'])).toBe(true);
  });
  it('allows a path nested under a root', () => {
    expect(pathWithinRoots('/home/u/proj/src/lib', ['/home/u/proj'])).toBe(true);
  });
  it('checks every root in the set', () => {
    expect(pathWithinRoots('/home/u/other/x', ['/home/u/proj', '/home/u/other'])).toBe(true);
  });
  it('rejects a path outside all roots', () => {
    expect(pathWithinRoots('/etc/passwd', ['/home/u/proj'])).toBe(false);
  });
  it('rejects a sibling that shares a name prefix', () => {
    expect(pathWithinRoots('/home/u/proj-evil', ['/home/u/proj'])).toBe(false);
  });
  it('rejects when there are no roots', () => {
    expect(pathWithinRoots('/home/u/proj', [])).toBe(false);
  });
});
