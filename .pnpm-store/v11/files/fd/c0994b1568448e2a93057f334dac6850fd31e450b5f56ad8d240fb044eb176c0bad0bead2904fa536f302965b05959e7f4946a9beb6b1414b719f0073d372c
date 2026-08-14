import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { BlockAssembler, deepFreeze } from "@deepseek-ai/dsh-llm";
import { canonicalHeader, deriveEventMessage, headerEquals, isSurfaceEvent } from "@deepseek-ai/dsh-session";
import { z as z$1 } from "zod";
//#region lib/types/estimate.js
/**
* Fixed-density heuristic token pricing shared by the meter service and the
* pure context-breakdown projection, so both surfaces price identical content
* to identical numbers.
*
* @module @deepseek-ai/dsh-token-meter/estimate
*/
/** Fixed text-density estimate used until exact tokenization is needed. */
const CHARS_PER_TOKEN = 4;
/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4;
/**
* Price content blocks recursively under the fixed density heuristic.
* @param blocks - content blocks to price without mutation.
* @returns heuristic tokens including per-block structural overhead.
*/
function estimateContent(blocks) {
	let tokens = 0;
	for (const block of blocks) switch (block.type) {
		case "text":
		case "reasoning":
			tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
			break;
		case "tool-call":
			tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN) + Math.ceil(block.arguments.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
			break;
		case "tool-result":
			tokens += estimateContent(block.content) + BLOCK_OVERHEAD;
			break;
		default: tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
	}
	return tokens;
}
/**
* Heuristically price one model-visible message.
* @param message - message to price without mutation.
* @returns content and role-framing tokens under the fixed heuristic.
*/
function estimateMessage(message) {
	return estimateContent(message.content) + 4;
}
/**
* Price the system-prompt part of a canonical request envelope.
* @param header - canonical envelope, or undefined before any request.
* @returns heuristic system-prompt tokens; 0 when absent.
*/
function estimateSystemTokens(header) {
	if (header?.system === void 0) return 0;
	return Math.ceil(header.system.length / CHARS_PER_TOKEN) + 4;
}
/**
* Price the tool-schema part of a canonical request envelope.
* @param header - canonical envelope, or undefined before any request.
* @returns heuristic tool-schema tokens; 0 when absent or empty.
*/
function estimateToolsTokens(header) {
	if (header?.tools === void 0 || header.tools.length === 0) return 0;
	return Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}
/**
* Price the complete non-surface request envelope.
* @param header - canonical envelope, or undefined before any request.
* @returns heuristic system plus tool tokens.
*/
function estimateHeader(header) {
	return estimateSystemTokens(header) + estimateToolsTokens(header);
}
//#endregion
//#region lib/types/surface-projection.js
/**
* The O(1) surface-token fold shared by the token-meter projection units.
*
* A projection state must stay bounded — the persisted projection cache
* checkpoints every unit's whole state, so carrying the priced surface
* (one node per model-visible message) would grow a checkpoint without
* bound over the session's life. Instead, replacements ride the compact
* seam's shadow-price protocol: the metering event immediately before a
* surface `replace` (`compaction/summary` or `compaction/prune`) states the
* heuristic price of the exact replaced range, so the fold keeps a running
* total plus at most one pending claim and never retains per-node prices.
* The counts are exact by construction: producers derive them from the same
* fixed estimator this module prices appends with. A replacement without an
* armed claim folds with zero delta because bounded state cannot reconstruct
* the replaced range; this preserves replay at the cost of possible drift.
*
* @module @deepseek-ai/dsh-token-meter/surface-projection
*/
/**
* Fold one committed event onto a running surface-token total.
*
* A shadow-price event arms a claim; any other event expires it, and a
* surface `replace` consumes the claim naming its exact range — the
* producers append the metering event and the replacement synchronously
* adjacent, so a surviving claim always prices the very next event.
* A replace with no claim folds with zero delta because the bounded state
* cannot reconstruct the replaced range. An armed claim for another range
* still fails because the adjacent events contradict each other.
* @param claim - the claim armed by the immediately preceding event, if any.
* @param event - the next committed session event.
* @returns the signed token delta and the claim state after this event.
* @throws when a replacement arrives with an armed claim for a different
*   range — the metering event was adjacent, so this is a live producer's
*   shadow-price contract violation, not historical data, and must fail
*   loud rather than let the total drift.
*/
function foldSurfaceProjection(claim, event) {
	if (event.type === "compaction/summary" || event.type === "compaction/prune") {
		const { shadowedRange, shadowedTokenCount } = event.data;
		return {
			deltaTokens: 0,
			claim: {
				start: shadowedRange.start,
				end: shadowedRange.end,
				tokens: shadowedTokenCount
			}
		};
	}
	if (!isSurfaceEvent(event)) return {
		deltaTokens: 0,
		claim: void 0
	};
	const message = deriveEventMessage(event);
	const tokens = message === null ? 0 : estimateMessage(message);
	const op = event.surfaceOp;
	if (op === "append") return {
		deltaTokens: tokens,
		claim: void 0
	};
	if (claim === void 0) return {
		deltaTokens: 0,
		claim: void 0
	};
	if (claim.start !== op.start || claim.end !== op.end) throw new Error(`token surface: replace at seq ${event.seq} over range ${op.start}-${op.end} has no adjacent shadow price (armed claim covers ${claim.start}-${claim.end})`);
	return {
		deltaTokens: tokens - claim.tokens,
		claim: void 0
	};
}
/**
* Token-meter's context-composition projection unit.
*
* Envelope figures are last-wins per `request/header`; the message figure
* rides {@link foldSurfaceProjection} — the same O(1) fold the occupancy
* projection uses — so fully metered logs equal `measure().surfaceTokens` at
* every event boundary and compaction shrinks the figure by its logged shadow
* price. A replacement without a claim preserves the previous total. The
* state is a fixed handful of numbers, so the persisted checkpoint stays
* O(1) over the session's life.
*/
const contextBreakdownProjectionDefinition = {
	key: "contextBreakdown",
	schema: z$1.object({
		systemTokens: z$1.number().int().nonnegative(),
		toolsTokens: z$1.number().int().nonnegative(),
		messageTokens: z$1.number().int().nonnegative()
	}).strict(),
	init: () => ({
		systemTokens: 0,
		toolsTokens: 0,
		messageTokens: 0
	}),
	apply: (state, event) => {
		const fold = foldSurfaceProjection(state.claim, event);
		let systemTokens = state.systemTokens;
		let toolsTokens = state.toolsTokens;
		if (event.type === "request/header") {
			const header = canonicalHeader(event.data.header);
			systemTokens = estimateSystemTokens(header);
			toolsTokens = estimateToolsTokens(header);
		}
		if (systemTokens === state.systemTokens && toolsTokens === state.toolsTokens && fold.deltaTokens === 0 && fold.claim === void 0 && state.claim === void 0) return state;
		return {
			systemTokens,
			toolsTokens,
			messageTokens: state.messageTokens + fold.deltaTokens,
			...fold.claim === void 0 ? {} : { claim: fold.claim }
		};
	},
	view: ({ systemTokens, toolsTokens, messageTokens }) => ({
		systemTokens,
		toolsTokens,
		messageTokens
	}),
	stateVersion: 2
};
//#endregion
//#region lib/types/usage-projection.js
/**
* Pure folds for durable provider-reported token usage and context occupancy.
*/
const zeroBuckets = () => ({
	uncachedInputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0
});
const bucketsFrom = (usage) => ({
	uncachedInputTokens: usage.inputTokens,
	outputTokens: usage.outputTokens,
	cacheReadTokens: usage.cacheReadTokens ?? 0,
	cacheWriteTokens: usage.cacheWriteTokens ?? 0
});
const bucketsEqual = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens && left.outputTokens === right.outputTokens && left.cacheReadTokens === right.cacheReadTokens && left.cacheWriteTokens === right.cacheWriteTokens;
const addReplacing = (totals, previous, next) => ({
	uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
	outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
	cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
	cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens
});
const projectionSchema = z$1.object({
	uncachedInputTokens: z$1.number().int().nonnegative(),
	outputTokens: z$1.number().int().nonnegative(),
	cacheReadTokens: z$1.number().int().nonnegative(),
	cacheWriteTokens: z$1.number().int().nonnegative()
}).strict();
const pressureSchema = z$1.object({
	pressureTokens: z$1.number().int().nonnegative().optional(),
	projectedTokens: z$1.number().int().nonnegative().optional(),
	contextWindow: z$1.number().int().positive().optional()
}).strict();
/** Prompt-side pressure of one request: input plus cache traffic, no output. */
const pressureFrom = (usage) => usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
/** The usage a chunk or finalized message reports for its step, if any. */
const usageOf = (event) => event.type === "assistant/chunk" && event.data.chunk.type === "usage" ? event.data.chunk.usage : event.type === "assistant/message" ? event.data.usage : void 0;
/**
* Token-meter's session projection unit.
*
* Usage chunks provide an early sample that survives a later request failure;
* an assistant message provides the final sample for the same turn/step. A
* repeated sample replaces that step's earlier value instead of double
* counting it. The single `last` slot relies on the session-log invariant
* that usage reports for one turn/step are adjacent: once a later step begins,
* a legal log never reports usage for an earlier step again.
*/
const tokenUsageProjectionDefinition = {
	key: "tokenUsage",
	schema: projectionSchema,
	init: () => ({
		totals: zeroBuckets(),
		last: null
	}),
	apply: (state, event) => {
		let turn;
		let step;
		let usage;
		if (event.type === "assistant/chunk" && event.data.chunk.type === "usage") {
			({turn, step} = event.data);
			usage = event.data.chunk.usage;
		} else if (event.type === "assistant/message" && event.data.usage !== void 0) ({turn, step, usage} = event.data);
		else return state;
		const buckets = bucketsFrom(usage);
		const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last.buckets : void 0;
		if (previous !== void 0 && bucketsEqual(previous, buckets)) return state;
		return {
			totals: addReplacing(state.totals, previous, buckets),
			last: {
				turn,
				step,
				buckets
			}
		};
	},
	view: (state) => state.totals,
	stateVersion: 1
};
/**
* Token-meter's context-occupancy projection unit.
*
* Independent last-wins slots: the newest usage sample supplies the provider
* numerator, the newest `request/context` record the denominator. Both are
* whole values, so replay order alone decides the result and no cross-field
* consistency is claimed — the pair is explicitly not one atomic request
* observation (see {@link ContextPressureProjection}).
*
* `pressureTokens` is prompt-side only, so it holds still while a turn streams
* and steps forward once the next request reports its usage. Because nothing
* but a request reports usage, it also cannot see a compaction: the fold
* therefore carries a running surface total alongside it and publishes
* `projectedTokens` — the sample plus the surface's signed movement since it
* was taken — so occupancy answers for the next request rather than the last
* one. The total rides {@link foldSurfaceProjection}, so the state stays O(1)
* and a replacement shrinks it by its logged shadow price. A replacement
* without a claim preserves the previous total. A usage sample is stamped
* BEFORE the same event joins the surface, so an `assistant/message` anchors
* against the surface its own request saw.
*/
const contextPressureProjectionDefinition = {
	key: "contextPressure",
	schema: pressureSchema,
	init: () => ({ surfaceTokens: 0 }),
	apply: (state, event) => {
		const fold = foldSurfaceProjection(state.claim, event);
		let next = state;
		if (event.type === "request/context") {
			const contextWindow = event.data.contextWindow;
			if (contextWindow !== state.contextWindow) if (contextWindow !== void 0) next = {
				...next,
				contextWindow
			};
			else {
				const { contextWindow: _removed, ...withoutContextWindow } = next;
				next = withoutContextWindow;
			}
		}
		const usage = usageOf(event);
		if (usage !== void 0) {
			const pressureTokens = pressureFrom(usage);
			if (pressureTokens !== next.pressureTokens || next.sampledSurfaceTokens !== next.surfaceTokens) next = {
				...next,
				pressureTokens,
				sampledSurfaceTokens: next.surfaceTokens
			};
		}
		if (fold.deltaTokens !== 0) next = {
			...next,
			surfaceTokens: next.surfaceTokens + fold.deltaTokens
		};
		if (state.claim === void 0 && fold.claim === void 0) return next;
		const { claim: _expired, ...withoutClaim } = next;
		return fold.claim === void 0 ? withoutClaim : {
			...withoutClaim,
			claim: fold.claim
		};
	},
	view: ({ contextWindow, pressureTokens, surfaceTokens, sampledSurfaceTokens }) => ({
		...contextWindow === void 0 ? {} : { contextWindow },
		...pressureTokens === void 0 ? {} : { pressureTokens },
		...pressureTokens === void 0 || sampledSurfaceTokens === void 0 ? {} : { projectedTokens: Math.max(0, pressureTokens + surfaceTokens - sampledSurfaceTokens) }
	}),
	stateVersion: 4
};
//#endregion
//#region lib/types/surface-fold.js
/**
* The measurement service's positional surface fold: the per-node priced
* surface `measure()` serves and compaction plans against. The projection
* units deliberately do NOT share this fold — their state must stay O(1)
* for the persisted checkpoint, so they ride `surface-projection.ts`'s
* shadow-price protocol instead. Fully metered logs stay in agreement by
* construction: both price through `estimate.ts`, and every logged shadow
* price is derived from THIS fold's nodes by the replace producer. A
* projection replacement without a claim deliberately folds with zero delta.
*
* @module @deepseek-ai/dsh-token-meter/surface-fold
*/
/**
* Fold one surface event onto a priced surface.
*
* Total and allocation-fresh: the caller assigns the result rather than
* mutating in place, so a throw here leaves the caller's state untouched and
* the same malformed event fails identically on every retry.
* @param nodes - the priced surface preceding this event, in model-visible order.
* @param event - the surface event to place.
* @returns the event's price, the next surface, and the signed total delta.
* @throws when a replacement names a range absent from `nodes` — committed
*   logs are surface-validated at append time, so an unresolvable range is log
*   corruption and must fail loud rather than skip the event.
*/
function foldSurfaceTokens(nodes, event) {
	const message = deriveEventMessage(event);
	const tokens = message === null ? 0 : estimateMessage(message);
	const op = event.surfaceOp;
	if (op === "append") return {
		tokens,
		nodes: [...nodes, {
			seq: event.seq,
			tokens
		}],
		deltaTokens: tokens
	};
	const startIdx = nodes.findIndex((node) => node.seq === op.start);
	const endIdx = nodes.findIndex((node) => node.seq === op.end);
	if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) throw new Error(`token surface: replace at seq ${event.seq} has invalid current range ${op.start}-${op.end}`);
	const removed = nodes.slice(startIdx, endIdx + 1).reduce((total, node) => total + node.tokens, 0);
	const next = [...nodes];
	next.splice(startIdx, endIdx - startIdx + 1, {
		seq: event.seq,
		tokens
	});
	return {
		tokens,
		nodes: next,
		deltaTokens: tokens - removed
	};
}
//#endregion
//#region lib/types/index.js
/**
* Single replay-aware token-meter service for request and surface pressure.
*
* @module @deepseek-ai/dsh-token-meter
*/
/** Sum disjoint provider usage buckets without double-counting reasoning output. */
function usageTokens(usage) {
	return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + usage.outputTokens;
}
/** Compare optional envelopes so a headerless estimate can track later surface deltas. */
function optionalHeaderEquals(left, right) {
	if (left === void 0 || right === void 0) return left === right;
	return headerEquals(left, right);
}
/** Reject stale or misspelled keys before defaults can hide them. */
function validateConfigKeys(config) {
	for (const key of Object.keys(config)) throw new Error(`TokenMeterConfig: unknown key "${key}" (no settings are supported)`);
}
/** Replay owner for one service-wide estimator and isolated per-session folds. */
var TokenMeter = class extends Service {
	static Config = z.object({});
	states = /* @__PURE__ */ new WeakMap();
	constructor(ctx, config = {}) {
		super(ctx, "tokenMeter");
		validateConfigKeys(config);
		ctx.inject(["sessionProjections"], (projectionCtx) => {
			projectionCtx.sessionProjections.register(tokenUsageProjectionDefinition);
			projectionCtx.sessionProjections.register(contextPressureProjectionDefinition);
			projectionCtx.sessionProjections.register(contextBreakdownProjectionDefinition);
		});
		ctx.on("session/event", (session) => {
			if (this.states.has(session)) this._sync(session);
		});
	}
	/**
	* Measure current request pressure and surface through the durable tail.
	*
	* Provider usage is reused only when the latest successful call's canonical
	* request envelope matches `requestHeader` and its total is no lower than
	* that call's full heuristic anchor; otherwise the complete envelope and
	* surface are heuristically repriced.
	*
	* `requestHeader` affects request pressure only; surface fields always
	* describe the current session surface. Every call clones those positional
	* nodes, so measurement is O(surface).
	*
	* @param session - session to replay through its current durable tail.
	* @param requestHeader - optional effective request envelope replacing the latest logged header.
	* @returns a detached deeply immutable pressure and surface measurement.
	*/
	measure(session, requestHeader) {
		const state = this._sync(session);
		const header = requestHeader === void 0 ? state.header : canonicalHeader(requestHeader);
		const anchor = state.anchor;
		let baseline;
		let surfaceDeltaTokens;
		if (anchor !== void 0 && optionalHeaderEquals(anchor.header, header)) {
			baseline = anchor.baseline;
			surfaceDeltaTokens = state.surfaceTokens - anchor.surfaceTokens;
		} else if (header === void 0 && state.surfaceTokens === 0) {
			baseline = {
				kind: "none",
				tokens: 0
			};
			surfaceDeltaTokens = 0;
		} else {
			baseline = {
				kind: "estimated",
				tokens: estimateHeader(header) + state.surfaceTokens
			};
			surfaceDeltaTokens = 0;
		}
		return deepFreeze(structuredClone({
			logRevision: state.consumedEvents,
			baseline,
			surfaceDeltaTokens,
			totalTokens: Math.max(0, baseline.tokens + surfaceDeltaTokens),
			surfaceTokens: state.surfaceTokens,
			nodes: state.surface
		}));
	}
	/**
	* Heuristically price one model-visible message (instance face of the pure
	* `estimateMessage` export from `estimate.ts`).
	* @param message - message to price without mutation.
	* @returns content and role-framing tokens under the fixed service heuristic.
	*/
	estimateMessage(message) {
		return estimateMessage(message);
	}
	/** Catch one session's fold up to the current durable tail. */
	_sync(session) {
		let state = this.states.get(session);
		if (state === void 0) {
			state = {
				consumedEvents: 0,
				header: void 0,
				surface: [],
				surfaceTokens: 0,
				stepStart: void 0,
				anchor: void 0
			};
			this.states.set(session, state);
		}
		while (state.consumedEvents < session.events.length) {
			const event = session.events[state.consumedEvents];
			this._foldEvent(session, state, event);
			state.consumedEvents += 1;
		}
		return state;
	}
	/**
	* Validate and prepare every fallible part before mutating replay state.
	* A malformed event remains unread on every retry instead of partially
	* applying the same mutation more than once.
	*/
	_foldEvent(session, state, event) {
		let nextHeader = state.header;
		let nextStepStart = state.stepStart;
		let nextAnchor = state.anchor;
		switch (event.type) {
			case "request/header":
				nextHeader = canonicalHeader(event.data.header);
				break;
			case "step/start":
				if (state.stepStart !== void 0) throw new Error(`token meter: step/start at seq ${event.seq} arrived before turn ${state.stepStart.turn}/step ${state.stepStart.step} ended`);
				nextStepStart = {
					...event.data,
					surfaceTokens: state.surfaceTokens
				};
				break;
			case "step/end":
				if (state.stepStart === void 0 || state.stepStart.turn !== event.data.turn || state.stepStart.step !== event.data.step) throw new Error(`token meter: step/end at seq ${event.seq} has no matching step/start event`);
				nextStepStart = void 0;
				break;
			default: break;
		}
		const surface = isSurfaceEvent(event) ? foldSurfaceTokens(state.surface, event) : void 0;
		if (event.type === "assistant/message") {
			const stepStart = state.stepStart;
			if (stepStart === void 0 || stepStart.turn !== event.data.turn || stepStart.step !== event.data.step) throw new Error(`token meter: assistant/message at seq ${event.seq} has no matching step/start event`);
			const eventTokens = surface.tokens;
			if (event.data.usage !== void 0 && nextHeader !== void 0) {
				const providerAssistantTokens = this._estimateProviderAssistant(session, event, eventTokens);
				const anchorSurfaceTokens = stepStart.surfaceTokens + providerAssistantTokens;
				const providerTokens = usageTokens(event.data.usage);
				const estimatedAnchorTokens = estimateHeader(nextHeader) + anchorSurfaceTokens;
				nextAnchor = {
					header: nextHeader,
					surfaceTokens: anchorSurfaceTokens,
					baseline: providerTokens >= estimatedAnchorTokens ? {
						kind: "usage",
						tokens: providerTokens,
						usage: event.data.usage
					} : {
						kind: "estimated",
						tokens: estimatedAnchorTokens
					}
				};
			} else {
				const anchorSurfaceTokens = stepStart.surfaceTokens + eventTokens;
				nextAnchor = {
					header: nextHeader,
					surfaceTokens: anchorSurfaceTokens,
					baseline: {
						kind: "estimated",
						tokens: estimateHeader(nextHeader) + anchorSurfaceTokens
					}
				};
			}
		}
		state.header = nextHeader;
		state.stepStart = nextStepStart;
		if (surface !== void 0) {
			state.surface = surface.nodes;
			state.surfaceTokens += surface.deltaTokens;
		}
		state.anchor = nextAnchor;
	}
	/**
	* Reassemble provider output from the exact cited chunk seqs for a usage anchor.
	* Missing legacy source seqs conservatively treat the durable output as the
	* provider output; an explicit empty list prices a known empty stream.
	*/
	_estimateProviderAssistant(session, event, durableEventTokens) {
		const sourceSeqs = event.sourceEventSeqs;
		if (sourceSeqs === void 0) return durableEventTokens;
		const assembler = new BlockAssembler();
		const seen = /* @__PURE__ */ new Set();
		for (const seq of sourceSeqs) {
			if (seq >= event.seq) throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} is not earlier`);
			if (seen.has(seq)) throw new Error(`token meter: assistant/message at seq ${event.seq} repeats source seq ${seq}`);
			seen.add(seq);
			const sourceEvent = session.events[seq];
			if (sourceEvent.type !== "assistant/chunk") throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} is not assistant/chunk`);
			if (sourceEvent.data.turn !== event.data.turn || sourceEvent.data.step !== event.data.step) throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} belongs to another step`);
			assembler.push(sourceEvent.data.chunk);
		}
		const providerContent = assembler.blocks();
		return providerContent.length === 0 ? 0 : estimateContent(providerContent) + 4;
	}
};
//#endregion
export { TokenMeter, TokenMeter as default };
