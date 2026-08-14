import "@deepseek-ai/dsh-llm";
//#region lib/types/runtime.js
/**
* Brand a string as a goal id.
* @param id - raw goal identifier.
* @returns the same string with the compile-time brand.
*/
function GoalId(id) {
	return id;
}
//#endregion
//#region lib/types/fold.js
/** Pure replay fold and strict decoder for durable goal changes. */
const SNAPSHOT_OPERATIONS = new Set([
	"create",
	"edit",
	"pause",
	"resume",
	"complete",
	"block"
]);
const PHASES = new Set([
	"active",
	"paused",
	"blocked",
	"complete"
]);
/**
* Build an empty replay accumulator.
* @returns mutable state with no current goal or prior ref.
*/
function emptyGoalFoldState() {
	return {
		goal: void 0,
		roundsStarted: 0,
		createdAt: void 0,
		updatedAt: void 0,
		lastRef: void 0,
		seenGoalIds: /* @__PURE__ */ new Set()
	};
}
/** Whether a value is a JSON record rather than an array. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Require one positive safe integer. */
function positiveInteger(value, field) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`goal change ${field} must be a positive safe integer`);
	return value;
}
/** Require one non-negative safe integer. */
function nonNegativeInteger(value, field) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`goal change ${field} must be a non-negative safe integer`);
	return value;
}
/** Decode one canonical blocker explanation. */
function decodeBlockReason(value) {
	if (!isRecord(value) || Object.keys(value).sort().join(",") !== "code,message") throw new Error("goal change goal.blockedReason must have exactly code and message fields");
	if (typeof value["code"] !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value["code"])) throw new Error("goal change goal.blockedReason.code must be lower-kebab-case");
	if (typeof value["message"] !== "string" || value["message"].trim().length === 0 || value["message"] !== value["message"].trim()) throw new Error("goal change goal.blockedReason.message must be non-empty and normalized");
	return {
		code: value["code"],
		message: value["message"]
	};
}
/** Decode and validate one snapshot. */
function decodeSnapshot(value) {
	if (!isRecord(value)) throw new Error("goal change goal must be a record");
	if (typeof value["id"] !== "string" || value["id"].length === 0) throw new Error("goal change goal.id must be a non-empty string");
	if (typeof value["objective"] !== "string" || value["objective"].trim().length === 0 || value["objective"] !== value["objective"].trim()) throw new Error("goal change goal.objective must be non-empty and normalized");
	if (typeof value["phase"] !== "string" || !PHASES.has(value["phase"])) throw new Error("goal change goal.phase is invalid");
	const phase = value["phase"];
	const expectedKeys = phase === "blocked" ? "blockedReason,id,maxGoalRounds,objective,phase,revision" : "id,maxGoalRounds,objective,phase,revision";
	if (Object.keys(value).sort().join(",") !== expectedKeys) throw new Error(`goal change goal for phase ${phase} must have exactly ${expectedKeys} fields`);
	return {
		id: GoalId(value["id"]),
		revision: positiveInteger(value["revision"], "goal.revision"),
		objective: value["objective"],
		phase,
		maxGoalRounds: positiveInteger(value["maxGoalRounds"], "goal.maxGoalRounds"),
		...phase === "blocked" ? { blockedReason: decodeBlockReason(value["blockedReason"]) } : {}
	};
}
/** Decode and validate one ref. */
function decodeRef(value) {
	if (!isRecord(value) || Object.keys(value).sort().join(",") !== "id,revision") throw new Error("goal clear tombstone must have exactly id and revision fields");
	if (typeof value["id"] !== "string" || value["id"].length === 0) throw new Error("goal clear tombstone id must be a non-empty string");
	return {
		id: GoalId(value["id"]),
		revision: positiveInteger(value["revision"], "cleared.revision")
	};
}
/**
* Decode a value that declares itself as a goal change. Unrelated values
* return `undefined`; malformed goal changes fail replay loudly.
* @param value - candidate source change.
* @returns validated goal change or `undefined` for another value kind.
*/
function decodeGoalChange(value) {
	if (!isRecord(value) || value["kind"] !== "goal/change") return void 0;
	if (value["version"] !== 1) throw new Error(`unsupported goal change version ${String(value["version"])}`);
	if (value["operation"] === "clear") {
		const allowed = [
			"cleared",
			"clearedAt",
			"kind",
			"operation",
			"version"
		];
		if (Object.keys(value).sort().join(",") !== allowed.sort().join(",")) throw new Error(`goal clear change must have exactly ${allowed.sort().join(",")} fields`);
		return {
			kind: "goal/change",
			version: 1,
			operation: "clear",
			cleared: decodeRef(value["cleared"]),
			clearedAt: nonNegativeInteger(value["clearedAt"], "clearedAt")
		};
	}
	if (typeof value["operation"] !== "string" || !SNAPSHOT_OPERATIONS.has(value["operation"])) throw new Error("goal change operation is invalid");
	const allowed = [
		"createdAt",
		"goal",
		"kind",
		"operation",
		"roundsStarted",
		"updatedAt",
		"version"
	];
	if (Object.keys(value).sort().join(",") !== allowed.sort().join(",")) throw new Error(`goal snapshot change must have exactly ${allowed.sort().join(",")} fields`);
	const createdAt = nonNegativeInteger(value["createdAt"], "createdAt");
	const updatedAt = nonNegativeInteger(value["updatedAt"], "updatedAt");
	if (updatedAt < createdAt) throw new Error("goal change updatedAt cannot precede createdAt");
	return {
		kind: "goal/change",
		version: 1,
		operation: value["operation"],
		goal: decodeSnapshot(value["goal"]),
		roundsStarted: nonNegativeInteger(value["roundsStarted"], "roundsStarted"),
		createdAt,
		updatedAt
	};
}
/** Narrow model attribution to a valid goal source. */
function goalSource(source) {
	if (source.kind !== "goal") return void 0;
	if (typeof source.goalId !== "string" || source.goalId.length === 0 || !Number.isSafeInteger(source.revision) || source.revision < 1 || !Number.isSafeInteger(source.round) || source.round < 1) throw new Error("goal message source is invalid");
	return source;
}
/** Require two snapshots to retain fields that only `edit` may replace. */
function requireSameDefinition(current, next, operation) {
	if (next.objective !== current.objective || next.maxGoalRounds !== current.maxGoalRounds) throw new Error(`goal ${operation} cannot change objective or maxGoalRounds`);
}
/** Require one exact next revision of the current goal. */
function requireNextRevision(current, next, operation) {
	if (next.id !== current.id || next.revision !== current.revision + 1) throw new Error(`goal ${operation} must advance the current goal by one revision`);
}
/** Validate one non-create snapshot operation against the preceding projection. */
function validateSnapshotTransition(state, change, current) {
	const next = change.goal;
	requireNextRevision(current, next, change.operation);
	/* v8 ignore next -- a current goal established by this fold always has an updatedAt */
	if (state.updatedAt === void 0) throw new Error("current goal fold lacks updatedAt");
	if (change.createdAt !== state.createdAt || change.updatedAt < state.updatedAt || change.roundsStarted !== state.roundsStarted) throw new Error(`goal ${change.operation} does not preserve the current counters and timestamps`);
	switch (change.operation) {
		case "edit":
			if (next.phase !== current.phase || JSON.stringify(next.blockedReason) !== JSON.stringify(current.blockedReason)) throw new Error("goal edit cannot change phase or blocked reason");
			break;
		case "pause":
			requireSameDefinition(current, next, change.operation);
			if (current.phase !== "active" || next.phase !== "paused") throw new Error("goal pause has an invalid phase transition");
			break;
		case "resume":
			requireSameDefinition(current, next, change.operation);
			if (!new Set([
				"active",
				"paused",
				"blocked"
			]).has(current.phase) || next.phase !== "active" || state.roundsStarted >= next.maxGoalRounds) throw new Error("goal resume has an invalid phase transition or exhausted round budget");
			break;
		case "complete":
			requireSameDefinition(current, next, change.operation);
			if (current.phase === "complete" || next.phase !== "complete") throw new Error("goal complete has an invalid phase transition");
			break;
		case "block":
			requireSameDefinition(current, next, change.operation);
			if (current.phase !== "active" || next.phase !== "blocked") throw new Error("goal block has an invalid phase transition");
			break;
		/* v8 ignore start -- the caller excludes create and GoalOperation is closed; these arms retain fail-loud exhaustiveness */
		case "create": throw new Error("goal create cannot be validated as a current-goal transition");
		default:
			change.operation;
			throw new Error("unknown goal snapshot operation");
	}
}
/**
* Return the revision identity carried by a snapshot or tombstone.
* @param change - decoded goal mutation.
* @returns stable identity used to reconcile a deferred change with its log event.
*/
function goalChangeRef(change) {
	return change.operation === "clear" ? change.cleared : {
		id: change.goal.id,
		revision: change.goal.revision
	};
}
/**
* Validate and apply one decoded change to a mutable accumulator.
* @param state - preceding durable goal projection.
* @param change - decoded full snapshot or clear tombstone.
*/
function applyGoalChange(state, change) {
	const ref = goalChangeRef(change);
	if (change.operation === "clear") {
		const current = state.goal;
		if (current === void 0) throw new Error("goal clear requires a current goal");
		requireNextRevision(current, change.cleared, change.operation);
		/* v8 ignore next -- a current goal established by this fold always has an updatedAt */
		if (state.updatedAt === void 0) throw new Error("current goal fold lacks updatedAt");
		if (change.clearedAt < state.updatedAt) throw new Error("goal clear timestamp cannot precede the current goal update");
		state.goal = void 0;
		state.roundsStarted = 0;
		state.createdAt = void 0;
		state.updatedAt = void 0;
		state.lastRef = ref;
		return;
	}
	if (change.operation === "create") {
		if (change.goal.revision !== 1 || change.goal.phase !== "active" || change.roundsStarted !== 0 || state.goal !== void 0 && state.goal.phase !== "complete" || state.seenGoalIds.has(change.goal.id)) throw new Error("goal create requires a fresh active revision-one goal with zero rounds");
		state.seenGoalIds.add(change.goal.id);
	} else {
		const current = state.goal;
		if (current === void 0) throw new Error(`goal ${change.operation} requires a current goal`);
		validateSnapshotTransition(state, change, current);
	}
	state.goal = change.goal;
	state.roundsStarted = change.roundsStarted;
	state.createdAt = change.createdAt;
	state.updatedAt = change.updatedAt;
	state.lastRef = ref;
}
/**
* Apply one session event to the strict durable goal fold.
* @param state - mutable fold accumulator.
* @param event - next event in sequence order.
*/
function applyGoalEvent(state, event) {
	if (event.type === "goal/change") {
		const change = decodeGoalChange(event.data);
		/* v8 ignore next -- the event's declared payload always identifies itself as a goal change. */
		if (change === void 0) throw new Error(`goal change at session event ${event.seq} has an invalid kind`);
		applyGoalChange(state, change);
		return;
	}
	if (event.type === "user/message") {
		const source = goalSource(event.data.source);
		if (source === void 0) return;
		const current = state.goal;
		if (current === void 0 || current.phase !== "active" || source.goalId !== current.id || source.revision !== current.revision || source.round !== state.roundsStarted + 1 || source.round > current.maxGoalRounds) throw new Error(`goal round at session event ${event.seq} is not the next admitted round of the active goal`);
		state.roundsStarted = source.round;
	}
}
//#endregion
//#region lib/types/invariant.js
/** Package-owned durable goal-stream invariants. @module @deepseek-ai/dsh-goal/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-goal";
/** Cordis companion plugin name. */
const name = "goal-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** Copy the independent fold before validating one candidate event. */
function cloneState(state) {
	return {
		goal: state.goal,
		roundsStarted: state.roundsStarted,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		lastRef: state.lastRef,
		seenGoalIds: new Set(state.seenGoalIds)
	};
}
/** Apply one event through the strict goal decoder and attribute failures. */
function applyChecked(state, event, fail) {
	try {
		applyGoalEvent(state, event);
	} catch (error) {
		/* v8 ignore next -- the strict goal decoder throws Error instances */
		const message = error instanceof Error ? error.message : String(error);
		fail(`session event ${event.seq} violates the durable goal stream: ${message}`);
	}
}
/** Install an independent incremental fold over every attached session. */
const install = Object.assign((ctx, fail) => {
	const states = /* @__PURE__ */ new WeakMap();
	const staged = /* @__PURE__ */ new WeakMap();
	const seed = (session) => {
		const state = emptyGoalFoldState();
		for (const event of session.events) applyChecked(state, event, fail);
		states.set(session, state);
		return state;
	};
	/* v8 ignore next -- session/event always follows list() or session/created seeding */
	const stateFor = (session) => states.get(session) ?? seed(session);
	for (const session of ctx.sessions.list()) seed(session);
	ctx.on("session/created", (session) => {
		seed(session);
	}, { global: true });
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "session/event") return;
		const [session, event] = args;
		const state = cloneState(stateFor(session));
		applyChecked(state, event, fail);
		staged.set(event, {
			session,
			state
		});
	}, { global: true });
	ctx.on("session/event", (session, event) => {
		const candidate = staged.get(event);
		/* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
		if (candidate === void 0 || candidate.session !== session) return fail("session/event reached publication without matching goal-fold validation");
		staged.delete(event);
		states.set(session, candidate.state);
	}, { global: true });
}, { inject: ["sessions"] });
/**
* Register the goal-stream invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
