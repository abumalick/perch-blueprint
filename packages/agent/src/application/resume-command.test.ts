import { describe, it, expect } from 'vitest';
import { resumeCommand } from './resume-command';

describe('resumeCommand', () => {
  it('returns the command unchanged when there is no session id', () => {
    expect(resumeCommand('claude --model opus', undefined)).toBe('claude --model opus');
  });

  it('appends --resume with the session id, preserving existing flags', () => {
    expect(resumeCommand('claude --model opus', 'abc-123')).toBe(
      'claude --model opus --resume abc-123 || exec claude --model opus',
    );
  });

  it('falls back to the original command so a stale session id cannot destroy the workspace', () => {
    expect(resumeCommand('claude', 'abc-123')).toBe('claude --resume abc-123 || exec claude');
  });

  it('replaces an existing --resume value rather than appending a second one', () => {
    expect(resumeCommand('claude --resume old-id --model opus', 'new-id')).toBe(
      'claude --model opus --resume new-id || exec claude --model opus',
    );
  });

  it("keeps the model's shell quoting intact on both arms", () => {
    // The PWA quotes the model (`opus[1m]` is a glob under the login shell tmux runs this
    // through). Rebuilding the command must not drop those quotes, or unparking dies where
    // creating worked.
    expect(resumeCommand("claude --model 'opus[1m]'", 'abc-123')).toBe(
      "claude --model 'opus[1m]' --resume abc-123 || exec claude --model 'opus[1m]'",
    );
  });

  it('leaves a non-Claude command untouched when there is no session id', () => {
    expect(resumeCommand('zsh', undefined)).toBe('zsh');
  });

  it('returns an empty command unchanged even with a session id, rather than emitting a malformed resume string', () => {
    expect(resumeCommand('', 'sess-1')).toBe('');
  });

  it('returns a whitespace-only command unchanged even with a session id', () => {
    expect(resumeCommand('   ', 'sess-1')).toBe('   ');
  });
});
