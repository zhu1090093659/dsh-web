/** Zod schemas for the browser-safe subagent domain. */
import { z } from 'zod';
import { contentBlockSchema, historyEntrySchema, sessionIdSchema, sessionProjectionsBlockSchema, } from "./sessions.schema.js";
/** Healthy and diagnostic durable catalog rows. */
export const subagentListEntrySchema = z.union([
    z.object({
        kind: z.literal('child'),
        id: sessionIdSchema,
        mode: z.literal('one-shot'),
        activity: z.union([z.literal('running'), z.literal('inactive')]),
        hasChildren: z.boolean(),
        label: z.string().optional(),
    }),
    z.object({
        kind: z.literal('child'),
        id: sessionIdSchema,
        mode: z.literal('continuable'),
        activity: z.union([z.literal('running'), z.literal('inactive')]),
        hasChildren: z.boolean(),
        label: z.string(),
    }),
    z.object({
        kind: z.literal('diagnostic'),
        id: sessionIdSchema,
        reason: z.union([z.literal('corrupt'), z.literal('unsupported'), z.literal('unavailable')]),
    }),
]);
/** subagent.list request payload. */
export const subagentListRequestSchema = z.object({
    parentSessionId: sessionIdSchema,
});
/** subagent.list response value. */
export const subagentListValueSchema = z.object({
    entries: z.array(subagentListEntrySchema),
    parentAvailable: z.boolean(),
});
/** subagent.history request payload. */
export const subagentHistoryRequestSchema = z.object({
    parentSessionId: sessionIdSchema,
    childSessionId: sessionIdSchema,
    mode: z.union([z.literal('one-shot'), z.literal('continuable')]),
    beforeSeq: z.number().int().nonnegative().optional(),
    maxMessages: z.number().int().positive().optional(),
});
/** subagent.history response value. */
export const subagentHistoryValueSchema = z.object({
    events: z.array(historyEntrySchema),
    hasMore: z.boolean(),
    projections: sessionProjectionsBlockSchema.optional(),
});
/** subagent.prompt request payload. */
export const subagentPromptRequestSchema = z.object({
    parentSessionId: sessionIdSchema,
    childSessionId: sessionIdSchema,
    mode: z.literal('continuable'),
    content: z.array(contentBlockSchema),
    clientTimeZone: z.string().optional(),
});
/** subagent.interrupt request payload. */
export const subagentInterruptRequestSchema = z.object({
    parentSessionId: sessionIdSchema,
    childSessionId: sessionIdSchema,
    mode: z.literal('continuable'),
});
/** subagent.interrupt response value. */
export const subagentInterruptValueSchema = z.object({
    accepted: z.literal(true),
});
const messageIdSchema = z.string();
/** subagent.prompt response value. */
export const subagentPromptValueSchema = z.object({
    messageId: messageIdSchema,
});
//# sourceMappingURL=subagents.schema.js.map