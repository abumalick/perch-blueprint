import { describe, it, expect } from 'vitest';
import { isHiddenPath } from './is-hidden-path';

describe('isHiddenPath', () => {
  const hidden = ['secret-proj', 'archive', 'scratch'];

  it('hides the named folder itself', () => {
    expect(isHiddenPath('/home/u/workspace/secret-proj', hidden)).toBe(true);
  });

  it('hides subfolders of a named folder', () => {
    expect(isHiddenPath('/home/u/workspace/secret-proj/api/src', hidden)).toBe(true);
  });

  it('hides a named folder anywhere in the tree', () => {
    expect(isHiddenPath('/srv/scratch', hidden)).toBe(true);
  });

  it('does not hide a folder whose name only shares a prefix', () => {
    expect(isHiddenPath('/home/u/workspace/secret-proj-old', hidden)).toBe(false);
  });

  it('does not hide unrelated folders', () => {
    expect(isHiddenPath('/home/u/workspace/perch', hidden)).toBe(false);
  });

  it('hides nothing when the names list is empty', () => {
    expect(isHiddenPath('/home/u/workspace/secret-proj', [])).toBe(false);
  });
});
