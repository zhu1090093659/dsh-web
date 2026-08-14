import { randomUUID } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { scopeTarget } from "@deepseek-ai/dsh-scope";
//#region lib/types/types.js
/**
* Wire-safe approval identifiers and outcome vocabulary, free of
* cordis/service imports so browser type chains (apiproxy api → client) can
* consume them without loading this package's Context augmentation.
* @module @deepseek-ai/dsh-user-approval/types
*/
/**
* Brand a string as an {@link ApprovalRequestId}.
* @param id - the raw id string to brand.
* @returns the same string carrying the brand.
*/
function ApprovalRequestId(id) {
	return id;
}
//#endregion
//#region lib/types/index.js
/**
* Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
* answerers fail closed; grants apply only to the requested action.
* @module @deepseek-ai/dsh-user-approval
*/
/** Every {@link ApprovalOutcome}, for runtime normalization of answerer returns. */
const OUTCOMES = [
	"allowed-once",
	"rejected",
	"cancelled",
	"unavailable"
];
/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
const APPROVAL_POLICIES = ["ask", "never"];
/** Model-facing statement for the deterministic `'never'` policy. */
const NEVER_SENTENCE = "Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).";
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = "Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.";
/**
* The session's approval-policy override: the last `approval/policy` event in
* the log, or undefined when the session never switched (callers apply the
* plugin's configured default). The pure fold — resume needs no catch-up
* machinery because replaying the log IS the state.
* @param events - session events in log order (other event types are skipped).
* @returns the policy of the last switch event, or undefined without one.
*/
function effectiveApprovalPolicy(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type === "approval/policy") return event.data.policy;
	}
}
/**
* Whether the log currently sits inside an open turn (a `turn/start` not yet
* closed by a `turn/end`) — the {@link ApprovalService.request} precondition.
* The audit pair must be turn-enclosed: the turn is the durable log's
* commit/replay boundary, so a bare event appended between turns is
* indistinguishable from a crash tail and silently dropped on reload.
*/
function hasOpenTurn(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const type = events[index].type;
		if (type === "turn/start") return true;
		if (type === "turn/end") return false;
	}
	return false;
}
/**
* Append the sole durable representation of a session policy override. Invalid
* values throw before the log changes; consumers fold the new value on each read.
* @param session - the session the override belongs to.
* @param policy - the policy in effect until the next switch.
*/
function setApprovalPolicy(session, policy) {
	if (!APPROVAL_POLICIES.includes(policy)) throw new TypeError("approval policy must be one of \"ask\" or \"never\"");
	session.append("approval/policy", { policy });
}
(class extends Service {
	config;
	static Config = z.object({ policy: z.union(["ask", "never"]).default("ask") });
	constructor(ctx, config) {
		super(ctx, "approval");
		this.config = config;
		const effective = (agent) => this.effectivePolicy(agent.session);
		ctx.inject(["systemPrompt"], (scope) => {
			scope.systemPrompt.context({
				name: "approval:policy",
				order: 115,
				text: (context) => {
					const agent = context.agent;
					if (agent === void 0) return "";
					return effective(agent) === "never" ? NEVER_SENTENCE : ASK_SENTENCE;
				}
			});
		});
	}
	/**
	* Switch one live agent's policy and queue the transition for its next model
	* step. Session initialization uses {@link setApprovalPolicy} directly
	* because there is no previously visible policy to change.
	* @param agent - the live agent whose policy is changing.
	* @param policy - the new effective policy.
	*/
	setPolicy(agent, policy) {
		const previous = this.effectivePolicy(agent.session);
		if (previous === policy) return;
		setApprovalPolicy(agent.session, policy);
		agent.inject(createUserMessage({
			content: [{
				type: "text",
				text: `The approval policy changed from "${previous}" to "${policy}" (changed by the user).`
			}],
			source: {
				kind: "plugin",
				plugin: "user-approval"
			}
		}));
	}
	/**
	* Ask the composed answerers to decide one readonly same-process request.
	* The service borrows the request, agent, session, and live signal directly.
	* The request requires an open turn because the audit pair must be enclosed
	* by the durable log's commit/replay boundary; an idle ask rejects before
	* appending anything. The answerer phase always produces an outcome: an
	* aborted signal yields `'cancelled'`, a missing or throwing answerer yields
	* `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
	* normalized to `'unavailable'`. A failure that prevents either audit append
	* from committing still rejects because returning an unlogged decision would
	* violate the pair. Session contains post-commit observer failures, so an
	* authoritative append cannot reject the request or suppress its matching
	* audit event.
	* @param req - the pending decision (agent, tool identity, reason, signal).
	* @returns the closed outcome; `'allowed-once'` is the only grant.
	* @throws when no turn is open or either audit event fails before the session
	*   append commit point.
	*/
	async request(req) {
		const session = req.agent.session;
		if (!hasOpenTurn(session.events)) throw new Error("approval.request() outside an open turn: the approval/asked + approval/decided audit pair must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). Ask from inside the turn that needs the decision.");
		const id = ApprovalRequestId(randomUUID());
		session.append("approval/asked", {
			id,
			toolName: req.toolName,
			...req.callId !== void 0 ? { callId: req.callId } : {},
			...req.reason !== void 0 ? { reason: req.reason } : {}
		});
		const outcome = await this.decide(req, session);
		session.append("approval/decided", {
			id,
			outcome
		});
		return outcome;
	}
	/**
	* The session's effective policy: its own `approval/policy` fold, else the
	* configured default (the schema already defaulted an omitted policy to
	* `'ask'`; the `??` only narrows the optional-input TYPE).
	* @param session - the exact accepted session whose policy applies.
	* @returns the policy every ask for this session resolves under right now.
	*/
	effectivePolicy(session) {
		return this.overrideOf(session) ?? this.config.policy ?? "ask";
	}
	/**
	* Read the session override without applying the configured default.
	* @param session - session whose log supplies the override.
	* @returns the last logged policy, or `undefined` without one.
	*/
	overrideOf(session) {
		return effectiveApprovalPolicy(session.events);
	}
	/**
	* Dispatch the waterfall, contained and raced against the request signal.
	* @param req - the borrowed public request.
	* @param session - the request agent's session used for policy lookup.
	* @returns the normalized closed outcome.
	*/
	async decide(req, session) {
		const signal = req.signal;
		if (signal?.aborted) return "cancelled";
		if (this.effectivePolicy(session) === "never") return "rejected";
		const answer = Promise.resolve().then(() => this.ctx.waterfall(scopeTarget(this, req.agent), "approval/request", req, () => Promise.resolve("unavailable"))).then((outcome) => OUTCOMES.includes(outcome) ? outcome : "unavailable", () => "unavailable");
		if (signal === void 0) return answer;
		return await new Promise((resolve) => {
			const onAbort = () => {
				signal.removeEventListener("abort", onAbort);
				resolve("cancelled");
			};
			signal.addEventListener("abort", onAbort, { once: true });
			answer.then((outcome) => {
				signal.removeEventListener("abort", onAbort);
				resolve(outcome);
			});
		});
	}
});
//#endregion
//#region lib/types/invariant.js
/** Package-owned approval audit-stream invariants. @module @deepseek-ai/dsh-user-approval/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-user-approval";
const APPROVAL_OUTCOMES = [
	"allowed-once",
	"rejected",
	"cancelled",
	"unavailable"
];
/** Cordis companion plugin name. */
const name = "user-approval-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** Validate one approval event against committed unmatched questions. */
function validateApprovalEvent(trace, event, fail) {
	if (event.type === "approval/asked") {
		if (trace.openTurn === null) fail("approval/asked appended outside any open turn");
		if (event.data.toolName.length === 0) fail("approval/asked toolName must be non-empty");
		if (trace.pending.has(event.data.id)) fail(`approval/asked repeated open id ${JSON.stringify(event.data.id)}`);
		return {
			kind: "asked",
			id: event.data.id
		};
	}
	if (event.type === "approval/decided") {
		if (trace.openTurn === null) fail("approval/decided appended outside any open turn");
		if (!trace.pending.has(event.data.id)) fail(`approval/decided has no matching approval/asked for id ${JSON.stringify(event.data.id)}`);
		if (!APPROVAL_OUTCOMES.includes(event.data.outcome)) fail(`approval/decided carries unknown outcome ${JSON.stringify(event.data.outcome)}`);
		return {
			kind: "decided",
			id: event.data.id
		};
	}
	if (event.type === "approval/policy" && !APPROVAL_POLICIES.includes(event.data.policy)) fail(`approval/policy carries unknown policy ${JSON.stringify(event.data.policy)}`);
}
/** Apply one accepted approval-pair transition. */
function applyApprovalTransition(pending, transition) {
	if (transition.kind === "asked") pending.add(transition.id);
	else pending.delete(transition.id);
}
/** Install audit pairing and closed-vocabulary checks. */
const install = Object.assign((ctx, fail) => {
	const traces = /* @__PURE__ */ new WeakMap();
	const staged = /* @__PURE__ */ new WeakMap();
	const seed = (session) => {
		const trace = {
			openTurn: null,
			pending: /* @__PURE__ */ new Set()
		};
		traces.set(session, trace);
		for (const event of session.events) {
			if (event.type === "turn/start") trace.openTurn = event.data.turn;
			else if (event.type === "turn/end") trace.openTurn = null;
			const transition = validateApprovalEvent(trace, event, fail);
			if (transition !== void 0) applyApprovalTransition(trace.pending, transition);
		}
		return trace;
	};
	const traceFor = (session) => traces.get(session) ?? seed(session);
	for (const session of ctx.sessions.list()) seed(session);
	ctx.on("session/created", (session) => {
		seed(session);
	}, { global: true });
	ctx.on("session/event", (session, event) => {
		const trace = traceFor(session);
		if (event.type === "turn/start") {
			trace.openTurn = event.data.turn;
			return;
		}
		if (event.type === "turn/end") {
			trace.openTurn = null;
			return;
		}
		if (event.type !== "approval/asked" && event.type !== "approval/decided") return;
		const candidate = staged.get(event);
		/* v8 ignore next -- internal/dispatch stages every package-owned pair event */
		if (candidate === void 0 || candidate.session !== session) return fail("approval audit event published without pre-commit validation");
		staged.delete(event);
		applyApprovalTransition(trace.pending, candidate.transition);
	}, { global: true });
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "session/event") return;
		const [session, event] = args;
		const transition = validateApprovalEvent(traceFor(session), event, fail);
		if (transition !== void 0) staged.set(event, {
			session,
			transition
		});
	}, { global: true });
}, { inject: ["sessions"] });
/**
* Register the approval invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
