import { Service } from "@deepseek-ai/cordis";
import { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, SessionPreparation, adoptSessionEvent, interruptedTurnClosers, snapshotJsonValue, snapshotSessionEvent } from "@deepseek-ai/dsh-session";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
//#region lib/types/revision.js
/** Opaque revision identity for lightweight persistence observations. */
/**
* Brand a backend revision for the provider-neutral persistence contract.
* @param value - backend-owned opaque revision representation.
* @returns the same runtime string with persistence-revision identity.
*/
function SessionPersistenceRevision(value) {
	return value;
}
//#endregion
//#region lib/types/preparations.js
/**
* Bounded sharing and exclusive reservation of unpublished Sessions.
* @module @deepseek-ai/dsh-session-persistence/preparations
*/
/** Per-coordinator cold-read sharing, exclusive reservation, and ready-entry LRU. */
var SessionPreparations = class {
	capacity;
	entries = /* @__PURE__ */ new Map();
	constructor(capacity) {
		this.capacity = capacity;
	}
	/**
	* Whether this pool currently knows about an unpublished identity.
	* @param id - session identity.
	* @returns whether an entry exists for the identity.
	*/
	has(id) {
		return this.entries.has(id);
	}
	/**
	* Observe one prepared source, sharing an in-flight read for the same id.
	* @param id - session identity.
	* @param load - cold loader used when no entry exists.
	* @param signal - optional cancellation signal while waiting.
	* @returns the shared prepared source.
	*/
	async inspect(id, load, signal) {
		const entry = this.entryFor(id, load);
		const loaded = signal === void 0 ? await entry.result : await observeQueuedAbort(entry.result, signal);
		const source = entry.source ?? loaded;
		if (this.entries.get(id) === entry && entry.phase === "ready") this.touch(entry);
		return source;
	}
	/**
	* Reserve one ready source after committing its pending durable repair.
	* @param id - session identity.
	* @param load - cold loader used when no entry exists.
	* @param commit - durable repair and cursor-state commit.
	* @param signal - optional cancellation signal while waiting.
	* @returns the exclusive reservation, or undefined if its entry was invalidated.
	*/
	async reserve(id, load, commit, signal) {
		const entry = this.entryFor(id, load);
		await (signal === void 0 ? entry.result : observeQueuedAbort(entry.result, signal));
		while (this.entries.get(id) === entry && entry.phase !== "ready") {
			const settled = entry.reservationSettled;
			/* v8 ignore next -- committing/reserved transitions install this waiter synchronously. */
			if (settled === void 0) throw new Error(`session "${id}" preparation lost its reservation waiter`);
			if (signal === void 0) await settled;
			else await observeQueuedAbort(settled, signal);
		}
		if (this.entries.get(id) !== entry) return void 0;
		const source = entry.source;
		const reservationSettled = Promise.withResolvers();
		entry.phase = "committing";
		entry.reservationSettled = reservationSettled.promise;
		entry.settleReservation = reservationSettled.resolve;
		let committed;
		try {
			committed = await commit(source);
		} catch (error) {
			this.remove(entry);
			throw error;
		}
		if (committed === void 0) {
			this.remove(entry);
			return;
		}
		entry.source = committed.source;
		try {
			signal?.throwIfAborted();
		} catch (error) {
			this.makeReady(entry);
			throw error;
		}
		if (this.entries.get(id) !== entry) return void 0;
		const reservation = {
			entry,
			source: committed.source,
			state: committed.state
		};
		entry.phase = "reserved";
		entry.reservation = reservation;
		return reservation;
	}
	/**
	* Return the exact reservation for Session publication, rejecting aliases.
	* @param session - exact Session candidate for publication.
	* @returns its reservation, or undefined when no preparation exists.
	*/
	reservationFor(session) {
		const entry = this.entries.get(session.id);
		if (entry === void 0) return void 0;
		if (entry.phase === "reserved" && entry.source?.session === session && entry.reservation !== void 0) return entry.reservation;
		throw new Error(`cannot publish session "${session.id}": persisted state already owns this identity`);
	}
	/**
	* Consume a reservation after its exact Session has attached.
	* @param reservation - reservation to consume.
	*/
	attach(reservation) {
		const { entry } = reservation;
		if (this.entries.get(entry.id) !== entry || entry.reservation !== reservation) throw new Error(`session "${entry.id}" preparation is no longer reserved`);
		this.remove(entry);
	}
	/**
	* Consume a reservation whose caller only needs the committed inspection.
	* @param reservation - reservation to consume.
	*/
	discard(reservation) {
		const { entry } = reservation;
		if (this.entries.get(entry.id) !== entry || entry.reservation !== reservation) return;
		this.remove(entry);
	}
	/**
	* Return a reusable unpublished reservation to the ready LRU.
	* @param reservation - reservation to release.
	* @param reusable - whether the source remains valid for reuse.
	*/
	release(reservation, reusable) {
		const { entry } = reservation;
		if (this.entries.get(entry.id) !== entry || entry.reservation !== reservation || entry.phase !== "reserved") return;
		if (!reusable) {
			this.remove(entry);
			return;
		}
		delete entry.reservation;
		this.makeReady(entry);
	}
	/**
	* Discard a prepared view after the durable log changes.
	* @param id - changed session identity.
	*/
	invalidate(id) {
		const entry = this.entries.get(id);
		if (entry !== void 0) this.remove(entry);
	}
	/**
	* Discard an exact stale ready source without disturbing an exclusive owner.
	* @param id - changed session identity.
	* @param expected - exact source observed before its revision check.
	* @returns whether the source was discarded, retained by a reservation, or is absent.
	*/
	discardReady(id, expected) {
		const entry = this.entries.get(id);
		if (entry === void 0 || entry.source !== expected) return "missing";
		if (entry.phase !== "ready") return "retained";
		this.remove(entry);
		return "discarded";
	}
	/**
	* Reject writes while an unpublished Session exclusively reserves the id.
	* @param id - session identity to check.
	*/
	assertWritable(id) {
		const phase = this.entries.get(id)?.phase;
		if (phase === "committing" || phase === "reserved") throw new Error(`cannot append session "${id}" while its persisted preparation is reserved`);
	}
	/**
	* Remove a completed entry for an already-serialized append adoption.
	* @param id - adopted session identity.
	* @returns the prepared source, or undefined when no ready entry exists.
	*/
	takeReady(id) {
		const entry = this.entries.get(id);
		if (entry === void 0 || entry.phase !== "ready" || entry.source === void 0) return void 0;
		this.remove(entry);
		return entry.source;
	}
	entryFor(id, load) {
		const existing = this.entries.get(id);
		if (existing !== void 0) return existing;
		const deferred = Promise.withResolvers();
		const entry = {
			id,
			result: deferred.promise,
			phase: "loading"
		};
		this.entries.set(id, entry);
		let loading;
		try {
			loading = load();
		} catch (error) {
			this.remove(entry);
			deferred.reject(error);
			return entry;
		}
		loading.then((source) => {
			if (this.entries.get(id) === entry) {
				entry.source = source;
				this.makeReady(entry);
			}
			deferred.resolve(source);
		}, (error) => {
			this.remove(entry);
			deferred.reject(error);
		});
		return entry;
	}
	makeReady(entry) {
		if (this.entries.get(entry.id) !== entry) return;
		entry.phase = "ready";
		const settle = entry.settleReservation;
		delete entry.reservationSettled;
		delete entry.settleReservation;
		settle?.();
		this.touch(entry);
	}
	remove(entry) {
		if (this.entries.get(entry.id) !== entry) return;
		this.entries.delete(entry.id);
		const settle = entry.settleReservation;
		delete entry.reservationSettled;
		delete entry.settleReservation;
		settle?.();
	}
	touch(entry) {
		this.entries.delete(entry.id);
		this.entries.set(entry.id, entry);
		let readyCount = 0;
		for (const candidate of this.entries.values()) if (candidate.phase === "ready") readyCount += 1;
		if (readyCount <= this.capacity) return;
		for (const [id, candidate] of this.entries) {
			if (candidate.phase !== "ready") continue;
			this.entries.delete(id);
			return;
		}
	}
};
/**
* Give a queued observer a prompt cancellation view without cancelling shared work.
* @param operation - shared operation whose settlement remains authoritative.
* @param signal - observer-local cancellation signal.
* @param started - whether the operation has crossed its cancellation cutoff.
* @returns the operation result or the observer's prompt cancellation.
*/
function observeQueuedAbort(operation, signal, started = () => false) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			callback();
		};
		const onAbort = () => {
			if (started()) return;
			finish(() => {
				try {
					signal.throwIfAborted();
				} catch (reason) {
					rejectObservation(reject, reason);
					return;
				}
				/* v8 ignore next -- a native AbortSignal emits abort only after becoming aborted. */
				reject(/* @__PURE__ */ new Error("queued observation abort event lacked an aborted signal"));
			});
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			finish(() => {
				resolve(value);
			});
		}, (reason) => {
			finish(() => {
				rejectObservation(reject, reason);
			});
		});
		if (signal.aborted) onAbort();
	});
}
/** Preserve an exact loader or AbortSignal reason, including legacy non-Error values. */
function rejectObservation(reject, reason) {
	reject(reason);
}
//#endregion
//#region lib/types/write-behind.js
/**
* Bounded per-session write batching for the shared persistence coordinator.
* @module @deepseek-ai/dsh-session-persistence/write-behind
*/
/**
* Owns one live session's pending events, fixed batching deadline, active write,
* failure retention, and explicit quiescence barrier.
*/
var SessionWriteBehind = class {
	options;
	pending = [];
	timer;
	active;
	barrier;
	deadlineExpired = false;
	automaticPaused = false;
	/**
	* @param options - fixed scheduling policy and durable batch sink.
	*/
	constructor(options) {
		this.options = options;
	}
	/** Whether this controller owns queued events or an active durable write. */
	get hasWork() {
		return this.pending.length > 0 || this.active !== void 0;
	}
	/**
	* Copy one event into the persistence-owned queue and start a fixed deadline
	* when the automatic path is idle.
	* @param event - frozen live event to retain independently of its producer.
	*/
	enqueue(event) {
		const wasEmpty = this.pending.length === 0;
		this.pending.push(structuredClone(event));
		if (this.barrier !== void 0) return;
		if (this.automaticPaused) {
			this.automaticPaused = false;
			this.deadlineExpired = false;
			this.armTimer();
		} else if (wasEmpty) this.armTimer();
	}
	/**
	* Cancel the batching wait and durably drain through a quiescent point.
	* Concurrent callers join the same barrier.
	* @returns a promise that rejects if the barrier's durable retry fails.
	*/
	flush() {
		if (this.barrier !== void 0) return this.barrier;
		this.cancelTimer();
		this.deadlineExpired = false;
		this.automaticPaused = false;
		const barrier = Promise.withResolvers();
		this.barrier = barrier.promise;
		this.drainBarrier(barrier.resolve, barrier.reject);
		return barrier.promise;
	}
	/** Cancel the current automatic deadline without draining retained work. */
	cancelAutomaticWait() {
		this.cancelTimer();
		this.deadlineExpired = false;
	}
	/** Start the one fixed window for the current pending prefix. */
	armTimer() {
		this.timer = setTimeout(() => {
			this.onDeadline();
		}, this.options.maxDelayMs);
	}
	/** Cancel any pending automatic deadline. */
	cancelTimer() {
		if (this.timer === void 0) return;
		clearTimeout(this.timer);
		this.timer = void 0;
	}
	/** Start a background write now, or remember that an active write used the budget. */
	onDeadline() {
		this.timer = void 0;
		if (this.active !== void 0) {
			this.deadlineExpired = true;
			return;
		}
		this.startBackground();
	}
	/** Start one detached write whose failure is reported and retained. */
	startBackground() {
		this.startWrite(true).then(() => {
			this.continueAutomatic();
		}, () => {});
	}
	/** Continue immediately after an over-budget active write, otherwise keep its timer. */
	continueAutomatic() {
		if (this.barrier !== void 0 || this.pending.length === 0) return;
		if (this.deadlineExpired) {
			this.deadlineExpired = false;
			this.startBackground();
		}
	}
	/** Await overlapping work, drain to quiescence, and settle the shared barrier. */
	async drainBarrier(resolve, reject) {
		try {
			const overlapping = this.active;
			if (overlapping !== void 0) {
				await Promise.allSettled([overlapping]);
				this.automaticPaused = false;
			}
			while (this.pending.length > 0) await this.startWrite(false);
		} catch (error) {
			this.barrier = void 0;
			reject(error);
			return;
		}
		this.barrier = void 0;
		resolve();
	}
	/** Start one stable pending prefix, retaining it in order if durability fails. */
	startWrite(background) {
		const batch = this.pending.splice(0);
		this.cancelTimer();
		this.deadlineExpired = false;
		const active = Promise.resolve().then(() => this.options.write(batch)).catch((error) => {
			this.pending = batch.concat(this.pending);
			this.cancelTimer();
			this.deadlineExpired = false;
			this.automaticPaused = true;
			if (background) this.options.reportBackgroundFailure(error);
			throw error;
		}).finally(() => {
			this.active = void 0;
		});
		this.active = active;
		return active;
	}
};
//#endregion
//#region lib/types/coordinator.js
/**
* Shared buffering, serialization, adoption, repair, and disposal orchestration
* for first-party backends. Third-party backends may implement the public
* persistence seam directly.
* @module @deepseek-ai/dsh-session-persistence/coordinator
*/
/** Default number of detached session preparations retained by a coordinator. */
const DEFAULT_PREPARED_SESSION_CACHE_SIZE = 5;
/** Default maximum intentional wait before a live session batch starts writing. */
const DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200;
/** Largest write batching delay accepted by Node's timer implementation. */
const MAX_WRITE_BATCH_DELAY_MS = MAX_TIMER_DELAY_MS;
/** Durable session contents failed validation after a successful backend read. */
var SessionPersistenceCorruptionError = class extends Error {
	/**
	* @param message - stable corruption context.
	* @param options - original validation failure.
	*/
	constructor(message, options) {
		super(message, options);
		this.name = "SessionPersistenceCorruptionError";
	}
};
/**
* The stored log is intact but this runtime cannot faithfully interpret it:
* the header carries an unsupported format version, or an event's type is
* unknown to this build and the event is not marked ignorable. Distinct from
* {@link SessionPersistenceCorruptionError} — nothing is damaged; the raw log
* remains readable at {@link location} when the backend keeps one artifact
* per session.
*/
var SessionFormatUnsupportedError = class extends Error {
	location;
	/**
	* @param message - stable reason the log cannot be interpreted, already
	*   including the raw-log path when one exists.
	* @param location - the backend's artifact location, when one exists.
	*/
	constructor(message, location) {
		super(message);
		this.location = location;
		this.name = "SessionFormatUnsupportedError";
	}
};
/**
* Direction-aware refusal text for a stored session whose format version this
* build does not read. Shared by the coordinator's load-time check and by
* backends that must refuse BEFORE decoding version-dependent structure (a
* future format may not satisfy today's structural checks at all, and the
* user must see "upgrade the harness", never "corrupt").
* @param id - the stored session id, for message context.
* @param version - the stored format version.
* @returns the stable refusal text, without a raw-log path suffix.
*/
function sessionFormatVersionRefusal(id, version) {
	return version > SESSION_FORMAT_VERSION ? `session "${id}" uses log format v${version}, but this harness reads only v${SESSION_FORMAT_VERSION}: the log was written by a newer harness — upgrade the harness to open it` : `session "${id}" uses log format v${version}, older than the supported v${SESSION_FORMAT_VERSION}, and this build ships no upgrade path for it`;
}
/** Collect the rejection reasons from a set of promises (none-throwing). */
async function settledErrors(promises) {
	const settled = await Promise.allSettled([...promises]);
	const errors = [];
	for (const result of settled) if (result.status === "rejected") errors.push(result.reason);
	return errors;
}
/** Whether a live session seed reproduces a persisted prefix exactly. */
function seedCoversPrefix(seed, prefix) {
	return prefix.length <= seed.length && prefix.every((event, index) => {
		const seedEvent = seed[index];
		return seedEvent !== void 0 && JSON.stringify(seedEvent) === JSON.stringify(event);
	});
}
/** Reject events from an obsolete v0 vocabulary that this build cannot replay. */
function assertSupportedEvents(events, id) {
	const legacyType = "request/header-delta";
	const legacy = events.find((event) => event.type === legacyType);
	if (legacy !== void 0) throw new Error(`session "${id}" contains unsupported legacy request/header-delta event at seq ${legacy.seq}`);
	const legacyModeType = "mode/set";
	const legacyMode = events.find((event) => event.type === legacyModeType);
	if (legacyMode !== void 0) throw new Error(`session "${id}" contains unsupported legacy mode/set event at seq ${legacyMode.seq}`);
	const fallback = events.find((event) => event.type === "request/header" && event.data.reason === "fallback");
	if (fallback !== void 0) throw new Error(`session "${id}" contains unsupported legacy request/header reason "fallback" at seq ${fallback.seq}`);
}
/** Return an object record without widening arrays into message payloads. */
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** Whether a record contains every required key and no key outside the optional extension set. */
function hasOnlyKeys(record, required, optional = []) {
	const allowed = [...required, ...optional];
	return Object.keys(record).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(record, key));
}
/** Mint the stable import identity for a message persisted before identities existed. */
function legacyMessageId(id, seq) {
	return `legacy-message:${id}:${seq}`;
}
/** Read a replacement target while leaving malformed surface metadata to the session validator. */
function replacementStart(event) {
	const op = asRecord(event.surfaceOp);
	return op?.["op"] === "replace" && typeof op["start"] === "number" ? op["start"] : void 0;
}
/** Whether one suffix event needs facts available only from the preceding stored prefix. */
function needsLegacyPrefix(event) {
	const data = asRecord(event.data);
	if (event.type === "steering/message") return true;
	if (data === void 0) return false;
	switch (event.type) {
		case "user/message": return !Object.hasOwn(data, "id") && Object.hasOwn(data, "content");
		case "assistant/message": return !Object.hasOwn(data, "message") && Object.hasOwn(data, "content");
		case "tool/result": return !Object.hasOwn(data, "message") && Object.hasOwn(data, "callId");
		default: return false;
	}
}
/** Upgrade the removed steering surface event into its current user-message equivalent. */
function migrateLegacySteeringEvent(event, id) {
	if (event.type !== "steering/message") return event;
	const data = asRecord(event.data);
	if (data === void 0) throw new Error(`session "${id}" contains malformed pre-react-loop steering/message at seq ${event.seq}`);
	const wrapped = asRecord(data["message"]);
	if (wrapped !== void 0 && Number.isSafeInteger(data["turn"]) && hasOnlyKeys(data, ["turn", "message"])) return {
		...event,
		type: "user/message",
		data: wrapped
	};
	if (!Number.isSafeInteger(data["turn"]) || !hasOnlyKeys(data, [
		"turn",
		"content",
		"source"
	])) throw new Error(`session "${id}" contains malformed pre-react-loop steering/message at seq ${event.seq}`);
	const { turn: _turn, ...message } = data;
	return {
		...event,
		type: "user/message",
		data: {
			...message,
			id: legacyMessageId(id, event.seq),
			role: "user"
		}
	};
}
/** Remove the obsolete trigger after verifying the complete old turn-start envelope. */
function migrateLegacyTurnStartEvent(event, id) {
	if (event.type !== "turn/start") return event;
	const data = asRecord(event.data);
	if (data === void 0 || !Object.hasOwn(data, "trigger")) return event;
	const trigger = asRecord(data["trigger"]);
	if (!Number.isSafeInteger(data["turn"]) || data["turn"] < 1 || !hasOnlyKeys(data, ["turn", "trigger"]) || trigger === void 0 || typeof trigger["kind"] !== "string" || trigger["kind"].length === 0) throw new Error(`session "${id}" contains malformed pre-react-loop turn/start at seq ${event.seq}`);
	return {
		...event,
		data: { turn: data["turn"] }
	};
}
/** Upgrade an obsolete turn ending while preserving the latest-master envelope. */
function migrateLegacyTurnEndEvent(event, id) {
	if (event.type !== "turn/end") return event;
	const data = asRecord(event.data);
	/* v8 ignore next -- a non-record current envelope cannot match a legacy shape. */
	if (data === void 0) return event;
	const malformed = () => {
		throw new Error(`session "${id}" contains malformed pre-react-loop turn/end at seq ${event.seq}`);
	};
	const reason = asRecord(data["reason"]);
	if (!Number.isSafeInteger(data["turn"]) || data["turn"] < 1 || !hasOnlyKeys(data, ["turn", "reason"]) || reason === void 0 || typeof reason["kind"] !== "string") return malformed();
	let currentReason;
	switch (reason["kind"]) {
		case "completed":
		case "blocked":
		case "max-tokens":
		case "interrupted":
			if (!hasOnlyKeys(reason, ["kind"])) return malformed();
			return event;
		case "aborted":
			if (Object.hasOwn(reason, "reason")) return event;
			if (!hasOnlyKeys(reason, ["kind"])) return malformed();
			currentReason = {
				kind: "aborted",
				reason: { kind: "legacy" }
			};
			break;
		case "disposed":
			if (!hasOnlyKeys(reason, ["kind"])) return malformed();
			currentReason = {
				kind: "aborted",
				reason: { kind: "disposed" }
			};
			break;
		case "error": {
			if (Object.hasOwn(reason, "error")) return event;
			if (!Number.isSafeInteger(reason["step"]) || reason["step"] < 0) return malformed();
			const failure = asRecord(reason["failure"]);
			if (failure !== void 0 && hasOnlyKeys(reason, [
				"kind",
				"step",
				"failure"
			]) && hasOnlyKeys(failure, ["message", "code"], [
				"status",
				"providerRetryAfterMs",
				"requestId"
			]) && typeof failure["message"] === "string" && typeof failure["code"] === "string" && (failure["status"] === void 0 || typeof failure["status"] === "number") && (failure["providerRetryAfterMs"] === void 0 || typeof failure["providerRetryAfterMs"] === "number") && (failure["requestId"] === void 0 || typeof failure["requestId"] === "string")) {
				currentReason = {
					kind: "error",
					error: failure
				};
				break;
			}
			if (!hasOnlyKeys(reason, reason["code"] === void 0 ? [
				"kind",
				"step",
				"message"
			] : [
				"kind",
				"step",
				"message",
				"code"
			]) || typeof reason["message"] !== "string" || reason["code"] !== void 0 && typeof reason["code"] !== "string") return malformed();
			currentReason = {
				kind: "error",
				error: {
					message: reason["message"],
					code: typeof reason["code"] === "string" ? reason["code"] : "UNKNOWN"
				}
			};
			break;
		}
		default: return event;
	}
	return {
		...event,
		data: {
			...data,
			reason: currentReason
		}
	};
}
/**
* Upgrade one pre-identity message event into the current wrapper shape.
* Current-looking malformed events remain untouched so validation rejects them
* instead of disguising corruption as legacy data.
*/
function migrateLegacyMessageEvent(event, id, messageIds) {
	const data = asRecord(event.data);
	if (data === void 0) return event;
	switch (event.type) {
		case "user/message":
			if (Object.hasOwn(data, "id") || Object.hasOwn(data, "role") || Object.hasOwn(data, "message") || !Object.hasOwn(data, "content") || !Object.hasOwn(data, "source")) return event;
			return {
				...event,
				data: {
					...data,
					id: legacyMessageId(id, event.seq),
					role: "user"
				}
			};
		case "assistant/message": {
			if (Object.hasOwn(data, "message") || !Object.hasOwn(data, "content") || !Object.hasOwn(data, "provenance")) return event;
			const { content, provenance, ...eventData } = data;
			return {
				...event,
				data: {
					...eventData,
					message: {
						id: legacyMessageId(id, event.seq),
						role: "assistant",
						content,
						source: {
							...asRecord(provenance),
							kind: "model"
						}
					}
				}
			};
		}
		case "tool/result": {
			if (Object.hasOwn(data, "message") || !Object.hasOwn(data, "callId") || !Object.hasOwn(data, "content") || !Object.hasOwn(data, "isError")) return event;
			const { callId, content, isError, ...eventData } = data;
			const inheritedId = replacementStart(event);
			return {
				...event,
				data: {
					...eventData,
					message: {
						id: inheritedId === void 0 ? legacyMessageId(id, event.seq) : messageIds.get(inheritedId),
						role: "user",
						content: [{
							type: "tool-result",
							toolCallId: callId,
							content,
							isError
						}],
						source: {
							kind: "tool",
							callId
						}
					}
				}
			};
		}
		default: return event;
	}
}
/** Read the identified message carried by one validated current event. */
function eventMessageId(event) {
	const data = asRecord(event.data);
	const message = event.type === "user/message" ? data : asRecord(data?.["message"]);
	return typeof message?.["id"] === "string" ? message["id"] : void 0;
}
/** Materialize stored events as upgraded, validated snapshots with immutable messages. */
function snapshotStoredEvents(events, id) {
	assertSupportedEvents(events, id);
	const messageIds = /* @__PURE__ */ new Map();
	return events.map((event) => {
		const snapshot = snapshotSessionEvent(migrateLegacyMessageEvent(migrateLegacySteeringEvent(migrateLegacyTurnEndEvent(migrateLegacyTurnStartEvent(event, id), id), id), id, messageIds));
		const messageId = eventMessageId(snapshot);
		if (messageId !== void 0) messageIds.set(snapshot.seq, messageId);
		return snapshot;
	});
}
/** Upgrade and validate an exclusively owned backend result without copying it. */
function adoptStoredEvents(events, id) {
	assertSupportedEvents(events, id);
	const messageIds = /* @__PURE__ */ new Map();
	for (const [index, event] of events.entries()) {
		const adopted = adoptSessionEvent(migrateLegacyMessageEvent(migrateLegacySteeringEvent(migrateLegacyTurnEndEvent(migrateLegacyTurnStartEvent(event, id), id), id), id, messageIds));
		events[index] = adopted;
		const messageId = eventMessageId(adopted);
		if (messageId !== void 0) messageIds.set(adopted.seq, messageId);
	}
	return events;
}
/**
* Owns the backend-agnostic session write-path orchestration. A backend
* constructs one (`new PersistenceCoordinator(ctx, this)`), implements
* {@link PersistenceBackend}, and delegates its write/read service methods to
* the matching coordinator methods.
*
* All per-id operations are serialized (a per-id promise chain) so concurrent
* flushes / a flush racing a load never interleave storage writes. The
* constructor installs the write-path listeners, per-session retirement, and
* the backend dispose effect.
*
* @typeParam TornMarker - the backend's opaque torn-tail repair token.
*/
var PersistenceCoordinator = class {
	ctx;
	backend;
	/** Backend bookkeeping keyed by session id (NOT the live Session object). */
	states = /* @__PURE__ */ new Map();
	/** Lifecycle and write-behind state keyed by the exact live Session. */
	live = /* @__PURE__ */ new Map();
	/** Exact disposed lifecycles whose buffered tail is still draining. */
	retirements = /* @__PURE__ */ new Map();
	/** Shared cold reads, unpublished reservations, and completed LRU entries. */
	preparations;
	/**
	* Per-session serialization: every operation chains onto the prior one for the
	* same id, so writes for one session never interleave. Keyed by session id.
	*/
	chains = /* @__PURE__ */ new Map();
	/** Resolved fixed write-batching window shared by per-session controllers. */
	writeBatchMaxDelayMs;
	constructor(ctx, backend, options = {
		preparedSessionCacheSize: 5,
		writeBatchMaxDelayMs: 200
	}) {
		this.ctx = ctx;
		this.backend = backend;
		if (!Number.isSafeInteger(options.preparedSessionCacheSize) || options.preparedSessionCacheSize < 1) throw new TypeError("preparedSessionCacheSize must be a positive safe integer");
		if (!Number.isSafeInteger(options.writeBatchMaxDelayMs) || options.writeBatchMaxDelayMs < 1 || options.writeBatchMaxDelayMs > MAX_WRITE_BATCH_DELAY_MS) throw new TypeError(`writeBatchMaxDelayMs must be an integer between 1 and ${MAX_WRITE_BATCH_DELAY_MS}`);
		this.writeBatchMaxDelayMs = options.writeBatchMaxDelayMs;
		this.preparations = new SessionPreparations(options.preparedSessionCacheSize);
		this.installWritePath();
	}
	/**
	* Register detached session metadata for lazy creation on the first append.
	* @param meta - header to snapshot; duplicate tracked or persisted ids reject.
	*/
	create(meta) {
		const snapshot = snapshotJsonValue(meta);
		if (snapshot === void 0) return Promise.reject(/* @__PURE__ */ new TypeError("session metadata must be losslessly JSON-serializable"));
		if (!Number.isSafeInteger(snapshot.createdAt) || snapshot.createdAt < 0) return Promise.reject(/* @__PURE__ */ new TypeError("session metadata createdAt must be a non-negative safe integer"));
		return this.serialize(snapshot.id, () => this.createCore(snapshot));
	}
	async createCore(meta) {
		if (this.states.has(meta.id) || this.preparations.has(meta.id)) throw new Error(`session "${meta.id}" already exists in this backend`);
		if (await this.backend.loadStored(meta.id) !== void 0) throw new Error(`session "${meta.id}" already has a persisted log on disk; load/resume it instead of creating`);
		this.states.set(meta.id, {
			meta,
			cursor: 0,
			materialized: false
		});
	}
	/**
	* Durably persist a batch of events. Honors the append-only and contiguous-seq
	* contracts; rejects non-JSON-serializable `event.data`.
	* @param id - the session the batch belongs to.
	* @param events - the contiguous batch to persist, in seq order; materialized
	*   as a detached lossless-JSON snapshot at call time.
	*/
	async append(id, events) {
		const batch = snapshotJsonValue(events);
		if (batch === void 0) throw new TypeError("session event batch is not losslessly JSON-serializable because it contains non-JSON-serializable data");
		return this.serialize(id, () => this.appendCore(id, batch));
	}
	async appendCore(id, events) {
		assertSupportedEvents(events, id);
		if (events.length === 0) return;
		this.preparations.assertWritable(id);
		let state = this.states.get(id);
		if (state === void 0) state = await this.adopt(id);
		for (const [i, event] of events.entries()) if (event.seq !== state.cursor + i) throw new Error(`append seq mismatch for "${id}": expected ${state.cursor + i} at index ${i}, got ${event.seq}`);
		await this.backend.appendBatch(state.meta, events, state.materialized);
		state.materialized = true;
		state.cursor += events.length;
		this.preparations.invalidate(id);
	}
	/**
	* Prepare and reserve the exact unpublished Session used by resume.
	* Revision retries converge once the durable log remains unchanged for one
	* read/check round trip; continuous external writers may delay completion.
	* @param id - persisted session to prepare.
	* @param signal - optional cancellation for reading and repair.
	* @returns an owned preparation released after publication or rollback.
	*/
	async prepare(id, signal) {
		for (;;) {
			await this.waitForRetirement(id, signal);
			if (this.ctx.sessions.get(id) !== void 0) throw new Error(`cannot prepare session "${id}" while it is live`);
			const reservation = await this.preparations.reserve(id, () => this.serialize(id, () => this.prepareCore(id)), (source) => this.serialize(id, () => this.commitPrepared(source), signal), signal);
			if (reservation === void 0) continue;
			if (this.ctx.sessions.get(id) !== void 0) {
				this.preparations.release(reservation, false);
				throw new Error(`cannot prepare session "${id}" while it is live`);
			}
			return SessionPreparation.create(reservation.source.session, { release: () => {
				this.preparations.release(reservation, reservation.state.owner === void 0 && reservation.source.session.events.length === reservation.source.sessionLength);
			} });
		}
	}
	/**
	* Commit recovery and return its immutable logical view without publication.
	* Revision retries converge once the durable log remains unchanged for one
	* read/check round trip; continuous external writers may delay completion.
	* @param id - persisted session to load.
	* @returns prepared header and balanced events.
	*/
	async load(id) {
		for (;;) {
			await this.waitForRetirement(id);
			const live = this.ctx.sessions.get(id);
			if (live !== void 0) return this.loadLiveSnapshot(live);
			const reservation = await this.preparations.reserve(id, () => this.serialize(id, () => this.prepareCore(id)), (source) => this.serialize(id, () => this.commitPrepared(source)));
			if (reservation === void 0) continue;
			const attached = this.ctx.sessions.get(id);
			if (attached !== void 0) {
				this.preparations.discard(reservation);
				return this.loadLiveSnapshot(attached);
			}
			this.preparations.discard(reservation);
			return reservation.source.inspection;
		}
	}
	/**
	* Inspect a logical session without publishing it or committing recovery.
	* A stale ready source is reloaded. A source already committing or reserved
	* for resume remains exclusive, and inspection may borrow its immutable view.
	* Revision retries converge once the log is stable for one read/check round
	* trip; continuous external writers may delay completion.
	* @param id - persisted session to inspect.
	* @param signal - optional cancellation for preparation work.
	* @returns immutable prepared metadata and events; a live view may have an open turn.
	*/
	async inspect(id, signal) {
		for (;;) {
			signal?.throwIfAborted();
			if (this.retirements.has(id)) await this.waitForRetirement(id, signal);
			const live = this.ctx.sessions.get(id);
			if (live !== void 0) return this.inspectLive(live);
			try {
				const source = await this.preparations.inspect(id, () => this.serialize(id, () => this.prepareCore(id)), signal);
				const attached = this.ctx.sessions.get(id);
				if (attached !== void 0) return this.inspectLive(attached);
				const current = await this.serialize(id, () => this.isPreparedSourceCurrent(source, signal), signal);
				const published = this.ctx.sessions.get(id);
				if (published !== void 0) return this.inspectLive(published);
				if (current) return source.inspection;
				if (this.preparations.discardReady(id, source) === "retained") return source.inspection;
			} catch (error) {
				signal?.throwIfAborted();
				const attached = this.ctx.sessions.get(id);
				if (attached !== void 0) return this.inspectLive(attached);
				throw error;
			}
		}
	}
	/**
	* Read the stored events from `fromSeq` onward, detached and non-mutating
	* (the read-from-seq primitive behind the service's `readFrom`). Runs on
	* the same per-id chain as writes; a backend with the seek-capable
	* {@link PersistenceBackend.loadStoredFrom} hook reads only the suffix,
	* every other backend reads its stored prefix and skips forward here.
	* @param id - persisted session to read.
	* @param fromSeq - first event seq to include; a non-negative safe integer.
	* @param signal - optional cancellation for queued and backend read work.
	* @returns stored header and the valid stored events with `seq >= fromSeq`.
	*/
	readFrom(id, fromSeq, signal) {
		if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) return Promise.reject(/* @__PURE__ */ new TypeError(`readFrom fromSeq must be a non-negative safe integer, got ${String(fromSeq)}`));
		const retired = Promise.resolve(this.retirements.get(id));
		return (signal === void 0 ? retired : observeQueuedAbort(retired, signal, () => false)).then(() => this.serialize(id, () => this.readFromCore(id, fromSeq, signal), signal));
	}
	async readFromCore(id, fromSeq, signal) {
		signal?.throwIfAborted();
		if (this.backend.loadStoredFrom !== void 0) {
			let suffix;
			try {
				suffix = await this.backend.loadStoredFrom(id, fromSeq, signal);
			} catch (error) {
				if (signal?.aborted) signal.throwIfAborted();
				throw error;
			}
			signal?.throwIfAborted();
			if (suffix === void 0) throw new Error(`session "${id}" not found`);
			this.assertStoredId(id, suffix.meta);
			this.assertVersion(suffix.meta);
			if (suffix.events.some(needsLegacyPrefix)) {
				const whole = await this.readStoredPrefix(id, signal);
				return {
					meta: whole.meta,
					events: whole.events.filter((event) => event.seq >= fromSeq)
				};
			}
			const events = snapshotStoredEvents(suffix.events, id);
			this.assertEventsSupported(suffix.meta, events);
			return {
				meta: structuredClone(suffix.meta),
				events
			};
		}
		const whole = await this.readStoredPrefix(id, signal);
		return {
			meta: whole.meta,
			events: whole.events.slice(fromSeq)
		};
	}
	/** Read one detached physical prefix without logical recovery or caching. */
	async readStoredPrefix(id, signal) {
		signal?.throwIfAborted();
		const stored = await this.backend.loadStored(id, signal);
		signal?.throwIfAborted();
		if (stored === void 0) throw new Error(`session "${id}" not found`);
		this.assertStoredId(id, stored.meta);
		this.assertVersion(stored.meta);
		const events = snapshotStoredEvents(stored.events, id);
		this.assertEventsSupported(stored.meta, events);
		return {
			meta: structuredClone(stored.meta),
			events
		};
	}
	/** Read, repair in memory, validate, and freeze one cold source once. */
	async prepareCore(id) {
		const stored = await this.backend.loadStored(id);
		if (stored === void 0) throw new Error(`session "${id}" not found`);
		try {
			const { meta, events, revision, tornMarker } = stored;
			this.assertStoredId(id, meta);
			this.assertVersion(meta);
			const storedEvents = adoptStoredEvents(events, id);
			this.assertEventsSupported(meta, storedEvents);
			const closers = interruptedTurnClosers(storedEvents).map(adoptSessionEvent);
			const balanced = [...storedEvents, ...closers];
			const session = this.ctx.sessions.prepare(id, {
				seed: balanced,
				meta,
				seedSource: "persistence"
			});
			return {
				inspection: Object.freeze({
					meta: session.header,
					events: Object.freeze(balanced)
				}),
				session,
				revision,
				sessionLength: session.events.length,
				tornMarker,
				closers
			};
		} catch (error) {
			if (error instanceof SessionFormatUnsupportedError) throw error;
			throw new SessionPersistenceCorruptionError(`stored session "${id}" failed validation: ${String(error)}`, { cause: error });
		}
	}
	/** Commit one prepared repair and establish its ownerless durable cursor. */
	async commitPrepared(source) {
		const id = source.inspection.meta.id;
		const cursor = source.inspection.events.length;
		const existing = this.states.get(id);
		if (existing?.owner !== void 0) throw new Error(`session "${id}" already has a live persistence owner`);
		if (!await this.isPreparedSourceCurrent(source)) return void 0;
		if (source.tornMarker !== void 0 || source.closers.length > 0) {
			await this.backend.commitRepair(source.inspection.meta, source.tornMarker, source.closers);
			return;
		}
		const state = existing ?? {
			meta: source.inspection.meta,
			cursor,
			materialized: true
		};
		state.meta = source.inspection.meta;
		state.cursor = cursor;
		state.materialized = true;
		this.states.set(id, state);
		return {
			source,
			state
		};
	}
	/** Whether one cached source still names the current durable log revision. */
	async isPreparedSourceCurrent(source, signal) {
		return await this.backend.readStoredRevision(source.inspection.meta.id, signal) === source.revision;
	}
	/** Return one durable immutable view of an already-live Session. */
	async loadLiveSnapshot(session) {
		const events = session.events;
		await this.flush(session);
		const state = this.states.get(session.id);
		/* v8 ignore next -- successful flush always publishes this live session's durable state */
		if (state === void 0) throw new Error(`session "${session.id}" lost persistence state during load`);
		if (events.length === 0) throw new Error(`session "${session.id}" not found`);
		if (interruptedTurnClosers(events).length > 0) throw new Error(`cannot load session "${session.id}" while its live turn is open; use the live Session or wait for the turn to close`);
		return Object.freeze({
			meta: state.meta,
			events
		});
	}
	/** Borrow one immutable view from an already-live Session. */
	inspectLive(session) {
		return Object.freeze({
			meta: session.header,
			events: session.events
		});
	}
	/** Await one retiring lifecycle with caller cancellation. */
	waitForRetirement(id, signal) {
		const retired = Promise.resolve(this.retirements.get(id));
		return signal === void 0 ? retired : observeQueuedAbort(retired, signal, () => false);
	}
	/**
	* Run `op` after any in-flight operation for the same session id, so writes for
	* one session never interleave. Errors do not poison the chain. NOTE: serialized
	* public methods must NOT call each other (deadlock); they call the unserialized
	* `*Core` helpers instead.
	*/
	serialize(id, op, signal) {
		const prior = this.chains.get(id) ?? Promise.resolve();
		let started = false;
		const run = () => {
			signal?.throwIfAborted();
			started = true;
			return op();
		};
		const next = prior.then(run, run);
		const tail = next.then(() => void 0, () => void 0);
		this.chains.set(id, tail);
		tail.then(() => {
			if (this.chains.get(id) === tail) this.chains.delete(id);
		});
		return signal === void 0 ? next : observeQueuedAbort(next, signal, () => started);
	}
	/** Build a state for a session discovered in storage but not yet in memory. */
	async adopt(id) {
		for (;;) {
			const source = this.preparations.takeReady(id) ?? await this.prepareCore(id);
			const committed = await this.commitPrepared(source);
			if (committed !== void 0) return committed.state;
		}
	}
	assertVersion(meta) {
		if (meta.version === SESSION_FORMAT_VERSION) return;
		throw this.unsupported(meta, sessionFormatVersionRefusal(meta.id, meta.version));
	}
	/**
	* Refuse a log containing an event type this build does not know, unless the
	* writer marked the event ignorable: an unrecognized required event may
	* change how the rest of the log must be interpreted, so silently skipping
	* it would reconstruct a wrong session (the envelope contract on
	* `SessionEvent.ignorable`). Runs on NORMALIZED events — after
	* `snapshotStoredEvents`/`adoptStoredEvents` has upgraded the legacy shapes
	* this build still reads and rejected the ones it does not, so those keep
	* their specific diagnostics.
	*/
	assertEventsSupported(meta, events) {
		for (const event of events) {
			if (KNOWN_SESSION_EVENT_TYPES.has(event.type) || event.ignorable === true) continue;
			throw this.unsupported(meta, `session "${meta.id}" contains event type "${event.type}" (seq ${event.seq}) unknown to this harness and not marked ignorable; refusing to interpret the log — it was likely written by a newer harness`);
		}
	}
	/** Build a format refusal that points at the raw artifact when the backend has one. */
	unsupported(meta, reason) {
		const location = this.backend.locate?.(meta);
		return new SessionFormatUnsupportedError(location === void 0 ? reason : `${reason} (raw log: ${location.path})`, location);
	}
	/** Reject backend metadata that is not bound to the requested session id. */
	assertStoredId(id, meta) {
		if (meta.id !== id) throw new Error(`stored session identity mismatch: requested "${id}", header contains "${meta.id}"`);
	}
	installWritePath() {
		const ctx = this.ctx;
		ctx.effect(() => async () => {
			let disposeError;
			try {
				const errors = await settledErrors([...this.live.keys()].map((session) => this.flush(session)));
				while (this.chains.size > 0) await Promise.allSettled([...this.chains.values()]);
				if (errors.length > 0) throw new AggregateError(errors, `${this.backend.name} dispose failed`);
			} catch (error) {
				disposeError = error;
				throw error;
			} finally {
				try {
					await this.backend.close?.();
				} catch (closeError) {
					/* v8 ignore start -- close failure racing disposal is a defensive teardown edge */
					if (disposeError === void 0) throw closeError;
				}
			}
		}, `${this.backend.name} write path`);
		ctx.on("session/created", (session) => {
			this.initFor(session);
		});
		ctx.on("session/event", (session, event) => {
			this.initFor(session).writes.enqueue(event);
		});
		ctx.on("session/flush", (session) => this.flush(session));
		ctx.on("session/disposed", (session) => {
			this.retire(session);
		});
		for (const session of ctx.sessions.list()) this.initFor(session);
	}
	/** Start and observe one disposed session's final drain. */
	retire(session) {
		if (!this.live.has(session)) return;
		const retirement = this.retireCore(session);
		this.retirements.set(session.id, retirement);
		const forget = () => {
			if (this.retirements.get(session.id) === retirement) this.retirements.delete(session.id);
		};
		retirement.then(forget, forget);
		retirement.catch((error) => {
			this.ctx.logger.warn(`${this.backend.name}: session "${session.id}" retirement failed: ${String(error)}`);
		});
	}
	/** Drain and release state owned by one exact disposed Session lifecycle. */
	async retireCore(session) {
		await this.flush(session);
		const id = session.header.id;
		await this.serialize(id, () => {
			this.live.delete(session);
			if (this.states.get(id)?.owner === session) this.states.delete(id);
		});
	}
	/** Return the one lifecycle controller for a live session, creating it if needed. */
	initFor(session) {
		const existing = this.live.get(session);
		if (existing) return existing;
		const reservation = this.preparations.reservationFor(session);
		if (reservation !== void 0) {
			const restored = this.attachPrepared(session, reservation);
			this.live.set(session, restored);
			return restored;
		}
		const seed = session.events.map((e) => structuredClone(e));
		const live = {
			init: Promise.resolve(),
			writes: this.createWriteBehind(session, () => live.init)
		};
		this.live.set(session, live);
		live.init = this.serialize(session.header.id, () => this.onCreated(session, seed));
		live.init.catch(() => {});
		return live;
	}
	/** Bind one exact prepared Session and persist only its unpublished suffix. */
	attachPrepared(session, reservation) {
		const { source, state } = reservation;
		if (source.session !== session || state.owner !== void 0 || state.cursor !== source.inspection.events.length || session.firstLiveSeq !== state.cursor) throw new Error(`session "${session.id}" preparation no longer matches its persistence state`);
		const suffix = session.events.slice(state.cursor).map((event) => structuredClone(event));
		this.preparations.attach(reservation);
		state.owner = session;
		const live = {
			init: Promise.resolve(),
			writes: this.createWriteBehind(session, () => live.init)
		};
		if (suffix.length > 0) {
			live.init = this.serialize(session.id, () => this.appendCore(session.id, suffix));
			live.init.catch(() => {});
		}
		return live;
	}
	/**
	* Whether a live session's `seed` reproduces the first `cursor` persisted
	* events. A `cursor` of 0 (nothing persisted yet) trivially matches. Used when
	* a live session claims ownerless state left by a prior `load()`/`create()`.
	*/
	async seedMatchesPersisted(id, seed, cursor) {
		if (cursor === 0) return true;
		const stored = await this.backend.loadStored(id);
		/* v8 ignore next -- a cursor > 0 means the session was materialized, so it exists */
		if (stored === void 0) return false;
		this.assertStoredId(id, stored.meta);
		return seedCoversPrefix(seed, snapshotStoredEvents(stored.events, id).slice(0, cursor));
	}
	/**
	* On session/created: sync the backend's in-memory state to a live Session.
	*
	* Cases, by whether this backend tracks the id and whether an artifact exists:
	*   1. Already tracked → no-op (or claim ownerless state if the seed matches,
	*      or reclaim a truly-abandoned id, else reject as a collision).
	*   2. Not tracked, an artifact EXISTS at the same cwd and is a seq-aligned
	*      PREFIX of the live events → ADOPT it, persisting any live suffix.
	*   3. Not tracked, an artifact EXISTS at another cwd or is NOT a prefix →
	*      REJECT (collision).
	*   4. Not tracked and NO artifact → a genuinely new session: register meta
	*      (lazy) and persist its seed once.
	*/
	async onCreated(session, seed) {
		const id = session.header.id;
		const tracked = this.states.get(id);
		if (tracked !== void 0) {
			/* v8 ignore next -- initFor dedupes per session object; same-object re-entry can't occur */
			if (tracked.owner === session) return;
			if (tracked.owner === void 0) {
				if (tracked.meta.cwd !== session.header.cwd) throw new Error(`session "${id}" is already persisted at a different cwd (persisted: ${String(tracked.meta.cwd)}, live: ${String(session.header.cwd)}) (id collision)`);
				if (!await this.seedMatchesPersisted(id, seed, tracked.cursor)) throw new Error(`session "${id}" is already persisted with ${tracked.cursor} event(s) that do not match this live session (id collision)`);
				tracked.owner = session;
				const suffix = seed.slice(tracked.cursor);
				if (suffix.length > 0) await this.appendCore(id, suffix);
				return;
			}
			const owner = this.live.get(tracked.owner);
			if (!tracked.materialized && !owner?.writes.hasWork) this.states.delete(id);
			else throw new Error(`session "${id}" is already bound to a different live session in this backend (id collision)`);
		}
		const live = await this.backend.loadStored(id);
		if (live !== void 0) {
			await this.adoptLivePrefix(session, seed, live);
			return;
		}
		const meta = { ...session.header };
		await this.createCore(meta);
		const created = this.states.get(id);
		/* v8 ignore next -- create() always sets the state for the id */
		if (created !== void 0) created.owner = session;
		if (seed.length > 0) await this.appendCore(id, seed);
	}
	/**
	* Adopt a stored prefix as a live session's history (HMR/reload): verify the
	* seed covers the stored prefix, truncate any torn tail (NOT the open turn —
	* the live Session is still the authority), bind ownership, and persist the
	* live suffix that was ahead of the stored prefix.
	*/
	async adoptLivePrefix(session, seed, stored) {
		const { meta, events, tornMarker } = stored;
		this.assertStoredId(session.header.id, meta);
		if (meta.cwd !== session.header.cwd) throw new Error(`session "${session.header.id}" is already persisted at a different cwd (persisted: ${String(meta.cwd)}, live: ${String(session.header.cwd)}) (id collision)`);
		this.assertVersion(meta);
		const storedEvents = snapshotStoredEvents(events, session.header.id);
		this.assertEventsSupported(meta, storedEvents);
		if (!seedCoversPrefix(seed, storedEvents)) throw new Error(`session "${session.header.id}" already has a persisted log on disk that does not match this live session (id collision)`);
		if (tornMarker !== void 0) await this.backend.commitRepair(meta, tornMarker, []);
		this.states.set(session.header.id, {
			meta: { ...meta },
			cursor: storedEvents.length,
			materialized: true,
			owner: session
		});
		const suffix = seed.slice(storedEvents.length);
		if (suffix.length > 0) await this.appendCore(session.header.id, suffix);
	}
	async flush(session) {
		const live = this.initFor(session);
		live.writes.cancelAutomaticWait();
		try {
			await live.init;
		} catch (error) {
			live.writes.cancelAutomaticWait();
			throw error;
		}
		await live.writes.flush();
	}
	/** Build one package-private write controller around initialization and id serialization. */
	createWriteBehind(session, ready) {
		return new SessionWriteBehind({
			maxDelayMs: this.writeBatchMaxDelayMs,
			write: async (batch) => {
				await ready();
				await this.serialize(session.header.id, () => this.appendLiveBatch(session.header.id, batch));
			},
			reportBackgroundFailure: (error) => {
				this.ctx.logger.warn(`${this.backend.name}: background write for session "${session.id}" failed (buffered events retained): ${String(error)}`);
			}
		});
	}
	/** Append one controller-owned prefix after filtering events initialization already stored. */
	async appendLiveBatch(id, batch) {
		/* v8 ignore next -- state is always set by the awaited initialization */
		const cursor = this.states.get(id)?.cursor ?? 0;
		const fresh = batch.filter((e) => e.seq >= cursor);
		await this.appendCore(id, fresh);
	}
};
//#endregion
//#region lib/types/index.js
/**
* Durable session-persistence Service Definition (`ctx.sessionPersistence`). Backends store
* {@link SessionEvent}s as the event-sourced log and carry non-replayable
* {@link SessionHeader} metadata separately.
* @module @deepseek-ai/dsh-session-persistence
*/
/**
* Durable append-only session storage. Implementations preserve contiguous,
* losslessly JSON-serializable events; {@link append} resolves only after
* durability, and {@link load} balances a complete interrupted tail without
* rewriting committed events.
*/
var SessionPersistence = class extends Service {
	constructor(ctx) {
		super(ctx, "sessionPersistence");
	}
	/**
	* Read a session's backend-owned artifact text verbatim — the exact durable
	* bytes the backend wrote (decoded from its physical encoding, e.g. a
	* decompressed JSONL). The returned `content` is the raw text, not a
	* reconstruction from parsed events, so it preserves backend-specific
	* serialization (chunk packing, key order, line breaks). Callers first test
	* {@link supportsRawArtifacts}; `undefined` then means only that the requested
	* session has no materialized artifact.
	* @param _id - the persisted session to read (unused by the default: no
	* per-session artifact).
	* @param signal - optional cancellation for backend read work.
	* @returns the raw artifact plus its parsed header, or `undefined` when the
	* session is absent.
	* @throws when this backend does not expose per-session raw artifacts.
	*/
	readRaw(_id, signal) {
		if (signal?.aborted === true) return Promise.reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("aborted"));
		return Promise.reject(/* @__PURE__ */ new Error("this session persistence backend does not expose raw artifacts"));
	}
	/**
	* Prepare the exact unpublished Session used by resume. Implementations may
	* reuse object graphs retained by an earlier {@link inspect} after confirming
	* their durable revision is still current; disposal releases an unpublished
	* reservation. Revision retries require the durable log to remain unchanged
	* for one read/check round trip; continuous external writers may delay completion.
	* @param id - persisted session to prepare.
	* @param signal - optional cancellation for preparation work.
	* @returns one owned unpublished Session preparation.
	*/
	async prepare(id, signal) {
		signal?.throwIfAborted();
		const loaded = await this.load(id);
		signal?.throwIfAborted();
		const sessions = this.ctx.get("sessions");
		if (sessions === void 0) throw new Error("cannot prepare a session: SessionStore is not configured");
		return SessionPreparation.create(sessions.prepare(id, {
			seed: loaded.events.map((event) => structuredClone(event)),
			meta: structuredClone(loaded.meta),
			seedSource: "persistence"
		}));
	}
};
//#endregion
export { DEFAULT_PREPARED_SESSION_CACHE_SIZE, DEFAULT_WRITE_BATCH_MAX_DELAY_MS, MAX_WRITE_BATCH_DELAY_MS, PersistenceCoordinator, SessionFormatUnsupportedError, SessionPersistence, SessionPersistence as default, SessionPersistenceCorruptionError, SessionPersistenceRevision, sessionFormatVersionRefusal };
