/**
 * Service Definition and drive registry for the session-projection capability seam: the merge-extensible `SessionProjectionMap` type
 * table, the `ProjectionDefinition` state-driven computation unit contract,
 * and the `ctx.sessionProjections` registry that DRIVES every registered unit
 * forward eagerly over committed session events. Domain host plugins
 * contribute pure mathematics (init/apply/view); the framework owns the
 * subscription, the per-session watermark cache, and change notification;
 * carriers consume the snapshot read face and the change feed. Neither side
 * knows the other
 * (capability-seam three-way split). Design authority: the session-projection
 * RFC (.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md).
 *
 * Whole-value event rule (load-bearing): a state-carrying log event MUST
 * carry the complete post-change state, never a bare delta — it keeps every
 * unit's transition trivially cheap and every served value self-describing.
 *
 * @module @deepseek-ai/dsh-session-projection
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { ZodType } from 'zod';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessionProjections: SessionProjectionRegistry;
    }
}
import type { SessionProjectionMap } from './types.ts';
export type { SessionProjectionMap } from './types.ts';
/**
 * One domain's state-driven computation unit: three pure synchronous
 * functions plus declarations — never an opaque getter. The framework drives
 * `apply` on every committed session event; the domain holds no
 * subscriptions and owns only the mathematics. All three functions MUST be
 * synchronous (an async unit would tear the carriers' consistency cut) and
 * `state` MUST be plain JSON (the persisted-cache precondition).
 */
export interface ProjectionDefinition<K extends keyof SessionProjectionMap, S> {
    /** The projection key this unit owns (its `SessionProjectionMap` entry). */
    key: K;
    /** Validates the wire payload (`view` output) before it leaves the host. */
    schema: ZodType<SessionProjectionMap[K]>;
    /**
     * State for the empty log.
     * @returns the initial state.
     */
    init(): S;
    /**
     * Pure transition: previous state + one committed event → next state. A
     * unit uninterested in an event MUST return the same state reference — an
     * unchanged reference (`Object.is`) produces zero downstream work.
     * @param state - the state covering all prior events.
     * @param event - the next committed session event.
     * @returns the next state (same reference when the event is not the unit's).
     */
    apply(state: S, event: SessionEvent): S;
    /**
     * State → wire payload (the read-side projection).
     * @param state - the current state.
     * @returns the whole current value for this unit's key.
     */
    view(state: S): SessionProjectionMap[K];
    /**
     * Persisted-cache invalidation version: bump whenever the serialized state fields or the
     * fold semantics change, so persisted `(sessionId, key, ver, seq, val)`
     * rows from an older unit are discarded instead of being forward-applied
     * into garbage. Non-negative integer.
     */
    stateVersion: number;
}
/**
 * Change-feed listener: one unit's value changed for one session. `value` is
 * the schema-validated `view` output; `seq` is the unit's watermark at
 * emission (the seq of the event that caused the change).
 */
export type ProjectionChangeListener = (session: Session, key: Extract<keyof SessionProjectionMap, string>, value: unknown, seq: number) => void;
/**
 * One consistent read cut over every registered unit for one session.
 * `asOfSeq` is the shared watermark — the seq of the last event every value
 * reflects (`-1` for an empty log, mirroring `session/subscribed.lastSeq`).
 */
export interface ProjectionSnapshot {
    /** Seq of the last event the values reflect; -1 for an empty log. */
    asOfSeq: number;
    /** Whole current value per registered key. */
    values: Partial<SessionProjectionMap>;
}
/**
 * One unit's checkpoint: its internal state (plain JSON by the unit
 * contract), the seq of the last event folded into it, and the unit
 * `stateVersion` that produced it — the persisted projection-cache row
 * `(sessionId, key, ver, seq, val)` minus the two outer keys. A row is
 * never authoritative, only a fold shortcut: `restore` discards it on a
 * version mismatch or when it claims events past the stored log end.
 */
export interface ProjectionCheckpointRow {
    /** The registering unit's `stateVersion` at fold time. */
    ver: number;
    /** Seq of the last event folded into `val`; -1 for the empty log. */
    seq: number;
    /** The unit's internal state — plain JSON per the unit contract. */
    val: unknown;
}
/** Checkpoint rows keyed by projection key (one session's persisted cache value). */
export type ProjectionCheckpoint = Record<string, ProjectionCheckpointRow>;
/**
 * `ctx.sessionProjections`: the projection unit table and its drive. The
 * service subscribes to `session/event` once; every committed event passes
 * every registered unit's `apply` (eager drive), and a changed state
 * reference notifies the change feed with the schema-validated view.
 * Cells build lazily — a unit registered after events flowed, or a session
 * older than the registry, folds `init` over the in-memory log on first
 * touch (event or read). Registration is an effect (disposer rides the
 * calling fiber): an unloaded domain plugin's key disappears from snapshots
 * and clients read it as capability absence. Domain
 * plugins register under `ctx.inject(['sessionProjections'], …)` so headless
 * assemblies without the registry stay unaffected. Registrants sharing a key
 * share one unit and are counted: the same tool package mounted in N agent
 * presets registers N times, and the key survives until the last one
 * unloads.
 */
export declare class SessionProjectionRegistry extends Service {
    private readonly registrations;
    private readonly listeners;
    /**
     * Create and install the registry as `ctx.sessionProjections`.
     * @param ctx - Cordis context that owns the service.
     */
    constructor(ctx: Context);
    /**
     * Register one domain's unit. The registration is an effect on the calling
     * context's fiber: disposing the fiber (or calling the returned disposer)
     * removes the key — and the unit's cached cells — from subsequent drives
     * and snapshots.
     * @param definition - key, state schema, pure unit functions, and stateVersion.
     * @returns the exact disposer that unregisters this unit.
     */
    register<K extends keyof SessionProjectionMap, S>(definition: ProjectionDefinition<K, S>): () => void;
    /**
     * Subscribe to the change feed. The registration is an effect on the
     * calling context's fiber.
     * @param listener - called once per unit whose state reference changed, per committed event.
     * @returns the exact disposer that unsubscribes.
     */
    onChanged(listener: ProjectionChangeListener): () => void;
    /**
     * One consistent cut over every registered unit for one session, read from
     * the watermark cache (missing cells fold lazily over the in-memory log).
     * Fully synchronous — every value and `asOfSeq` reflect the same log
     * position. Each value passes its unit's schema before leaving.
     * @param session - the session whose projection values are read.
     * @returns the snapshot; `values` is empty when no unit is registered.
     */
    snapshot(session: Session): ProjectionSnapshot;
    /**
     * State-level checkpoint of every registered unit for one session, read
     * from the watermark cache (missing cells fold lazily over the in-memory
     * log). This is the write side of the persisted projection cache: the
     * returned rows are the `(key → {ver, seq, val})` part of the durable
     * `(sessionId, key, ver, seq, val)`
     * rows. Every `val` is a DETACHED structured clone — never the live
     * cell reference: the watermark cache is this registry's authoritative
     * mutable state, and a caller reaching the live reference could corrupt
     * every subsequent snapshot and frame through it (plain JSON by the unit
     * contract, so the clone is total).
     * @param session - the session whose unit states are checkpointed.
     * @returns one row per registered key; empty when no unit is registered.
     */
    checkpoint(session: Session): ProjectionCheckpoint;
    /**
     * The stored seq a {@link restore} tail read over `checkpoint` must start
     * at: one event BELOW the lowest usable watermark (a row is usable when
     * its `ver` matches the live unit's `stateVersion`; an absent or mismatched row
     * pulls the floor to `0` — that key must refold the full log). The
     * one-below anchor is load-bearing: the tail then proves how far the
     * stored log still extends, so {@link restore} can detect a log that
     * shrank below a row's watermark (crash-repair truncation) instead of
     * serving the stale row as current — an empty tail read from the anchor
     * yields an end below every watermark and the restore rejects for a full
     * re-read.
     * @param checkpoint - persisted rows for one session (possibly stale or empty).
     * @returns the seq to hand the persistence `readFrom`, or `undefined`
     *   when no unit is registered (no read needed — {@link restore} would
     *   serve empty values regardless).
     */
    restoreFloor(checkpoint: ProjectionCheckpoint): number | undefined;
    /**
     * View a checkpoint's rows without any log read: for every registered
     * unit whose row's `ver` matches, serve the schema-validated
     * `view` of the stored state; mismatched or absent rows leave their key
     * absent (a cold or listing consumer treats it as not-yet-available and a
     * fuller read path refolds it). The zero-I/O rung of the read ladder —
     * values are as stale as their rows, never wrong.
     * @param checkpoint - persisted rows for one session (possibly stale or empty).
     * @returns whole values per key with a usable row; empty when none.
     */
    viewCheckpoint(checkpoint: ProjectionCheckpoint): Partial<SessionProjectionMap>;
    /**
     * Cold read: fold every registered unit over a stored log suffix, seeding
     * each from its checkpoint row when usable — the one read recipe (cached
     * state + forward tail replay + `view`) applied without a live `Session`.
     * Call with the events returned by a persistence
     * `readFrom(id, restoreFloor(checkpoint))` and that same floor as
     * `baseSeq`; the floor's one-below anchor makes the supplied end honest,
     * so a shrunk log is detected here. A row is usable iff its
     * `ver` matches the live unit's `stateVersion`, it does not predate `baseSeq`
     * (`seq >= baseSeq - 1`), and it does not claim events past the
     * supplied end (`seq <= endSeq`); an unusable row is discarded
     * and its key refolds from `init` — which is only sound over the full
     * log, so a discarded row with `baseSeq > 0` throws (the caller re-reads
     * from seq 0, e.g. after a crash-repair truncation shrank the log below
     * a row's watermark).
     * @param checkpoint - persisted rows for one session (possibly stale or empty).
     * @param events - the stored events with `seq >= baseSeq`, in seq order.
     * @param baseSeq - the seq `events` starts at (its first event's seq when non-empty).
     * @returns the snapshot cut at the supplied log end (`asOfSeq` is the last
     *   supplied event's seq, `baseSeq - 1` for an empty tail) plus the
     *   refreshed checkpoint rows at that cut, ready for a durable write-back.
     */
    restore(checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: number): {
        snapshot: ProjectionSnapshot;
        checkpoint: ProjectionCheckpoint;
    };
    /** Fold one unit from init over `events`, producing a cell watermarked at the last folded event. */
    private buildCell;
    /** Read (or lazily build, folding the full in-memory log) one unit's cell. */
    private cellFor;
    /** Eager drive: pass one committed event through every registered unit; notify on changed references. */
    private drive;
}
export default SessionProjectionRegistry;
//# sourceMappingURL=index.d.ts.map