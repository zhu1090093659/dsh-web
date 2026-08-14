/**
 * The workspace domain declaration: record schema and the `defineDomain` spec
 * the registry opens. The zod schema is the durable-boundary validator today
 * and the direct source of the RPC wire projection in a later phase.
 * @module @deepseek-ai/dsh-workspace/src/spec
 */
import { z } from 'zod';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { WorkspaceId } from './types.ts';
/**
 * Durable shape of one workspace record. `path` is the `fs.realpath` canon
 * stamped at create; `sessionIds` is the ordered ownership account (array
 * order is display order); timestamps are ISO-8601 strings.
 */
export declare const workspaceRecord: z.ZodObject<{
    path: z.ZodString;
    title: z.ZodString;
    sessionIds: z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
/** One stored workspace record, inferred from {@link workspaceRecord}. */
export type WorkspaceRecord = z.infer<typeof workspaceRecord>;
/**
 * Durable registry state. `initialized` distinguishes a valid empty registry
 * from one that still needs the header-only history bootstrap;
 * `workspaceIds` is the authoritative display order. `archivedSessionIds` is
 * the registry-global archive set layered over workspace accounting: an
 * archived session keeps its `sessionIds` slot (unarchiving must restore the
 * position), so the set never participates in the one-owner accounting
 * invariant. Defaulted so records written before the field parse unchanged.
 */
export declare const workspaceDomainState: z.ZodObject<{
    initialized: z.ZodBoolean;
    workspaceIds: z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>>;
    archivedSessionIds: z.ZodDefault<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>>>;
    pendingMutation: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        operation: z.ZodLiteral<"create">;
        workspaceId: z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>;
    }, z.core.$strip>, z.ZodObject<{
        operation: z.ZodLiteral<"delete">;
        workspaceId: z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>;
    }, z.core.$strip>], "operation">>;
}, z.core.$strip>;
/** Durable registry state inferred from {@link workspaceDomainState}. */
export type WorkspaceDomainState = z.infer<typeof workspaceDomainState>;
/**
 * The workspace domain spec: one `workspaces` table keyed by
 * {@link WorkspaceId} plus the bootstrap/order singleton. The registry opens
 * this through `ctx.storage.domain`; the spec object is the single source of
 * the domain's identity, version, and schemas.
 */
export declare const workspaceDomainSpec: {
    name: string;
    version: number;
    global: {
        schema: z.ZodObject<{
            initialized: z.ZodBoolean;
            workspaceIds: z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>>;
            archivedSessionIds: z.ZodDefault<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>>>;
            pendingMutation: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                operation: z.ZodLiteral<"create">;
                workspaceId: z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>;
            }, z.core.$strip>, z.ZodObject<{
                operation: z.ZodLiteral<"delete">;
                workspaceId: z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>;
            }, z.core.$strip>], "operation">>;
        }, z.core.$strip>;
        initial: {
            initialized: boolean;
            workspaceIds: never[];
            archivedSessionIds: never[];
        };
    };
    tables: {
        workspaces: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<WorkspaceId, {
            path: string;
            title: string;
            sessionIds: SessionId[];
            createdAt: string;
            updatedAt: string;
        }>;
    };
};
//# sourceMappingURL=spec.d.ts.map