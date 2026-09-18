import { z } from 'zod';
import { WORKSPACE_STATUSES, type WorkspaceStatus } from '../domain/workspace-status';
import type { Workspace } from '../domain/workspace';

const workspaceStatusSchema = z.enum(
  WORKSPACE_STATUSES as unknown as [WorkspaceStatus, ...WorkspaceStatus[]],
);

export const workspaceSchema = z.object({
  machineId: z.string(),
  id: z.string(),
  name: z.string(),
  projectPath: z.string(),
  command: z.string(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
  status: workspaceStatusSchema,
  // Optional GitHub owner/repo (parsed from the origin remote by the agent). `.optional()`
  // keeps a version-skewed rollout safe: an old agent omits it, a new one includes it.
  github: z
    .object({ owner: z.string(), repo: z.string(), ownerType: z.enum(['user', 'org']).optional() })
    .optional(),
  // Manual "pin to top of its status group" flag. `.optional()` keeps a version-skewed
  // rollout safe: an old agent omits it and the PWA reads it as not-urgent.
  urgent: z.boolean().optional(),
  // The name Claude Code's session registry gives the session running in this workspace.
  // `.optional()` keeps a version-skewed rollout safe: an old agent omits it and the PWA
  // simply shows no badge. It must be declared here or zod strips it off the wire.
  agentAddress: z.string().optional(),
});

// Compile-time guarantee that the schema and the domain type stay in sync.
type Equals<A, B> = A extends B ? (B extends A ? true : false) : false;
const _workspaceMatchesDomain: Equals<z.infer<typeof workspaceSchema>, Workspace> = true;
void _workspaceMatchesDomain;

const dim = z.number().int().positive();

// A live agent-browser session on the agent's machine, viewable via the `/browser` stream
// socket (see browser-messages.ts).
export const browserSessionSchema = z.object({ name: z.string() });
export type BrowserSession = z.infer<typeof browserSessionSchema>;

// A shortcut the keyboard bar's command drop-down offers, read from the agent machine's
// ~/.perch/commands.json. `submit` sends Enter after the command (right for argument-less
// commands like /rename); otherwise the command lands in the prompt awaiting an argument.
export const commandEntrySchema = z.object({
  command: z.string(),
  submit: z.boolean().default(false),
});
export type CommandEntry = z.infer<typeof commandEntrySchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('list') }),
  z.object({ type: z.literal('getRecentPaths') }),
  z.object({ type: z.literal('browseDir'), path: z.string() }),
  // Create a new directory named `name` inside the already-browsed `parent`. The agent
  // authorizes it against the same allowed-roots set as browseDir, then replies with a
  // `dirEntries` for the new (empty) folder so the picker browses into it.
  z.object({ type: z.literal('makeDir'), parent: z.string(), name: z.string() }),
  z.object({ type: z.literal('listRoots') }),
  z.object({ type: z.literal('listCommands') }),
  z.object({ type: z.literal('readFile'), path: z.string() }),
  z.object({ type: z.literal('attach'), workspaceId: z.string(), cols: dim, rows: dim }),
  z.object({ type: z.literal('detach'), workspaceId: z.string() }),
  z.object({ type: z.literal('input'), workspaceId: z.string(), data: z.string() }),
  z.object({ type: z.literal('putFile'), workspaceId: z.string(), name: z.string(), data: z.string() }),
  z.object({ type: z.literal('resize'), workspaceId: z.string(), cols: dim, rows: dim }),
  z.object({ type: z.literal('create'), projectPath: z.string(), command: z.string() }),
  z.object({ type: z.literal('close'), workspaceId: z.string() }),
  z.object({ type: z.literal('setStatus'), workspaceId: z.string(), status: workspaceStatusSchema }),
  // Manually pin/unpin a workspace to the top of its status group. Orthogonal to setStatus;
  // the agent's onChange broadcasts the refreshed workspace to every device.
  z.object({ type: z.literal('setUrgent'), workspaceId: z.string(), urgent: z.boolean() }),
  // Start an agent-browser session named after the workspace. Old agents answer with their
  // generic unknown-message error; the PWA only offers this once the agent has proven
  // support by sending `browserSessions`.
  z.object({ type: z.literal('startBrowser'), workspaceId: z.string() }),
  // Liveness probe: the PWA pings periodically so it can detect a half-open socket that
  // never fires a `close` event (common on mobile) and force a reconnect. The agent answers
  // with `pong`.
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const detachReasonSchema = z.enum(['opened-elsewhere', 'closed', 'error']);
export type DetachReason = z.infer<typeof detachReasonSchema>;

export const agentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('authResult'), ok: z.boolean() }),
  z.object({ type: z.literal('workspaces'), workspaces: z.array(workspaceSchema) }),
  z.object({ type: z.literal('workspaceUpdated'), workspace: workspaceSchema }),
  z.object({ type: z.literal('recentPaths'), paths: z.array(z.string()) }),
  // The agent's configured project roots — the folder picker's top-level browse points.
  // `roots` is additive: older agents omit it, so it defaults to [] rather than letting the
  // strict client parser drop the whole message during a version-skewed rollout.
  z.object({ type: z.literal('roots'), roots: z.array(z.string()).default([]) }),
  // The agent machine's configured command shortcuts. `commands` is additive: older agents
  // omit it, so it defaults to [] rather than letting the strict client parser drop the
  // whole message during a version-skewed rollout.
  z.object({ type: z.literal('commands'), commands: z.array(commandEntrySchema).default([]) }),
  // `files` is additive: older agents that predate it omit the field, so it defaults to []
  // (a strictly-required field would make the strict client parser silently drop their
  // dirEntries during a version-skewed rollout, hanging the browser on "Loading…").
  z.object({ type: z.literal('dirEntries'), path: z.string(), subdirs: z.array(z.string()), files: z.array(z.string()).default([]) }),
  // `truncated`/`binary` are additive: older agents omit them, so they default to false (a
  // strictly-required field would make the strict client parser drop the whole message
  // during a version-skewed rollout).
  z.object({
    type: z.literal('fileContents'),
    path: z.string(),
    data: z.string(),
    truncated: z.boolean().default(false),
    binary: z.boolean().default(false),
  }),
  z.object({ type: z.literal('attached'), workspaceId: z.string() }),
  z.object({ type: z.literal('output'), workspaceId: z.string(), data: z.string() }),
  z.object({ type: z.literal('fileStored'), workspaceId: z.string(), path: z.string() }),
  z.object({ type: z.literal('detached'), workspaceId: z.string(), reason: detachReasonSchema }),
  z.object({ type: z.literal('closed'), workspaceId: z.string() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  // Live agent-browser sessions, sent after every `workspaces` reply. `sessions` defaults
  // to [] so a skewed sender omitting it can't make the strict client parser drop the
  // whole message.
  z.object({ type: z.literal('browserSessions'), sessions: z.array(browserSessionSchema).default([]) }),
  // Reply to the client's liveness `ping` (see clientMessageSchema).
  z.object({ type: z.literal('pong') }),
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export function parseClientMessage(raw: unknown): ClientMessage {
  return clientMessageSchema.parse(raw);
}

export function parseAgentMessage(raw: unknown): AgentMessage {
  return agentMessageSchema.parse(raw);
}
