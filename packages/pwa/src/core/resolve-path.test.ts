import { describe, it, expect } from 'vitest';
import { resolveProjectPath, displayProjectPath, relativeProjectPath } from './resolve-path';

describe('resolveProjectPath', () => {
  it('returns the input unchanged when no default path is set', () => {
    expect(resolveProjectPath(undefined, '/abs/project')).toBe('/abs/project');
    expect(resolveProjectPath('', 'relative')).toBe('relative');
  });

  it('passes an absolute input through, ignoring the default', () => {
    expect(resolveProjectPath('/home/u/workspace', '/other/place')).toBe('/other/place');
  });

  it('joins a relative input onto the default path', () => {
    expect(resolveProjectPath('/home/u/workspace', 'perch')).toBe('/home/u/workspace/perch');
  });

  it('normalizes slashes between the default and the input', () => {
    expect(resolveProjectPath('/home/u/workspace/', 'perch')).toBe('/home/u/workspace/perch');
    expect(resolveProjectPath('/home/u/workspace/', '/perch')).toBe('/perch');
    expect(resolveProjectPath('/home/u/workspace', 'sub/dir')).toBe('/home/u/workspace/sub/dir');
  });

  it('resolves an empty input to the default root', () => {
    expect(resolveProjectPath('/home/u/workspace', '')).toBe('/home/u/workspace');
    expect(resolveProjectPath('/home/u/workspace/', '')).toBe('/home/u/workspace');
  });

  it('returns empty when neither default nor input is set', () => {
    expect(resolveProjectPath(undefined, '')).toBe('');
  });
});

describe('displayProjectPath', () => {
  it('returns the path unchanged when no default path is set', () => {
    expect(displayProjectPath(undefined, '/home/u/workspace/api')).toBe('/home/u/workspace/api');
    expect(displayProjectPath('', '/home/u/workspace/api')).toBe('/home/u/workspace/api');
  });

  it('strips the default path prefix', () => {
    expect(displayProjectPath('/home/u/workspace', '/home/u/workspace/api')).toBe('api');
  });

  it('keeps nested segments under the default', () => {
    expect(displayProjectPath('/home/u/workspace', '/home/u/workspace/sub/dir')).toBe('sub/dir');
  });

  it('normalizes a trailing slash on the default', () => {
    expect(displayProjectPath('/home/u/workspace/', '/home/u/workspace/api')).toBe('api');
  });

  it('shows the folder name when the path is the default root itself', () => {
    expect(displayProjectPath('/home/u/workspace', '/home/u/workspace')).toBe('workspace');
  });

  it('returns the full path when it is not under the default', () => {
    expect(displayProjectPath('/home/u/workspace', '/other/place')).toBe('/other/place');
  });

  it('does not strip a default that is only a string prefix, not a path boundary', () => {
    expect(displayProjectPath('/home/u/work', '/home/u/workspace')).toBe('/home/u/workspace');
  });
});

describe('relativeProjectPath', () => {
  it('returns the absolute path unchanged when no default path is set', () => {
    expect(relativeProjectPath(undefined, '/home/u/workspace/api')).toBe('/home/u/workspace/api');
    expect(relativeProjectPath('', '/home/u/workspace/api')).toBe('/home/u/workspace/api');
  });

  it('returns empty when the path is the default root itself', () => {
    expect(relativeProjectPath('/home/u/workspace', '/home/u/workspace')).toBe('');
    expect(relativeProjectPath('/home/u/workspace/', '/home/u/workspace')).toBe('');
  });

  it('strips the default prefix for a path under it', () => {
    expect(relativeProjectPath('/home/u/workspace', '/home/u/workspace/api')).toBe('api');
    expect(relativeProjectPath('/home/u/workspace', '/home/u/workspace/sub/dir')).toBe('sub/dir');
  });

  it('keeps an absolute path that is outside the default', () => {
    expect(relativeProjectPath('/home/u/workspace', '/other/place')).toBe('/other/place');
  });

  it('does not strip a default that is only a string prefix, not a path boundary', () => {
    expect(relativeProjectPath('/home/u/work', '/home/u/workspace')).toBe('/home/u/workspace');
  });

  it('round-trips with resolveProjectPath', () => {
    const dp = '/home/u/workspace';
    for (const abs of ['/home/u/workspace', '/home/u/workspace/api', '/home/u/workspace/a/b', '/other/place']) {
      expect(resolveProjectPath(dp, relativeProjectPath(dp, abs))).toBe(abs);
    }
  });
});
