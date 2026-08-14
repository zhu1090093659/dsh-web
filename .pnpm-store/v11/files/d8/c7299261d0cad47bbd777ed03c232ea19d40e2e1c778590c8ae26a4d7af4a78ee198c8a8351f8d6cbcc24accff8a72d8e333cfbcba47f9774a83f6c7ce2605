/**
 * Generic per-session projection value store (push model; see the
 * session-projection subsystem page, docs/subsystems/session-projection.md):
 * the host is the only computation site; the client holds finished
 * whole values per key — `key → { value, seq }` — seeded by the history tail
 * page's projections block and updated by `session/projection` push frames,
 * under the single rule **higher seq wins**. No client-side domain folding
 * exists: a domain ships projection support with zero client code. Per-key
 * bare observable faces feed `useProjection` (web-react binds them).
 */
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';
import type { ObservableSnapshot } from '../contract/store.ts';
export type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';
/**
 * The fifth framework hook seat (see the session-projection subsystem page,
 * docs/subsystems/session-projection.md): key-addressed
 * projection reader delivered through the standard kit. `undefined` uniformly
 * means capability absent — host unit unmounted, or no baseline/frame has
 * carried the key yet. The selector overload mirrors useSession (per-key uSES
 * binding; reference stability holds because a key's value reference changes
 * only when a frame or baseline lands).
 */
export type UseProjection = {
    <K extends Extract<keyof SessionProjectionMap, string>>(key: K): SessionProjectionMap[K] | undefined;
    <K extends Extract<keyof SessionProjectionMap, string>, S>(key: K, selector: (value: SessionProjectionMap[K] | undefined) => S, eq?: (a: S, b: S) => boolean): S;
};
/**
 * Tail-page projections baseline — structurally identical to the wire's
 * `SessionProjectionsBlock` (apiproxy api layer), restated here so the
 * React-free store depends only on the type table, not the wire package's
 * response vocabulary.
 */
export interface ProjectionsBaseline {
    /** The consistent-cut seq (equals the window tail seq by construction). */
    asOfSeq: number;
    /** Whole current values by key; a registered key absent here means the capability is absent. */
    values: Partial<SessionProjectionMap>;
}
/**
 * One session's projection values. Framework semantics, uniform across every
 * key: a baseline seeds rows at its cut, a push frame updates one row, and in
 * both paths a lower-or-equal seq loses — a replayed frame cannot regress a
 * value, a stale baseline cannot overwrite a newer frame. A key the store has
 * never seen reads `undefined` (capability absent). Faces are identity-stable
 * per key (create-on-demand, cached) so the React side binds each exactly
 * once; the store-level channel (`subscribeAny`) serves coarse consumers (the
 * manager's list projection reads the `title` key).
 */
export declare class ProjectionValueStore {
    private readonly rows;
    private readonly channels;
    private valuesCache;
    /** Coarse any-key channel (no snapshot cache to rebuild: reads hit rows directly). */
    private readonly anyNotifier;
    /**
     * Key-addressed bare observable face (the useProjection resolution path).
     * Always defined — absence is an `undefined` snapshot, never a missing
     * face, so a component may subscribe before the key ever carries a value.
     * @param key - projection key.
     * @returns the identity-stable face for this key.
     */
    faceOf(key: string): ObservableSnapshot<unknown>;
    /**
     * Current whole value for a key (erased framework read; typed reads go
     * through `useProjection`'s map lookup).
     * @param key - projection key.
     * @returns the value, or undefined while the key is absent.
     */
    get(key: string): unknown;
    /**
     * Read every current projection value as one reference-stable snapshot.
     * @returns The same frozen value map until a row changes.
     */
    values(): Readonly<Partial<SessionProjectionMap>>;
    /**
     * Subscribe to any-key changes (microtask-batched) — the manager's list
     * rebuild channel.
     * @param listener - change callback.
     * @returns the unsubscribe function.
     */
    subscribeAny(listener: () => void): () => void;
    /**
     * Apply one finished value (the `session/projection` push-frame path).
     * @param key - projection key.
     * @param value - whole value computed by the host unit.
     * @param seq - the unit's watermark at emission.
     */
    apply(key: string, value: unknown, seq: number): void;
    /**
     * Seed from a history tail page's projections block: every carried key
     * lands under the same seq rule as frames; a key the block omits is
     * capability-absent as of the cut — its row clears unless a newer frame
     * already superseded the cut (a stale baseline can neither overwrite nor
     * clear newer values).
     * @param baseline - the response's projections block.
     */
    seed(baseline: ProjectionsBaseline): void;
    /**
     * Drop rows past a mux-generation baseline (`session/subscribed.lastSeq`):
     * a row claiming knowledge beyond the host's own durable baseline rode
     * state a restart lost — under last-wins it would wrongly outrank the
     * host's recomputed (lower-seq) values forever. Durable replay and the next
     * baseline re-seed whatever truly survived (the title-snapshot precedent,
     * generalized).
     * @param lastSeq - the subscribed frame's durable baseline seq.
     */
    truncate(lastSeq: number): void;
    private changed;
    private channel;
}
//# sourceMappingURL=projection-store.d.ts.map