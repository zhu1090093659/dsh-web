import { Service } from "@deepseek-ai/cordis";
import { scopeTarget } from "@deepseek-ai/dsh-scope";
import { assertObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import { HarnessError, boundContextSummary, createUserMessage, errorChain } from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";
import { foldConsumedWork } from "@deepseek-ai/dsh-agent";
import { Session, SessionId, snapshotJsonValue } from "@deepseek-ai/dsh-session";
import { z } from "zod";
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
//#region lib/types/error.js
/**
* Typed failures shared by subagent service and provider operations.
*
* @module @deepseek-ai/dsh-subagent
*/
/** Typed failure for the subagent seam. */
var SubagentError = class extends HarnessError {
	constructor(message, code, options) {
		super(message, code, options);
		this.name = "SubagentError";
	}
};
//#endregion
//#region lib/types/depth.js
/**
* Delegation-depth accounting: the recursion budget a parent passes to its
* children. Kept apart from the service so composition helpers can read it
* without importing the registry.
*
* @module @deepseek-ai/dsh-subagent/depth
*/
/**
* Read an agent's delegation depth, treating absence as top-level depth zero.
* The persisted session header is authoritative and monotone: runtime
* `AgentOptions.subagentDepth` may DEEPEN the count but can never lower it —
* a resumed child arrives with fresh options, and counting it from zero would
* let it delegate as if it were top-level.
* @param agent - the agent whose header and options carry the depth.
* @returns its non-negative safe-integer depth.
* @throws if the runtime `AgentOptions.subagentDepth` is not a non-negative safe integer.
*/
function delegationDepthOf(agent) {
	const runtime = agent.options.subagentDepth;
	if (runtime !== void 0 && (!Number.isSafeInteger(runtime) || runtime < 0 || Object.is(runtime, -0))) throw new TypeError("agent subagentDepth must be a non-negative safe integer");
	return Math.max(agent.session.header.delegationDepth ?? 0, runtime ?? 0);
}
/**
* Reject a recursion cap that cannot represent an exact delegation depth.
* @param maxDepth - the optional runtime value to validate.
*/
function assertSubagentMaxDepth(maxDepth) {
	if (maxDepth !== void 0 && (typeof maxDepth !== "number" || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || Object.is(maxDepth, -0))) throw new TypeError("subagent maxDepth must be a non-negative safe integer");
}
//#endregion
//#region lib/types/assistant-output.js
/**
* Canonical selection of a child's final assistant output. Backend run results
* and `subagent/end.lastAssistantMessage` apply the same rule: select the last
* non-empty assistant message. An empty-content message records usage only
* when the loop appends it after a max-tokens step with no executable blocks,
* so it does not replace earlier output. If no non-empty message exists,
* select the accumulated assistant text. Selection is independent of the
* run's stop reason.
*
* @module @deepseek-ai/dsh-subagent/assistant-output
*/
/**
* Incremental fold of the selection rule, for backends that observe a child's
* output as it streams: session-event backends {@link push} each event, and
* transports without session events (ACP content chunks) {@link pushText} raw
* text into the same streamed fallback.
*/
var AssistantOutputFold = class {
	message;
	partial = [];
	/**
	* Fold one session event: a non-empty assistant message becomes the
	* candidate final answer, and a `text-delta` chunk extends the streamed
	* fallback; every other event contributes nothing.
	* @param event - the next observed session event.
	*/
	push(event) {
		if (event.type === "assistant/message") {
			const content = event.data.message.content;
			if (content.length > 0) this.message = content;
		} else if (event.type === "assistant/chunk" && event.data.chunk.type === "text-delta") this.pushText(event.data.chunk.text);
	}
	/**
	* Extend the streamed fallback with text observed outside session events.
	* @param text - the next streamed text piece (an empty piece is a no-op).
	*/
	pushText(text) {
		if (text.length > 0) this.partial.push(text);
	}
	/**
	* Select the final output folded so far.
	* @returns the last non-empty assistant message, else the accumulated
	*   streamed text, or `undefined` when the child produced neither.
	*/
	collect() {
		if (this.message !== void 0) return this.message;
		const text = this.partial.join("");
		return text.length > 0 ? [{
			type: "text",
			text
		}] : void 0;
	}
};
/**
* Apply the selection rule to one complete child-owned event suffix.
* @param events - the child-owned events (after any seed or epoch boundary).
* @returns the selected output, or `undefined` when the child produced none.
*/
function finalAssistantOutput(events) {
	const fold = new AssistantOutputFold();
	for (const event of events) fold.push(event);
	return fold.collect();
}
//#endregion
//#region lib/types/types.js
/**
* The seam's consumer-facing contracts: request, result, and capability types
* for {@link SubagentProvider}, plus the `subagent/start` and `subagent/end`
* payloads that plugins and hosts observe. Internal control interfaces belong
* with their implementation — the lifecycle observer in `./lifecycle.ts`, the
* continuation host in `./continuation.ts` — so this module stays the published
* surface rather than a bag of everything type-shaped.
*
* @module @deepseek-ai/dsh-subagent/types
*/
/**
* Brand a string as a {@link SubagentRunId}.
* @param id - the raw run id.
* @returns the same string, branded.
*/
function SubagentRunId(id) {
	return id;
}
//#endregion
//#region lib/types/lifecycle.js
/**
* Lifecycle-edge publication for both subagent shapes: the contained emitter,
* the one-shot run observer, and the continuable Activation observer.
*
* The public payload contracts ({@link SubagentRunInfo},
* {@link SubagentRunEndInfo}) live in `./types.ts` with the rest of the seam's
* consumer-facing types; this module owns only the implementation and the
* package-private {@link ActivationObserver} the continuation manager consumes.
* Keeping the internal control interface out of the published surface is
* deliberate: the observer's `start`/`capture`/`settle` ordering is a contract
* between this module and one in-package caller, not something a plugin may
* depend on.
*
* @module @deepseek-ai/dsh-subagent/lifecycle
*/
/**
* Build the contained lifecycle emitter this seam publishes every edge through.
* Every listener is independently contained: a synchronous throw or a rejected
* returned promise is logged without starving peer listeners, changing the run,
* or — for provider removal, which fires from a disposer — breaking teardown.
* @param ctx - the service's own context, owning dispatch and the logger.
* @param carrier - resolve the scoped dispatch carrier for one delegating parent.
* @returns the emitter both observers and the provider registry publish through.
*/
function createLifecycleEmitter(ctx, carrier) {
	return (name, info, parent) => {
		const dispatchArgs = parent === void 0 ? [name, info] : [
			carrier(parent),
			name,
			info
		];
		for (const callback of ctx.events.dispatch("emit", dispatchArgs)) try {
			const returned = callback(info);
			Promise.resolve(returned).catch((error) => {
				ctx.logger.warn(`subagent: ${name} listener rejected: ${renderThrown(error)}`);
			});
		} catch (error) {
			ctx.logger.warn(`subagent: ${name} listener threw: ${renderThrown(error)}`);
		}
	};
}
/**
* Emit the start/end lifecycle pair for one accepted one-shot run.
* @param emit - the contained lifecycle emitter.
* @param provider - the provider that established the run.
* @param parent - the delegating parent keying scoped dispatch.
* @param run - the published run whose settlement closes the pair.
* @returns the same run, unchanged.
*/
function observeRun(emit, provider, parent, run) {
	const identity = {
		runId: SubagentRunId(randomUUID()),
		provider,
		id: run.id,
		local: run.localAgent !== void 0
	};
	run.result.then((result) => {
		emit("subagent/end", {
			...identity,
			stopReason: result.stopReason,
			...result.output.length === 0 ? {} : { lastAssistantMessage: result.output }
		}, parent);
	}, () => {
		emit("subagent/end", {
			...identity,
			stopReason: "error"
		}, parent);
	});
	emit("subagent/start", identity, parent);
	return run;
}
/**
* Build the observer for one continuable Activation's residency epoch. Observers
* see the same vocabulary as a one-shot run, so a child's start and settlement
* remain observable without exposing whether the manager materialized, woke, or
* cold-resumed it. Creation failure before residency emits no lifecycle edge.
* @param emit - the contained lifecycle emitter.
* @param provider - the provider name recorded in the durable descriptor.
* @param childId - the durable child session id.
* @param parent - the exact live direct parent keying scoped dispatch.
* @returns the observer whose edges this epoch publishes.
*/
function createActivationObserver(emit, provider, childId, parent) {
	const identity = {
		runId: SubagentRunId(randomUUID()),
		provider,
		id: childId,
		local: true
	};
	let boundary = 0;
	let captured = { stopReason: "completed" };
	const terminal = (failure) => failure === void 0 ? captured : { stopReason: "error" };
	return {
		start: (child) => {
			boundary = child.session.events.length;
			emit("subagent/start", identity, parent);
		},
		capture: (child) => {
			const own = child.session.events.slice(boundary);
			const output = finalAssistantOutput(own);
			captured = {
				stopReason: epochStopReason(own),
				...output === void 0 ? {} : { output }
			};
		},
		terminal,
		settle: (failure) => {
			const { stopReason, output } = terminal(failure);
			emit("subagent/end", {
				...identity,
				stopReason,
				...output === void 0 ? {} : { lastAssistantMessage: output }
			}, parent);
		}
	};
}
/**
* Why this child's epoch ended, for the terminal lifecycle edge and the
* manager's own parent delivery. The child's own log is authoritative:
* teardown succeeding says nothing about whether the model errored, hit its
* token ceiling, or was cancelled, so deriving the reason from disposal would
* report failed work as completed.
*
* {@link foldConsumedWork} supplies both halves the raw turn sequence cannot:
* which turn accounts for the work this epoch consumed, and whether accepted
* work was cancelled after it without any turn opening over it. A recorded
* failure still wins over a cancellation — stopping a child that had already
* failed does not turn its failure into a cancellation.
* @param events - this epoch's own event suffix.
* @returns its terminal stop reason; `completed` only for an epoch that both
*   closed cleanly and had nothing left to run.
*/
function epochStopReason(events) {
	const { end, droppedUnrun } = foldConsumedWork(events);
	switch (end?.data.reason.kind) {
		case "max-tokens": return "max-tokens";
		case "aborted":
		case "interrupted": return "aborted";
		case "error": return "error";
		case "blocked": return "refusal";
		case void 0:
		case "completed": return droppedUnrun ? "aborted" : "completed";
		/* v8 ignore next 3 -- `TurnEndReason` is merge-extensible, so this arm needs a
		* backend that adds a variant; treating an unnameable reason as success would
		* report failed work as completed. */
		default: return "error";
	}
}
/** Render any listener-thrown value without letting coercion escape containment. */
function renderThrown(value) {
	try {
		return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
	} catch {
		return "<unrenderable thrown value>";
	}
}
//#endregion
//#region lib/types/descriptor.js
/**
* The durable subagent-child descriptor: the versioned, model-hidden
* `subagent/descriptor` session event that identifies every session-backed
* subagent and records whether it is one-shot or continuable. Continuable
* descriptors additionally preserve the declared composition required for
* cold resume. Providers append it turn-enclosed in the child's initial turn.
*
* The descriptor deliberately snapshots explicit fields rather than the
* merge-extensible `AgentOptions` object: an unrelated extension value cannot
* make continuation fail merely because it is not JSON, and later composition
* inputs require a deliberate {@link SUBAGENT_DESCRIPTOR_VERSION} change. It
* omits `subagentDepth` — cold resume trusts the persisted header's
* `delegationDepth` as the monotone floor — and `outputSchema`, which belongs
* to one activation's result contract rather than durable child composition.
* Per-activation knobs such as `maxTokens` are omitted for the same reason as
* `outputSchema`: they budget one activation. Cold resume requires the exact
* live parent for authorization but reconstructs child options only from the
* durable descriptor, so it neither restores the prior budget nor inherits
* the parent's current one; the resumed route's defaults apply instead.
*
* @module @deepseek-ai/dsh-subagent/descriptor
*/
/**
* The current descriptor format version, stamped into every appended
* `subagent/descriptor` event and required verbatim by {@link foldSubagentDescriptor}.
* Supporting another composition input is a deliberate version change, never
* an implicit extra field.
*/
const SUBAGENT_DESCRIPTOR_VERSION = 2;
const DESCRIPTOR_BASE_KEYS = [
	"version",
	"mode",
	"provider",
	"label"
];
const ONE_SHOT_DESCRIPTOR_KEYS = new Set(DESCRIPTOR_BASE_KEYS);
const CONTINUABLE_DESCRIPTOR_KEYS = new Set([
	...DESCRIPTOR_BASE_KEYS,
	"agentProvider",
	"agentModel",
	"persona",
	"toolFilter"
]);
const TOOL_FILTER_KEYS = new Set(["allow", "deny"]);
/** Whether a persisted JSON value is an object record. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Reject fields outside one versioned record's declared schema. */
function assertKnownKeys(value, keys, path) {
	const unknown = Object.keys(value).find((key) => !keys.has(key));
	if (unknown !== void 0) throw new Error(`persisted subagent descriptor ${path} has unknown field "${unknown}"`);
}
/** Read one optional string field from a persisted descriptor record. */
function optionalString(value, key) {
	if (!Object.hasOwn(value, key)) return void 0;
	const field = value[key];
	if (typeof field !== "string") throw new Error(`persisted subagent descriptor ${key} must be a string`);
	return field;
}
/** Read one optional string-array field from a persisted tool restriction. */
function optionalStringArray(value, key) {
	if (!Object.hasOwn(value, key)) return void 0;
	const field = value[key];
	if (!Array.isArray(field)) throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`);
	const items = field;
	if (items.some((item) => typeof item !== "string")) throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`);
	return items;
}
/** Validate and reconstruct a persisted tool restriction. */
function parseToolFilter(value) {
	if (!isRecord(value)) throw new Error("persisted subagent descriptor toolFilter must be an object");
	assertKnownKeys(value, TOOL_FILTER_KEYS, "toolFilter");
	const allow = optionalStringArray(value, "allow");
	const deny = optionalStringArray(value, "deny");
	if (allow === void 0 && deny === void 0) throw new Error("persisted subagent descriptor toolFilter must declare allow and/or deny");
	return {
		...allow !== void 0 ? { allow } : {},
		...deny !== void 0 ? { deny } : {}
	};
}
/** Validate one persisted descriptor payload for the current runtime. */
function parseSubagentDescriptor(value) {
	if (!isRecord(value)) throw new Error("persisted subagent descriptor payload must be an object");
	const version = value["version"];
	if (typeof version !== "number") throw new Error("persisted subagent descriptor version must be a number");
	if (version !== 2) return void 0;
	const mode = value["mode"];
	if (mode !== "one-shot" && mode !== "continuable") throw new Error("persisted subagent descriptor mode must be \"one-shot\" or \"continuable\"");
	assertKnownKeys(value, mode === "one-shot" ? ONE_SHOT_DESCRIPTOR_KEYS : CONTINUABLE_DESCRIPTOR_KEYS, "payload");
	const provider = value["provider"];
	if (typeof provider !== "string") throw new Error("persisted subagent descriptor provider must be a string");
	if (mode === "one-shot") {
		const label = optionalString(value, "label");
		return {
			version: 2,
			mode,
			provider,
			...label !== void 0 ? { label } : {}
		};
	}
	const label = value["label"];
	if (typeof label !== "string") throw new Error("persisted subagent descriptor label must be a string");
	const agentProvider = optionalString(value, "agentProvider");
	const agentModel = optionalString(value, "agentModel");
	const persona = optionalString(value, "persona");
	const toolFilter = Object.hasOwn(value, "toolFilter") ? parseToolFilter(value["toolFilter"]) : void 0;
	return {
		version: 2,
		mode,
		provider,
		label,
		...agentProvider !== void 0 ? { agentProvider } : {},
		...agentModel !== void 0 ? { agentModel } : {},
		...persona !== void 0 ? { persona } : {},
		...toolFilter !== void 0 ? { toolFilter } : {}
	};
}
function snapshotSubagentDescriptor(input) {
	const snapshot = snapshotJsonValue(input.mode === "one-shot" ? {
		version: 2,
		mode: input.mode,
		provider: input.provider,
		...input.label !== void 0 ? { label: input.label } : {}
	} : {
		version: 2,
		mode: input.mode,
		provider: input.provider,
		label: input.label,
		...input.agentProvider !== void 0 ? { agentProvider: input.agentProvider } : {},
		...input.agentModel !== void 0 ? { agentModel: input.agentModel } : {},
		...input.persona !== void 0 ? { persona: input.persona } : {},
		...input.toolFilter !== void 0 ? { toolFilter: input.toolFilter } : {}
	});
	if (snapshot === void 0) throw new Error("subagent descriptor is not losslessly JSON-serializable");
	return snapshot;
}
/**
* Fold a persisted child log to its supported descriptor. The first
* `subagent/descriptor` event is authoritative — the establishing provider
* appends exactly one, so a later same-type event cannot rewrite the declared
* composition.
* @param events - the loaded child session events.
* @returns the descriptor, or `undefined` when the log has none or its
*   version is not {@link SUBAGENT_DESCRIPTOR_VERSION} (the child cannot be
*   classified by this runtime).
* @throws when a current-version persisted payload does not match its complete
*   declared schema.
*/
function foldSubagentDescriptor(events) {
	const event = events.find((candidate) => candidate.type === "subagent/descriptor");
	if (event === void 0) return void 0;
	return parseSubagentDescriptor(event.data);
}
//#endregion
//#region lib/types/child-agent.js
/**
* Shared in-process child composition: the delegation-depth budget, the
* durable session metadata, the resolved child `AgentOptions`, the delegated
* policy seed, and the scoped setup a child agent needs. Both the one-shot
* provider driver and the continuation manager compose children this way, so
* depth accounting, lineage stamping, and delegation policy have one home.
*
* @module @deepseek-ai/dsh-subagent/child-agent
*/
/** Thrown when starting a child would exceed the requested depth cap. */
var SubagentDepthError = class extends Error {
	attemptedDepth;
	maxDepth;
	constructor(attemptedDepth, maxDepth) {
		super(`subagent depth ${attemptedDepth} exceeds maxDepth ${maxDepth}`);
		this.attemptedDepth = attemptedDepth;
		this.maxDepth = maxDepth;
		this.name = "SubagentDepthError";
	}
};
/**
* Resolve the child's delegation depth from its parent and enforce an optional
* cap. The persisted parent header is the monotone floor, so a resumed parent
* cannot delegate as if it were top-level.
* @param parent - the delegating parent agent.
* @param maxDepth - optional absolute cap the resolved depth must not exceed.
* @returns the child's non-negative safe-integer depth.
* @throws {SubagentDepthError} when the resolved depth exceeds `maxDepth`.
* @throws {RangeError} when the resolved depth leaves the safe-integer range.
*/
function resolveChildDepth(parent, maxDepth) {
	const childDepth = delegationDepthOf(parent) + 1;
	if (!Number.isSafeInteger(childDepth)) throw new RangeError("subagent child depth exceeds the safe-integer range");
	if (maxDepth !== void 0 && childDepth > maxDepth) throw new SubagentDepthError(childDepth, maxDepth);
	return childDepth;
}
/**
* Resolve the child's `AgentOptions`: the parent's provider/model/maxTokens
* route unless the request overrides it, stamped with the child's own
* delegation depth.
* @param parent - the delegating parent whose route the child inherits.
* @param requested - per-child overrides, if any.
* @param childDepth - the resolved delegation depth to stamp.
* @returns the resolved options for `ctx.agents.create()`.
*/
function resolveChildAgentOptions(parent, requested, childDepth) {
	const parentProvider = parent.options.provider;
	const parentModel = parent.options.model;
	const parentMaxTokens = parent.options.maxTokens;
	return {
		...parentProvider !== void 0 ? { provider: parentProvider } : {},
		...parentModel !== void 0 ? { model: parentModel } : {},
		...parentMaxTokens !== void 0 ? { maxTokens: parentMaxTokens } : {},
		...requested,
		subagentDepth: childDepth
	};
}
/**
* Build the child session's durable creation metadata: the parent's workspace,
* its direct lineage, coarse product origin, the recursion budget that must
* survive persistence, the seed boundary that separates inherited parent
* history from child work, and the composition the child runs under.
*
* The preset is read from the parent's LIVE scope chain rather than from its
* header, because a parent that switched preset while blank runs on the newer
* composition and its header still names the older one. Recording it is what
* makes a child's history reconstructable: without it a cold read of the child
* resolves the deployment default and rebuilds turns under a tool set the
* child never had.
* @param parent - the delegating parent agent.
* @param childDepth - the resolved delegation depth to persist.
* @param lineageSeedLength - how many leading events came from the parent's log.
* @returns the `meta` for `ctx.agents.create()`.
*/
function childSessionMeta(parent, childDepth, lineageSeedLength) {
	const parentHeader = parent.session.header;
	const agentPreset = parent.ctx.get("agentPresets")?.composedPreset(parent.ctx);
	return {
		...parentHeader.cwd !== void 0 ? { cwd: parentHeader.cwd } : {},
		...agentPreset === void 0 ? {} : { agentPreset },
		parentSession: parentHeader.id,
		origin: "subagent",
		delegationDepth: childDepth,
		...lineageSeedLength > 0 ? { seedLength: lineageSeedLength } : {}
	};
}
/**
* Model-facing delegation-scope statement for every in-process child. A
* runtime-context contribution rather than a system-prompt section, so the
* deployment's system prompt stays uniform across parents and children.
*/
const SUBAGENT_DELEGATION_CONTEXT = "You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. When the task needs access beyond that scope, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.";
/**
* Compose one child inside its creation window: join its parent's preset,
* register the fixed delegation-scope statement, then apply the child's own
* shadowing persona section and tool restriction, all owned by the child's
* scope and therefore invisible to its parent and siblings. Creation and cold
* resume both pass through here.
*
* The join comes first and the child's own registrations second, which is the
* order the layering already implies — the nearest scope wins a name, and a
* per-child restriction intersects with everything its chain admits — but
* stating it here keeps the two steps from being read as independent.
*
* The join and the per-child registrations live in ONE call because a child
* composed without the join is exactly the defect this function exists to
* prevent: with every model-facing row on the agent plane, a child that joins
* no preset sees an empty tool registry and none of its parent's prompt
* sections. Taking the parent as a parameter is what makes that omission
* unrepresentable at the call sites.
* @param childCtx - the child agent's scoped creation context.
* @param parent - the delegating parent whose composition the child joins.
* @param composition - the per-child persona and tool filter to install.
*/
function applyChildComposition(childCtx, parent, composition) {
	childCtx.get("agentPresets")?.composeFrom(childCtx, parent.ctx);
	childCtx.systemPrompt.context({
		name: "subagent:delegation",
		order: 120,
		text: SUBAGENT_DELEGATION_CONTEXT
	});
	if (composition.persona !== void 0) childCtx.systemPrompt.section({
		name: "deployment:persona",
		order: 0,
		text: composition.persona
	});
	if (composition.toolFilter !== void 0) childCtx.tools.restrict(composition.toolFilter);
}
/**
* Capture the policy to seed into one delegation. Call synchronously before
* the child start's first await: a later parent switch belongs to the
* parent's future, not to this child. Only the parent session's explicit
* sandbox override is captured — never deployment defaults or one-shot
* grants — and the approval policy is pinned to `'never'` regardless of the
* parent's own policy.
* @param parent - the delegating parent agent.
* @returns the sandbox override (or `undefined` without one) and the approval pin.
*/
function captureDelegatedPolicyOverrides(parent) {
	return {
		sandboxMode: parent.ctx.get("sandboxPolicy")?.overrideOf(parent.session),
		approvalPolicy: parent.ctx.get("approval") === void 0 ? void 0 : "never"
	};
}
/**
* Append the captured delegation policy onto the child's own log as
* `source: 'delegation'` events inside the unpublished creation window, so the
* child's effective policy is reconstructable from its log alone. Appends land
* after any fork seed, so fresh policy wins stale seed state; later child
* switches still win over these events.
* @param childSession - the unpublished child's session.
* @param overrides - the policy captured at delegation.
*/
function appendDelegatedPolicyOverrides(childSession, overrides) {
	if (overrides.sandboxMode !== void 0) childSession.append("sandbox/mode", {
		mode: overrides.sandboxMode,
		source: "delegation"
	});
	if (overrides.approvalPolicy !== void 0) childSession.append("approval/policy", {
		policy: overrides.approvalPolicy,
		source: "delegation"
	});
}
//#endregion
//#region lib/types/descriptor-seed.js
/**
* Seeding of a continuable child's durable descriptor event: the model-hidden
* record of the child's declared composition before its first request, so a
* later cold resume can reconstruct it from its own log.
*
* @module @deepseek-ai/dsh-subagent/descriptor-seed
*/
/**
* Build the child's creation seed: any inherited parent-history prefix followed
* by one model-hidden, between-turn `descriptor` event. Staging through a
* `Session` assigns the sequence number and enforces the same lossless-JSON
* rules the durable log does.
* @param childId - the reserved child session id the staged log belongs to.
* @param seed - the inherited completed-turn prefix, or `undefined` for a fresh child.
* @param descriptor - the snapshotted composition record to persist.
* @returns the complete seed events, contiguous from sequence zero.
*/
function seedDescriptorTurn(childId, seed, descriptor) {
	const staged = Session.create(childId, seed);
	staged.append("subagent/descriptor", descriptor);
	return [...staged.events];
}
//#endregion
//#region lib/types/continuation.js
/**
* Internal continuable-subagent manager: stable child ids, descriptor
* persistence, activation admission, the live ownership graph, cold resume,
* child-first disposal, and settlement delivery to the parent, behind
* `ctx.subagents`.
*
* A continuable child has one durable Session and at most one process-local
* {@link Activation} — one residency epoch for a reconstructed child Agent. An
* Activation is not a request, result, cancellation, or Task boundary: it may
* execute many FIFO turns and stays resident while descendants it created are
* still running. The Agent inbox is the only turn queue, so this manager owns
* residency while the Agent loop owns all turn ordering and execution. No
* continuable path creates a Task or an intermediate result-bearing wrapper.
*
* Because residency is this manager's alone to end, telling the parent that a
* child settled is its job too. An external `subagent/end` listener cannot do
* it correctly: that payload names no parent, the child handle is already
* disposed by then, and the release that wakes the parent's own settlement
* watcher has already run. See {@link SubagentContinuationManager.notifySettlement}.
*
* @module @deepseek-ai/dsh-subagent
*/
/**
* Read one Activation's current disposal transaction. This indirection exists
* because TypeScript would otherwise narrow repeated reads of the mutable field
* inside a long-lived closure to constants instead of re-reading runtime state.
* @param activation - the Activation to inspect.
* @returns the in-flight or settled disposal, or `undefined` while resident.
*/
function disposalOf(activation) {
	return activation.disposal;
}
/**
* One line telling a parent that a background child is finished and why, in
* the parent's own task vocabulary.
* @param childId - the durable child the parent knows by id.
* @param stopReason - how the child's last ordinary turn ended.
* @returns the model-facing opening line of the settlement notice.
*/
function settlementSummary(childId, stopReason) {
	const subject = `Background subagent ${childId}`;
	switch (stopReason) {
		case "completed": return `${subject} finished and will do no further work unless you send it more.`;
		case "aborted": return `${subject} was stopped before it finished.`;
		case "max-tokens": return `${subject} ran out of room before it finished.`;
		case "refusal": return `${subject} declined the task.`;
		case "error": return `${subject} failed before it finished.`;
		/* v8 ignore next 4 -- `SubagentResult['stopReason']` is merge-extensible, so this arm
		* needs a backend that adds a variant; an unnameable ending is reported as unfinished
		* rather than silently as success. */
		default: return `${subject} ended abnormally (${String(stopReason)}) before it finished.`;
	}
}
/** Serialize each durable child's delivery, release, and disposal. */
var ChildLock = class {
	tails = /* @__PURE__ */ new Map();
	/**
	* Run `operation` after every previously queued operation for `childId`.
	* @param childId - the durable child whose operations are linearized.
	* @param operation - the critical section to run in order.
	* @returns the operation's own settlement.
	*/
	run(childId, operation) {
		const result = (this.tails.get(childId) ?? Promise.resolve()).then(operation, operation);
		const tail = result.then(() => void 0, () => void 0);
		this.tails.set(childId, tail);
		tail.then(() => {
			if (this.tails.get(childId) === tail) this.tails.delete(childId);
		});
		return result;
	}
};
/**
* The continuable-subagent orchestration service behind `ctx.subagents`. Tool
* schema and host adapters are consumers of this one contract; foreground
* one-shot delegation keeps calling `ctx.subagents.start()` and never enters
* this lifecycle.
*/
var SubagentContinuationManager = class {
	ctx;
	host;
	setupRegistry;
	/** Child session id → its live Activation. Process-local, never durable. */
	activations = /* @__PURE__ */ new Map();
	/** Materializations admitted before drain, tracked through publication or rollback. */
	materializations = /* @__PURE__ */ new Set();
	locks = new ChildLock();
	/** Structural Cordis owner of every Activation handle. */
	ownerCtx;
	/**
	* Exact roots whose host teardown has begun, with the live lineage members
	* observed under each root. Entries remain until that exact root leaves the
	* Agent registry, closing admission throughout its host's teardown without
	* poisoning a later same-id replacement.
	*/
	closingScopes = /* @__PURE__ */ new Map();
	draining = false;
	constructor(ctx, host, setupRegistry) {
		this.ctx = ctx;
		this.host = host;
		this.setupRegistry = setupRegistry;
		const scope = ctx.plugin(function activationOwner() {});
		this.ownerCtx = scope.ctx;
		ctx.on("agent/disposed", ({ agent }) => {
			this.closingScopes.delete(agent);
		});
		ctx.effect(function* () {
			yield scope.dispose;
			yield () => this.drain();
		}.bind(this), "subagents.continuations()");
	}
	/**
	* Start one continuable background child: reserve its durable identity,
	* resolve the provider's detached creation spec, create the child Agent
	* through the private activation-owner scope, establish any continuable-parent
	* ownership, and submit the initial prompt. Resolves when inbox acceptance
	* yields the message id — without waiting for the turn to start or for the
	* message to reach the Session log.
	*
	* Every failure before that acceptance rejects without either id, disposing
	* any created handle and rolling back the Activation and parent ownership.
	* The caller signal owns lookup, materialization, and admission only until
	* acceptance; afterwards the manager owns the Activation independently.
	* @param spec - provider, delegation request, and caller cancellation.
	* @returns the durable child id and the accepted initial prompt's message id.
	*/
	async startContinuable(spec) {
		const request = spec.request;
		const parent = request.parent;
		this.assertAdmitting(parent);
		this.requirePersistence();
		assertSubagentMaxDepth(request.maxDepth);
		const childId = SessionId(randomUUID());
		const childDepth = resolveChildDepth(parent, request.maxDepth);
		const agentProvider = request.agentOptions?.provider ?? parent.options.provider;
		const agentModel = request.agentOptions?.model ?? parent.options.model;
		const descriptor = snapshotSubagentDescriptor({
			mode: "continuable",
			provider: spec.provider,
			label: spec.label,
			...agentProvider !== void 0 ? { agentProvider } : {},
			...agentModel !== void 0 ? { agentModel } : {},
			...request.persona !== void 0 ? { persona: request.persona } : {},
			...request.toolFilter !== void 0 ? { toolFilter: request.toolFilter } : {}
		});
		const delegatedPolicies = captureDelegatedPolicyOverrides(parent);
		const prepared = await this.host.prepareContinuable(spec.provider, {
			sessionId: childId,
			parent,
			signal: spec.signal
		});
		spec.signal.throwIfAborted();
		this.assertAdmitting(parent);
		const lineageSeedLength = prepared.seed?.length ?? 0;
		const seed = seedDescriptorTurn(childId, prepared.seed, descriptor);
		return {
			childId,
			messageId: await this.locks.run(childId, async () => {
				const activation = await this.materialize({
					childId,
					provider: spec.provider,
					parent,
					create: {
						seed,
						meta: childSessionMeta(parent, childDepth, lineageSeedLength),
						delegatedPolicies
					},
					agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth),
					composition: {
						persona: request.persona,
						toolFilter: request.toolFilter
					},
					signal: spec.signal
				});
				return this.submitMaterialized(activation, request.prompt, { kind: "user" }, parent, spec.signal);
			})
		};
	}
	/**
	* Deliver one later message to a known continuable child as its next FIFO
	* turn. Routing depends only on Activation residency: a `running` Activation
	* enqueues, a `waiting` one wakes the same Agent, and an absent one
	* cold-resumes a new Activation from the persisted Session. The Agent inbox
	* is the only queue, so every accepted message has one observable order.
	*
	* The caller signal owns lookup, materialization, and admission only until
	* inbox acceptance; afterwards the accepted turn cannot be cancelled through
	* this service.
	* @param parent - the exact live direct parent authorizing this delivery.
	* @param childId - the durable child session id.
	* @param content - the user-role content to deliver.
	* @param options - the message source fields and caller cancellation.
	* @returns the accepted message's inbox id.
	* @throws when parent authority, availability, or admission rejects the delivery.
	*/
	async followup(parent, childId, content, options) {
		this.assertAdmitting(parent);
		while (true) {
			const live = await this.locks.run(childId, async () => {
				const activation = this.activations.get(childId);
				if (activation === void 0) return this.coldResume(parent, childId, content, options);
				/* v8 ignore next 3 -- the send-versus-dispose cutoff: reaching this arm needs a
				* delivery to observe the transaction inside the same critical section that opened it,
				* which no test can schedule deterministically. The behavior is covered end-to-end by
				* "cold-resumes a delivery that lost the race with final disposal". */
				if (activation.disposal !== void 0) return activation.disposal.then(() => void 0, () => void 0);
				return this.submitAdmitted(activation, content, options.source, parent, options.signal);
			});
			/* v8 ignore start -- only the lost-cutoff arm above returns undefined, so only that
			* race reaches the retry below, which then cold-resumes a new Activation. */
			if (live !== void 0) return live;
			this.assertAdmitting(parent);
			options.signal.throwIfAborted();
		}
	}
	/**
	* Interrupt one live continuable child's current turn. Admission is
	* synchronous and the effect is asynchronous: this authorizes the caller,
	* requests `Agent.cancel(cause, { keepInbox: true })` on the target, and
	* returns without waiting for the target to observe the signal or reach
	* quiescence. The Activation, its handle, accepted unclaimed inbox work, and
	* already-published descendants are untouched; work already claimed into the
	* interrupted turn is not requeued. Once the interrupted driver is idle, a
	* waking send resumes the parked queue.
	*
	* An absent target is an accepted no-op, which uniformly covers natural
	* completion races, repeated requests, one-shot ids, and unknown ids without
	* consulting the durable catalog. A target whose disposal transaction is
	* already open is likewise an accepted no-op after authorization.
	* @param targetSessionId - the durable child session id to interrupt.
	* @param authority - the human parent address or exact live ancestor Agent.
	* @throws {SubagentError} `UNAUTHORIZED` when the presented authority does
	*   not own the live target: a stale or self-targeting ancestor caller, a
	*   parent address that is not the live target's durable direct parent, or
	*   an ancestor outside the target's recorded live lineage.
	*/
	interrupt(targetSessionId, authority) {
		if (authority.kind === "ancestor") {
			const caller = authority.agent;
			if (this.ctx.agents.get(caller.id) !== caller) throw new SubagentError(`interrupting "${targetSessionId}" requires the exact live ancestor agent`, "UNAUTHORIZED");
			if (caller.id === targetSessionId) throw new SubagentError(`agent "${caller.id}" cannot interrupt itself`, "UNAUTHORIZED");
		}
		const activation = this.activations.get(targetSessionId);
		if (activation === void 0) return;
		if (authority.kind === "user") {
			if (activation.handle.agent.session.header.parentSession !== authority.parentSessionId) throw new SubagentError(`subagent "${targetSessionId}" belongs to another parent session`, "UNAUTHORIZED");
		} else if (!activation.ancestry.has(authority.agent)) throw new SubagentError(`subagent "${targetSessionId}" is not a live descendant of agent "${authority.agent.id}"`, "UNAUTHORIZED");
		if (activation.disposal !== void 0) return;
		activation.handle.agent.cancel(authority.kind === "user" ? { kind: "user" } : { kind: "parent" }, { keepInbox: true });
	}
	/**
	* Deliver explicitly selected content from one resident continuable child to
	* its durable direct parent. Sender authorization, parent resolution, and
	* send acceptance share one no-await span. Reporting neither concludes the
	* child's turn nor changes its Activation lifetime.
	* @param child - exact live reporting child; this is the authority credential.
	* @param content - selected model-facing content.
	* @param options - scheduling policy and pre-acceptance cancellation.
	* @returns the stable identity of the message accepted by the parent.
	* @throws {SubagentError} when the sender is unauthorized, the parent is not
	*   live, or continuation admission is closing.
	*/
	async reportFrom(child, content, options) {
		options.signal.throwIfAborted();
		this.assertAdmitting(child);
		const activation = this.authorizeReporter(child);
		const parent = this.resolveReportParent(child);
		return this.deliverReport(activation, parent, content, options.delivery);
	}
	/** Authorize only the exact Agent of one resident Activation. */
	authorizeReporter(child) {
		const activation = this.activations.get(child.id);
		if (activation === void 0 || activation.handle.agent !== child) throw new SubagentError(`agent "${child.id}" is not a live continuable subagent and cannot report`, "UNAUTHORIZED");
		/* v8 ignore next 6 -- only a synchronous re-entrant disposer can open this
		* transaction between exact-agent authorization and this no-await cutoff. */
		if (activation.disposal !== void 0) throw new SubagentError(`subagent "${child.id}" activation is being disposed; the report was not delivered`, "ACTIVATION_CLOSING");
		return activation;
	}
	/** Resolve the reporting child's live direct parent from durable lineage. */
	resolveReportParent(child) {
		const parentId = child.session.header.parentSession;
		/* v8 ignore next -- every continuation-managed child has direct-parent metadata. */
		const parent = parentId === void 0 ? void 0 : this.ctx.agents.get(parentId);
		if (parent === void 0) throw new SubagentError("direct parent is not live; report was not delivered", "PARENT_UNAVAILABLE");
		return parent;
	}
	/** Deliver one framed report through the selected parent scheduling preset. */
	deliverReport(activation, parent, content, delivery) {
		const message = createUserMessage({
			content: [{
				type: "text",
				text: `Background subagent ${activation.childId} reported:`
			}, ...content],
			source: {
				kind: "subagent-report",
				form: "relay",
				senderSessionId: activation.childId
			}
		});
		if (delivery === "wakeup") this.sendWaking(parent, message, () => {
			this.sendReport(parent, message, delivery);
		});
		else this.sendReport(parent, message, delivery);
		return message.id;
	}
	/**
	* Perform one waking send to a parent, accounted against that parent's own
	* Activation when it has one. Registering the id before the send is what
	* keeps a continuation-managed parent from being judged quiescent in the
	* window between `followup()` and the microtask that admits it.
	* @param parent - the exact live parent receiving the waking message.
	* @param message - the message whose id is accounted.
	* @param send - the synchronous waking send to perform.
	*/
	sendWaking(parent, message, send) {
		const parentActivation = this.activations.get(parent.id);
		if (parentActivation !== void 0 && parentActivation.handle.agent === parent) this.admitWaking(parentActivation, message.id, send);
		else send();
	}
	/** Send one report while translating only the parent's own rejection. */
	sendReport(parent, message, delivery) {
		try {
			if (delivery === "wakeup") parent.followup(message);
			else parent.inject(message);
		} catch (error) {
			throw new SubagentError("direct parent is not live; report was not delivered", "PARENT_UNAVAILABLE", { cause: error });
		}
	}
	/**
	* Close admission, await every already-admitted materialization through
	* publication or rollback, then dispose the stable live Activation forest
	* child-first. Sibling branches drain independently: one failure is recorded
	* but never prevents the remaining handles from being attempted, and the
	* aggregate rejects only after every branch settles.
	* @returns once materialization is quiescent and every live Activation released its handle.
	* @throws an aggregate error when any branch failed to release.
	*/
	async drain() {
		this.draining = true;
		await Promise.all([...this.materializations].map((materialization) => materialization.settled));
		const owned = /* @__PURE__ */ new Set();
		for (const activation of this.activations.values()) for (const child of activation.ownedChildren) owned.add(child);
		const roots = [...this.activations.values()].filter((activation) => !owned.has(activation.childId));
		await this.disposeRoots(roots, "activation(s)");
	}
	/**
	* Stop only the continuable descendants of exact live host-owned parents.
	* Admission stays closed for those parent trees until each exact parent
	* leaves the Agent registry; unrelated trees and manager-wide admission stay
	* live.
	* @param parents - exact live roots whose continuable descendants must stop.
	* @returns once every retained descendant Activation released its handle.
	* @throws an aggregate error after all scoped branches settle when any failed.
	*/
	async drainDescendants(parents) {
		const roots = new Set(parents.filter((parent) => this.ctx.agents.get(parent.id) === parent));
		if (roots.size === 0) return;
		for (const root of roots) this.closingMembers(root).add(root);
		const targets = [];
		for (const activation of this.activations.values()) {
			const lineage = this.liveLineage(activation.handle.agent);
			const owners = [...roots].filter((root) => activation.handle.agent !== root && activation.ancestry.has(root));
			if (owners.length === 0) continue;
			targets.push(activation);
			for (const owner of owners) {
				const members = this.closingMembers(owner);
				members.add(activation.handle.agent);
				for (const agent of lineage) members.add(agent);
			}
		}
		const materializations = [...this.materializations].filter((materialization) => {
			const owners = [...roots].filter((root) => materialization.lineage.includes(root));
			for (const owner of owners) {
				const members = this.closingMembers(owner);
				for (const agent of materialization.lineage) members.add(agent);
			}
			return owners.length > 0;
		});
		const ownedTargets = /* @__PURE__ */ new Set();
		for (const activation of targets) for (const child of activation.ownedChildren) ownedTargets.add(child);
		const targetRoots = targets.filter((activation) => !ownedTargets.has(activation.childId));
		for (const activation of targets) this.dispose(activation).catch(() => void 0);
		await Promise.all(materializations.map((materialization) => materialization.settled));
		await this.disposeRoots(targetRoots, "scoped activation(s)");
	}
	/** Dispose independent roots and report every branch failure after all settle. */
	async disposeRoots(roots, failureSubject) {
		const reasons = (await Promise.all(roots.map(async (activation) => {
			try {
				await this.dispose(activation);
				return;
			} catch (error) {
				return error;
			}
		}))).filter((failure) => failure !== void 0);
		if (reasons.length > 0) throw new SubagentError(`continuable subagent teardown failed for ${reasons.length} ${failureSubject}: ` + reasons.map((reason) => errorChain(reason)).join("; "), "ACTIVATION_TEARDOWN_FAILED");
	}
	/** Return the retained member set for one exact scoped-teardown root. */
	closingMembers(root) {
		const existing = this.closingScopes.get(root);
		if (existing !== void 0) return existing;
		const members = /* @__PURE__ */ new Set();
		this.closingScopes.set(root, members);
		return members;
	}
	/**
	* Return the exact currently resolvable ancestry from `agent` upward. The
	* first element is always the supplied identity, even when it is already
	* stale; each ancestor after it must be the registry's current exact entry.
	*/
	liveLineage(agent) {
		const lineage = [agent];
		const seen = new Set([agent.id]);
		let parentSession = agent.session.header.parentSession;
		while (parentSession !== void 0) {
			const parent = this.ctx.agents.get(parentSession);
			if (parent === void 0 || seen.has(parent.id)) break;
			lineage.push(parent);
			seen.add(parent.id);
			parentSession = parent.session.header.parentSession;
		}
		return lineage;
	}
	/**
	* The teardown that closed continuable admission for this agent's lineage.
	* `'manager'` is the whole manager draining; an Agent is the exact scoped root
	* whose forest is closing.
	* @param agent - the agent whose lineage is tested.
	* @returns the closing teardown, or `undefined` while admission is open.
	*/
	closingTeardownFor(agent) {
		if (this.draining) return "manager";
		const lineage = this.liveLineage(agent);
		for (const [root, members] of this.closingScopes) if (members.has(agent) || lineage.includes(root)) return root;
	}
	/** Reject new admission once the manager or this exact parent tree began draining. */
	assertAdmitting(agent) {
		const closing = this.closingTeardownFor(agent);
		if (closing === void 0) return;
		throw new SubagentError(closing === "manager" ? "continuable subagents are draining; the operation was not admitted" : `continuable subagents below parent "${closing.id}" are draining; the operation was not admitted`, "DRAINING");
	}
	/**
	* Derive residency from Agent quiescence and the owned-child set. `running`
	* covers an active admission, an open turn, or accepted waking inbox work.
	*
	* `Agent.status` alone is insufficient: it stays `idle` between an accepted
	* waking send and the microtask that admits it, so a synchronous inbox
	* observer would see `settled` while a turn is already queued. `accepted`
	* holds the ids this manager admitted but has not yet seen drained.
	*/
	stateOf(activation) {
		if (activation.handle.agent.status === "running" || activation.accepted.size > 0) return "running";
		if (activation.ownedChildren.size > 0) return "waiting";
		return "settled";
	}
	/**
	* Cold-resume a persisted child: inspect and authorize its Session, fold the
	* generic descriptor, create the Activation through `ctx.agents.resume()`,
	* and submit the waiting turn. This never dispatches through a subagent
	* provider — the persisted Session already holds the initial prefix and the
	* descriptor is the whole reconstruction input.
	*/
	async coldResume(parent, childId, content, options) {
		const persistence = this.requirePersistence();
		let loaded;
		try {
			loaded = await persistence.inspect(childId, options.signal);
		} catch (error) {
			options.signal.throwIfAborted();
			throw new SubagentError(`subagent "${childId}" is unavailable`, "NOT_RESUMABLE", { cause: error });
		}
		options.signal.throwIfAborted();
		this.assertAdmitting(parent);
		this.authorizeLineage(parent, childId, loaded.meta.parentSession);
		const descriptor = foldSubagentDescriptor(loaded.events.slice(loaded.meta.seedLength ?? 0));
		if (descriptor === void 0 || descriptor.mode !== "continuable") throw new SubagentError(`subagent "${childId}" has no supported continuation state and cannot be resumed; do not retry send_message with this id`, "NOT_RESUMABLE");
		let activation;
		try {
			activation = await this.materialize({
				childId,
				provider: descriptor.provider,
				parent,
				agentOptions: {
					...descriptor.agentProvider !== void 0 ? { provider: descriptor.agentProvider } : {},
					...descriptor.agentModel !== void 0 ? { model: descriptor.agentModel } : {}
				},
				composition: {
					persona: descriptor.persona,
					toolFilter: descriptor.toolFilter
				},
				signal: options.signal
			});
		} catch (error) {
			options.signal.throwIfAborted();
			if (error instanceof SubagentError) throw error;
			throw new SubagentError(`subagent "${childId}" is unavailable`, "NOT_RESUMABLE", { cause: error });
		}
		return this.submitMaterialized(activation, content, options.source, parent, options.signal);
	}
	/**
	* Submit to a freshly materialized Activation or roll it back completely.
	* @param activation - the just-published Activation to admit or release.
	* @param content - the initial or resumed message content.
	* @param source - durable fields naming who supplied the accepted message.
	* @param parent - the live direct parent authorizing admission.
	* @param signal - caller cancellation owning admission until acceptance.
	* @returns the accepted inbox message id.
	*/
	async submitMaterialized(activation, content, source, parent, signal) {
		try {
			return this.submitAdmitted(activation, content, source, parent, signal);
		} catch (error) {
			/* v8 ignore next -- rollback disposal failures must not mask the
			* pre-acceptance signal, drain, or lifecycle failure. */
			await this.dispose(activation).catch(() => void 0);
			throw error;
		}
	}
	/**
	* Create or resume the child Agent through the private activation-owner
	* scope, install the handle in a fresh Activation, and register ownership on
	* a continuation-managed parent. Rejection leaves no Activation, no handle,
	* and no ownership membership.
	*/
	materialize(inputs) {
		this.assertAdmitting(inputs.parent);
		const settled = Promise.withResolvers();
		const lineage = this.liveLineage(inputs.parent);
		const materialization = {
			lineage,
			settled: settled.promise
		};
		this.materializations.add(materialization);
		return this.materializeTracked(inputs, lineage).finally(() => {
			this.materializations.delete(materialization);
			settled.resolve();
		});
	}
	/**
	* Perform one tracked materialization. The caller keeps the drain barrier
	* registered until this either returns a resident Activation or finishes
	* rollback.
	*/
	async materializeTracked(inputs, parentLineage) {
		const { childId, provider, parent, create } = inputs;
		inputs.signal.throwIfAborted();
		const setup = (childCtx) => {
			if (create !== void 0) appendDelegatedPolicyOverrides(childCtx.agent.session, create.delegatedPolicies);
			applyChildComposition(childCtx, parent, inputs.composition);
			return this.setupRegistry.apply(childCtx);
		};
		const observer = this.host.observeActivation(provider, childId, parent);
		const handle = create === void 0 ? await this.ownerCtx.agents.resume({
			resumeSessionId: childId,
			agentOptions: inputs.agentOptions,
			signal: inputs.signal,
			setup
		}) : await this.ownerCtx.agents.create({
			sessionId: childId,
			meta: create.meta,
			seed: create.seed,
			agentOptions: inputs.agentOptions,
			signal: inputs.signal,
			setup
		});
		const activation = {
			childId,
			parentSession: parent.id,
			provider,
			handle,
			ancestry: new WeakSet([handle.agent, ...parentLineage]),
			ownedChildren: /* @__PURE__ */ new Set(),
			observer,
			disposal: void 0,
			accepted: /* @__PURE__ */ new Set(),
			announced: false,
			poke: Promise.withResolvers()
		};
		this.activations.set(childId, activation);
		try {
			inputs.signal.throwIfAborted();
			this.assertAdmitting(parent);
			this.acquireOwnership(parent, childId);
			handle.agent.ctx.on("agent/inbox/claimed", ({ message }) => {
				/* v8 ignore next -- a claim of an id this manager never admitted needs
				* another sender on the same child, which no current path allows. */
				if (activation.accepted.delete(message.id)) this.wake(activation);
			});
			handle.agent.ctx.on("agent/inbox/discarded", ({ message }) => {
				if (activation.accepted.delete(message.id)) this.wake(activation);
			});
			observer.start(handle.agent);
		} catch (error) {
			/* v8 ignore next -- rollback failure must not mask the admission failure
			* that prevented this operation from returning an accepted message id. */
			await this.rollbackUnpublished(activation).catch(() => void 0);
			throw error;
		}
		this.watchSettlement(activation);
		return activation;
	}
	/**
	* Release an Activation whose start edge was not published. The memoized
	* transaction remains in the live map until handle disposal settles, so a
	* concurrent drain or delivery observes the same closing boundary.
	*/
	rollbackUnpublished(activation) {
		return activation.disposal ??= (async () => {
			try {
				await activation.handle.dispose();
			} finally {
				this.activations.delete(activation.childId);
				this.releaseOwnership(activation.childId);
			}
		})();
	}
	/**
	* Register the child in a continuation-managed parent's owned set before the
	* child can run, so that parent cannot settle while the child is live. A
	* top-level or other non-continuation Agent has no Activation and stays
	* outside the waiting graph.
	*/
	acquireOwnership(parent, childId) {
		const parentActivation = this.activations.get(parent.id);
		if (parentActivation === void 0) return;
		if (parentActivation.disposal !== void 0) throw new SubagentError(`subagent parent "${parent.id}" is being disposed; the child was not established`, "ACTIVATION_CLOSING");
		parentActivation.ownedChildren.add(childId);
	}
	/** Remove one child from its live owner's set and let that owner re-check settlement. */
	releaseOwnership(childId) {
		for (const candidate of this.activations.values()) if (candidate.ownedChildren.delete(childId)) this.wake(candidate);
	}
	/** Let a settlement watcher re-observe quiescence after ownership or inbox changes. */
	wake(activation) {
		activation.poke.resolve();
		activation.poke = Promise.withResolvers();
	}
	/**
	* Submit one message as the child's next FIFO turn and return its accepted
	* inbox id. Acceptance is the operation's success boundary; the manager owns
	* the Activation independently afterwards.
	*/
	submit(activation, content, source, parent) {
		this.acquireOwnership(parent, activation.childId);
		const message = createUserMessage({
			content,
			source
		});
		const accepted = this.admitWaking(activation, message.id, () => {
			activation.handle.agent.followup(message);
		});
		activation.announced = true;
		return accepted;
	}
	/**
	* Account one waking send across a resident Activation's settlement window.
	* @param activation - Activation receiving waking inbox work.
	* @param messageId - stable identity of the message about to be sent.
	* @param send - synchronous send that publishes one enqueue occurrence.
	* @returns the accepted message id.
	*/
	admitWaking(activation, messageId, send) {
		activation.accepted.add(messageId);
		try {
			send();
		} catch (error) {
			activation.accepted.delete(messageId);
			throw error;
		}
		this.wake(activation);
		return messageId;
	}
	/**
	* Cross the final admission cutoff and submit without yielding. Signal abort,
	* manager drain, or Activation disposal that wins before this synchronous
	* span rejects without inbox acceptance.
	*/
	submitAdmitted(activation, content, source, parent, signal) {
		signal.throwIfAborted();
		this.assertAdmitting(parent);
		/* v8 ignore next 6 -- only a synchronous re-entrant disposer can change
		* this field between the caller's live check and this no-await boundary. */
		if (disposalOf(activation) !== void 0) throw new SubagentError(`subagent "${activation.childId}" activation is being disposed; the message was not accepted`, "ACTIVATION_CLOSING");
		this.authorizeLineage(parent, activation.childId, activation.handle.agent.session.header.parentSession);
		return this.submit(activation, content, source, parent);
	}
	/**
	* Authorize one operation against the durable direct-parent lineage. Other
	* agents, ancestors, teams, workflows, and hosts remain rejected until an
	* explicit authority protocol has a production consumer.
	*/
	authorizeLineage(parent, childId, parentSession) {
		if (this.ctx.agents.get(parent.id) !== parent) throw new SubagentError(`subagent "${childId}" delivery requires the exact live parent agent`, "UNAUTHORIZED");
		if (parentSession !== parent.id) throw new SubagentError(`subagent "${childId}" belongs to another parent session`, "UNAUTHORIZED");
	}
	/**
	* Follow one Activation to settlement: wait for Agent quiescence, then for
	* every owned child to complete disposal, and dispose the handle once both
	* hold. A `next-turn` delivered while `waiting` wakes the same Agent and
	* returns it to `running`, so this re-observes rather than settling early.
	*/
	watchSettlement(activation) {
		(async () => {
			while (disposalOf(activation) === void 0) {
				const poked = activation.poke.promise;
				await Promise.race([activation.handle.agent.whenIdle(), poked]);
				if (disposalOf(activation) !== void 0) return;
				const settling = await this.locks.run(activation.childId, () => {
					if (disposalOf(activation) !== void 0 || this.stateOf(activation) !== "settled") return Promise.resolve({ settling: false });
					return Promise.resolve({
						settling: true,
						done: this.dispose(activation)
					});
				});
				if (!settling.settling) {
					if (activation.handle.agent.status !== "running") await poked;
					continue;
				}
				try {
					await settling.done;
				} catch (error) {
					this.ctx.logger.warn(`subagent "${activation.childId}" activation teardown failed: ${errorChain(error)}`);
				}
				return;
			}
		})();
	}
	/**
	* Stop one Activation immediately, then release it child-first. The memoized
	* transaction is installed before cancellation or recursive callbacks, so
	* admission and reentrant teardown converge on the same owner.
	*
	* The final session flush is best effort and never prevents handle disposal
	* or ownership release, because retaining a child would permanently pin its
	* ancestors in `waiting`.
	* @param activation - the residency epoch to stop and release.
	* @returns the one disposal transaction owned by this Activation.
	*/
	dispose(activation) {
		const existing = activation.disposal;
		if (existing !== void 0) return existing;
		const completion = Promise.withResolvers();
		activation.disposal = completion.promise;
		this.finishDisposal(activation).then(completion.resolve, completion.reject);
		return completion.promise;
	}
	/**
	* Propagate stop synchronously, then finish the child-first release.
	* @param activation - the Activation whose disposal transaction is installed.
	* @returns once the handle and ownership edge are released.
	*/
	async finishDisposal(activation) {
		this.wake(activation);
		const { childId } = activation;
		activation.handle.agent.cancel({ kind: "parent" });
		const idle = activation.handle.agent.whenIdle();
		const childDisposals = [...activation.ownedChildren].map((child) => this.activations.get(child)).filter((child) => child !== void 0).map((child) => this.dispose(child));
		const failures = [];
		try {
			const reasons = (await Promise.all(childDisposals.map(async (disposal) => {
				try {
					await disposal;
					return;
				} catch (error) {
					return error;
				}
			}))).filter((reason) => reason !== void 0);
			if (reasons.length > 0) failures.push(new SubagentError(`subagent "${childId}" child teardown failed: ${reasons.map((reason) => errorChain(reason)).join("; ")}`, "ACTIVATION_TEARDOWN_FAILED"));
			await idle;
			await this.flushFinalState(activation);
			activation.observer.capture(activation.handle.agent);
		} catch (error) {
			failures.push(new SubagentError(`subagent "${childId}" activation teardown failed: ${errorChain(error)}`, "ACTIVATION_TEARDOWN_FAILED", { cause: error }));
		}
		try {
			await activation.handle.dispose();
		} catch (error) {
			failures.push(new SubagentError(`subagent "${childId}" activation handle disposal failed: ${errorChain(error)}`, "ACTIVATION_TEARDOWN_FAILED", { cause: error }));
		}
		let failure;
		if (failures.length === 1) failure = failures[0];
		else if (failures.length > 1) failure = new SubagentError(`subagent "${childId}" activation teardown failed at ${failures.length} boundaries: ` + failures.map((item) => errorChain(item)).join("; "), "ACTIVATION_TEARDOWN_FAILED", { cause: new AggregateError(failures) });
		this.activations.delete(childId);
		this.notifySettlement(activation, activation.observer.terminal(failure));
		this.releaseOwnership(childId);
		activation.observer.settle(failure);
		if (failure !== void 0) throw failure;
	}
	/**
	* Tell the durable direct parent that this child produced everything it is
	* going to. Unconditional for every child the caller received an id for: it
	* does not consider whether the child reported, because the cases that most
	* need it — a token ceiling, a model failure, cancellation, teardown — are
	* exactly the ones where the child never got to choose. A materialization
	* rolled back before its first acceptance stays silent, since the caller was
	* told that child was not established. A parent that is no longer live is not
	* an error; the child's own Session remains the durable record either way.
	* A parent whose own lineage is already closing receives the notice without a
	* wake, because teardown is not a reason to start a turn.
	*
	* Never blocks disposal. A delivery failure is logged and dropped, because
	* retaining a child to retry a notice would pin its whole ancestry in
	* `waiting` forever.
	* @param activation - the settling Activation, still owned by its parent.
	* @param terminal - how this epoch ended, as the terminal edge will report it.
	*/
	notifySettlement(activation, terminal) {
		if (!activation.announced) return;
		try {
			const parent = this.ctx.agents.get(activation.parentSession);
			if (parent === void 0) return;
			const summary = settlementSummary(activation.childId, terminal.stopReason);
			const message = createUserMessage({
				content: [{
					type: "text",
					text: summary
				}, ...terminal.output === void 0 ? [{
					type: "text",
					text: "It left no closing message."
				}] : [{
					type: "text",
					text: "Its closing message:"
				}, ...terminal.output]],
				source: {
					kind: "subagent-settled",
					form: "notice",
					summary: boundContextSummary(summary),
					senderSessionId: activation.childId
				}
			});
			if (this.closingTeardownFor(parent) !== void 0) {
				parent.inject(message);
				return;
			}
			this.sendWaking(parent, message, () => {
				if (parent.status === "idle") parent.followup(message);
				else parent.steer(message);
			});
		} catch (error) {
			this.ctx.logger.warn(`subagent "${activation.childId}" settlement notice was not delivered to its parent: ` + errorChain(error));
		}
	}
	/**
	* Request a best-effort final session flush after the child is quiescent.
	* Listener failure is logged because flush participation cannot identify a
	* particular persistence backend, and teardown must still release ownership.
	* @param activation - the Activation whose final events should be flushed.
	*/
	async flushFinalState(activation) {
		const child = activation.handle.agent;
		try {
			await child.ctx.sessions.flush(child.session);
		} catch (error) {
			this.ctx.logger.warn(`subagent "${activation.childId}" best-effort final session flush failed; the persisted state may be unavailable or stale on resume: ${errorChain(error)}`);
		}
	}
	/** Resolve the persistence service continuable children require, or fail loud. */
	requirePersistence() {
		const persistence = this.ctx.get("sessionPersistence");
		if (persistence === void 0) throw new SubagentError("continuable subagents require session persistence (load a dsh-session-persistence backend)", "PERSISTENCE_UNAVAILABLE");
		return persistence;
	}
};
//#endregion
//#region lib/types/activation-setup-registry.js
/**
* Internal registry of deployment capabilities composed into every continuable
* child's unpublished creation context.
*
* A contribution grants a child-scoped capability without teaching the
* continuation manager which capabilities exist. The manager owns residency;
* this registry owns the join between plugin lifetime, unpublished setup, and
* Activation disposal, so no installation outlives either owner and no removed
* contribution can be installed after revocation reports completion.
*
* @module @deepseek-ai/dsh-subagent/activation-setup-registry
*/
/** Re-read mutable removal state after a contribution may have revoked itself. */
function isRemoved(registration) {
	return registration.removed;
}
/**
* Owns continuable-child setup registrations, installations, rollback, child
* cleanup, and immediate live revocation.
*/
var SubagentActivationSetupRegistry = class {
	/** Live contributions in installation order. */
	registrations = /* @__PURE__ */ new Set();
	/** Child context to its live installations. */
	byChild = /* @__PURE__ */ new Map();
	/**
	* Register one contribution.
	* @param contribution - synchronous child-scope installer.
	* @returns an idempotent registration undo.
	* @throws after attempting every installation when any disposer fails.
	*/
	register(contribution) {
		const registration = {
			contribution,
			removed: false,
			installations: /* @__PURE__ */ new Set()
		};
		this.registrations.add(registration);
		return () => {
			if (registration.removed) return;
			registration.removed = true;
			this.registrations.delete(registration);
			this.releaseAll([...registration.installations], "contribution removal");
		};
	}
	/**
	* Install every live contribution into one unpublished child context.
	* @param childCtx - the child's unpublished scoped context.
	* @returns the provisioning commit consumed at Agent publication.
	*/
	apply(childCtx) {
		const state = {
			installations: [],
			invalidated: false
		};
		try {
			for (const registration of [...this.registrations]) {
				/* v8 ignore next -- only a synchronous re-entrant revocation of an
				* already-snapshotted registration reaches this guard. */
				if (registration.removed) continue;
				const installation = {
					registration,
					childCtx,
					dispose: registration.contribution(childCtx),
					released: false,
					transaction: state
				};
				registration.installations.add(installation);
				state.installations.push(installation);
				let indexed = this.byChild.get(childCtx);
				if (indexed === void 0) {
					indexed = /* @__PURE__ */ new Set();
					this.byChild.set(childCtx, indexed);
				}
				indexed.add(installation);
				if (isRemoved(registration)) this.release(installation);
			}
		} catch (error) {
			try {
				this.releaseAll([...state.installations], "setup rollback");
			} catch (releaseFailure) {}
			throw error;
		}
		childCtx.effect(() => () => {
			this.releaseChild(childCtx);
		}, "subagents.activationSetup()");
		return { commit: () => {
			if (state.invalidated) throw new SubagentError("a continuable-subagent setup contribution was revoked while this child was being built; the child was not established", "ACTIVATION_SETUP_REVOKED");
			for (const installation of state.installations) installation.transaction = void 0;
		} };
	}
	/** Release every remaining installation owned by one disposed child scope. */
	releaseChild(childCtx) {
		const indexed = this.byChild.get(childCtx) ?? [];
		this.releaseAll([...indexed], "child scope disposal");
	}
	/**
	* Release a batch completely before reporting disposer failures.
	* @param installations - records to release.
	* @param during - operation name for diagnostics.
	*/
	releaseAll(installations, during) {
		const failures = [];
		for (const installation of installations) try {
			this.release(installation);
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 0) return;
		throw new SubagentError(`continuable-subagent setup ${during} failed to release ${failures.length} installation(s): ` + failures.map((failure) => errorChain(failure)).join("; "), "ACTIVATION_SETUP_RELEASE_FAILED");
	}
	/** Drop one installation from both indices and dispose it exactly once. */
	release(installation) {
		if (installation.released) return;
		installation.released = true;
		installation.registration.installations.delete(installation);
		const indexed = this.byChild.get(installation.childCtx);
		/* v8 ignore next 4 -- every live installation is indexed until this method removes it. */
		if (indexed !== void 0) {
			indexed.delete(installation);
			if (indexed.size === 0) this.byChild.delete(installation.childCtx);
		}
		if (installation.transaction !== void 0) installation.transaction.invalidated = true;
		installation.dispose();
	}
};
//#endregion
//#region lib/types/list-children.js
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
/**
* Concurrent cold inspections per listing; a constant because it bounds one
* read-only scan of local media, not deployment behavior. Should a networked
* persistence backend appear, promote it to a validated `Config` field.
*/
const COLD_READ_CONCURRENCY = 4;
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
async function listChildren(ctx, parentSessionId, signal) {
	const listing = await prepareListing(ctx, signal);
	return (await resolveCandidateRows([...listing.corpus.values()].filter((record) => record.header.parentSession === parentSessionId && record.header.origin === "subagent").sort(compareCorpusRecords), listing, signal)).filter((row) => row !== void 0);
}
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
async function listDescendants(ctx, rootSessionId, signal) {
	const listing = await prepareListing(ctx, signal);
	const positioned = descendantCandidates(listing.corpus, rootSessionId);
	const rows = await resolveCandidateRows(positioned.map((candidate) => candidate.record), listing, signal);
	const entries = [];
	positioned.forEach((position, index) => {
		const row = rows[index];
		if (row !== void 0) entries.push({
			...row,
			parentId: position.parentId,
			depth: position.depth
		});
	});
	return entries;
}
/** Resolve listing services once and build one live-preferred session corpus. */
async function prepareListing(ctx, signal) {
	const projections = ctx.get("sessionProjections");
	if (projections === void 0) throw new SubagentError("listing subagents requires the sessionProjections registry (load @deepseek-ai/dsh-session-projection)", "SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE");
	const sessions = ctx.get("sessions");
	if (sessions === void 0) throw new SubagentError("listing subagents requires the session store (load @deepseek-ai/dsh-session)", "SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE");
	assertListingNotCancelled(signal);
	const persistence = ctx.get("sessionPersistence");
	const cache = ctx.get("sessionProjectionCache");
	let persistedHeaders = [];
	if (persistence !== void 0) {
		try {
			persistedHeaders = await persistence.list(signal);
		} catch (error) {
			assertListingNotCancelled(signal);
			throw error;
		}
		assertListingNotCancelled(signal);
	}
	const corpus = /* @__PURE__ */ new Map();
	for (const header of persistedHeaders) corpus.set(header.id, {
		header,
		live: void 0
	});
	for (const session of sessions.list()) corpus.set(session.header.id, {
		header: session.header,
		live: session
	});
	const subagentParents = /* @__PURE__ */ new Set();
	for (const record of corpus.values()) if (record.header.origin === "subagent" && record.header.parentSession !== void 0) subagentParents.add(record.header.parentSession);
	return {
		projections,
		persistence,
		cache,
		corpus,
		subagentParents
	};
}
/** Resolve projection-backed rows for aligned candidates with bounded cold reads. */
async function resolveCandidateRows(candidates, listing, signal) {
	const { projections, persistence, cache, subagentParents } = listing;
	const rows = Array.from({ length: candidates.length });
	const coldReads = [];
	candidates.forEach((candidate, index) => {
		const childId = candidate.header.id;
		if (candidate.live === void 0) {
			coldReads.push({
				index,
				header: candidate.header
			});
			return;
		}
		let identity;
		try {
			identity = projections.snapshot(candidate.live).values.subagent;
		} catch {
			rows[index] = {
				kind: "diagnostic",
				id: childId,
				reason: "corrupt"
			};
			return;
		}
		if (identity === void 0 || identity === null) return;
		rows[index] = childRow(childId, identity, "running", subagentParents.has(childId));
	});
	if (persistence !== void 0 && coldReads.length > 0) {
		const queue = [...coldReads];
		await Promise.all(Array.from({ length: Math.min(COLD_READ_CONCURRENCY, queue.length) }, async () => {
			for (let job = queue.shift(); job !== void 0; job = queue.shift()) rows[job.index] = await resolveColdIdentity(persistence, projections, cache, job.header, subagentParents.has(job.header.id), signal);
		}));
	}
	assertListingNotCancelled(signal);
	return rows;
}
/** Build origin-classified candidates from the complete tree without recursion. */
function descendantCandidates(corpus, rootSessionId) {
	const children = /* @__PURE__ */ new Map();
	for (const record of corpus.values()) {
		const parentId = record.header.parentSession;
		if (parentId === void 0) continue;
		const siblings = children.get(parentId);
		if (siblings === void 0) children.set(parentId, [record]);
		else siblings.push(record);
	}
	for (const siblings of children.values()) siblings.sort(compareCorpusRecords);
	const positioned = [];
	const stack = (children.get(rootSessionId) ?? []).map((record) => ({
		record,
		parentId: rootSessionId,
		depth: 1
	})).reverse();
	const visited = new Set([rootSessionId]);
	while (stack.length > 0) {
		const position = stack.pop();
		const id = position.record.header.id;
		if (visited.has(id)) continue;
		visited.add(id);
		if (position.record.header.origin === "subagent") positioned.push(position);
		const descendants = children.get(id) ?? [];
		for (const record of [...descendants].reverse()) stack.push({
			record,
			parentId: id,
			depth: position.depth + 1
		});
	}
	return positioned;
}
/** Compare siblings by durable creation time, then id. */
function compareCorpusRecords(a, b) {
	return a.header.createdAt - b.header.createdAt || a.header.id.localeCompare(b.header.id);
}
/**
* Resolve one cold candidate down the remaining ladder: a durable
* projection-cache row when it serves an own-suffix identity (the seq gate),
* otherwise one persistence inspection folded through the projection
* registry (the same detached recipe the API proxy uses for detached session
* projections). A failed inspection is one transient `unavailable` row
* retried on the next listing; an inspection naming another lifecycle, and a
* settled log the fold cannot identify — or that makes any registered unit
* throw — are final, so they report `corrupt`.
*/
async function resolveColdIdentity(persistence, projections, cache, header, hasChildren, signal) {
	const childId = header.id;
	if (cache !== void 0) {
		let cached;
		try {
			cached = cache.cachedSnapshot(header)?.values.subagent;
		} catch {
			cached = void 0;
		}
		if (cached !== void 0 && cached !== null && cached.seq >= (header.seedLength ?? 0)) return childRow(childId, cached, "inactive", hasChildren);
	}
	assertListingNotCancelled(signal);
	let inspected;
	try {
		inspected = await persistence.inspect(childId, signal);
	} catch {
		assertListingNotCancelled(signal);
		return {
			kind: "diagnostic",
			id: childId,
			reason: "unavailable"
		};
	}
	assertListingNotCancelled(signal);
	if (!sameLifecycle(inspected.meta, header)) return {
		kind: "diagnostic",
		id: childId,
		reason: "corrupt"
	};
	let identity;
	try {
		identity = projections.restore({}, inspected.events, 0).snapshot.values.subagent;
	} catch {
		return {
			kind: "diagnostic",
			id: childId,
			reason: "corrupt"
		};
	}
	if (identity === void 0 || identity === null) return {
		kind: "diagnostic",
		id: childId,
		reason: "corrupt"
	};
	return childRow(childId, identity, "inactive", hasChildren);
}
/** Materialize one served identity as its child row. */
function childRow(id, identity, activity, hasChildren) {
	return identity.mode === "one-shot" ? {
		kind: "child",
		id,
		mode: "one-shot",
		...identity.label !== void 0 ? { label: identity.label } : {},
		activity,
		hasChildren
	} : {
		kind: "child",
		id,
		mode: "continuable",
		label: identity.label,
		activity,
		hasChildren
	};
}
/** Immutable header fields that distinguish one session lifecycle from another under the same id. */
const LIFECYCLE_WITNESS_KEYS = [
	"version",
	"id",
	"createdAt",
	"cwd",
	"parentSession",
	"seedLength",
	"delegationDepth"
];
/** Whether an inspected log still belongs to the enumerated lifecycle. */
function sameLifecycle(meta, expected) {
	return LIFECYCLE_WITNESS_KEYS.every((key) => meta[key] === expected[key]);
}
/** Stop a listing at its next cancellation checkpoint. */
function assertListingNotCancelled(signal) {
	if (signal?.aborted) throw new SubagentError("subagent listing was cancelled", "CANCELLED");
}
/**
* Fold turn boundaries around the child's own durable descriptor.
*
* A fork seed may contain an ancestor descriptor and completed turns. Every
* descriptor therefore resets the accumulated state; the healthy catalog
* admits only a child with exactly one descriptor in its own suffix, making
* the final reset the child's authoritative timing origin.
*/
const subagentTimingProjectionDefinition = {
	key: "subagentTiming",
	schema: z.object({
		settledMs: z.number().int().nonnegative(),
		active: z.object({
			since: z.number().int().nonnegative(),
			through: z.number().int().nonnegative()
		}).strict().optional()
	}).strict(),
	init: () => ({
		descriptorSeen: false,
		settledMs: 0
	}),
	apply: (state, event) => {
		if (event.type === "turn/start") return state.descriptorSeen ? {
			...state,
			active: {
				since: event.time,
				through: event.time
			}
		} : {
			...state,
			pendingTurnStart: event.time
		};
		if (event.type === "subagent/descriptor") {
			const activeSince = state.active?.since ?? state.pendingTurnStart;
			return {
				descriptorSeen: true,
				settledMs: 0,
				...activeSince === void 0 ? {} : { active: {
					since: activeSince,
					through: event.time
				} }
			};
		}
		if (event.type === "turn/end") {
			if (!state.descriptorSeen) {
				if (state.pendingTurnStart === void 0) return state;
				const { pendingTurnStart: _closed, ...next } = state;
				return next;
			}
			if (state.active === void 0) return state;
			const { active, ...rest } = state;
			return {
				...rest,
				settledMs: state.settledMs + Math.max(0, event.time - active.since)
			};
		}
		if (state.active === void 0) return state;
		return {
			...state,
			active: {
				...state.active,
				through: event.time
			}
		};
	},
	view: (state) => ({
		settledMs: state.settledMs,
		...state.active === void 0 ? {} : { active: state.active }
	}),
	stateVersion: 2
};
const identitySchema = z.discriminatedUnion("mode", [z.object({
	mode: z.literal("one-shot"),
	label: z.string().optional(),
	seq: z.number().int().nonnegative()
}).strict(), z.object({
	mode: z.literal("continuable"),
	label: z.string(),
	seq: z.number().int().nonnegative()
}).strict()]).nullable();
/** Interpret one `subagent/descriptor` event's identity; no value when the payload cannot be trusted. */
function descriptorIdentity(event) {
	let descriptor;
	try {
		descriptor = foldSubagentDescriptor([event]);
	} catch {
		descriptor = void 0;
	}
	if (descriptor === void 0) return void 0;
	return descriptor.mode === "one-shot" ? {
		mode: "one-shot",
		...descriptor.label !== void 0 ? { label: descriptor.label } : {},
		seq: event.seq
	} : {
		mode: "continuable",
		label: descriptor.label,
		seq: event.seq
	};
}
/**
* Fold the durable mode/label identity from `subagent/descriptor` events,
* last-wins: a fork seed may replay an ancestor's descriptor, and the child's
* own descriptor must override it — the same reset discipline as
* {@link subagentTimingProjectionDefinition}. A malformed or unknown-version
* payload resets to the `null` sentinel instead of throwing, so a fork of a
* healthy ancestor never inherits an identity its own descriptor failed to
* establish — and the reset survives every JSON push frame, so a consumer
* holding the earlier identity replaces it instead of keeping it stale;
* `null` ⟺ no valid descriptor, with the causes deliberately undistinguished.
*/
const subagentIdentityProjectionDefinition = {
	key: "subagent",
	schema: identitySchema,
	init: () => ({}),
	apply: (state, event) => {
		if (event.type !== "subagent/descriptor") return state;
		const identity = descriptorIdentity(event);
		return identity === void 0 ? {} : { identity };
	},
	view: (state) => state.identity ?? null,
	stateVersion: 2
};
//#endregion
//#region lib/types/out-of-process.js
/**
* Provider-side vocabulary for OUT-OF-PROCESS subagent backends — the pieces
* that enforce this seam's own contracts around a child in another process:
* the no-capabilities advertisement, timing-bound validation, child
* working-directory resolution (config override, else the delegating parent
* session's workspace), the never-reject result settlement, and the standard
* run-handle publication. Backends compose these with their own wire drivers;
* the process machinery itself (spawn, env scrub, tree-scoped teardown)
* belongs to the `dsh-subprocess` seam.
*
* @module @deepseek-ai/dsh-subagent/out-of-process
*/
/**
* The capability advertisement of an out-of-process backend: NONE. A child in
* another process cannot honor parent-enforced start features
* (`outputSchema`/`maxDepth`/`toolFilter`/`persona`), so the service rejects a
* request needing any of them before `start` runs — never accepted-then-ignored.
*/
const NO_START_CAPABILITIES = Object.freeze({
	outputSchema: false,
	depthLimit: false,
	toolFilter: false,
	persona: false
});
/**
* Assert a configured timing bound is a positive finite number (it bounds a
* teardown or shutdown wait; zero, negative, or NaN would skip or wedge it).
* @param prefix - the consuming plugin's diagnostic prefix (e.g. `subagent-acp`).
* @param name - the config field name, for the diagnostic.
* @param value - the configured value.
*/
function assertPositiveFinite(prefix, name, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${prefix}: ${name} must be a positive finite number`);
}
/**
* Whether `path` names an existing directory the harness can ENTER. The
* search-permission probe matters: `statSync().isDirectory()` is true for a
* mode-600 directory, but a subprocess cwd needs `X_OK` or spawn fails EACCES.
*/
function isEnterableDirectory(path) {
	try {
		if (!statSync(path).isDirectory()) return false;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
/**
* Assert `cwd` can actually host the child: absolute (it doubles as the
* child's workspace identity, and a relative path would be re-anchored to the
* server process's launch directory) and an existing directory (fail here,
* before the process boundary, instead of as an ambiguous spawn ENOENT).
* @param prefix - the consuming plugin's diagnostic prefix.
* @param label - which source supplied the value, for the diagnostic.
* @param cwd - the candidate working directory.
* @returns `cwd`, validated.
*/
function assertUsableCwd(prefix, label, cwd) {
	if (!isAbsolute(cwd)) throw new Error(`${prefix}: ${label} must be an absolute path: ${cwd}`);
	if (!isEnterableDirectory(cwd)) throw new Error(`${prefix}: ${label} is not an accessible directory: ${cwd}`);
	return cwd;
}
/**
* Validate a configured `cwd` override ONCE, at plugin load: reject the empty
* string (`path.resolve('')` is the process cwd — it would silently
* reintroduce the launch-directory fallback this resolution removes),
* interpret a relative path against the harness launch directory, and require
* an enterable directory.
* @param prefix - the consuming plugin's diagnostic prefix.
* @param cwd - the configured override, or `undefined` when the config omits it.
* @returns the validated absolute override, or `undefined` when omitted.
*/
function validateConfiguredCwd(prefix, cwd) {
	if (cwd === void 0) return void 0;
	if (cwd === "") throw new Error(`${prefix}: config cwd must not be empty — omit the key to inherit the parent session cwd`);
	return assertUsableCwd(prefix, "config cwd", resolve(cwd));
}
/**
* Resolve the child's working directory at start: the deployment override
* when configured (already validated at load), else the parent session's
* workspace cwd (validated here, its earliest resolvable point). Fails loud
* when neither exists — falling back to the harness process cwd would
* silently bind the child to the server's launch directory instead of the
* delegating session's workspace (one server process serves many sessions,
* each with its own cwd).
* @param prefix - the consuming plugin's diagnostic prefix.
* @param configured - the load-validated override, or `undefined`.
* @param parentCwd - the delegating parent session's workspace cwd, if any.
* @returns the absolute child working directory.
*/
function resolveChildCwd(prefix, configured, parentCwd) {
	if (configured !== void 0) return configured;
	if (parentCwd === void 0) throw new Error(`${prefix}: no working directory for the child — configure \`cwd\` or delegate from a parent session that has one`);
	return assertUsableCwd(prefix, "parent session cwd", parentCwd);
}
/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value) {
	/* v8 ignore next */
	return value instanceof Error ? value : new Error(String(value));
}
/**
* Settle an out-of-process run result under the seam contract: `result` never
* rejects after publication. A normally completed or rejected attempt resolves
* as `aborted` when cancellation already settled locally; another rejection is
* flattened to `stopReason: 'error'` through the contained diagnostic sink.
* The abort listener is removed on every path.
* @param parts - the attempt, output snapshot, cancellation state, sink, and signal wiring.
* @returns the terminal result (never a rejection).
*/
async function settleRunResult(parts) {
	try {
		const result = await parts.attempt();
		return parts.cancelled() ? {
			output: parts.collectOutput(),
			stopReason: "aborted"
		} : result;
	} catch (error) {
		if (parts.cancelled()) return {
			output: parts.collectOutput(),
			stopReason: "aborted"
		};
		try {
			parts.onError?.(toError(error), "error");
		} catch {}
		return {
			output: parts.collectOutput(),
			stopReason: "error"
		};
	} finally {
		parts.signal.removeEventListener("abort", parts.onAbort);
	}
}
/**
* Publish the seam run handle for an out-of-process child. `dispose()` is
* idempotent (one memoized teardown): it removes the abort listener, settles
* local cancellation — there is no assumption the child cooperates — and then
* awaits the backend's teardown to actual exit.
* @param parts - the run identity, result, cancellation wiring, and teardown.
* @returns the seam run handle (`localAgent` is `undefined` for remote runs).
*/
function subprocessRunHandle(parts) {
	let disposal;
	return {
		id: parts.id,
		localAgent: void 0,
		result: parts.result,
		dispose() {
			if (disposal !== void 0) return disposal;
			parts.signal.removeEventListener("abort", parts.onAbort);
			parts.requestCancel();
			disposal = parts.teardown();
			return disposal;
		}
	};
}
//#endregion
//#region lib/types/run-settlement.js
/**
* Settlement of one ONE-SHOT subagent run into a background-Task outcome. Only
* the one-shot background path uses Jobs; continuable children have no Task,
* no per-message result, and no Task cancellation.
*
* @module @deepseek-ai/dsh-subagent/run-settlement
*/
/** Flatten a child's final output blocks to the task's final text. */
function finalText(blocks) {
	return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
}
/**
* Map a child result to the task outcome: completed carries final text,
* aborted is killed, and every other reason is failed without partial output.
* @param result - child terminal result.
* @returns outcome for the `ctx.jobs` registration.
*/
function runOutcome(result) {
	switch (result.stopReason) {
		case "completed": return {
			status: "completed",
			output: finalText(result.output)
		};
		case "aborted": return { status: "killed" };
		case "error":
		case "max-tokens":
		case "refusal": return {
			status: "failed",
			detail: result.stopReason
		};
		default: return {
			status: "failed",
			detail: String(result.stopReason)
		};
	}
}
/**
* Await the child result, dispose the run, then return its task outcome. Result
* and disposal failures become `failed`; when both fail, both details survive.
* @param run - live run to settle and release.
* @returns outcome after child resources are released.
*/
async function settleRun(run) {
	let outcome;
	try {
		outcome = runOutcome(await run.result);
	} catch (error) {
		outcome = {
			status: "failed",
			detail: String(error)
		};
	}
	try {
		await run.dispose();
	} catch (error) {
		return {
			status: "failed",
			detail: `${outcome.detail === void 0 ? "" : `${outcome.detail}; `}dispose failed: ${String(error)}`
		};
	}
	return outcome;
}
//#endregion
//#region lib/types/index.js
/**
* Service Definition for the subagent capability seam (`ctx.subagents`): a named-provider registry plus a
* capability-validating asynchronous start API. Providers establish a
* child before returning its run, so fulfillment is the single publication and
* ownership-transfer boundary.
*
* Unlike the bash seam (one executor per context, second load throws), MULTIPLE
* providers coexist here: each registers under a unique name and a caller picks
* one by name. The shape mirrors the LLM adapter registry
* (`LlmRuntime.registerAdapter`), not the single-service bash executor.
*
* This package owns the Service Definition role of the capability seam. Service Providers
* (`@deepseek-ai/dsh-subagent-spawn-in-process`, `-fork`, `-acp`) and the model-facing
* consumer (`@deepseek-ai/dsh-tool-subagent`) are separate packages.
*
* Public operations express caller intent: `start` returns one published owned
* one-shot run, `startContinuable` establishes a durable continuable child, and
* `followup` delivers later content without exposing whether the child is
* resident. Continuable children never become a {@link SubagentRun}: the
* continuation manager holds their `AgentHandle` directly and orders every turn
* through the child's own inbox, so providers contribute only the detached
* creation spec and see no handle, turn, or teardown. Child and descendant
* discovery read the live session store and optional session persistence
* directly and do not require that continuation runtime.
*
* Same-process providers are trusted typed collaborators. Requests, provider
* descriptors, results, and lifecycle payloads are borrowed immutable values;
* serialization and hostile-input validation belong at real process, worker,
* persistence, and model boundaries.
*
* @module @deepseek-ai/dsh-subagent
*/
/** Named provider registry with one-shot runs, durable discovery, and continuable-child operations. */
var SubagentRuntime = class extends Service {
	providers = /* @__PURE__ */ new Map();
	continuations;
	/** Deployment contributions composed into unpublished continuable children. */
	setupRegistry = new SubagentActivationSetupRegistry();
	/**
	* The contained lifecycle-edge publisher. Built here because scoped dispatch
	* keys its carrier by this exact service instance, whose own context filter
	* composes into the carrier.
	*/
	emitLifecycle;
	constructor(ctx) {
		super(ctx, "subagents");
		this.emitLifecycle = createLifecycleEmitter(this.ctx, (parent) => scopeTarget(this, parent));
		ctx.inject(["agents"], (childCtx) => {
			const manager = new SubagentContinuationManager(childCtx, {
				prepareContinuable: (name, request) => this.prepareContinuable(name, request),
				observeActivation: (provider, childId, parent) => this.observeActivation(provider, childId, parent)
			}, this.setupRegistry);
			this.continuations = manager;
			childCtx.effect(() => () => {
				/* v8 ignore else -- one injected binding owns the slot until its fiber disposes. */
				if (this.continuations === manager) this.continuations = void 0;
			}, "subagents.continuationBinding()");
		});
		ctx.inject(["sessionProjections"], (projectionCtx) => {
			projectionCtx.sessionProjections.register(subagentTimingProjectionDefinition);
			projectionCtx.sessionProjections.register(subagentIdentityProjectionDefinition);
		});
	}
	/**
	* Establish one durable continuable child and deliver its initial prompt.
	* Resolves when the child's inbox accepts that prompt, without waiting for the
	* turn to start or for the message to reach the Session log; any earlier
	* failure rejects with no ids and rolls back the child entirely.
	* @param spec - provider, delegation request, and caller cancellation.
	* @returns the durable child id and the accepted prompt's message id.
	* @throws when continuation services are unavailable or materialization fails.
	*/
	async startContinuable(spec) {
		return this.requireContinuations().startContinuable(spec);
	}
	/**
	* Deliver one later message to a continuable child as its next FIFO turn. A
	* resident child's Agent inbox accepts it directly (waking a `waiting`
	* Activation), while an absent one is cold-resumed from its persisted
	* Session. The Agent inbox is the only queue, so every accepted message has
	* one observable order.
	* @param parent - the exact live direct parent authorizing this delivery.
	* @param childId - durable child session id.
	* @param content - user-role content to deliver.
	* @param options - the message source fields and caller cancellation, which stops the
	*   operation only before inbox acceptance.
	* @returns the accepted message's inbox id.
	* @throws when continuation services are unavailable, parent authority is
	*   rejected, or the message was not admitted.
	*/
	async followup(parent, childId, content, options) {
		return this.requireContinuations().followup(parent, childId, content, options);
	}
	/**
	* Interrupt one live continuable child's current turn under a human parent
	* address or an exact live ancestor Agent. Fire-and-return: the cancel
	* signal is issued before this returns, but the target may keep running
	* until it observes the signal. Unclaimed pending inbox work, the Activation,
	* and published descendants are preserved; claimed work is not requeued.
	* Once the interrupted driver is idle, a waking send resumes the parked FIFO
	* queue. An absent target — including a one-shot or unknown id —
	* is an accepted no-op, as is a manager-less composition, which cannot own a
	* live Activation.
	* @param targetSessionId - the durable child session id to interrupt.
	* @param authority - the human parent address or exact live ancestor Agent.
	* @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
	*   live target.
	*/
	interrupt(targetSessionId, authority) {
		this.continuations?.interrupt(targetSessionId, authority);
	}
	/**
	* Deliver selected content from one live continuable child to its durable
	* direct parent. The child is the authority credential; callers cannot name a
	* recipient. Reporting does not conclude the child's turn or Activation.
	* @param child - exact live reporting child.
	* @param content - selected model-facing content.
	* @param options - parent scheduling and pre-acceptance cancellation.
	* @returns the stable identity of the parent-accepted message.
	* @throws when continuation services are unavailable, sender authorization
	*   fails, or the direct parent is not live.
	*/
	async reportFrom(child, content, options) {
		return this.requireContinuations().reportFrom(child, content, options);
	}
	/**
	* Compose one deployment capability into every continuable child's
	* unpublished creation context on fresh creation and cold resume. Grants wait
	* for the next Activation; removing the contribution revokes every resident
	* installation immediately.
	* @param contribution - synchronous child-scope installer.
	* @returns the exact Cordis effect disposer.
	*/
	registerContinuableSetup(contribution) {
		return this.ctx.effect(() => this.setupRegistry.register(contribution), "subagents.registerContinuableSetup()");
	}
	/**
	* Close continuable admission below exact live parent Agents, stop only their
	* visible descendant Activations synchronously, then await admitted scoped
	* materializations and release those forests child-first. The scoped cutoff
	* lasts until each exact parent leaves the registry; unrelated parent trees
	* remain live.
	* @param parents - exact host-owned parent Agents entering teardown.
	* @returns once every retained descendant Activation released its `AgentHandle`.
	* @throws an aggregate error after all branches settle when any failed.
	*/
	async drainContinuableDescendants(parents) {
		const manager = this.continuations;
		if (manager === void 0) return;
		await manager.drainDescendants(parents);
	}
	/**
	* Enumerate the parent's direct session-backed subagents without loading or
	* resuming an Agent and without any query service: the listing merges the live
	* session store with optional session persistence (live-preferred) and
	* serves each child's durable mode/label from the registered `subagent`
	* projection unit down a three-rung ladder — the registry's watermark
	* snapshot for a live child; for a cold one, a durable projection-cache
	* row when the optional cache serves an own-suffix identity (its `seq`
	* gate proves the value postdates the fork seed, where a child's own
	* descriptor is immutable once appended), else one persistence inspection
	* folded through the registry. The
	* projection fold is the single classification authority; per-child
	* diagnostics relay a fold that served no identity or a failed inspection,
	* never a list-time descriptor parse. Absent persistence, enumeration is
	* live-only (a cold child cannot be resumed then either, so its absence is
	* capability absence, not an error). This service consults no Agent
	* registrations, Activations, or providers.
	*
	* Every persistence read receives `signal`, and the listing rechecks
	* cancellation around each of those awaits. Read rejections that settle
	* after an abort become a stable `SubagentError` with code `CANCELLED`.
	* @param parentSessionId - parent session whose direct children are listed.
	* @param signal - caller-owned cancellation forwarded to persistence reads
	*   and observed around every read await.
	* @returns children and per-child diagnostics ordered by `createdAt`, then id.
	* @throws {@link SubagentError} when the projection registry or the session
	*   store is not mounted, or the caller cancels the listing.
	*/
	listChildren(parentSessionId, signal) {
		return listChildren(this.ctx, parentSessionId, signal);
	}
	/**
	* Enumerate the root's complete session-backed subagent tree in stable
	* pre-order from one live-preferred corpus, without loading or resuming an
	* Agent. Ordinary sessions and one-shot children remain traversal nodes so
	* continuable descendants below them are discovered; each returned entry
	* adds its durable `parentId` and root-relative `depth`. Identity resolution,
	* diagnostics, optional persistence, and cancellation follow the same
	* projection-backed contract as {@link listChildren}.
	* @param rootSessionId - session whose complete descendant tree is listed.
	* @param signal - caller-owned cancellation forwarded to persistence reads
	*   and observed around every read await.
	* @returns children and per-candidate diagnostics with tree position, in
	*   stable pre-order.
	* @throws {@link SubagentError} under the same conditions as {@link listChildren}.
	*/
	listDescendants(rootSessionId, signal) {
		return listDescendants(this.ctx, rootSessionId, signal);
	}
	/**
	* Register a provider under its name. Registration is effect-scoped and HMR
	* safe; removing a provider blocks new starts but does not revoke runs that
	* were already returned to their holders.
	* @param provider - the trusted provider implementation.
	* @returns the exact Cordis effect disposer.
	*/
	registerProvider(provider) {
		const name = provider.name;
		return this.ctx.effect(function* () {
			if (this.providers.has(name)) throw new SubagentError(`a subagent provider named "${name}" is already registered`, "DUPLICATE_PROVIDER");
			this.providers.set(name, provider);
			yield () => {
				this.providers.delete(name);
				this.emitLifecycle("subagent/provider-removed", name);
			};
			this.ctx.emit("subagent/provider-added", provider);
		}.bind(this), "subagents.registerProvider()");
	}
	/**
	* Look up a provider by name.
	* @param name - the provider name.
	* @returns the provider, or undefined when absent.
	*/
	getProvider(name) {
		return this.providers.get(name);
	}
	/**
	* List registered provider names in insertion order.
	* @returns the registered names.
	*/
	list() {
		return [...this.providers.keys()];
	}
	/**
	* Establish a published child on the named provider. Capability and semantic
	* checks run before delegation. Provider ownership lasts until its promise
	* fulfills; a rejection therefore has no run for the caller to dispose and
	* emits no run lifecycle events. Post-publication turn and infrastructure
	* failures settle through the returned run.
	* @param name - the provider to use.
	* @param request - child label, prompt, parent, signal, and optional capabilities.
	* @returns the published holder-owned run.
	*/
	async start(name, request) {
		const provider = this.expectProvider(name);
		this.assertCapabilities(provider, request);
		assertSubagentMaxDepth(request.maxDepth);
		if (request.outputSchema !== void 0) assertObjectJsonSchema(request.outputSchema);
		const descriptor = snapshotSubagentDescriptor({
			mode: "one-shot",
			provider: name,
			...request.label !== void 0 ? { label: request.label } : {}
		});
		const resolved = {
			...request,
			descriptor
		};
		return observeRun(this.emitLifecycle, name, request.parent, await provider.start(resolved));
	}
	/**
	* Resolve one provider's detached continuable-creation contribution. Method
	* presence on the provider IS the capability, so a provider without it is
	* rejected before the manager reserves any child resources.
	*/
	async prepareContinuable(name, request) {
		const provider = this.expectProvider(name);
		if (provider.prepareContinuable === void 0) throw new SubagentError(`subagent provider "${provider.name}" does not support continuable children (no prepareContinuable capability)`, "UNSUPPORTED_CAPABILITY");
		return provider.prepareContinuable(request);
	}
	/** Look up a provider for dispatch or fail loud. */
	expectProvider(name) {
		const provider = this.providers.get(name);
		if (provider === void 0) throw new SubagentError(`no subagent provider registered for "${name}"`, "NO_PROVIDER");
		return provider;
	}
	/** Resolve the optional continuable-subagent manager or fail loud. */
	requireContinuations() {
		if (this.continuations === void 0) throw new SubagentError("continuable subagents require the agents service", "CONTINUATION_UNAVAILABLE");
		return this.continuations;
	}
	/**
	* Build the lifecycle observer for one continuable Activation's residency
	* epoch, so the manager publishes its edges without owning event dispatch.
	*/
	observeActivation(provider, childId, parent) {
		return createActivationObserver(this.emitLifecycle, provider, childId, parent);
	}
	/** Reject the first requested capability that the provider lacks. */
	assertCapabilities(provider, request) {
		const needs = [
			{
				when: request.outputSchema !== void 0,
				cap: "outputSchema"
			},
			{
				when: request.maxDepth !== void 0,
				cap: "depthLimit"
			},
			{
				when: request.toolFilter !== void 0,
				cap: "toolFilter"
			},
			{
				when: request.persona !== void 0,
				cap: "persona"
			}
		];
		for (const { when, cap } of needs) if (when && !provider.capabilities[cap]) throw new SubagentError(`subagent provider "${provider.name}" does not support the "${cap}" capability`, "UNSUPPORTED_CAPABILITY");
	}
};
//#endregion
export { AssistantOutputFold, NO_START_CAPABILITIES, SUBAGENT_DESCRIPTOR_VERSION, SubagentDepthError, SubagentError, SubagentRunId, SubagentRuntime, SubagentRuntime as default, appendDelegatedPolicyOverrides, applyChildComposition, assertPositiveFinite, assertSubagentMaxDepth, assertUsableCwd, captureDelegatedPolicyOverrides, childSessionMeta, delegationDepthOf, finalAssistantOutput, foldSubagentDescriptor, resolveChildAgentOptions, resolveChildCwd, resolveChildDepth, seedDescriptorTurn, settleRun, settleRunResult, snapshotSubagentDescriptor, subprocessRunHandle, validateConfiguredCwd };
