/**
 * The session-projcache domain declaration: one `sessions` table keyed by
 * {@link SessionId}, each record the full projection checkpoint for one
 * session (`key → {ver, seq, val}` rows). The spec object
 * is the single source of the domain's identity, version, and record schema;
 * the storage-domain routing decides the medium (the shipped composition's
 * json backend lands it at `<root>/session_projcache.json`, beside
 * `workspace.json`).
 * @module @deepseek-ai/dsh-session-projection-cache/src/spec
 */
import { z } from 'zod';
import { SessionId } from '@deepseek-ai/dsh-session';
/**
 * One persisted checkpoint row (the RFC's `(sessionId, key, ver, seq, val)`
 * minus the two record keys). `val` is the unit's internal state — plain
 * JSON by the unit contract; `z.json()` enforces that at the durable
 * boundary. A row is never wrong, only possibly stale: `seq` says exactly
 * how stale, and a `ver` mismatch against the live unit's `stateVersion`
 * discards it at read time (never a migration).
 */
export declare const checkpointRow: z.ZodObject<{
    ver: z.ZodNumber;
    seq: z.ZodNumber;
    val: z.ZodJSONSchema;
}, z.core.$strip>;
/**
 * The stored-log identity a record is bound to: the immutable header fields
 * that distinguish one session lifecycle from another under the same id. A
 * session id names a slot, not a lifecycle — a deleted-then-recreated id, or
 * a persistence root swapped under a surviving cache, would otherwise let an
 * old row pass every watermark check and seed state folded from an unrelated
 * log. Reads validate this against the live header (listing) or the stored
 * header (cold read) before accepting any row.
 */
export declare const checkpointIdentity: z.ZodObject<{
    createdAt: z.ZodNumber;
    cwd: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** The identity fields a record is bound to, inferred from {@link checkpointIdentity}. */
export type CheckpointIdentity = z.infer<typeof checkpointIdentity>;
/**
 * One session's stored record: the log identity it was folded from plus its
 * checkpoint rows keyed by projection key. The whole record is replaced on
 * every write (whole-value discipline — the registry checkpoint is always
 * the complete per-session cut).
 */
export declare const checkpointRecord: z.ZodObject<{
    identity: z.ZodObject<{
        createdAt: z.ZodNumber;
        cwd: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    rows: z.ZodRecord<z.ZodString, z.ZodObject<{
        ver: z.ZodNumber;
        seq: z.ZodNumber;
        val: z.ZodJSONSchema;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One stored per-session checkpoint record, inferred from {@link checkpointRecord}. */
export type CheckpointRecord = z.infer<typeof checkpointRecord>;
/**
 * The session-projcache domain spec. Version bumps discard the whole medium
 * (cache semantics: a stale or unreadable cache costs a longer tail replay,
 * never a wrong value).
 */
export declare const projectionCacheDomainSpec: {
    name: string;
    version: number;
    tables: {
        sessions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<SessionId, {
            identity: {
                createdAt: number;
                cwd?: string | undefined;
            };
            rows: Record<string, {
                ver: number;
                seq: number;
                val: z.core.util.JSONType;
            }>;
        }>;
    };
};
//# sourceMappingURL=spec.d.ts.map