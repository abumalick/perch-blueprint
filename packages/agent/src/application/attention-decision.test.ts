import { describe, it, expect } from 'vitest';
import { attentionDecision } from './attention-decision';

// Payloads shaped like a real `claude` 2.1.210 run's; ids are placeholders.
const runningShell = {
  background_tasks: [
    {
      id: 'b00000001',
      type: 'shell',
      status: 'running',
      description: 'Sleep for 300 seconds',
      command: 'sleep 300',
    },
  ],
};
const runningSubagent = {
  background_tasks: [
    {
      id: 'a0000000000000001',
      type: 'subagent',
      status: 'running',
      description: 'Run sleep 240',
      agent_type: 'general-purpose',
    },
  ],
};
const idlePrompt = {
  notification_type: 'idle_prompt',
  message: 'Claude is waiting for your input',
};
// A subagent's tool call, shaped like a real `claude` 2.1.215 payload. `agent_id` and
// `agent_type` are present only when the call belongs to a subagent, never on the main loop's own.
const subagentToolCall = {
  tool_name: 'WebFetch',
  agent_id: 'a0000000000000002',
  agent_type: 'claude-code-guide',
  session_id: '00000000-0000-4000-8000-000000000001',
};

describe('attentionDecision', () => {
  describe('Stop', () => {
    it('defers while a backgrounded shell is still running', () => {
      expect(attentionDecision({ event: 'Stop', claude: runningShell, wasDeferred: false })).toEqual({
        status: null,
        deferral: 'set',
      });
    });

    it('defers while a background subagent is still running', () => {
      expect(attentionDecision({ event: 'Stop', claude: runningSubagent, wasDeferred: false })).toEqual({
        status: null,
        deferral: 'set',
      });
    });

    it('needs feedback when no background task is running', () => {
      expect(
        attentionDecision({ event: 'Stop', claude: { background_tasks: [] }, wasDeferred: true }),
      ).toEqual({ status: 'needs-feedback', deferral: 'clear' });
    });

    it('needs feedback when a background task has finished rather than running', () => {
      const done = { background_tasks: [{ id: 'x', type: 'shell', status: 'completed' }] };
      expect(attentionDecision({ event: 'Stop', claude: done, wasDeferred: false })).toEqual({
        status: 'needs-feedback',
        deferral: 'clear',
      });
    });

    // background_tasks is undocumented; if it ever disappears or an old hook script sends
    // nothing, fall back to today's behaviour rather than to silence.
    it.each([
      ['absent', undefined],
      ['null', null],
      ['malformed', { background_tasks: 'nope' }],
    ])('needs feedback when the payload is %s', (_label, claude) => {
      expect(attentionDecision({ event: 'Stop', claude, wasDeferred: false })).toEqual({
        status: 'needs-feedback',
        deferral: 'clear',
      });
    });
  });

  describe('Notification', () => {
    it('ignores the 60s idle prompt on a deferred session', () => {
      expect(attentionDecision({ event: 'Notification', claude: idlePrompt, wasDeferred: true })).toEqual({
        status: null,
        deferral: 'keep',
      });
    });

    it('needs feedback for an idle prompt when the session is not deferred', () => {
      expect(attentionDecision({ event: 'Notification', claude: idlePrompt, wasDeferred: false })).toEqual({
        status: 'needs-feedback',
        deferral: 'clear',
      });
    });

    // A permission prompt is the highest-value alert Perch has — it must never be swallowed,
    // even while background work is pending.
    it('needs feedback for a permission prompt even on a deferred session', () => {
      const permission = {
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use Bash',
      };
      expect(attentionDecision({ event: 'Notification', claude: permission, wasDeferred: true })).toEqual({
        status: 'needs-feedback',
        deferral: 'clear',
      });
    });

    it('needs feedback for a notification with no payload', () => {
      expect(attentionDecision({ event: 'Notification', claude: undefined, wasDeferred: true })).toEqual({
        status: 'needs-feedback',
        deferral: 'clear',
      });
    });
  });

  describe('other events', () => {
    it('clears the deferral when the user submits a new prompt', () => {
      expect(attentionDecision({ event: 'UserPromptSubmit', claude: undefined, wasDeferred: true })).toEqual({
        status: 'working',
        deferral: 'clear',
      });
    });

    // A background subagent's own tool calls fire these in the parent session after its Stop.
    // Clearing here would let the 60s idle_prompt through and defeat the feature.
    it.each(['PreToolUse', 'PostToolUse'])('keeps the deferral on %s', (event) => {
      expect(attentionDecision({ event, claude: undefined, wasDeferred: true })).toEqual({
        status: 'working',
        deferral: 'keep',
      });
    });

    // A subagent's tool calls fire in the parent session while the main loop may be blocked on
    // a question. Stamping `working` there silently overwrites the `needs-feedback` the block
    // just raised, which is what left workspaces stuck on `working` with a prompt on screen.
    it.each(['PreToolUse', 'PostToolUse'])(
      'leaves the status alone on %s from a subagent',
      (event) => {
        expect(attentionDecision({ event, claude: subagentToolCall, wasDeferred: false })).toEqual({
          status: null,
          deferral: 'keep',
        });
      },
    );

    it.each(['PreToolUse', 'PostToolUse'])(
      'still reports working on %s from the main loop',
      (event) => {
        const ownToolCall = { tool_name: 'Bash', session_id: 'abc' };
        expect(attentionDecision({ event, claude: ownToolCall, wasDeferred: false })).toEqual({
          status: 'working',
          deferral: 'keep',
        });
      },
    );
  });

  // Claude blocks indefinitely on these two tools waiting for the user to pick an option, and
  // never auto-times-out. Reading the tool name makes the block visible immediately rather than
  // depending on the `permission_prompt` Notification that trails it by a few seconds.
  describe('blocked on a user decision', () => {
    it.each(['AskUserQuestion', 'ExitPlanMode'])('needs feedback when %s is called', (tool) => {
      expect(
        attentionDecision({ event: 'PreToolUse', claude: { tool_name: tool }, wasDeferred: true }),
      ).toEqual({ status: 'needs-feedback', deferral: 'clear' });
    });

    it('reports working again once the user has answered', () => {
      expect(
        attentionDecision({
          event: 'PostToolUse',
          claude: { tool_name: 'AskUserQuestion' },
          wasDeferred: false,
        }),
      ).toEqual({ status: 'working', deferral: 'keep' });
    });

    // A subagent asking its own question must not speak for the parent session.
    it('ignores AskUserQuestion raised inside a subagent', () => {
      expect(
        attentionDecision({
          event: 'PreToolUse',
          claude: { tool_name: 'AskUserQuestion', agent_id: 'a1b3', agent_type: 'explorer' },
          wasDeferred: false,
        }),
      ).toEqual({ status: null, deferral: 'keep' });
    });

    it('leaves everything untouched for an unmapped event', () => {
      expect(attentionDecision({ event: 'SomethingElse', claude: undefined, wasDeferred: true })).toEqual({
        status: null,
        deferral: 'keep',
      });
    });
  });

  // The whole point of the feature: a session parked on a background subagent must survive
  // both the subagent's own tool chatter and the 60s idle prompt without shouting "Needs you".
  it('stays quiet across Stop -> subagent tool calls -> idle prompt', () => {
    expect(attentionDecision({ event: 'Stop', claude: runningSubagent, wasDeferred: false }).deferral).toBe('set');
    expect(attentionDecision({ event: 'PreToolUse', claude: undefined, wasDeferred: true }).deferral).toBe('keep');
    expect(attentionDecision({ event: 'Notification', claude: idlePrompt, wasDeferred: true })).toEqual({
      status: null,
      deferral: 'keep',
    });
  });
});
