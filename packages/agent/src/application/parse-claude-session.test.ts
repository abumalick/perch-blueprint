import { describe, it, expect } from 'vitest';
import { parseClaudeSession } from './parse-claude-session';

describe('parseClaudeSession', () => {
  it('reads the address and its tmux session name', () => {
    expect(
      parseClaudeSession({ name: 'perch-be', tmux: 'perch-bbb222:@2.%2', cwd: '/home/x/perch' }),
    ).toEqual({ tmuxSession: 'perch-bbb222', address: 'perch-be' });
  });

  // The registry is undocumented Claude Code internals, so every field is read defensively:
  // an entry we cannot join or cannot label is dropped rather than guessed at.
  it('returns null when the entry is not an object', () => {
    expect(parseClaudeSession('perch-be')).toBeNull();
    expect(parseClaudeSession(null)).toBeNull();
  });

  it('returns null when name or tmux is missing, empty, or not a string', () => {
    expect(parseClaudeSession({ tmux: 'perch-bbb222:@2.%2' })).toBeNull();
    expect(parseClaudeSession({ name: 'perch-be' })).toBeNull();
    expect(parseClaudeSession({ name: '', tmux: 'perch-bbb222:@2.%2' })).toBeNull();
    expect(parseClaudeSession({ name: 'perch-be', tmux: 42 })).toBeNull();
  });

  // A session started outside tmux has no session name to join on, so it can never match a
  // workspace — dropping it here keeps the caller's map free of unjoinable noise.
  it('returns null when tmux carries no session name', () => {
    expect(parseClaudeSession({ name: 'perch-be', tmux: ':@2.%2' })).toBeNull();
  });

  // The pane/window suffix is not part of the join key: the workspace id is the tmux session
  // name alone.
  it('keeps only the session name when there is no pane suffix', () => {
    expect(parseClaudeSession({ name: 'perch-be', tmux: 'perch-bbb222' })).toEqual({
      tmuxSession: 'perch-bbb222',
      address: 'perch-be',
    });
  });
});
