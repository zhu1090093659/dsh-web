/** Zod schemas for the browser-safe subagent domain. */
import { z } from 'zod';
import type { MessageId } from '@deepseek-ai/dsh-llm/brand';
import type { RequestPayload, ResponseValue } from './rpc-map.ts';
import type { Wire } from './rpc.schema.ts';
/** Healthy and diagnostic durable catalog rows. */
export declare const subagentListEntrySchema: z.ZodUnion<readonly [z.ZodObject<{
    kind: z.ZodLiteral<"child">;
    id: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    mode: z.ZodLiteral<"one-shot">;
    activity: z.ZodUnion<readonly [z.ZodLiteral<"running">, z.ZodLiteral<"inactive">]>;
    hasChildren: z.ZodBoolean;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"child">;
    id: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    mode: z.ZodLiteral<"continuable">;
    activity: z.ZodUnion<readonly [z.ZodLiteral<"running">, z.ZodLiteral<"inactive">]>;
    hasChildren: z.ZodBoolean;
    label: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"diagnostic">;
    id: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    reason: z.ZodUnion<readonly [z.ZodLiteral<"corrupt">, z.ZodLiteral<"unsupported">, z.ZodLiteral<"unavailable">]>;
}, z.core.$strip>]>;
/** subagent.list request payload. */
export declare const subagentListRequestSchema: z.ZodObject<{
    parentSessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
}, z.core.$strip>;
/** subagent.list response value. */
export declare const subagentListValueSchema: z.ZodObject<{
    entries: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        kind: z.ZodLiteral<"child">;
        id: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
        mode: z.ZodLiteral<"one-shot">;
        activity: z.ZodUnion<readonly [z.ZodLiteral<"running">, z.ZodLiteral<"inactive">]>;
        hasChildren: z.ZodBoolean;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"child">;
        id: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
        mode: z.ZodLiteral<"continuable">;
        activity: z.ZodUnion<readonly [z.ZodLiteral<"running">, z.ZodLiteral<"inactive">]>;
        hasChildren: z.ZodBoolean;
        label: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"diagnostic">;
        id: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
        reason: z.ZodUnion<readonly [z.ZodLiteral<"corrupt">, z.ZodLiteral<"unsupported">, z.ZodLiteral<"unavailable">]>;
    }, z.core.$strip>]>>;
    parentAvailable: z.ZodBoolean;
}, z.core.$strip>;
/** subagent.history request payload. */
export declare const subagentHistoryRequestSchema: z.ZodObject<{
    parentSessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    childSessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    mode: z.ZodUnion<readonly [z.ZodLiteral<"one-shot">, z.ZodLiteral<"continuable">]>;
    beforeSeq: z.ZodOptional<z.ZodNumber>;
    maxMessages: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** subagent.history response value. */
export declare const subagentHistoryValueSchema: z.ZodType<Wire<ResponseValue<"subagent.history">>>;
/** subagent.prompt request payload. */
export declare const subagentPromptRequestSchema: z.ZodType<RequestPayload<"subagent.prompt">>;
/** subagent.interrupt request payload. */
export declare const subagentInterruptRequestSchema: z.ZodObject<{
    parentSessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    childSessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    mode: z.ZodLiteral<"continuable">;
}, z.core.$strip>;
/** subagent.interrupt response value. */
export declare const subagentInterruptValueSchema: z.ZodObject<{
    accepted: z.ZodLiteral<true>;
}, z.core.$strip>;
/** subagent.prompt response value. */
export declare const subagentPromptValueSchema: z.ZodObject<{
    messageId: z.ZodType<MessageId, unknown, z.core.$ZodTypeInternals<MessageId, unknown>>;
}, z.core.$strip>;
//# sourceMappingURL=subagents.schema.d.ts.map