/**
 * Message-layer zod schemas: the four wire full forms + error body +
 * carrier receipt. The payload slot is unknown in the full-form schemas — business payloads
 * get a second parse dispatched by method (two-level parse discipline).
 * Brand cast point: rpcIdSchema, and only there.
 */
import { z } from 'zod';
/**
 * RpcId: one brand cast after schema validation (the only cast point in this
 * file). No min-length: the id is an opaque echo token, and rejecting values
 * here would only turn a correlatable error report into a client-side parse
 * failure (the handler substitutes a sentinel when a request's id is unreadable).
 */
export const rpcIdSchema = z.string();
/** Error body: discriminated by code, per-branch details aligned to RpcErrorDetailsMap; details is required. */
export const rpcErrorSchema = z.discriminatedUnion('code', [
    z.object({ code: z.literal('bad-request'), message: z.string(), details: z.object({ issues: z.array(z.custom()) }) }),
    z.object({ code: z.literal('cancelled'), message: z.string(), details: z.object({}) }),
    z.object({ code: z.literal('session-not-found'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
    z.object({ code: z.literal('model-unavailable'), message: z.string(), details: z.object({ provider: z.string(), model: z.string() }) }),
    z.object({ code: z.literal('session-conflict'), message: z.string(), details: z.object({ sessionId: z.string(), requestedCwd: z.string(), existingCwd: z.string().optional() }) }),
    z.object({ code: z.literal('invalid-time-zone'), message: z.string(), details: z.object({ value: z.string() }) }),
    z.object({ code: z.literal('workspace-attach-failed'), message: z.string(), details: z.object({ sessionId: z.string(), workspaceId: z.string() }) }),
    z.object({ code: z.literal('workspace-not-found'), message: z.string(), details: z.object({ workspaceId: z.string() }) }),
    z.object({ code: z.literal('workspace-invalid-path'), message: z.string(), details: z.object({ path: z.string() }) }),
    z.object({ code: z.literal('workspace-name-conflict'), message: z.string(), details: z.object({ name: z.string() }) }),
    z.object({ code: z.literal('workspace-move-invalid'), message: z.string(), details: z.object({ workspaceId: z.string(), sessionId: z.string(), beforeSessionId: z.string().optional() }) }),
    z.object({ code: z.literal('directory-unreadable'), message: z.string(), details: z.object({ path: z.string() }) }),
    z.object({ code: z.literal('directory-exists'), message: z.string(), details: z.object({ path: z.string() }) }),
    z.object({ code: z.literal('directory-create-failed'), message: z.string(), details: z.object({ path: z.string() }) }),
    z.object({ code: z.literal('directory-picker-unavailable'), message: z.string(), details: z.object({ capability: z.string() }) }),
    z.object({ code: z.literal('agent-preset-read-only'), message: z.string(), details: z.object({ agentPreset: z.string(), reason: z.string() }) }),
    z.object({ code: z.literal('agent-preset-locked'), message: z.string(), details: z.object({ sessionId: z.string(), agentPreset: z.string() }) }),
    z.object({ code: z.literal('agent-preset-conflict'), message: z.string(), details: z.object({ sessionId: z.string(), requestedPreset: z.string(), existingPreset: z.string().optional() }) }),
    z.object({ code: z.literal('agent-preset-not-found'), message: z.string(), details: z.object({ agentPreset: z.string(), available: z.array(z.string()) }) }),
    z.object({ code: z.literal('agent-preset-invalid'), message: z.string(), details: z.object({ agentPreset: z.string(), reason: z.string() }) }),
    z.object({ code: z.literal('agent-busy'), message: z.string(), details: z.object({ reason: z.string() }) }),
    z.object({ code: z.literal('attachment-error'), message: z.string(), details: z.object({ reason: z.string() }) }),
    z.object({ code: z.literal('queue-item-not-found'), message: z.string(), details: z.object({ itemId: z.string() }) }),
    z.object({ code: z.literal('steer-unavailable'), message: z.string(), details: z.object({ itemId: z.string() }) }),
    z.object({ code: z.literal('command-error'), message: z.string(), details: z.object({}) }),
    z.object({ code: z.literal('unknown-command'), message: z.string(), details: z.object({}) }),
    z.object({ code: z.literal('settings-rejected'), message: z.string(), details: z.object({ ns: z.string() }) }),
    z.object({ code: z.literal('settings-not-exposed'), message: z.string(), details: z.object({ ns: z.string() }) }),
    z.object({ code: z.literal('settings-conflict'), message: z.string(), details: z.object({ ns: z.string(), expected: z.number(), actual: z.number() }) }),
    z.object({ code: z.literal('credential-rejected'), message: z.string(), details: z.object({ ref: z.string() }) }),
    z.object({ code: z.literal('model-discovery-failed'), message: z.string(), details: z.object({ settingsNs: z.string(), baseURL: z.string().optional() }) }),
    z.object({ code: z.literal('title-invalid'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
    z.object({ code: z.literal('fork-unavailable'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
    z.object({ code: z.literal('subagent-parent-unavailable'), message: z.string(), details: z.object({ parentSessionId: z.string() }) }),
    z.object({ code: z.literal('subagent-not-found'), message: z.string(), details: z.object({ parentSessionId: z.string(), childSessionId: z.string() }) }),
    z.object({ code: z.literal('subagent-catalog-diagnostic'), message: z.string(), details: z.object({
            parentSessionId: z.string(),
            childSessionId: z.string(),
            reason: z.union([z.literal('corrupt'), z.literal('unsupported'), z.literal('unavailable')]),
        }) }),
    z.object({ code: z.literal('subagent-not-resumable'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
    z.object({ code: z.literal('subagent-unauthorized'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
    z.object({ code: z.literal('subagent-delivery-unavailable'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
    z.object({ code: z.literal('internal'), message: z.string(), details: z.object({}) }),
]);
/**
 * Business success/failure result schema (generic, reusable).
 * @param value - Schema for the business value.
 * @returns Schema for RpcResult<T>.
 */
export function rpcResultSchema(value) {
    return z.union([
        z.object({ ok: z.literal(true), value }),
        z.object({ ok: z.literal(false), error: rpcErrorSchema }),
    ]);
}
// ---- The four wire full-form schemas (payload/result.value slots stay wide — business layer does the second parse) ----
// The wide value slot is optional: a void business result serializes with no
// `value` field at all. Each endpoint's own second parse still requires its
// declared value, so absence never passes for a method that returns data.
/** ClientRequest full form (payload stays wide — the business layer runs the second parse). */
export const clientRequestSchema = z.object({
    type: z.literal('client-request'),
    rpcId: rpcIdSchema,
    method: z.string(),
    payload: z.unknown(),
});
/** ServerResponse full form (result.value stays wide). */
export const serverResponseSchema = z.object({
    type: z.literal('server-response'),
    rpcId: rpcIdSchema,
    result: rpcResultSchema(z.unknown().optional()),
});
/** ServerRequest full form (payload stays wide). */
export const serverRequestSchema = z.object({
    type: z.literal('server-request'),
    rpcId: rpcIdSchema,
    method: z.string(),
    payload: z.unknown(),
});
/** ClientResponse full form (result.value stays wide). */
export const clientResponseSchema = z.object({
    type: z.literal('client-response'),
    rpcId: rpcIdSchema,
    result: rpcResultSchema(z.unknown().optional()),
});
/** Wire full-form union (discriminated by type). */
export const rpcMessageSchema = z.discriminatedUnion('type', [
    clientRequestSchema,
    serverResponseSchema,
    serverRequestSchema,
    clientResponseSchema,
]);
/** Carrier receipt schema. */
export const rpcReceiptSchema = z.union([
    z.object({ accepted: z.literal(true) }),
    z.object({ accepted: z.literal(false), reason: z.union([z.literal('not-pending'), z.literal('bad-response')]) }),
]);
//# sourceMappingURL=rpc.schema.js.map