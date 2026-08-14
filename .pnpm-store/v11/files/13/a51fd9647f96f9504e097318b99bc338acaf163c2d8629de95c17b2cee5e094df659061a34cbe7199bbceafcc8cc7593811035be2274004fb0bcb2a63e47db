//#region lib/types/index.js
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
var TimeoutReason = class extends Error {
	code;
	timeoutMs;
	name = "TimeoutReason";
	/**
	* @param code Capability-owned timeout code (e.g. `BASH_TIMEOUT`).
	* @param timeoutMs The deadline that elapsed, in milliseconds.
	*/
	constructor(code, timeoutMs) {
		super(`${code} after ${timeoutMs}ms`);
		this.code = code;
		this.timeoutMs = timeoutMs;
	}
};
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
function assertTimerDelay(timeoutMs, name) {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error(`${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
}
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
function clampTimeout(requested, def, max, name = "timeoutMs") {
	if (requested !== void 0 && (!Number.isFinite(requested) || requested <= 0)) throw new Error(`${name} must be a positive finite number`);
	return Math.min(requested ?? def, max);
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
function deadline(upstream, timeoutMs, code) {
	if (timeoutMs <= 0) return {
		signal: upstream ?? new AbortController().signal,
		[Symbol.dispose]() {}
	};
	assertTimerDelay(timeoutMs, "deadline timeoutMs");
	const timer = new AbortController();
	const id = setTimeout(() => {
		timer.abort(new TimeoutReason(code, timeoutMs));
	}, timeoutMs);
	return {
		signal: upstream !== void 0 ? AbortSignal.any([upstream, timer.signal]) : timer.signal,
		[Symbol.dispose]() {
			clearTimeout(id);
		}
	};
}
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
function idleWatchdog(upstream, timeoutMs, code) {
	assertTimerDelay(timeoutMs, "idleWatchdog timeoutMs");
	const timeout = new AbortController();
	const signal = upstream === void 0 ? timeout.signal : AbortSignal.any([upstream, timeout.signal]);
	let timer;
	let outstanding = false;
	let disposed = false;
	const arm = () => {
		if (timer !== void 0) clearTimeout(timer);
		timer = setTimeout(() => {
			timeout.abort(new TimeoutReason(code, timeoutMs));
		}, timeoutMs);
	};
	return {
		signal,
		async next(iterator) {
			if (disposed) throw new Error("idleWatchdog is disposed");
			if (outstanding) throw new Error("idleWatchdog next is already outstanding");
			outstanding = true;
			arm();
			try {
				return await iterator.next();
			} finally {
				clearTimeout(timer);
				timer = void 0;
				outstanding = false;
			}
		},
		pulse() {
			if (disposed || !outstanding) return;
			arm();
		},
		[Symbol.dispose]() {
			if (disposed) return;
			disposed = true;
			if (timer !== void 0) clearTimeout(timer);
			timer = void 0;
		}
	};
}
/**
* Recover a timeout reason from a reason-bearing object. Supplying `code`
* distinguishes this deadline from a nested upstream deadline; a foreign code
* follows the ordinary cancellation path.
*
* @param x An {@link AbortSignal} or any `{ reason }` carrier (e.g. a caught abort error).
* @param code When provided, only a {@link TimeoutReason} with this exact `code` matches.
* @returns The matching {@link TimeoutReason}, else `undefined`.
*/
function timeoutOf(x, code) {
	const reason = x.reason;
	if (!(reason instanceof TimeoutReason)) return void 0;
	return code === void 0 || reason.code === code ? reason : void 0;
}
//#endregion
export { MAX_TIMER_DELAY_MS, TimeoutReason, clampTimeout, deadline, idleWatchdog, timeoutOf };
