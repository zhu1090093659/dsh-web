/**
 * Surface layer on top of the session event log: an ordered view of events
 * that produce LLM messages. The append-only log remains the source of truth.
 *
 * Browser-safe: web clients consume this subpath export, so it must stay free
 * of `node:` imports (they break the vite bundle).
 *
 * @module @deepseek-ai/dsh-session/surface
 */
import type { Message } from '@deepseek-ai/dsh-llm';
import type { SessionEvent, SurfaceEvent, SurfaceOp } from './types.ts';
/**
 * Whether an event type can join the model-visible surface.
 * @param type - event type to test.
 * @returns true for one of the three message-producing event types.
 */
export declare function isSurfaceEligibleType(type: string): boolean;
/**
 * Narrow an event to a surface-eligible event carrying its required marker.
 * @param event - event to test.
 * @returns true when both the type and marker identify a surface event.
 */
export declare function isSurfaceEvent(event: SessionEvent): event is SurfaceEvent;
/**
 * Narrow an event to an append-origin surface event: one that entered the
 * surface at its own log position and was never itself a replacement copy.
 *
 * The model-visible surface deliberately shadows replaced ranges, so it is the
 * wrong source for a human transcript — a landed replacement would erase
 * conversation the user already saw. Append-origin events are that transcript's
 * durable source material; replacement copies stay model-only.
 * @param event - event to test.
 * @returns true when the event appended to the surface tail.
 */
export declare function isAppendSurfaceEvent(event: SessionEvent): event is SurfaceEvent & {
    surfaceOp: 'append';
};
/**
 * Narrow an event to a surface replacement: a node that shadowed an existing
 * surface range instead of appending to the tail. The counterpart of
 * {@link isAppendSurfaceEvent} over the two {@link SurfaceOp} variants.
 * @param event - event to test.
 * @returns true when the event replaced a surface range.
 */
export declare function isReplacementSurfaceEvent(event: SessionEvent): event is SurfaceEvent & {
    surfaceOp: Extract<SurfaceOp, {
        op: 'replace';
    }>;
};
/**
 * Project a single event into the LLM message it derives to, or null when it
 * produces none — a non-surface event (chunk, boundary, log-only record) or an
 * empty-content assistant/message (which exists only to host usage). This is
 * THE per-node projection rule: `Session.deriveMessages` folds it over the
 * live surface, external reconstructors and pure projections fold the same
 * function over a log prefix's surface to rebuild the exact messages any
 * request was built from. The returned message is the already frozen message
 * nested in the event wrapper and shared by delivery, durable history, and
 * model requests.
 * @param event - the event to project.
 * @returns the derived message, or null when the event produces none.
 */
export declare function deriveEventMessage(event: SessionEvent): Message | null;
/** One replacement operation observed while folding a session surface. */
export interface SurfaceFoldReplacement {
    /** Seq of the event that replaced the prior surface range. */
    seq: number;
    /** Declared inclusive start seq of the replaced surface range. */
    start: number;
    /** Declared inclusive end seq of the replaced surface range. */
    end: number;
    /** Actual surface entries removed by the operation, in surface order. */
    shadowedSeqs: number[];
}
/** Complete result of replaying the surface operations in a session log. */
export interface SurfaceFoldResult {
    /** Current surface event sequences in model-visible order. */
    nodes: number[];
    /** Replacement operations in event order. */
    replacements: SurfaceFoldReplacement[];
}
/** Readonly live projection of the message-producing session events. */
export interface SessionSurface {
    /** Current surface event sequences in model-visible order. */
    readonly nodes: readonly number[];
    /** Monotonic count of committed positional replacements. */
    readonly replaceGeneration: number;
}
/**
 * Replay a complete session log through the canonical surface fold.
 * @param events - session events in contiguous seq order.
 * @returns detached current sequences and replacement history.
 * @throws when an event violates surface metadata, source-event references, range, or tool-result rewrite rules.
 */
export declare function foldSurface(events: readonly SessionEvent[]): SurfaceFoldResult;
/** Incremental ordered surface view and append-boundary validator. */
export declare class SurfaceManager implements SessionSurface {
    private log;
    private readonly baseSeq;
    /** Shared transition state; replacement history is not retained. */
    private _state;
    /** Last processed absolute seq. */
    private _lastProcessedSeq;
    /** Candidate already validated by `validateNext`, pending exact log admission. */
    private _pendingPlan;
    /**
     * @param log - Contiguous complete log or loaded event window.
     * @param baseSeq - Absolute sequence of the window's first event.
     */
    constructor(log: readonly SessionEvent[], baseSeq?: number);
    /**
     * Validate the next candidate without mutating the committed surface.
     * @param event - candidate event that has not entered the log yet.
     */
    validateNext(event: SessionEvent): void;
    /** Monotonic count of folded positional replacements. */
    get replaceGeneration(): number;
    /** Surface event sequences in model-visible order. */
    get nodes(): readonly number[];
    /** Fold events appended since the previous access. */
    private _processDelta;
}
//# sourceMappingURL=surface.d.ts.map