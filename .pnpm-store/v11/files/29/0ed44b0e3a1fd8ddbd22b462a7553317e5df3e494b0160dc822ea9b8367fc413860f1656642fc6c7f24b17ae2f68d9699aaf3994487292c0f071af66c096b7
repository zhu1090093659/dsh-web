/**
 * settings domain zod schemas (names derived from map keys: settingsDescribeRequestSchema /
 * settingsDescribeValueSchema / settingsUpdate* / settingsReplace*).
 */
import { z } from 'zod';
/** One redacted secret slot. */
export const settingsSecretViewSchema = z.object({
    path: z.array(z.string()),
    set: z.boolean(),
});
/** SettingsNamespaceView row of settings.describe and the write responses. */
export const settingsNamespaceViewSchema = z.object({
    ns: z.string().min(1),
    schema: z.unknown(),
    value: z.unknown(),
    base: z.unknown().optional(),
    user: z.unknown().optional(),
    applies: z.union([z.literal('live'), z.literal('restart')]),
    secrets: z.array(settingsSecretViewSchema),
    revision: z.number(),
});
/** settings.describe request payload. */
export const settingsDescribeRequestSchema = z.object({});
/** settings.describe response value. */
export const settingsDescribeValueSchema = z.object({
    writable: z.boolean(),
    hasDocument: z.boolean(),
    namespaces: z.array(settingsNamespaceViewSchema),
});
/** settings.openDocument request payload. */
export const settingsOpenDocumentRequestSchema = z.object({});
/** settings.openDocument response value. */
export const settingsOpenDocumentValueSchema = z.object({
    opened: z.literal(true),
});
/** settings.update request payload. */
export const settingsUpdateRequestSchema = z.object({
    ns: z.string().min(1),
    patch: z.record(z.string(), z.unknown()),
    expectedRevision: z.number().optional(),
});
/** settings.update response value: the namespace's new redacted view. */
export const settingsUpdateValueSchema = settingsNamespaceViewSchema;
/** settings.replace request payload. */
export const settingsReplaceRequestSchema = z.object({
    ns: z.string().min(1),
    section: z.record(z.string(), z.unknown()),
    expectedRevision: z.number().optional(),
});
/** One path-addressed edit of settings.mutate. */
export const settingsPathOpSchema = z.discriminatedUnion('op', [
    z.object({ op: z.literal('set'), path: z.array(z.string()), value: z.unknown() }),
    z.object({ op: z.literal('unset'), path: z.array(z.string()) }),
]);
/** settings.mutate request payload. */
export const settingsMutateRequestSchema = z.object({
    ns: z.string().min(1),
    ops: z.array(settingsPathOpSchema),
    expectedRevision: z.number().optional(),
});
/** settings.mutate response value: the namespace's new redacted view. */
export const settingsMutateValueSchema = settingsNamespaceViewSchema;
/** settings.replace response value. */
export const settingsReplaceValueSchema = settingsNamespaceViewSchema;
//# sourceMappingURL=settings.schema.js.map