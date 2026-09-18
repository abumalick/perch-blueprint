import { describe, it, expect } from 'vitest';
import { ensureUtf8Locale } from './ensure-utf8-locale';

describe('ensureUtf8Locale', () => {
  it('sets LANG when no locale var is present (launchd services)', () => {
    const env: Record<string, string | undefined> = {};
    ensureUtf8Locale(env);
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('leaves an existing UTF-8 LANG untouched', () => {
    const env: Record<string, string | undefined> = { LANG: 'fr_FR.UTF-8' };
    ensureUtf8Locale(env);
    expect(env.LANG).toBe('fr_FR.UTF-8');
  });

  it('accepts the utf8 spelling', () => {
    const env: Record<string, string | undefined> = { LANG: 'en_US.utf8' };
    ensureUtf8Locale(env);
    expect(env.LANG).toBe('en_US.utf8');
  });

  it('respects a UTF-8 LC_ALL even without LANG', () => {
    const env: Record<string, string | undefined> = { LC_ALL: 'en_US.UTF-8' };
    ensureUtf8Locale(env);
    expect(env.LANG).toBeUndefined();
    expect(env.LC_ALL).toBe('en_US.UTF-8');
  });

  it('upgrades a C locale', () => {
    const env: Record<string, string | undefined> = { LANG: 'C' };
    ensureUtf8Locale(env);
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('clears a non-UTF-8 LC_ALL/LC_CTYPE that would override the LANG fallback', () => {
    const env: Record<string, string | undefined> = { LC_ALL: 'C', LC_CTYPE: 'POSIX' };
    ensureUtf8Locale(env);
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBeUndefined();
    expect(env.LC_CTYPE).toBeUndefined();
  });

  it('honors LC_ALL precedence: UTF-8 LC_ALL wins over a C LANG', () => {
    const env: Record<string, string | undefined> = { LC_ALL: 'en_US.UTF-8', LANG: 'C' };
    ensureUtf8Locale(env);
    expect(env.LANG).toBe('C');
    expect(env.LC_ALL).toBe('en_US.UTF-8');
  });
});
