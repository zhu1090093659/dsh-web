/**
 * agent-presets domain zod schemas (names derived from map keys:
 * agentPresetListRequestSchema / agentPresetListValueSchema).
 */
import { z } from 'zod';
import { sessionIdSchema } from "./sessions.schema.js";
/** AgentPresetEntry row of agentPreset.list. */
export const agentPresetEntrySchema = z.object({
    id: z.string().min(1),
    trust: z.union([z.literal('system'), z.literal('user')]),
    isDefault: z.boolean(),
    name: z.string().optional(),
    description: z.string().optional(),
    broken: z.string().min(1).optional(),
});
/** agentPreset.list request payload. */
export const agentPresetListRequestSchema = z.object({});
/** agentPreset.list response value. */
export const agentPresetListValueSchema = z.object({
    presets: z.array(agentPresetEntrySchema),
    authorable: z.boolean(),
    hasDocument: z.boolean(),
});
/** agentPreset.select request payload. */
export const agentPresetSelectRequestSchema = z.object({
    sessionId: sessionIdSchema,
    agentPreset: z.string().min(1),
});
/** agentPreset.select response value. */
export const agentPresetSelectValueSchema = z.object({
    agentPreset: z.string(),
});
/** agentPreset.read request payload. */
export const agentPresetReadRequestSchema = z.object({
    agentPreset: z.string().min(1),
});
/** agentPreset.read response value. */
export const agentPresetReadValueSchema = z.object({
    agentPreset: z.string(),
    trust: z.union([z.literal('system'), z.literal('user')]),
    content: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
});
/** agentPreset.copy request payload. */
export const agentPresetCopyRequestSchema = z.object({
    from: z.string().min(1),
    agentPreset: z.string().min(1),
    name: z.string().optional(),
});
/** agentPreset.copy response value. */
export const agentPresetCopyValueSchema = z.object({
    agentPreset: z.string(),
});
/** agentPreset.openDocument request payload. */
export const agentPresetOpenDocumentRequestSchema = z.object({
    agentPreset: z.string().min(1),
});
/** agentPreset.openDocument response value. */
export const agentPresetOpenDocumentValueSchema = z.union([
    z.object({ opened: z.literal(true) }),
    z.object({ opened: z.literal(false), path: z.string() }),
]);
/** agentPreset.remove request payload. */
export const agentPresetRemoveRequestSchema = z.object({
    agentPreset: z.string().min(1),
});
/** agentPreset.remove response value. */
export const agentPresetRemoveValueSchema = z.object({});
//# sourceMappingURL=agent-presets.schema.js.map