/**
 * Shared timeout arithmetic, signal fusion, and classification. The library
 * only notifies through abort signals; each capability still owns the mechanism
 * that stops its work and translates timeout reasons into public outcomes.
 * @module @deepseek-ai/dsh-timeout
 */
/**
 * Internal abort reason carrying a capability-owned code and elapsed deadline.
 * Providers translate it through {@link timeoutOf} before returning to callers.
 */
export declare class TimeoutReason extends Error {
    readonly code: string;
    readonly timeoutMs: number;
    name: string;
    /**
     * @param code Capability-owned timeout code (e.g. `BASH_TIMEOUT`).
     * @param timeoutMs The deadline that elapsed, in milliseconds.
     */
    constructor(code: string, timeoutMs: number);
}
/** Largest delay Node schedules without clamping it to one millisecond. */
export declare const MAX_TIMER_DELAY_MS = 2147483647;
/**
 * Validate a caller's optional timeout hint, use the backend default, then cap
 * it. Supplied values must be positive and finite; zero is not a public
 * disable-timeout sentinel.
 *
 * @param requested The caller's optional hint; validated when present.
 * @param def The backend default applied when `requested` is absent.
 * @param max The backend upper bound the result is capped to.
 * @param name Field name used in the thrown message (so the caller sees which input was
 *   bad).
 * @returns The effective timeout in milliseconds: `min(requested ?? def, max)`.
 */
export declare function clampTimeout(requested: number | undefined, def: number, max: number, name?: string): number;
/** A deadline signal plus the cleanup that clears its timer (dispose-once). */
export interface Deadline {
    /** Aborts on upstream cancellation OR on timeout (the timeout carries a {@link TimeoutReason}). */
    readonly signal: AbortSignal;
    /** Clear the timer. Safe to call once; `using` calls it at scope exit. */
    [Symbol.dispose](): void;
}
/** Rearmable timeout around one outstanding async-iterator demand. */
export interface IdleWatchdog {
    /** Stable signal aborted by upstream cancellation or this watchdog's timeout. */
    readonly signal: AbortSignal;
    /**
     * Await one iterator demand while the idle timer is armed.
     * @param iterator - iterator whose next value represents provider progress.
     * @returns the iterator's next result.
     */
    next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>>;
    /** Rearm an outstanding demand after transport activity that yields no iterator value; otherwise a no-op. */
    pulse(): void;
    /** Clear an armed timer; safe to call once at the owning stream's exit. */
    [Symbol.dispose](): void;
}
/**
 * Fuse upstream cancellation with an identifiable timeout. `timeoutMs <= 0` is
 * the internal no-timer sentinel; the returned disposer clears an armed timer.
 * The signal only notifies, so callers must stop their own work.
 *
 * @param upstream The caller's cancellation signal, if any, fused into the result.
 * @param timeoutMs Deadline in milliseconds; `<= 0` means "no timeout" (arm no timer).
 * @param code Capability-owned code stamped onto the timeout's {@link TimeoutReason}.
 * @returns The fused {@link Deadline} (signal + timer cleanup).
 */
export declare function deadline(upstream: AbortSignal | undefined, timeoutMs: number, code: string): Deadline;
/**
 * Create a rearmable idle watchdog for an async iterator. The timer exists only
 * while {@link IdleWatchdog.next} is outstanding, so consumer think time does
 * not count as provider idle time. The returned signal is stable for the whole
 * call and only notifies; the iterator must observe it to terminate its work.
 *
 * @param upstream - caller cancellation fused into the stable signal.
 * @param timeoutMs - positive finite idle interval in milliseconds.
 * @param code - capability-owned code carried by the timeout reason.
 * @returns a stable signal, guarded next operation, and timer disposer.
 */
export declare function idleWatchdog(upstream: AbortSignal | undefined, timeoutMs: number, code: string): IdleWatchdog;
/**
 * Recover a timeout reason from a reason-bearing object. Supplying `code`
 * distinguishes this deadline from a nested upstream deadline; a foreign code
 * follows the ordinary cancellation path.
 *
 * @param x An {@link AbortSignal} or any `{ reason }` carrier (e.g. a caught abort error).
 * @param code When provided, only a {@link TimeoutReason} with this exact `code` matches.
 * @returns The matching {@link TimeoutReason}, else `undefined`.
 */
export declare function timeoutOf(x: AbortSignal | {
    reason?: unknown;
}, code?: string): TimeoutReason | undefined;
//# sourceMappingURL=index.d.ts.map