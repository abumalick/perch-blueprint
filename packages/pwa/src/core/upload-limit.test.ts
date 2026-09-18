import { describe, it, expect } from 'vitest';
import { MAX_UPLOAD_BYTES, checkUploadSize } from './upload-limit';

describe('checkUploadSize', () => {
  it('accepts a file under the limit', () => {
    expect(checkUploadSize(1024)).toBeNull();
  });

  it('accepts a file exactly at the limit', () => {
    expect(checkUploadSize(MAX_UPLOAD_BYTES)).toBeNull();
  });

  it('rejects a file over the limit', () => {
    expect(checkUploadSize(MAX_UPLOAD_BYTES + 1)).toBe('File is too large to attach (20 MB max)');
  });

  it('accepts an empty file', () => {
    expect(checkUploadSize(0)).toBeNull();
  });
});
