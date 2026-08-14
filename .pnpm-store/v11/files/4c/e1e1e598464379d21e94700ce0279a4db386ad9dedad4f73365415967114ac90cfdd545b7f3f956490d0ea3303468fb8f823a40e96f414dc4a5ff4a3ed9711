import { Service } from "@deepseek-ai/cordis";
import { Session, foldSurface, isSurfaceEvent, snapshotSessionEvent } from "@deepseek-ai/dsh-session";
import { foldSessionTitle } from "@deepseek-ai/dsh-session-title";
import { HarnessError } from "@deepseek-ai/dsh-llm";
//#region lib/types/config.js
/** Public configuration and typed failures for the combined session-query service. */
/** Default maximum `before`/`after` raw-event window. */
const SESSION_QUERY_READ_WINDOW_MAX = 50;
/** Default maximum number of concurrent persisted-log inspections in one batch read. */
const SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY = 4;
/** Typed session-query failure whose `code` is one closed taxonomy member. */
var SessionQueryError = class extends HarnessError {
	constructor(message, code, options) {
		super(message, code, options);
	}
};
//#endregion
//#region lib/types/sources.js
/** Shared immutable-header checks for logical session source observers. */
/**
* Reject incompatible observations of one logical session source.
* @param a - first live, listed, or loaded header observation.
* @param b - second header observation expected to identify the same source.
*/
function assertSessionHeadersCompatible(a, b) {
	if (a.version !== b.version || a.id !== b.id || a.createdAt !== b.createdAt || a.cwd !== b.cwd || a.parentSession !== b.parentSession || a.seedLength !== b.seedLength || (a.delegationDepth ?? 0) !== (b.delegationDepth ?? 0)) throw new SessionQueryError(`session source headers conflict for session "${a.id}"`, "SESSION_QUERY_SOURCE_CONFLICT");
}
//#endregion
//#region lib/types/corpus.js
/** Live/persisted logical-corpus resolution for session-query. */
/** Resolves a live-preferred corpus against the persistence service mounted now. */
var SessionCorpus = class {
	_ctx;
	_persistedInspectConcurrency;
	_persistence;
	_optionalPersistenceFiber;
	constructor(_ctx, _persistedInspectConcurrency) {
		this._ctx = _ctx;
		this._persistedInspectConcurrency = _persistedInspectConcurrency;
		this._optionalPersistenceFiber = _ctx.inject(["sessionPersistence"], (childCtx) => {
			const service = childCtx.sessionPersistence;
			this._persistence = service;
			childCtx.effect(() => () => {
				/* v8 ignore next -- a stale optional-service disposer cannot clear a replacement */
				if (this._persistence === service) this._persistence = void 0;
			}, "sessionQuery.persistenceBinding");
		});
		_ctx.effect(() => {
			return () => this._optionalPersistenceFiber.dispose();
		}, "sessionQuery.optionalPersistence");
	}
	/**
	* List the complete logical corpus with live precedence and cloned headers.
	* @param signal - optional cancellation for persistence listing.
	* @returns records in deterministic newest-first order.
	*/
	async listSessions(signal) {
		signal?.throwIfAborted();
		const persistence = this._persistence;
		const persisted = persistence === void 0 ? [] : await listPersisted(persistence, signal);
		signal?.throwIfAborted();
		const records = /* @__PURE__ */ new Map();
		for (const header of persisted) records.set(header.id, {
			header: structuredClone(header),
			live: false,
			persisted: true
		});
		for (const session of this._ctx.sessions.list()) {
			const durable = records.get(session.id);
			if (durable !== void 0) assertSessionHeadersCompatible(session.header, durable.header);
			records.set(session.id, {
				header: structuredClone(session.header),
				live: true,
				persisted: durable !== void 0
			});
		}
		return [...records.values()].sort(compareSessions);
	}
	/**
	* Load one logical source, preferring a detached live snapshot.
	*
	* A known live target never consults persistence, so an optional backend's
	* failure cannot make current in-memory history unreadable.
	* @param sessionId - session to resolve.
	* @param signal - optional cancellation for persisted source resolution.
	* @returns detached live-preferred header and events.
	*/
	async load(sessionId, signal) {
		signal?.throwIfAborted();
		const live = this._ctx.sessions.get(sessionId);
		if (live !== void 0) {
			const snapshot = snapshotLive(live);
			signal?.throwIfAborted();
			return snapshot;
		}
		const persistence = this._persistence;
		if (persistence === void 0) throw notFound(sessionId);
		const listed = (await listPersisted(persistence, signal)).find((header) => header.id === sessionId);
		signal?.throwIfAborted();
		if (listed === void 0) throw notFound(sessionId);
		const loaded = await inspectPersisted(persistence, sessionId, signal);
		signal?.throwIfAborted();
		const attached = this._ctx.sessions.get(sessionId);
		if (attached !== void 0) {
			const snapshot = snapshotLive(attached);
			signal?.throwIfAborted();
			return snapshot;
		}
		assertSessionHeadersCompatible(loaded.meta, listed);
		const snapshot = {
			header: structuredClone(loaded.meta),
			events: loaded.events.map((event) => structuredClone(event))
		};
		signal?.throwIfAborted();
		return snapshot;
	}
	/**
	* Project unique logical sources immediately from one persistence listing.
	*
	* The synchronous projector runs before a persisted worker claims its next id.
	* Full logs are borrowed only for that call and never retained by the batch.
	* @param sessionIds - sessions to resolve in first-occurrence order.
	* @param project - synchronous fold that owns/clones every retained value.
	* @param signal - cancellation shared by listing and every persisted inspection.
	* @returns one fulfilled or rejected projected result per unique requested id.
	*/
	async projectMany(sessionIds, project, signal) {
		const ids = [...new Set(sessionIds)];
		signal?.throwIfAborted();
		const resolved = /* @__PURE__ */ new Map();
		const unresolved = [];
		for (const id of ids) {
			const session = this._ctx.sessions.get(id);
			if (session === void 0) unresolved.push(id);
			else resolved.set(id, projectSource(id, sourceLive(session), project, signal));
		}
		if (unresolved.length === 0) return orderedResults(ids, resolved);
		const persistence = this._persistence;
		if (persistence === void 0) {
			for (const sessionId of unresolved) resolved.set(sessionId, {
				sessionId,
				status: "rejected",
				reason: notFound(sessionId)
			});
			return orderedResults(ids, resolved);
		}
		let persisted;
		try {
			persisted = await listPersisted(persistence, signal);
			signal?.throwIfAborted();
		} catch (error) {
			if (signal?.aborted) signal.throwIfAborted();
			for (const sessionId of unresolved) resolved.set(sessionId, {
				sessionId,
				status: "rejected",
				reason: error
			});
			return orderedResults(ids, resolved);
		}
		const persistedById = new Map(persisted.map((header) => [header.id, header]));
		const resolvePersisted = async (sessionId) => {
			const listed = persistedById.get(sessionId);
			if (listed === void 0) {
				const attached = this._ctx.sessions.get(sessionId);
				resolved.set(sessionId, attached === void 0 ? {
					sessionId,
					status: "rejected",
					reason: notFound(sessionId)
				} : projectSource(sessionId, sourceLive(attached), project, signal));
				return;
			}
			try {
				signal?.throwIfAborted();
				const loaded = await inspectPersisted(persistence, sessionId, signal);
				signal?.throwIfAborted();
				const attached = this._ctx.sessions.get(sessionId);
				if (attached !== void 0) {
					resolved.set(sessionId, projectSource(sessionId, sourceLive(attached), project, signal));
					return;
				}
				assertSessionHeadersCompatible(loaded.meta, listed);
				resolved.set(sessionId, projectSource(sessionId, {
					header: loaded.meta,
					events: loaded.events
				}, project, signal));
			} catch (error) {
				if (signal?.aborted) signal.throwIfAborted();
				resolved.set(sessionId, {
					sessionId,
					status: "rejected",
					reason: error
				});
			}
		};
		let cursor = 0;
		const worker = async () => {
			for (;;) {
				signal?.throwIfAborted();
				const index = cursor;
				if (index >= unresolved.length) return;
				cursor += 1;
				await resolvePersisted(unresolved[index]);
			}
		};
		const workerCount = Math.min(this._persistedInspectConcurrency, unresolved.length);
		const settlements = await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
		if (signal?.aborted) signal.throwIfAborted();
		/* v8 ignore start -- per-id failures settle inside resolvePersisted; workers reject only on abort above */
		for (const settlement of settlements) if (settlement.status === "rejected") throw settlement.reason;
		/* v8 ignore stop */
		signal?.throwIfAborted();
		return orderedResults(ids, resolved);
	}
};
function projectSource(sessionId, source, project, signal) {
	try {
		signal?.throwIfAborted();
		const value = project(source);
		signal?.throwIfAborted();
		return {
			sessionId,
			status: "fulfilled",
			value
		};
	} catch (reason) {
		/* v8 ignore next -- the synchronous projector has no external cancellation yield */
		if (signal?.aborted) signal.throwIfAborted();
		return {
			sessionId,
			status: "rejected",
			reason
		};
	}
}
function sourceLive(session) {
	return {
		header: session.header,
		events: session.events
	};
}
function orderedResults(ids, resolved) {
	return ids.map((sessionId) => resolved.get(sessionId));
}
async function listPersisted(persistence, signal) {
	try {
		return await persistence.list(signal);
	} catch (error) {
		if (signal?.aborted) signal.throwIfAborted();
		throw new SessionQueryError(`session persistence listing failed: ${errorMessage(error)}`, "SESSION_QUERY_PERSISTENCE_FAILED", { cause: error });
	}
}
async function inspectPersisted(persistence, sessionId, signal) {
	try {
		return await persistence.inspect(sessionId, signal);
	} catch (error) {
		if (signal?.aborted) signal.throwIfAborted();
		if (error instanceof Error && error.name === "SessionPersistenceCorruptionError") throw new SessionQueryError(`stored session "${sessionId}" is corrupt: ${errorMessage(error)}`, "SESSION_QUERY_CORRUPT_SESSION", { cause: error });
		throw new SessionQueryError(`failed to inspect session "${sessionId}": ${errorMessage(error)}`, "SESSION_QUERY_PERSISTENCE_FAILED", { cause: error });
	}
}
function snapshotLive(session) {
	return {
		header: structuredClone(session.header),
		events: session.events.map((event) => structuredClone(event))
	};
}
function compareSessions(a, b) {
	return b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id);
}
function notFound(sessionId) {
	return new SessionQueryError(`session "${sessionId}" not found`, "SESSION_QUERY_SESSION_NOT_FOUND");
}
function errorMessage(error) {
	return error instanceof Error ? error.message : "unknown error";
}
//#endregion
//#region lib/types/extraction.js
/** First-party semantic text extraction for session-query consumers. */
/**
* Extract searchable semantic text from one first-party session event.
*
* Structural boundaries, raw stream chunks, request envelopes, and unknown
* declaration-merged events contribute no text.
* @param event - event to inspect.
* @returns newline-joined semantic text, or an empty string when non-searchable.
*/
function extractSessionEventText(event) {
	switch (event.type) {
		case "user/message": return contentText(event.data.content);
		case "assistant/message": return contentText(event.data.message.content);
		case "tool/call": return joinText([event.data.name, event.data.arguments]);
		case "tool/result": return joinText([
			contentText(event.data.message.content),
			event.data.error?.name ?? "",
			event.data.error?.code ?? ""
		]);
		case "todo/write": return joinText(event.data.todos.flatMap((todo) => [todo.status, todo.content]));
		case "turn/end": return turnEndText(event.data.reason);
		case "turn/start":
		case "step/start":
		case "step/end":
		case "assistant/chunk":
		case "request/header": return "";
		default: return "";
	}
}
function turnEndText(reason) {
	switch (reason.kind) {
		case "error": return joinText(["error", reason.error.message]);
		case "aborted": return "aborted";
		case "max-tokens":
		case "interrupted": return reason.kind;
		case "completed": return "";
		default: return "";
	}
}
function contentText(content) {
	return joinText(content.flatMap(blockText));
}
function blockText(block) {
	switch (block.type) {
		case "text": return [block.text];
		case "reasoning": return [];
		case "tool-call": return [block.name, block.arguments];
		case "tool-result": return block.content.flatMap(blockText);
		default: return [];
	}
}
function joinText(parts) {
	return parts.map((part) => part.trim()).filter(Boolean).join("\n");
}
//#endregion
//#region lib/types/documents.js
/** Shared event metadata and semantic-document projection. */
/**
* Project a raw log into lightweight surface-aware event records.
* @param sessionId - session that owns the log.
* @param events - complete contiguous raw event log.
* @returns one record per event in ascending seq order.
*/
function buildSessionEventRecords(sessionId, events) {
	const surfaceBySeq = classifySurface(events);
	return events.map((event) => ({
		sessionId,
		seq: event.seq,
		type: event.type,
		time: event.time,
		surface: surfaceBySeq.get(event.seq) ?? "log-only"
	}));
}
/**
* Build first-party semantic documents for one complete raw event log.
* @param sessionId - session that owns the log.
* @param events - complete contiguous raw event log.
* @returns searchable documents in ascending seq order; structural events are omitted.
*/
function buildSessionEventSearchDocuments(sessionId, events) {
	const surfaceBySeq = classifySurface(events);
	const documents = [];
	for (const event of events) {
		const text = extractSessionEventText(event);
		if (text.length === 0) continue;
		documents.push({
			sessionId,
			seq: event.seq,
			type: event.type,
			time: event.time,
			surface: surfaceBySeq.get(event.seq) ?? "log-only",
			text
		});
	}
	return documents;
}
function classifySurface(events) {
	let folded;
	try {
		folded = foldSurface(events);
	} catch (error) {
		throw new SessionQueryError(
			/* v8 ignore next -- foldSurface throws Error instances */
			`invalid session surface: ${error instanceof Error ? error.message : "unknown error"}`,
			"SESSION_QUERY_INVALID_SURFACE",
			{ cause: error }
		);
	}
	const result = /* @__PURE__ */ new Map();
	for (const seq of folded.nodes) result.set(seq, "current");
	for (const replacement of folded.replacements) for (const seq of replacement.shadowedSeqs) result.set(seq, "shadowed");
	return result;
}
//#endregion
//#region lib/types/filters.js
/** Pure provider-independent predicates for logical sessions and event text. */
/**
* Apply ANDed logical-session filters while preserving input order.
* @param records - detached logical-session records to inspect.
* @param filters - clauses whose list values are ORed within each clause.
* @returns records accepted by every clause.
*/
function filterSessionResults(records, filters = []) {
	const predicates = filters.map(sessionPredicate);
	return records.filter((record) => predicates.every((predicate) => predicate(record)));
}
/**
* Apply ANDed event filters to extracted semantic documents.
* @param documents - semantic documents produced by {@link buildSessionEventSearchDocuments}.
* @param filters - metadata and literal-text predicates.
* @returns documents accepted by every clause, in input order.
*/
function filterSessionEventDocuments(documents, filters = []) {
	const predicates = filters.map(eventPredicate);
	return documents.filter((document) => predicates.every((predicate) => predicate(document)));
}
/**
* Copy and validate logical-session filters before an asynchronous boundary.
* @param filters - caller-owned clauses to materialize.
* @returns detached validated clauses.
*/
function materializeSessionResultFilters(filters) {
	assertArray(filters);
	return filters.map((filter) => {
		switch (filter.kind) {
			case "id": return {
				kind: filter.kind,
				values: copyStrings(filter.kind, filter.values)
			};
			case "cwd": return {
				kind: filter.kind,
				values: copyNullableStrings(filter.kind, filter.values)
			};
			case "created-at": return copyRange(filter.kind, filter);
			case "parent": return {
				kind: filter.kind,
				values: copyNullableStrings(filter.kind, filter.values)
			};
			case "availability": {
				const values = copyStrings(filter.kind, filter.values);
				assertAllowedValues(filter.kind, values, ["live", "persisted"]);
				return {
					kind: filter.kind,
					values
				};
			}
			default: return unknownFilter(filter);
		}
	});
}
/**
* Copy and validate event filters before an asynchronous boundary.
* @param filters - caller-owned clauses to materialize.
* @returns detached validated clauses.
*/
function materializeSessionEventResultFilters(filters) {
	assertArray(filters);
	return filters.map((filter) => {
		switch (filter.kind) {
			case "seq":
			case "time": return copyRange(filter.kind, filter);
			case "type": return {
				kind: filter.kind,
				values: copyStrings(filter.kind, filter.values)
			};
			case "surface": {
				const values = copyStrings(filter.kind, filter.values);
				assertAllowedValues(filter.kind, values, [
					"current",
					"shadowed",
					"log-only"
				]);
				return {
					kind: filter.kind,
					values
				};
			}
			case "text":
				if (typeof filter.text !== "string") throw invalidFilter("text filter text must be a string");
				return {
					kind: filter.kind,
					text: filter.text
				};
			default: return unknownFilter(filter);
		}
	});
}
/**
* Compile a literal case-insensitive, whitespace-flexible semantic-text match.
* @param text - caller-provided literal text.
* @returns Unicode-aware regular expression safe from regex injection.
*/
function compileSessionTextFilter(text) {
	const trimmed = text.trim();
	if (trimmed.length === 0) throw new SessionQueryError("session text filter must contain non-whitespace text", "SESSION_QUERY_INVALID_FILTER");
	const pattern = trimmed.split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s+");
	return new RegExp(pattern, "iu");
}
function sessionPredicate(filter) {
	switch (filter.kind) {
		case "id": return (record) => filter.values.includes(record.header.id);
		case "cwd": return (record) => filter.values.includes(record.header.cwd ?? null);
		case "created-at": {
			const range = validateRange(filter.kind, filter);
			return (record) => matchesRange(record.header.createdAt, range);
		}
		case "parent": return (record) => filter.values.includes(record.header.parentSession ?? null);
		case "availability":
			assertAllowedValues(filter.kind, filter.values, ["live", "persisted"]);
			return (record) => filter.values.some((value) => value === "live" ? record.live : record.persisted);
		default: return unknownFilter(filter);
	}
}
function eventPredicate(filter) {
	switch (filter.kind) {
		case "seq": {
			const range = validateRange(filter.kind, filter);
			return (document) => matchesRange(document.seq, range);
		}
		case "time": {
			const range = validateRange(filter.kind, filter);
			return (document) => matchesRange(document.time, range);
		}
		case "type": return (document) => filter.values.includes(document.type);
		case "surface":
			assertAllowedValues(filter.kind, filter.values, [
				"current",
				"shadowed",
				"log-only"
			]);
			return (document) => filter.values.includes(document.surface);
		case "text": {
			const pattern = compileSessionTextFilter(filter.text);
			return (document) => pattern.test(document.text);
		}
		default: return unknownFilter(filter);
	}
}
function copyStrings(name, values) {
	if (!isRuntimeArray(values) || values.some((value) => typeof value !== "string")) throw invalidFilter(`${name} filter values must be an array of strings`);
	return [...values];
}
function assertArray(value) {
	if (!Array.isArray(value)) throw invalidFilter("filters must be an array");
}
function copyNullableStrings(name, values) {
	if (!isRuntimeArray(values) || values.some((value) => value !== null && typeof value !== "string")) throw invalidFilter(`${name} filter values must be an array of strings or null`);
	return [...values];
}
function copyRange(kind, range) {
	const copy = {
		kind,
		...range.from === void 0 ? {} : { from: range.from },
		...range.to === void 0 ? {} : { to: range.to }
	};
	validateRange(kind, copy);
	return copy;
}
function unknownFilter(filter) {
	const kind = filter.kind;
	throw invalidFilter(`unknown filter kind ${typeof kind === "string" ? `"${kind}"` : "(missing)"}`);
}
function assertAllowedValues(name, values, allowed) {
	for (const value of values) if (!allowed.includes(value)) throw new SessionQueryError(`session ${name} filter contains unknown value "${value}"`, "SESSION_QUERY_INVALID_FILTER");
}
function validateRange(name, range) {
	if (range.from !== void 0 && !Number.isFinite(range.from)) throw invalidRange(name, "from must be finite");
	if (range.to !== void 0 && !Number.isFinite(range.to)) throw invalidRange(name, "to must be finite");
	if (range.from !== void 0 && range.to !== void 0 && range.from > range.to) throw invalidRange(name, "from must be less than or equal to to");
	return range;
}
function matchesRange(value, range) {
	return (range.from === void 0 || value >= range.from) && (range.to === void 0 || value <= range.to);
}
function invalidRange(name, detail) {
	return invalidFilter(`${name} filter ${detail}`);
}
function invalidFilter(detail) {
	return new SessionQueryError(`session ${detail}`, "SESSION_QUERY_INVALID_FILTER");
}
function isRuntimeArray(value) {
	return Array.isArray(value);
}
//#endregion
//#region lib/types/tracing.js
/** One-shot session-lineage and event-relationship tracing helpers. */
/**
* Classify a raw event log with one canonical surface fold.
* @param sessionId - owner of the event log.
* @param events - detached raw event log.
* @returns lightweight records in ascending log order.
*/
function eventRecords(sessionId, events) {
	return analyzeEventLog(sessionId, events).records;
}
/**
* Fold and return the current model surface after validating the whole log.
* @param sessionId - owner used in query diagnostics.
* @param events - detached raw event log from one corpus observation.
* @returns detached current surface events in folded order.
*/
function currentSurfaceEvents(sessionId, events) {
	return analyzeEventLog(sessionId, events).currentSeqs.map((seq) => {
		const event = events[seq];
		/* v8 ignore next 6 -- analyzeEventLog validated contiguous seqs and foldSurface returned only surface-event seqs. */
		if (event === void 0 || event.seq !== seq || !isSurfaceEvent(event)) throw new SessionQueryError(`invalid session surface: current node ${seq} is not a surface event`, "SESSION_QUERY_INVALID_SURFACE");
		return snapshotSessionEvent(event);
	});
}
/**
* Trace one target after one canonical surface fold and whole-log validation.
* @param sessionId - owner of the event log.
* @param events - detached raw event log.
* @param seq - target event seq.
* @returns direct surface replacements and relationships to cited source events.
*/
function traceEvent(sessionId, events, seq) {
	const target = events[seq];
	if (target === void 0 || target.seq !== seq) throw new SessionQueryError(`session "${sessionId}" has no event at seq ${seq}`, "SESSION_QUERY_EVENT_NOT_FOUND");
	const analysis = analyzeEventLog(sessionId, events);
	const replacementChain = [];
	let replacement = analysis.replacedBy.get(seq);
	while (replacement !== void 0) {
		replacementChain.push(replacement);
		replacement = analysis.replacedBy.get(replacement);
	}
	const derivedEventSeqs = [];
	for (const event of events) {
		if (event.seq <= seq) continue;
		if (eventSources(event).includes(seq)) derivedEventSeqs.push(event.seq);
	}
	const targetRecord = analysis.records[seq];
	const replacedBy = analysis.replacedBy.get(seq);
	return {
		target: targetRecord,
		...replacedBy === void 0 ? {} : { replacedBy },
		replacementChain,
		replacedEventSeqs: analysis.replacedEventSeqs.get(seq) ?? [],
		sourceEventSeqs: [...eventSources(target)],
		derivedEventSeqs
	};
}
/**
* Trace one target's known ancestry and recursively known descendants.
* @param records - complete logical corpus from one observation.
* @param sessionId - target session id.
* @returns complete or explicitly partial lineage.
*/
function traceSession(records, sessionId) {
	const byId = new Map(records.map((record) => [record.header.id, record]));
	const target = byId.get(sessionId);
	if (target === void 0) throw new SessionQueryError(`session "${sessionId}" not found`, "SESSION_QUERY_SESSION_NOT_FOUND");
	const ancestors = [];
	const ancestrySeen = new Set([sessionId]);
	let unresolvedParentId;
	let parentId = target.header.parentSession;
	while (parentId !== void 0) {
		if (ancestrySeen.has(parentId)) throw new SessionQueryError(`session lineage contains a cycle at "${parentId}"`, "SESSION_QUERY_INVALID_LINEAGE");
		ancestrySeen.add(parentId);
		const parent = byId.get(parentId);
		if (parent === void 0) {
			unresolvedParentId = parentId;
			break;
		}
		ancestors.push(parent);
		parentId = parent.header.parentSession;
	}
	const childrenByParent = /* @__PURE__ */ new Map();
	for (const record of records) {
		const parent = record.header.parentSession;
		if (parent === void 0) continue;
		const children = childrenByParent.get(parent) ?? [];
		children.push(record);
		childrenByParent.set(parent, children);
	}
	for (const children of childrenByParent.values()) children.sort((a, b) => a.header.createdAt - b.header.createdAt || a.header.id.localeCompare(b.header.id));
	const descendants = buildDescendants(childrenByParent, sessionId);
	const common = {
		target: cloneRecord(target),
		ancestors: ancestors.map(cloneRecord),
		descendants
	};
	if (unresolvedParentId !== void 0) return {
		...common,
		complete: false,
		unresolvedParentId
	};
	return {
		...common,
		complete: true,
		root: cloneRecord(ancestors.at(-1) ?? target)
	};
}
function analyzeEventLog(sessionId, events) {
	let folded;
	try {
		folded = foldSurface(events);
	} catch (error) {
		throw new SessionQueryError(
			/* v8 ignore next -- foldSurface throws Error instances */
			`invalid session surface: ${error instanceof Error ? error.message : "unknown error"}`,
			"SESSION_QUERY_INVALID_SURFACE",
			{ cause: error }
		);
	}
	const current = new Set(folded.nodes);
	const replacedBy = /* @__PURE__ */ new Map();
	const replacedEventSeqs = /* @__PURE__ */ new Map();
	for (const replacement of folded.replacements) {
		const removed = replacement.shadowedSeqs;
		replacedEventSeqs.set(replacement.seq, removed);
		for (const removedSeq of removed) replacedBy.set(removedSeq, replacement.seq);
	}
	return {
		records: events.map((event) => ({
			sessionId,
			seq: event.seq,
			type: event.type,
			time: event.time,
			surface: current.has(event.seq) ? "current" : replacedBy.has(event.seq) ? "shadowed" : "log-only"
		})),
		replacedBy,
		replacedEventSeqs,
		currentSeqs: [...folded.nodes]
	};
}
function eventSources(event) {
	return event.sourceEventSeqs ?? [];
}
function buildDescendants(childrenByParent, sessionId) {
	const descendants = [];
	const stack = [{
		sessionId,
		descendants
	}];
	while (stack.length > 0) {
		const frame = stack.pop();
		const nodes = [];
		for (const child of childrenByParent.get(frame.sessionId) ?? []) {
			const node = {
				session: cloneRecord(child),
				descendants: []
			};
			nodes.push(node);
			frame.descendants.push(node);
		}
		for (let index = nodes.length - 1; index >= 0; index -= 1) {
			const node = nodes[index];
			stack.push({
				sessionId: node.session.header.id,
				descendants: node.descendants
			});
		}
	}
	return descendants;
}
function cloneRecord(record) {
	return {
		...record,
		header: structuredClone(record.header)
	};
}
//#endregion
//#region lib/types/cursor.js
/** Opaque cursor identity for session-search pagination. */
/**
* Brand an encoded provider cursor for the public search contract.
* @param value - opaque encoded cursor value.
* @returns the same runtime string with session-search cursor identity.
*/
function SessionSearchCursor(value) {
	return value;
}
//#endregion
//#region lib/types/index.js
/**
* Service Definition for combined session-history reads, traces, filters, and full-text search.
*
* @module @deepseek-ai/dsh-session-query
*/
/**
* Unified live-preferred session query service.
*
* Exact reads, filters, and traces are backend-independent concrete behavior.
* A backend implements full-text observation, reconciliation, ranking, cursor
* generations, and query execution on the same `ctx.sessionQuery` service.
*/
var SessionQueryEngine = class extends Service {
	static inject = ["sessions"];
	_readWindowMax;
	_corpus;
	constructor(ctx, config = {}) {
		super(ctx, "sessionQuery");
		this._readWindowMax = config.readWindowMax ?? 50;
		if (!Number.isInteger(this._readWindowMax) || this._readWindowMax < 0) throw new SessionQueryError("session-query: readWindowMax must be a non-negative integer", "SESSION_QUERY_INVALID_CONFIG");
		const persistedInspectConcurrency = config.persistedInspectConcurrency ?? 4;
		if (!Number.isSafeInteger(persistedInspectConcurrency) || persistedInspectConcurrency < 1) throw new SessionQueryError("session-query: persistedInspectConcurrency must be a positive safe integer", "SESSION_QUERY_INVALID_CONFIG");
		this._corpus = new SessionCorpus(ctx, persistedInspectConcurrency);
	}
	/**
	* List the complete logical corpus using live-preferred records.
	* @param signal - optional cancellation for persistence listing.
	* @returns deterministic newest-first cloned session records.
	*/
	listSessions(signal) {
		return this._corpus.listSessions(signal);
	}
	/**
	* Read and replay-validate one complete logical session log without making it live.
	* @param sessionId - live or persisted session id to read.
	* @returns cloned header and complete raw event log from one observation.
	* @throws when persistence, header compatibility, or replay validation fails.
	*/
	async readSession(sessionId) {
		const loaded = await this._corpus.load(sessionId);
		Session.create(sessionId, loaded.events, loaded.header);
		return {
			session: structuredClone(loaded.header),
			events: loaded.events.map(snapshotSessionEvent)
		};
	}
	/**
	* Filter the complete logical corpus with provider-independent predicates.
	* @param filters - ANDed session metadata and availability clauses.
	* @param signal - optional cancellation for persistence listing.
	* @returns matching cloned records in deterministic newest-first order.
	*/
	async filterSessions(filters, signal) {
		const ownedFilters = materializeSessionResultFilters(filters);
		return this._filterSessions(ownedFilters, signal);
	}
	/**
	* Fold the latest log-backed title from one live-preferred logical session.
	* @param sessionId - live or persisted session id to read.
	* @param signal - optional cancellation for source resolution and title folding.
	* @returns latest title snapshot, or `undefined` when the log has no title event.
	*/
	async readTitle(sessionId, signal) {
		return (await this.readTitleSnapshot(sessionId, signal)).title;
	}
	/**
	* Fold the latest title and return its source header from one corpus observation.
	* @param sessionId - live or persisted session id to read.
	* @param signal - optional cancellation for source resolution and title folding.
	* @returns cloned source header and optional latest title snapshot.
	*/
	async readTitleSnapshot(sessionId, signal) {
		const result = (await this.readTitleSnapshots([sessionId], signal))[0];
		if (result.status === "rejected") throw result.reason;
		return result.value;
	}
	/**
	* Fold titles for unique sessions from one cancellable corpus observation.
	*
	* Results preserve first-occurrence input order. Operational failures stay
	* isolated per session, while cancellation rejects the complete operation.
	* @param sessionIds - live or persisted session ids to observe.
	* @param signal - optional cancellation shared by all source reads.
	* @returns one fulfilled or rejected result per unique requested id.
	*/
	async readTitleSnapshots(sessionIds, signal) {
		return this._corpus.projectMany(sessionIds, (source) => {
			const title = foldSessionTitle(source.events);
			return {
				session: structuredClone(source.header),
				...title === void 0 ? {} : { title }
			};
		}, signal);
	}
	/**
	* List lightweight raw-log event records for one logical session.
	* @param sessionId - live-preferred session id to read.
	* @returns event records in ascending seq order.
	*/
	async listEvents(sessionId) {
		return eventRecords(sessionId, (await this._corpus.load(sessionId)).events);
	}
	/**
	* Scan first-party semantic event documents with provider-independent filters.
	* @param sessionId - live-preferred session id to scan.
	* @param filters - ANDed metadata and literal-text predicates.
	* @returns matching semantic documents in ascending seq order.
	*/
	async filterEvents(sessionId, filters) {
		const ownedFilters = materializeSessionEventResultFilters(filters);
		return this._filterEvents(sessionId, ownedFilters);
	}
	async _filterSessions(filters, signal) {
		return filterSessionResults(await this._corpus.listSessions(signal), filters);
	}
	async _filterEvents(sessionId, filters) {
		return filterSessionEventDocuments(buildSessionEventSearchDocuments(sessionId, (await this._corpus.load(sessionId)).events), filters);
	}
	/**
	* Read one session's complete current model surface from one corpus observation.
	* @param sessionId - live-preferred session id to read.
	* @returns cloned header, current surface, and the last sequence number included in the raw-log capture.
	* @throws when source resolution fails or the session surface is invalid.
	*/
	async readSurface(sessionId) {
		const loaded = await this._corpus.load(sessionId);
		return {
			session: structuredClone(loaded.header),
			capturedThroughSeq: loaded.events.at(-1)?.seq ?? null,
			events: currentSurfaceEvents(sessionId, loaded.events)
		};
	}
	/**
	* Trace known ancestry and descendants from one corpus observation.
	* @param sessionId - logical session id to trace.
	* @param signal - optional cancellation for persistence listing.
	* @returns a complete lineage or the first parent that could not be resolved.
	* @throws when corpus resolution fails, the target is absent, or its known ancestry cycles.
	*/
	async traceSession(sessionId, signal) {
		const records = await this._corpus.listSessions(signal);
		signal?.throwIfAborted();
		return traceSession(records, sessionId);
	}
	/**
	* Trace one event's direct positional replacements and cited source events.
	* @param request - target session id and event seq.
	* @param signal - optional cancellation for persisted source resolution.
	* @returns source header, direct links, and the target's positional replacement chain.
	* @throws when source resolution fails, the target is absent, or surface/source-event validation fails.
	*/
	async traceEvent(request, signal) {
		const loaded = await this._corpus.load(request.sessionId, signal);
		signal?.throwIfAborted();
		return {
			session: loaded.header,
			...traceEvent(request.sessionId, loaded.events, request.seq)
		};
	}
	/**
	* Read one full event plus a bounded raw-log context window.
	* @param request - target session/seq and context sizes.
	* @param signal - optional cancellation for persisted source resolution.
	* @returns cloned target and neighboring events.
	*/
	async readEvent(request, signal) {
		const before = this._readWindow("before", request.before);
		const after = this._readWindow("after", request.after);
		const sessionId = request.sessionId;
		const seq = request.seq;
		return this._readEvent(sessionId, seq, before, after, signal);
	}
	async _readEvent(sessionId, seq, before, after, signal) {
		const loaded = await this._corpus.load(sessionId, signal);
		signal?.throwIfAborted();
		const target = loaded.events[seq];
		if (target === void 0 || target.seq !== seq) throw new SessionQueryError(`session "${sessionId}" has no event at seq ${seq}`, "SESSION_QUERY_EVENT_NOT_FOUND");
		const startSeq = Math.max(0, seq - before);
		const endSeq = Math.min(loaded.events.length - 1, seq + after);
		const targetSnapshot = snapshotSessionEvent(target);
		const events = loaded.events.slice(startSeq, endSeq + 1).map((event) => event === target ? targetSnapshot : snapshotSessionEvent(event));
		return {
			session: structuredClone(loaded.header),
			target: targetSnapshot,
			events,
			startSeq,
			endSeq
		};
	}
	_readWindow(name, value) {
		if (value === void 0) return 0;
		if (!Number.isInteger(value) || value < 0 || value > this._readWindowMax) throw new SessionQueryError(`${name} must be an integer between 0 and ${this._readWindowMax}`, "SESSION_QUERY_INVALID_WINDOW");
		return value;
	}
};
//#endregion
export { SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY, SESSION_QUERY_READ_WINDOW_MAX, SessionQueryEngine, SessionQueryEngine as default, SessionQueryError, SessionSearchCursor, assertSessionHeadersCompatible, buildSessionEventRecords, buildSessionEventSearchDocuments, compileSessionTextFilter, extractSessionEventText, filterSessionEventDocuments, filterSessionResults, materializeSessionEventResultFilters, materializeSessionResultFilters };
