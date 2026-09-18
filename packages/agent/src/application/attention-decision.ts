import type { WorkspaceStatus } from '@perch/contracts';

// What to do with the session's deferral mark: `set` it, `clear` it, or leave it alone.
type Deferral = 'set' | 'clear' | 'keep';

export interface AttentionDecision {
  // null = leave the current status untouched.
  status: WorkspaceStatus | null;
  deferral: Deferral;
}

// The Stop hook payload carries `background_tasks`: the tasks Claude is parked on, covering
// both backgrounded shells (`type: 'shell'`) and background subagents (`type: 'subagent'`).
// It is undocumented, so read it defensively — anything unexpected means "no running task",
// which lands on `needs-feedback`, i.e. the behaviour Perch had before this feature.
function hasRunningBackgroundTask(claude: unknown): boolean {
  if (typeof claude !== 'object' || claude === null) return false;
  const tasks = (claude as { background_tasks?: unknown }).background_tasks;
  if (!Array.isArray(tasks)) return false;
  return tasks.some(
    (task) =>
      typeof task === 'object' &&
      task !== null &&
      (task as { status?: unknown }).status === 'running',
  );
}

function isIdlePrompt(claude: unknown): boolean {
  if (typeof claude !== 'object' || claude === null) return false;
  return (claude as { notification_type?: unknown }).notification_type === 'idle_prompt';
}

// `agent_id`/`agent_type` are set on a tool call's payload only when the call belongs to a
// subagent. Subagent tool calls fire in the *parent* session, so treating them as the parent
// working overwrites whatever the parent is actually doing — including a "Needs you" raised
// while it sits blocked on a question.
function isSubagentToolCall(claude: unknown): boolean {
  if (typeof claude !== 'object' || claude === null) return false;
  return typeof (claude as { agent_id?: unknown }).agent_id === 'string';
}

// Claude blocks indefinitely on these waiting for the user to pick an option, and (unlike a
// permission prompt) they carry no reliable notification of their own on every version.
const BLOCKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

function isBlockingTool(claude: unknown): boolean {
  if (typeof claude !== 'object' || claude === null) return false;
  const name = (claude as { tool_name?: unknown }).tool_name;
  return typeof name === 'string' && BLOCKING_TOOLS.has(name);
}

export function attentionDecision(input: {
  event: string;
  claude?: unknown;
  wasDeferred: boolean;
}): AttentionDecision {
  switch (input.event) {
    case 'Stop':
      return hasRunningBackgroundTask(input.claude)
        ? { status: null, deferral: 'set' }
        : { status: 'needs-feedback', deferral: 'clear' };
    case 'Notification':
      // Claude Code emits an idle_prompt 60s after every Stop — even while a background task
      // is still running. Letting it through would undo the deferral a minute later and
      // defeat the feature. Every other notification (a permission prompt) still gets through.
      return isIdlePrompt(input.claude) && input.wasDeferred
        ? { status: null, deferral: 'keep' }
        : { status: 'needs-feedback', deferral: 'clear' };
    case 'UserPromptSubmit':
      return { status: 'working', deferral: 'clear' };
    // A background subagent's own tool calls fire these in the parent session after its Stop,
    // so they must not clear the deferral — and must not speak for the parent's status at all.
    case 'PreToolUse':
    case 'PostToolUse':
      if (isSubagentToolCall(input.claude)) return { status: null, deferral: 'keep' };
      if (input.event === 'PreToolUse' && isBlockingTool(input.claude)) {
        return { status: 'needs-feedback', deferral: 'clear' };
      }
      return { status: 'working', deferral: 'keep' };
    default:
      return { status: null, deferral: 'keep' };
  }
}
