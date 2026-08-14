/**
 * agent-presets domain zod schemas (names derived from map keys:
 * agentPresetListRequestSchema / agentPresetListValueSchema).
 */
import { z } from 'zod';
/** AgentPresetEntry row of agentPreset.list. */
export declare const agentPresetEntrySchema: z.ZodObject<{
    id: z.ZodString;
    trust: z.ZodUnion<readonly [z.ZodLiteral<"system">, z.ZodLiteral<"user">]>;
    isDefault: z.ZodBoolean;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    broken: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** agentPreset.list request payload. */
export declare const agentPresetListRequestSchema: z.ZodObject<{}, z.core.$strip>;
/** agentPreset.list response value. */
export declare const agentPresetListValueSchema: z.ZodObject<{
    presets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        trust: z.ZodUnion<readonly [z.ZodLiteral<"system">, z.ZodLiteral<"user">]>;
        isDefault: z.ZodBoolean;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        broken: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    authorable: z.ZodBoolean;
    hasDocument: z.ZodBoolean;
}, z.core.$strip>;
/** agentPreset.select request payload. */
export declare const agentPresetSelectRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    agentPreset: z.ZodString;
}, z.core.$strip>;
/** agentPreset.select response value. */
export declare const agentPresetSelectValueSchema: z.ZodObject<{
    agentPreset: z.ZodString;
}, z.core.$strip>;
/** agentPreset.read request payload. */
export declare const agentPresetReadRequestSchema: z.ZodObject<{
    agentPreset: z.ZodString;
}, z.core.$strip>;
/** agentPreset.read response value. */
export declare const agentPresetReadValueSchema: z.ZodObject<{
    agentPreset: z.ZodString;
    trust: z.ZodUnion<readonly [z.ZodLiteral<"system">, z.ZodLiteral<"user">]>;
    content: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** agentPreset.copy request payload. */
export declare const agentPresetCopyRequestSchema: z.ZodObject<{
    from: z.ZodString;
    agentPreset: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** agentPreset.copy response value. */
export declare const agentPresetCopyValueSchema: z.ZodObject<{
    agentPreset: z.ZodString;
}, z.core.$strip>;
/** agentPreset.openDocument request payload. */
export declare const agentPresetOpenDocumentRequestSchema: z.ZodObject<{
    agentPreset: z.ZodString;
}, z.core.$strip>;
/** agentPreset.openDocument response value. */
export declare const agentPresetOpenDocumentValueSchema: z.ZodUnion<readonly [z.ZodObject<{
    opened: z.ZodLiteral<true>;
}, z.core.$strip>, z.ZodObject<{
    opened: z.ZodLiteral<false>;
    path: z.ZodString;
}, z.core.$strip>]>;
/** agentPreset.remove request payload. */
export declare const agentPresetRemoveRequestSchema: z.ZodObject<{
    agentPreset: z.ZodString;
}, z.core.$strip>;
/** agentPreset.remove response value. */
export declare const agentPresetRemoveValueSchema: z.ZodObject<{}, z.core.$strip>;
//# sourceMappingURL=agent-presets.schema.d.ts.map