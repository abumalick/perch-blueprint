import { describe, it, expect } from 'vitest';
import { isValidFolderName } from './folder-name';

describe('isValidFolderName', () => {
  it('accepts a plain name', () => {
    expect(isValidFolderName('docs')).toBe(true);
  });

  it('accepts a name with surrounding whitespace (it is trimmed)', () => {
    expect(isValidFolderName('  docs  ')).toBe(true);
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(isValidFolderName('')).toBe(false);
    expect(isValidFolderName('   ')).toBe(false);
  });

  it('rejects a name containing a path separator', () => {
    expect(isValidFolderName('a/b')).toBe(false);
  });

  it('rejects "." and ".."', () => {
    expect(isValidFolderName('.')).toBe(false);
    expect(isValidFolderName('..')).toBe(false);
  });
});
