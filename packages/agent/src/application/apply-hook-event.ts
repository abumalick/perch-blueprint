import type { WorkspaceStatus } from '@perch/contracts';
import type { StatusStorePort } from '../ports/status-store-port';
import { attentionDecision } from './attention-decision';

// Claude Code sends `session_id` on every hook event's payload. Read it defensively (the
// payload is `unknown`) — a missing or malformed field means "leave the last known value
// alone," never "clear it."
function extractSessionId(claude: unknown): string | undefined {
  if (typeof claude !== 'object' || claude === null) return undefined;
  const id = (claude as { session_id?: unknown }).session_id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

// `deferred` holds the sessions parked on background work, so the idle notification that
// follows their Stop can be told apart from a genuine one. Deliberately in-memory: losing it
// on restart costs at most one extra "Needs you", never a missed one.
export function applyHookEvent(
  deps: { store: Pick<StatusStorePort, 'set' | 'setClaudeSessionId'>; deferred: Set<string> },
  input: { sessionName: string; event: string; claude?: unknown },
): { workspaceId: string; status: WorkspaceStatus } | null {
  const sessionId = extractSessionId(input.claude);
  if (sessionId) {
    deps.store.setClaudeSessionId(input.sessionName, sessionId);
  }

  const decision = attentionDecision({
    event: input.event,
    claude: input.claude,
    wasDeferred: deps.deferred.has(input.sessionName),
  });

  if (decision.deferral === 'set') {
    deps.deferred.add(input.sessionName);
  } else if (decision.deferral === 'clear') {
    deps.deferred.delete(input.sessionName);
  }

  if (!decision.status) {
    return null;
  }
  deps.store.set(input.sessionName, decision.status);
  return { workspaceId: input.sessionName, status: decision.status };
}
