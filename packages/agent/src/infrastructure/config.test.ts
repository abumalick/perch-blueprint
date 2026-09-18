import { describe, it, expect } from 'vitest';
import { loadConfig, assertServerConfig } from './config';

const base = { PERCH_MACHINE_ID: 'mini', PERCH_TOKEN: 'secret' };

describe('loadConfig', () => {
  it('applies defaults from the home directory', () => {
    const cfg = loadConfig(base, '/home/u');
    expect(cfg).toEqual({
      machineId: 'mini',
      token: 'secret',
      host: '127.0.0.1',
      port: 8787,
      projectRoots: ['/home/u/workspace'],
      recentStorePath: '/home/u/.perch/recent.json',
      statusStorePath: '/home/u/.perch/status.json',
      hiddenFoldersPath: '/home/u/.perch/hidden-folders.json',
      commandsPath: '/home/u/.perch/commands.json',
      clientLogPath: '/home/u/.perch/client-log.jsonl',
      workspaceLogPath: '/home/u/.perch/workspace-log.jsonl',
      parkedStorePath: '/home/u/.perch/parked.json',
      claudeSessionsDir: '/home/u/.claude/sessions',
      sessionPrefix: 'perch-',
    });
  });

  it('parses colon-separated project roots', () => {
    const cfg = loadConfig({ ...base, PERCH_PROJECT_ROOTS: '/a:/b/c' }, '/home/u');
    expect(cfg.projectRoots).toEqual(['/a', '/b/c']);
  });

  it('reads host and port overrides', () => {
    const cfg = loadConfig({ ...base, PERCH_HOST: '0.0.0.0', PERCH_PORT: '9000' }, '/home/u');
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.port).toBe(9000);
  });

  it('does NOT require PERCH_TOKEN (CLI usage)', () => {
    const cfg = loadConfig({ PERCH_MACHINE_ID: 'mini' }, '/home/u');
    expect(cfg.token).toBeUndefined();
  });

  it('throws when PERCH_MACHINE_ID is missing', () => {
    expect(() => loadConfig({ PERCH_TOKEN: 'secret' }, '/home/u')).toThrow(/PERCH_MACHINE_ID/);
  });

  it('throws when PERCH_PORT is not a number', () => {
    expect(() => loadConfig({ ...base, PERCH_PORT: 'abc' }, '/home/u')).toThrow(/PERCH_PORT/);
  });
});

describe('assertServerConfig', () => {
  it('passes when a token is present', () => {
    expect(() => assertServerConfig(loadConfig(base, '/home/u'))).not.toThrow();
  });

  it('throws when the token is missing', () => {
    expect(() => assertServerConfig(loadConfig({ PERCH_MACHINE_ID: 'mini' }, '/home/u'))).toThrow(
      /PERCH_TOKEN/,
    );
  });
});
