import { z } from 'zod';

// A single client-side connection lifecycle event. `kind` is a bare string (not an enum) so
// a newer client emitting a new kind is never rejected by an older agent's parser. Every
// event carries the three signals that discriminate the disconnect suspects: the WebSocket
// close `code`, `navigator.onLine`, and `document.visibilityState` at emit time.
export const clientLogEventSchema = z.object({
  sess: z.string(), // per-app-launch id
  seq: z.number().int().nonnegative(), // monotonic within sess
  t: z.number(), // epoch ms at emit
  machineId: z.string().optional(), // absent for app-global events (visibility/online)
  kind: z.string(),
  code: z.number().int().optional(), // WS close code, when reported
  reason: z.string().optional(), // classified diagnostic message / close reason
  online: z.boolean(),
  vis: z.string(),
});
export type ClientLogEvent = z.infer<typeof clientLogEventSchema>;

// A batch flushed to the agent's POST /clientlog after a reconnect. `ua`/`shell` describe
// the client once; `events` is capped so a hand-crafted or runaway payload can't be huge.
export const clientLogBatchSchema = z.object({
  ua: z.string().optional(),
  shell: z.string().optional(),
  events: z.array(clientLogEventSchema).min(1).max(500),
});
export type ClientLogBatch = z.infer<typeof clientLogBatchSchema>;

export function parseClientLogBatch(raw: unknown): ClientLogBatch {
  return clientLogBatchSchema.parse(raw);
}
