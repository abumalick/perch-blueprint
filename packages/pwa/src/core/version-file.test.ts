import { describe, it, expect } from 'vitest';
import {
  buildVersionJson,
  parseVersionJson,
  VERSION_FILE,
} from './version-file';

describe('version-file', () => {
  it('serializes the build label and id as JSON the app can read back', () => {
    const parsed = JSON.parse(buildVersionJson('feat-x', '1751049600000'));
    expect(parsed).toEqual({ label: 'feat-x', buildId: '1751049600000' });
  });

  it('exposes the file name served at the site root', () => {
    expect(VERSION_FILE).toBe('version.json');
  });

  describe('parseVersionJson', () => {
    it('reads back the label and buildId from a valid payload', () => {
      const data = JSON.parse(buildVersionJson('main', '42'));
      expect(parseVersionJson(data)).toEqual({ label: 'main', buildId: '42' });
    });

    it('returns nulls for missing fields', () => {
      expect(parseVersionJson({})).toEqual({ label: null, buildId: null });
      expect(parseVersionJson({ label: 'main' })).toEqual({ label: 'main', buildId: null });
    });

    it('returns nulls for non-string fields or a non-object input', () => {
      expect(parseVersionJson({ label: 1, buildId: {} })).toEqual({ label: null, buildId: null });
      expect(parseVersionJson(null)).toEqual({ label: null, buildId: null });
      expect(parseVersionJson('nope')).toEqual({ label: null, buildId: null });
    });
  });
});
