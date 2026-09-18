import { describe, it, expect } from 'vitest';
import { installHooks } from './install-hooks';

const HOOK_COMMAND = 'bash ~/.perch/perch-hook.sh';

describe('installHooks', () => {
  it('adds Stop, Notification, UserPromptSubmit, PreToolUse, and PostToolUse hook entries', () => {
    const result = installHooks({ settings: {} }, { hookCommand: HOOK_COMMAND, port: 8787 });
    const hooks = result.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    expect(Object.keys(hooks).sort()).toEqual([
      'Notification',
      'PostToolUse',
      'PreToolUse',
      'Stop',
      'UserPromptSubmit',
    ]);
    expect(hooks.Stop?.[0]?.hooks?.[0]?.command).toBe(`${HOOK_COMMAND} Stop 8787`);
    expect(hooks.Notification?.[0]?.hooks?.[0]?.command).toBe(`${HOOK_COMMAND} Notification 8787`);
    expect(hooks.PreToolUse?.[0]?.hooks?.[0]?.command).toBe(`${HOOK_COMMAND} PreToolUse 8787`);
    expect(hooks.PostToolUse?.[0]?.hooks?.[0]?.command).toBe(`${HOOK_COMMAND} PostToolUse 8787`);
  });

  it('registers a portable command with no absolute machine-specific repo path', () => {
    const result = installHooks({ settings: {} }, { hookCommand: HOOK_COMMAND, port: 8787 });
    const hooks = result.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    for (const event of ['Stop', 'Notification', 'UserPromptSubmit']) {
      const command = hooks[event]?.[0]?.hooks?.[0]?.command ?? '';
      expect(command).not.toMatch(/\/(Users|home)\//);
      expect(command).not.toContain('/workspace/');
      expect(command).toContain('~/.perch/perch-hook.sh');
    }
  });

  it('is idempotent — re-running does not duplicate entries', () => {
    const once = installHooks({ settings: {} }, { hookCommand: HOOK_COMMAND, port: 8787 });
    const twice = installHooks({ settings: once }, { hookCommand: HOOK_COMMAND, port: 8787 });
    const hooks = twice.hooks as Record<string, unknown[]>;
    expect(hooks.Stop).toHaveLength(1);
    expect(hooks.Notification).toHaveLength(1);
  });

  it('replaces a legacy absolute-path Perch entry with the portable command', () => {
    const existing = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: 'bash /Users/u/workspace/perch/packages/agent/src/hooks/perch-hook.sh Stop 8787',
              },
            ],
          },
        ],
      },
    };
    const result = installHooks({ settings: existing }, { hookCommand: HOOK_COMMAND, port: 8787 });
    const hooks = result.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    expect(hooks.Stop).toHaveLength(1);
    expect(hooks.Stop?.[0]?.hooks?.[0]?.command).toBe(`${HOOK_COMMAND} Stop 8787`);
  });

  it('preserves unrelated existing settings and non-Perch hooks', () => {
    const existing = {
      model: 'claude-opus',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/notify.sh' }] }],
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
      },
    };
    const result = installHooks({ settings: existing }, { hookCommand: HOOK_COMMAND, port: 8787 });
    expect(result.model).toBe('claude-opus');
    const hooks = result.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    // PreToolUse is now a Perch event too: the unrelated `echo hi` is kept and the
    // Perch entry is appended.
    expect(hooks.PreToolUse).toHaveLength(2);
    expect(hooks.PreToolUse?.some((e) => e.hooks[0]?.command === 'echo hi')).toBe(true);
    expect(hooks.PreToolUse?.some((e) => e.hooks[0]?.command === `${HOOK_COMMAND} PreToolUse 8787`)).toBe(true);
    // The unrelated notify.sh hook is kept; the Perch entry is appended.
    expect(hooks.Stop).toHaveLength(2);
    expect(hooks.Stop?.some((e) => e.hooks[0]?.command === '~/.claude/hooks/notify.sh')).toBe(true);
    expect(hooks.Stop?.some((e) => e.hooks[0]?.command === `${HOOK_COMMAND} Stop 8787`)).toBe(true);
  });
});
