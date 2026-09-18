import { describe, it, expect } from 'vitest';
import { PWA_CORE_VERSION } from './version';

describe('@perch/pwa core', () => {
  it('exposes a numeric core version', () => {
    expect(PWA_CORE_VERSION).toBe(1);
  });
});
