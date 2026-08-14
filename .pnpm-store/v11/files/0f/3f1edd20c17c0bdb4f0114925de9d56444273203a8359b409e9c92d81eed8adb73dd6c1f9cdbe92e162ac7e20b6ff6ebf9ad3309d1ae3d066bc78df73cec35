/**
 * host domain zod schemas (names derived from map keys).
 */
import { z } from 'zod';
/** host.describe request payload (empty object literal). */
export const hostDescribeRequestSchema = z.object({});
/** host.describe response value. */
export const hostDescribeValueSchema = z.object({
    version: z.string(),
    cwd: z.string(),
    provider: z.string().optional(),
    model: z.string().optional(),
    attachedSessions: z.number().int().nonnegative(),
    canOpenPath: z.boolean(),
});
/** host.pickDirectory request payload (empty object literal). */
export const hostPickDirectoryRequestSchema = z.object({});
/** host.pickDirectory response value; null means the user cancelled. */
export const hostPickDirectoryValueSchema = z.object({
    path: z.string().nullable(),
});
/** Directory row shared by listing entries and breadcrumb crumbs. */
export const directoryEntrySchema = z.object({
    name: z.string(),
    path: z.string(),
    hidden: z.boolean(),
});
/** host.listDirectory request payload; an absent path lists the home directory. */
export const hostListDirectoryRequestSchema = z.object({
    path: z.string().optional(),
});
/** host.listDirectory response value. */
export const hostListDirectoryValueSchema = z.object({
    path: z.string(),
    home: z.string(),
    crumbs: z.array(directoryEntrySchema),
    entries: z.array(directoryEntrySchema),
    truncated: z.boolean(),
});
/** host.createDirectory request payload: name must be one plain path segment. */
export const hostCreateDirectoryRequestSchema = z.object({
    path: z.string(),
    name: z.string(),
}).refine(payload => payload.name.trim() !== '' && payload.name !== '.' && payload.name !== '..'
    && !/[/\\]/.test(payload.name), { message: 'host.createDirectory requires a single non-blank path segment name' });
/** host.createDirectory response value: the created directory's absolute path. */
export const hostCreateDirectoryValueSchema = z.object({
    path: z.string(),
});
/** host.openPath request payload. */
export const hostOpenPathRequestSchema = z.object({
    path: z.string().min(1),
});
/** host.openPath response value. */
export const hostOpenPathValueSchema = z.object({
    opened: z.literal(true),
});
//# sourceMappingURL=host.schema.js.map