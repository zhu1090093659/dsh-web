/**
 * workspace domain zod schemas (names derived from map keys). The
 * WorkspaceId brand cast lives in sessions.schema (see the note there) and
 * is re-exported here as the domain-local name.
 */
import { z } from 'zod';
import { sessionIdSchema, workspaceIdSchema } from "./sessions.schema.js";
export { workspaceIdSchema } from "./sessions.schema.js";
/** WorkspaceView row of every workspace.* response. */
export const workspaceViewSchema = z.object({
    workspaceId: workspaceIdSchema,
    path: z.string(),
    title: z.string(),
    sessionIds: z.array(sessionIdSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
});
/** workspace.list request payload (empty object literal). */
export const workspaceListRequestSchema = z.object({});
/** workspace.list response value. */
export const workspaceListValueSchema = z.object({
    items: z.array(workspaceViewSchema),
    archivedSessionIds: z.array(sessionIdSchema),
});
/** workspace.create request payload: the existing directory to adopt. */
export const workspaceCreateRequestSchema = z.object({
    path: z.string(),
});
/** workspace.create response value. */
export const workspaceCreateValueSchema = z.object({
    workspace: workspaceViewSchema,
    created: z.boolean(),
});
/** workspace.rename request payload: the new title must be non-blank. */
export const workspaceRenameRequestSchema = z.object({
    workspaceId: workspaceIdSchema,
    title: z.string(),
}).refine(payload => payload.title.trim() !== '', { message: 'workspace.rename requires a non-blank title' });
/** workspace.rename response value. */
export const workspaceRenameValueSchema = z.object({
    workspace: workspaceViewSchema,
});
/** workspace.delete request payload. */
export const workspaceDeleteRequestSchema = z.object({
    workspaceId: workspaceIdSchema,
});
/** workspace.delete response value. */
export const workspaceDeleteValueSchema = z.object({
    deleted: z.literal(true),
});
/** workspace.insertBefore request payload (anchor omitted = append to end). */
export const workspaceInsertBeforeRequestSchema = z.object({
    workspaceId: workspaceIdSchema,
    beforeWorkspaceId: workspaceIdSchema.optional(),
});
/** workspace.insertBefore response value: the complete durable display order. */
export const workspaceInsertBeforeValueSchema = z.object({
    workspaceIds: z.array(workspaceIdSchema),
});
/** workspace.insertSessionBefore request payload (anchor omitted = append to end). */
export const workspaceInsertSessionBeforeRequestSchema = z.object({
    workspaceId: workspaceIdSchema,
    sessionId: sessionIdSchema,
    beforeSessionId: sessionIdSchema.optional(),
});
/** workspace.insertSessionBefore response value. */
export const workspaceInsertSessionBeforeValueSchema = z.object({
    workspace: workspaceViewSchema,
});
/** workspace.archiveSession request payload. */
export const workspaceArchiveSessionRequestSchema = z.object({
    sessionId: sessionIdSchema,
});
/** workspace.archiveSession response value: the full updated archive set. */
export const workspaceArchiveSessionValueSchema = z.object({
    archivedSessionIds: z.array(sessionIdSchema),
});
//# sourceMappingURL=workspace.schema.js.map