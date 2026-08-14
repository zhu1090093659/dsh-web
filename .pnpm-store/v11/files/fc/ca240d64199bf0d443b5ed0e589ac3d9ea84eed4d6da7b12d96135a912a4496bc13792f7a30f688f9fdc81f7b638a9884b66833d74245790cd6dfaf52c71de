/**
 * Read-only enumeration of durable subagent children and descendant trees
 * straight from the live session store and optional session persistence — no
 * query service. Candidates come from one live-preferred corpus; each child's
 * mode/label is the registered `subagent` projection unit's value, resolved
 * down a three-rung ladder: the registry's watermark cache for a live child,
 * a durable projection-cache row when it serves an own-suffix identity (the
 * seq gate), and one persistence inspection folded through the registry
 * otherwise, validated against the enumerated lifecycle. The projection fold
 * is the single classification authority — this module parses no descriptor
 * itself. Absent persistence, enumeration is live-only: a cold child is
 * unreachable for resume anyway, so its absence is capability absence, not an
 * error. The module owns no catalog state and does not consult Activation,
 * Agent-registry, continuation-manager, or provider state.
 *
 * @module @deepseek-ai/dsh-subagent
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
/**
 * One entry of a {@link listChildren} result, ordered by header `createdAt`
 * with ties broken on id. Only a candidate whose durable header has
 * `origin: 'subagent'` is interpreted. A served `subagent` projection value
 * produces a `child`; a settled candidate whose fold served no identity
 * produces a `diagnostic`; a running candidate without one is omitted — its
 * descriptor may not be appended yet (the creation window). Diagnostics
 * relay the projection fold's outcome or a failed read, never a per-child
 * event scan, and never expose model-hidden descriptor content.
 */
export type SubagentListEntry = {
    readonly kind: 'child';
    /** The durable child session id, stable across Activations. */
    readonly id: SessionId;
    /**
     * Store snapshot activity: `running` means the logical record is live in
     * `ctx.sessions`; `inactive` means it exists only in persistence. Neither
     * encodes a durable outcome, and a continuable child may still reject
     * delivery as an ownership conflict.
     */
    readonly activity: 'running' | 'inactive';
    /** Whether a direct descendant has durable `origin: 'subagent'`. */
    readonly hasChildren: boolean;
} & ({
    /** A terminal one-shot child. */
    readonly mode: 'one-shot';
    /** Optional durable creation label from the child's descriptor. */
    readonly label?: string;
} | {
    /** A resumable conversation. */
    readonly mode: 'continuable';
    /** Durable creation label from the child's descriptor. */
    readonly label: string;
}) | {
    readonly kind: 'diagnostic';
    /** The candidate's session id. */
    readonly id: SessionId;
    /**
     * Why the candidate has no `child` row: `corrupt` for a settled candidate
     * whose projection fold served no identity (a missing, malformed, or
     * unrecognized-version descriptor — deliberately undistinguished), and
     * for any candidate whose log makes a registered unit's fold or schema
     * throw (deterministic data damage, contained per child); `unavailable`
     * when the candidate's persistence inspection failed (retried on the
     * next listing). `unsupported` is never produced; it remains in the
     * union for consumers that route on it.
     */
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable';
};
/**
 * One entry of a descendant listing: the interpreted subagent facts plus its
 * position in the complete session tree. `parentId` is the durable direct
 * parent from the enumerated header, and `depth` counts edges from the root.
 */
export type SubagentDescendantListEntry = SubagentListEntry & {
    /** Durable direct parent of this candidate in the enumerated tree. */
    readonly parentId: SessionId;
    /** Edge distance from the requested root; direct children are `1`. */
    readonly depth: number;
};
/**
 * Enumerate one parent's origin-classified direct children from the
 * live-preferred merge of `ctx.sessions` and optional session persistence,
 * serving each identity from the `subagent` projection unit: the registry's
 * watermark snapshot for a live child; for a cold one, a durable
 * projection-cache row when it serves an own-suffix identity (the seq gate),
 * else one bounded-concurrency persistence inspection folded through the
 * registry.
 * @see SubagentRuntime.listChildren for the public cancellation and failure contract.
 * @param ctx - context carrying the session store, the projection registry,
 *   optional persistence, and the optional projection cache.
 * @param parentSessionId - parent session whose direct children are listed.
 * @param signal - caller-owned cancellation observed around every persistence read.
 * @returns children and per-child diagnostics ordered by `createdAt`, then id.
 * @throws {@link SubagentError} when the projection registry or the session
 *   store is not mounted, or the caller cancels the listing.
 */
export declare function listChildren(ctx: Context, parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>;
/**
 * Enumerate every session-backed subagent below one root in stable pre-order.
 * Ordinary sessions and one-shot children remain traversal nodes, so a
 * continuable child below either is still discovered. Classification uses the
 * same projection-backed runtime as {@link listChildren}; no Agent is loaded or
 * resumed.
 * @see SubagentRuntime.listDescendants for the public cancellation and failure contract.
 * @param ctx - context carrying the session store, projection registry, and optional persistence/cache.
 * @param rootSessionId - session whose complete descendant tree is listed.
 * @param signal - caller-owned cancellation observed around every persistence read.
 * @returns interpreted subagents with durable direct-parent and root-relative depth.
 * @throws {@link SubagentError} under the same conditions as {@link listChildren}.
 */
export declare function listDescendants(ctx: Context, rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>;
//# sourceMappingURL=list-children.d.ts.map