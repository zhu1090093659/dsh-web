/**
 * Bounded per-session write batching for the shared persistence coordinator.
 * @module @deepseek-ai/dsh-session-persistence/write-behind
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** Dependencies and scheduling policy for one live session's write controller. */
export interface SessionWriteBehindOptions {
    /** Maximum intentional batching wait after an idle queue receives work. */
    readonly maxDelayMs: number;
    /** Persist one stable ordered prefix; resolves only after backend durability. */
    readonly write: (events: readonly SessionEvent[]) => Promise<void>;
    /** Observe a detached background write failure without rejecting the producer. */
    readonly reportBackgroundFailure: (error: unknown) => void;
}
/**
 * Owns one live session's pending events, fixed batching deadline, active write,
 * failure retention, and explicit quiescence barrier.
 */
export declare class SessionWriteBehind {
    private readonly options;
    private pending;
    private timer;
    private active;
    private barrier;
    private deadlineExpired;
    private automaticPaused;
    /**
     * @param options - fixed scheduling policy and durable batch sink.
     */
    constructor(options: SessionWriteBehindOptions);
    /** Whether this controller owns queued events or an active durable write. */
    get hasWork(): boolean;
    /**
     * Copy one event into the persistence-owned queue and start a fixed deadline
     * when the automatic path is idle.
     * @param event - frozen live event to retain independently of its producer.
     */
    enqueue(event: SessionEvent): void;
    /**
     * Cancel the batching wait and durably drain through a quiescent point.
     * Concurrent callers join the same barrier.
     * @returns a promise that rejects if the barrier's durable retry fails.
     */
    flush(): Promise<void>;
    /** Cancel the current automatic deadline without draining retained work. */
    cancelAutomaticWait(): void;
    /** Start the one fixed window for the current pending prefix. */
    private armTimer;
    /** Cancel any pending automatic deadline. */
    private cancelTimer;
    /** Start a background write now, or remember that an active write used the budget. */
    private onDeadline;
    /** Start one detached write whose failure is reported and retained. */
    private startBackground;
    /** Continue immediately after an over-budget active write, otherwise keep its timer. */
    private continueAutomatic;
    /** Await overlapping work, drain to quiescence, and settle the shared barrier. */
    private drainBarrier;
    /** Start one stable pending prefix, retaining it in order if durability fails. */
    private startWrite;
}
//# sourceMappingURL=write-behind.d.ts.map