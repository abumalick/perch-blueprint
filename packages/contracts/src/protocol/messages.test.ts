import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  parseAgentMessage,
  workspaceSchema,
} from './messages';
import type { Workspace } from '../domain/workspace';

const sampleWorkspace: Workspace = {
  machineId: 'mini',
  id: 'perch-ab12cd',
  name: 'perch',
  projectPath: '/home/u/workspace/perch',
  command: 'claude',
  createdAt: 1_700_000_000_000,
  lastActivityAt: 1_700_000_001_000,
  status: 'needs-feedback',
};

describe('clientMessageSchema', () => {
  it('parses a valid attach message', () => {
    const msg = parseClientMessage({ type: 'attach', workspaceId: 'perch-ab12cd', cols: 80, rows: 24 });
    expect(msg).toEqual({ type: 'attach', workspaceId: 'perch-ab12cd', cols: 80, rows: 24 });
  });

  it('parses create without a machineId', () => {
    expect(parseClientMessage({ type: 'create', projectPath: '/p', command: 'claude' })).toEqual({
      type: 'create',
      projectPath: '/p',
      command: 'claude',
    });
  });

  it('rejects an unknown message type', () => {
    expect(() => parseClientMessage({ type: 'frobnicate' })).toThrow();
  });

  it('parses a listCommands message', () => {
    expect(parseClientMessage({ type: 'listCommands' })).toEqual({ type: 'listCommands' });
  });

  it('rejects non-positive terminal dimensions', () => {
    expect(() => parseClientMessage({ type: 'attach', workspaceId: 'x', cols: 0, rows: 24 })).toThrow();
  });

  it('rejects non-positive resize dimensions', () => {
    expect(() => parseClientMessage({ type: 'resize', workspaceId: 'x', cols: 0, rows: 24 })).toThrow();
  });

  it('parses a readFile message', () => {
    expect(parseClientMessage({ type: 'readFile', path: '/p/a.txt' })).toEqual({
      type: 'readFile',
      path: '/p/a.txt',
    });
  });

  it('parses a setStatus message', () => {
    expect(parseClientMessage({ type: 'setStatus', workspaceId: 'perch-ab12cd', status: 'blocked' })).toEqual({
      type: 'setStatus',
      workspaceId: 'perch-ab12cd',
      status: 'blocked',
    });
  });

  it('rejects a setStatus message with an unknown status', () => {
    expect(() =>
      parseClientMessage({ type: 'setStatus', workspaceId: 'perch-ab12cd', status: 'busy' }),
    ).toThrow();
  });

  it('parses a setUrgent message', () => {
    expect(parseClientMessage({ type: 'setUrgent', workspaceId: 'perch-ab12cd', urgent: true })).toEqual({
      type: 'setUrgent',
      workspaceId: 'perch-ab12cd',
      urgent: true,
    });
  });

  it('rejects a setUrgent message with a non-boolean urgent', () => {
    expect(() =>
      parseClientMessage({ type: 'setUrgent', workspaceId: 'perch-ab12cd', urgent: 'yes' }),
    ).toThrow();
  });

  it('parses a listRoots message', () => {
    expect(parseClientMessage({ type: 'listRoots' })).toEqual({ type: 'listRoots' });
  });

  it('parses a makeDir message', () => {
    expect(parseClientMessage({ type: 'makeDir', parent: '/p', name: 'new-folder' })).toEqual({
      type: 'makeDir',
      parent: '/p',
      name: 'new-folder',
    });
  });

  it('parses a putFile message', () => {
    const msg = { type: 'putFile', workspaceId: 'perch-a', name: 'pasted-image.png', data: 'AAAA' };
    expect(parseClientMessage(msg)).toEqual(msg);
  });

  it('parses a ping message', () => {
    expect(parseClientMessage({ type: 'ping' })).toEqual({ type: 'ping' });
  });

  it('parses a startBrowser message', () => {
    expect(parseClientMessage({ type: 'startBrowser', workspaceId: 'perch-ab12cd' })).toEqual({
      type: 'startBrowser',
      workspaceId: 'perch-ab12cd',
    });
  });

  it('rejects the removed authed-browser messages', () => {
    // The shared `authed` session was dropped for per-site `--restore` sessions; the
    // protocol no longer carries them.
    expect(() => parseClientMessage({ type: 'startAuthedBrowser' })).toThrow();
    expect(() => parseClientMessage({ type: 'saveAuthedBrowser' })).toThrow();
  });
});

describe('agentMessageSchema', () => {
  it('parses a fileStored message', () => {
    const msg = { type: 'fileStored', workspaceId: 'perch-a', path: '.tmp/files/pasted-image.png' };
    expect(parseAgentMessage(msg)).toEqual(msg);
  });

  it('parses a workspaces snapshot', () => {
    const msg = parseAgentMessage({ type: 'workspaces', workspaces: [sampleWorkspace] });
    expect(msg).toEqual({ type: 'workspaces', workspaces: [sampleWorkspace] });
  });

  it('parses dirEntries with subdirs and files', () => {
    const msg = parseAgentMessage({
      type: 'dirEntries',
      path: '/p',
      subdirs: ['/p/src'],
      files: ['/p/README.md'],
    });
    expect(msg).toEqual({ type: 'dirEntries', path: '/p', subdirs: ['/p/src'], files: ['/p/README.md'] });
  });

  it('defaults dirEntries files to [] when an older agent omits them', () => {
    expect(parseAgentMessage({ type: 'dirEntries', path: '/p', subdirs: ['/p/a'] })).toEqual({
      type: 'dirEntries',
      path: '/p',
      subdirs: ['/p/a'],
      files: [],
    });
  });

  it('parses a roots message', () => {
    expect(parseAgentMessage({ type: 'roots', roots: ['/home/u/workspace', '/srv/code'] })).toEqual({
      type: 'roots',
      roots: ['/home/u/workspace', '/srv/code'],
    });
  });

  it('defaults roots to [] when an older agent omits them', () => {
    expect(parseAgentMessage({ type: 'roots' })).toEqual({ type: 'roots', roots: [] });
  });

  it('parses a commands message', () => {
    expect(
      parseAgentMessage({
        type: 'commands',
        commands: [{ command: '/myplugin:task' }, { command: '/rename', submit: true }],
      }),
    ).toEqual({
      type: 'commands',
      commands: [
        { command: '/myplugin:task', submit: false },
        { command: '/rename', submit: true },
      ],
    });
  });

  it('defaults commands to [] when an older agent omits them', () => {
    expect(parseAgentMessage({ type: 'commands' })).toEqual({ type: 'commands', commands: [] });
  });

  it('parses a fileContents message', () => {
    expect(
      parseAgentMessage({ type: 'fileContents', path: '/p/a.txt', data: 'aGk=', truncated: true, binary: false }),
    ).toEqual({ type: 'fileContents', path: '/p/a.txt', data: 'aGk=', truncated: true, binary: false });
  });

  it('defaults fileContents truncated/binary when an older agent omits them', () => {
    expect(parseAgentMessage({ type: 'fileContents', path: '/p/a.txt', data: 'aGk=' })).toEqual({
      type: 'fileContents',
      path: '/p/a.txt',
      data: 'aGk=',
      truncated: false,
      binary: false,
    });
  });

  it('parses a detached message with a known reason', () => {
    const msg = parseAgentMessage({ type: 'detached', workspaceId: 'x', reason: 'opened-elsewhere' });
    expect(msg.type).toBe('detached');
  });

  it('rejects a detached message with an unknown reason', () => {
    expect(() => parseAgentMessage({ type: 'detached', workspaceId: 'x', reason: 'nope' })).toThrow();
  });

  it('parses a pong message', () => {
    expect(parseAgentMessage({ type: 'pong' })).toEqual({ type: 'pong' });
  });

  it('parses a browserSessions message', () => {
    expect(parseAgentMessage({ type: 'browserSessions', sessions: [{ name: 'perch-ab12cd' }] })).toEqual({
      type: 'browserSessions',
      sessions: [{ name: 'perch-ab12cd' }],
    });
  });

  it('defaults browserSessions sessions to [] when omitted', () => {
    expect(parseAgentMessage({ type: 'browserSessions' })).toEqual({ type: 'browserSessions', sessions: [] });
  });
});

describe('workspaceSchema', () => {
  it('rejects an invalid status', () => {
    expect(() => workspaceSchema.parse({ ...sampleWorkspace, status: 'busy' })).toThrow();
  });

  it('rejects a legacy attention/blocked workspace with no status (clean break)', () => {
    const { status: _omit, ...legacy } = sampleWorkspace;
    expect(() => workspaceSchema.parse({ ...legacy, attention: 'needs-feedback', blocked: false })).toThrow();
  });

  it('parses a workspace without github (optional field)', () => {
    expect(workspaceSchema.parse(sampleWorkspace)).toEqual(sampleWorkspace);
    expect(workspaceSchema.parse(sampleWorkspace).github).toBeUndefined();
  });

  it('parses a workspace with a github owner/repo', () => {
    const gh = { ...sampleWorkspace, github: { owner: 'someuser', repo: 'perch' } };
    expect(workspaceSchema.parse(gh)).toEqual(gh);
  });

  it('rejects a malformed github field', () => {
    expect(() => workspaceSchema.parse({ ...sampleWorkspace, github: { owner: 'someuser' } })).toThrow();
  });

  it('parses a workspace without urgent (optional field)', () => {
    expect(workspaceSchema.parse(sampleWorkspace).urgent).toBeUndefined();
  });

  it('parses a workspace with urgent set', () => {
    const urgent = { ...sampleWorkspace, urgent: true };
    expect(workspaceSchema.parse(urgent)).toEqual(urgent);
  });

  it('rejects a non-boolean urgent field', () => {
    expect(() => workspaceSchema.parse({ ...sampleWorkspace, urgent: 'yes' })).toThrow();
  });

  // The compile-time Equals guard cannot catch a field the schema is missing: a type without
  // an optional key stays assignable both ways, so the drift typechecks. Only a parse proves
  // the field survives the wire — zod strips unknown keys, so a schema omission silently
  // deletes an agent-sent field rather than failing anywhere.
  it('parses a workspace with an agent address', () => {
    const addressed = { ...sampleWorkspace, agentAddress: 'perch-be' };
    expect(workspaceSchema.parse(addressed)).toEqual(addressed);
  });

  it('parses a workspace without an agent address (optional field)', () => {
    expect(workspaceSchema.parse(sampleWorkspace).agentAddress).toBeUndefined();
  });

  it('rejects a non-string agent address', () => {
    expect(() => workspaceSchema.parse({ ...sampleWorkspace, agentAddress: 42 })).toThrow();
  });
});
