/**
 * workspace domain zod schemas (names derived from map keys). The
 * WorkspaceId brand cast lives in sessions.schema (see the note there) and
 * is re-exported here as the domain-local name.
 */
import { z } from 'zod';
export { workspaceIdSchema } from './sessions.schema.ts';
/** WorkspaceView row of every workspace.* response. */
export declare const workspaceViewSchema: z.ZodObject<{
    workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
    path: z.ZodString;
    title: z.ZodString;
    sessionIds: z.ZodArray<z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
/** workspace.list request payload (empty object literal). */
export declare const workspaceListRequestSchema: z.ZodObject<{}, z.core.$strip>;
/** workspace.list response value. */
export declare const workspaceListValueSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
        path: z.ZodString;
        title: z.ZodString;
        sessionIds: z.ZodArray<z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    archivedSessionIds: z.ZodArray<z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>>;
}, z.core.$strip>;
/** workspace.create request payload: the existing directory to adopt. */
export declare const workspaceCreateRequestSchema: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strip>;
/** workspace.create response value. */
export declare const workspaceCreateValueSchema: z.ZodObject<{
    workspace: z.ZodObject<{
        workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
        path: z.ZodString;
        title: z.ZodString;
        sessionIds: z.ZodArray<z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>;
    created: z.ZodBoolean;
}, z.core.$strip>;
/** workspace.rename request payload: the new title must be non-blank. */
export declare const workspaceRenameRequestSchema: z.ZodObject<{
    workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
    title: z.ZodString;
}, z.core.$strip>;
/** workspace.rename response value. */
export declare const workspaceRenameValueSchema: z.ZodObject<{
    workspace: z.ZodObject<{
        workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
        path: z.ZodString;
        title: z.ZodString;
        sessionIds: z.ZodArray<z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
/** workspace.delete request payload. */
export declare const workspaceDeleteRequestSchema: z.ZodObject<{
    workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
}, z.core.$strip>;
/** workspace.delete response value. */
export declare const workspaceDeleteValueSchema: z.ZodObject<{
    deleted: z.ZodLiteral<true>;
}, z.core.$strip>;
/** workspace.insertBefore request payload (anchor omitted = append to end). */
export declare const workspaceInsertBeforeRequestSchema: z.ZodObject<{
    workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
    beforeWorkspaceId: z.ZodOptional<z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>>;
}, z.core.$strip>;
/** workspace.insertBefore response value: the complete durable display order. */
export declare const workspaceInsertBeforeValueSchema: z.ZodObject<{
    workspaceIds: z.ZodArray<z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>>;
}, z.core.$strip>;
/** workspace.insertSessionBefore request payload (anchor omitted = append to end). */
export declare const workspaceInsertSessionBeforeRequestSchema: z.ZodObject<{
    workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
    sessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    beforeSessionId: z.ZodOptional<z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>>;
}, z.core.$strip>;
/** workspace.insertSessionBefore response value. */
export declare const workspaceInsertSessionBeforeValueSchema: z.ZodObject<{
    workspace: z.ZodObject<{
        workspaceId: z.ZodType<import("./workspace.ts").WorkspaceId, unknown, z.core.$ZodTypeInternals<import("./workspace.ts").WorkspaceId, unknown>>;
        path: z.ZodString;
        title: z.ZodString;
        sessionIds: z.ZodArray<z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
/** workspace.archiveSession request payload. */
export declare const workspaceArchiveSessionRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
}, z.core.$strip>;
/** workspace.archiveSession response value: the full updated archive set. */
export declare const workspaceArchiveSessionValueSchema: z.ZodObject<{
    archivedSessionIds: z.ZodArray<z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>>;
}, z.core.$strip>;
//# sourceMappingURL=workspace.schema.d.ts.map