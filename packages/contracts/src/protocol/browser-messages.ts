import { z } from 'zod';

// Wire protocol for the per-viewer browser stream socket (`GET /browser?session=<name>`
// on the agent). Input messages are validated here, then forwarded verbatim to the
// upstream agent-browser stream server, so field shapes mirror its CDP-flavored events.

const modifiers = z.number().int().optional();

export const browserClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  // Liveness probe, same pattern as the main terminal socket.
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('input_mouse'),
    eventType: z.string(),
    x: z.number(),
    y: z.number(),
    button: z.string().optional(),
    clickCount: z.number().int().optional(),
    deltaX: z.number().optional(),
    deltaY: z.number().optional(),
    modifiers,
  }),
  z.object({
    type: z.literal('input_keyboard'),
    eventType: z.string(),
    key: z.string().optional(),
    code: z.string().optional(),
    text: z.string().optional(),
    modifiers,
  }),
  z.object({
    type: z.literal('input_touch'),
    eventType: z.string(),
    touchPoints: z.array(z.object({ x: z.number(), y: z.number() }).passthrough()),
    modifiers,
  }),
  // Handled by the agent (CLI navigation/session control), never forwarded upstream.
  z.object({ type: z.literal('navigate'), url: z.string() }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('forward') }),
  z.object({ type: z.literal('closeSession') }),
  // Resize the remote browser viewport to the attached viewer's canvas (CSS pixels).
  z.object({
    type: z.literal('setViewport'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
]);
export type BrowserClientMessage = z.infer<typeof browserClientMessageSchema>;

export const browserEndedReasonSchema = z.enum(['closed', 'not-found', 'error', 'opened-elsewhere']);
export type BrowserEndedReason = z.infer<typeof browserEndedReasonSchema>;

// `frame`/`tabs`/`url`/`status` are relayed from the upstream agent-browser stream, which
// may add fields at any time — validate only what the PWA consumes and pass the rest
// through so the relay stays forward-compatible.
export const browserAgentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('authResult'), ok: z.boolean() }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('ended'), reason: browserEndedReasonSchema }),
  z
    .object({
      type: z.literal('frame'),
      data: z.string(), // base64 JPEG
      metadata: z
        .object({ deviceWidth: z.number(), deviceHeight: z.number() })
        .passthrough(),
    })
    .passthrough(),
  z.object({ type: z.literal('tabs') }).passthrough(),
  z.object({ type: z.literal('url'), url: z.string() }).passthrough(),
  z.object({ type: z.literal('status') }).passthrough(),
]);
export type BrowserAgentMessage = z.infer<typeof browserAgentMessageSchema>;

export function parseBrowserClientMessage(raw: unknown): BrowserClientMessage {
  return browserClientMessageSchema.parse(raw);
}

export function parseBrowserAgentMessage(raw: unknown): BrowserAgentMessage {
  return browserAgentMessageSchema.parse(raw);
}
