import { Service, getTraceable, symbols } from "@deepseek-ai/cordis";
import { AsyncLocalStorage } from "node:async_hooks";
import { isPromise } from "node:util/types";
import { scopeTarget } from "@deepseek-ai/dsh-scope";
//#region lib/types/inbox.js
/**
* Incremental projection of durable agent inbox events.
*
* @module @deepseek-ai/dsh-agent/inbox
*/
/** A replay-once projection that incrementally consumes later inbox splices. */
var Inbox = class {
	session;
	notifications;
	state = {
		"next-turn": [],
		"next-step": []
	};
	constructor(session, notifications) {
		this.session = session;
		this.notifications = notifications;
		for (const event of session.events.slice(session.header.seedLength ?? 0)) {
			if (event.type !== "agent/inbox/spliced") continue;
			try {
				this.apply(event.data);
			} catch (error) {
				throw new Error(`invalid persisted inbox splice at session seq ${event.seq}`, { cause: error });
			}
		}
	}
	/** Prompts awaiting individual turns. */
	get nextTurn() {
		return this.state["next-turn"];
	}
	/** Input awaiting the next step boundary. */
	get nextStep() {
		return this.state["next-step"];
	}
	/** Whether either pending-message list contains work. */
	get hasPending() {
		return this.nextTurn.length > 0 || this.nextStep.length > 0;
	}
	/** Durably cancel all pending input, clearing next-step before next-turn. */
	clear() {
		this.splice("next-step", 0, this.nextStep.length, []);
		this.splice("next-turn", 0, this.nextTurn.length, []);
	}
	/**
	* Remove and return the complete batch proposed for one step, publishing
	* each claimed message. The durable splices are pure deletions.
	* @param target - whether this boundary also consumes one queued turn.
	* @param turn - turn that will own the claimed batch.
	* @returns next-step input followed by the queued turn, when requested.
	* @internal - The agent loop's step-boundary operation, not a plugin extension point.
	*/
	claim(target, turn) {
		const claimed = this.mutate("next-step", 0, this.nextStep.length, [], false);
		if (target === "next-turn") claimed.push(...this.mutate("next-turn", 0, 1, [], false));
		for (const message of claimed) this.notifications.claimed(message, turn);
		return claimed;
	}
	/**
	* Append one message to a pending list and durably record the insertion.
	* @param target - pending list to extend.
	* @param message - message to append.
	* @throws if the message identity is already pending.
	*/
	append(target, message) {
		this.splice(target, this.state[target].length, 0, [message]);
	}
	/**
	* Prepend one message to a pending list and durably record the insertion.
	* @param target - pending list to extend.
	* @param message - message to prepend.
	* @throws if the message identity is already pending.
	*/
	prepend(target, message) {
		this.splice(target, 0, 0, [message]);
	}
	/**
	* Replace one pending message in place, possibly changing its identity. A
	* successful replacement publishes the old message as discarded and the new
	* message as inserted.
	* @param messageId - identity of the pending message to replace.
	* @param newMessage - replacement message.
	* @returns whether the message was still pending.
	* @throws if the replacement duplicates another pending message identity.
	*/
	replace(messageId, newMessage) {
		const location = this.locate(messageId);
		if (location === void 0) return false;
		this.splice(location.target, location.index, 1, [newMessage]);
		return true;
	}
	/**
	* Remove one pending message and durably record its cancellation.
	* @param messageId - identity of the pending message to remove.
	* @returns whether the message was still pending.
	*/
	remove(messageId) {
		const location = this.locate(messageId);
		if (location === void 0) return false;
		this.splice(location.target, location.index, 1, []);
		return true;
	}
	/**
	* Apply standard splice semantics and durably record the normalized result.
	* The durable event commits before the live projection mutates, so synchronous
	* `session/event` observers see the pre-splice lists and can reconstruct the
	* removed messages from the normalized coordinates.
	* @param target - pending list to mutate.
	* @param start - splice position.
	* @param deleteCount - maximum number of messages to remove.
	* @param inserted - messages to insert at the resolved position.
	* @returns messages removed by the splice.
	*/
	splice(target, start, deleteCount, inserted) {
		return this.mutate(target, start, deleteCount, inserted, true);
	}
	/** Locate one pending identity across both owned lists. */
	locate(messageId) {
		for (const target of ["next-turn", "next-step"]) {
			const index = this.state[target].findIndex((message) => message.id === messageId);
			if (index >= 0) return {
				target,
				index
			};
		}
	}
	/** Commit one normalized mutation and publish its live notifications. */
	mutate(target, start, deleteCount, inserted, discardRemoved) {
		const inbox = this.state[target];
		const truncatedStart = Math.trunc(start);
		const offset = Number.isNaN(truncatedStart) ? 0 : truncatedStart;
		const actualStart = offset < 0 ? Math.max(inbox.length + offset, 0) : Math.min(offset, inbox.length);
		const truncatedDeleteCount = Math.trunc(deleteCount);
		const actualDeleteCount = Math.min(Math.max(Number.isNaN(truncatedDeleteCount) ? 0 : truncatedDeleteCount, 0), inbox.length - actualStart);
		if (actualDeleteCount === 0 && inserted.length === 0) return [];
		const outcome = discardRemoved && actualDeleteCount > 0 ? "canceled" : void 0;
		const splice = {
			target,
			start: actualStart,
			...actualDeleteCount === 0 ? {} : { removedCount: actualDeleteCount },
			inserted,
			...outcome === void 0 ? {} : { outcome }
		};
		this.validate(splice);
		const event = this.session.append("agent/inbox/spliced", splice);
		const removed = inbox.splice(actualStart, actualDeleteCount, ...event.data.inserted);
		if (discardRemoved) for (const message of removed) this.notifications.discarded(message);
		for (const message of event.data.inserted) this.notifications.inserted(message);
		return removed;
	}
	/** Apply one normalized durable splice to the projection. */
	apply(splice) {
		this.validate(splice);
		return this.state[splice.target].splice(splice.start, splice.removedCount ?? 0, ...splice.inserted);
	}
	/** Validate one normalized splice against the current projection. */
	validate(splice) {
		const inbox = this.state[splice.target];
		const removedCount = splice.removedCount ?? 0;
		if (!Number.isSafeInteger(splice.start) || splice.start < 0 || splice.start > inbox.length || !Number.isSafeInteger(removedCount) || removedCount < 0 || splice.start + removedCount > inbox.length) throw new Error("invalid inbox splice");
		const candidate = inbox.toSpliced(splice.start, removedCount, ...splice.inserted);
		const ids = /* @__PURE__ */ new Set();
		for (const message of splice.target === "next-turn" ? [...candidate, ...this.nextStep] : [...this.nextTurn, ...candidate]) {
			if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`);
			ids.add(message.id);
		}
	}
};
//#endregion
//#region lib/types/consumed-work.js
/**
* How one agent log accounts for the work it consumed.
*
* The turn and step vocabulary alone cannot answer this. A turn that stops
* before its first step leaves a `turn/end` shaped exactly like the balanced
* no-op turns a rejection or an empty claim produces, so reading turns in
* isolation either credits cut-short work as finished or convicts every no-op.
* The missing fact is the inbox's own record: {@link Inbox} logs each mutation
* with `removedCount` and marks a cancellation `outcome: 'canceled'`, which
* separates a turn claiming its input from work being dropped unrun.
*
* @module @deepseek-ai/dsh-agent/consumed-work
*/
/**
* Whether a turn that consumed input but never reached a step ends in a way
* that accounts for that input. Only a `completed` end does not: it had
* nothing left to run once its claim was rewritten away. A `blocked` end is
* that input's ending too — the pre-step rejection that produced it discarded
* the claimed messages, so the work it took will never run.
* @param reason - the turn's recorded ending.
* @returns whether the ending accounts for the input the turn took.
*/
function accountsForClaim(reason) {
	switch (reason.kind) {
		case "completed": return false;
		case "blocked":
		case "aborted":
		case "interrupted":
		case "error": return true;
		/* v8 ignore next 4 -- unreachable: the one unnamed built-in, `max-tokens`, requires a step,
		* so its turn short-circuits as stepped before this call, and `TurnEndReasonMap` is
		* merge-extensible, so a backend-added variant cannot be listed; an unnameable ending over
		* consumed input must not read as success. */
		default: return true;
	}
}
/**
* Fold one agent log, or an owned suffix of one, into its account of consumed
* work. Single pass, and every input is the log itself: no caller has to sample
* live state before cancelling, so a cancellation issued by anyone — the owner's
* teardown, an ancestor's interrupt, an unloading plugin — reads the same.
* @param events - the log, or an owned suffix, to fold.
* @returns the accounting turn when one closed, and whether work was dropped unrun after it.
*/
function foldConsumedWork(events) {
	const stepped = /* @__PURE__ */ new Set();
	const claimed = /* @__PURE__ */ new Set();
	let open;
	let end;
	let droppedUnrun = false;
	for (const event of events) switch (event.type) {
		case "turn/start":
			open = event.data.turn;
			break;
		case "step/start":
			stepped.add(event.data.turn);
			break;
		case "agent/inbox/spliced": {
			const { removedCount, outcome, inserted } = event.data;
			if (removedCount === void 0) break;
			if (outcome === "canceled") droppedUnrun ||= inserted.length === 0;
			else if (open !== void 0) claimed.add(open);
			break;
		}
		case "turn/end": {
			const { turn, reason } = event.data;
			open = void 0;
			if (stepped.delete(turn) || claimed.delete(turn) && accountsForClaim(reason)) {
				end = event;
				droppedUnrun = false;
			}
			break;
		}
		default: break;
	}
	return {
		...end === void 0 ? {} : { end },
		droppedUnrun
	};
}
//#endregion
//#region lib/types/model-selection.js
/**
* Agent-scoped model selection shared by runtime entry points.
* @module @deepseek-ai/dsh-agent/model-selection
*/
/**
* Couple one mutable selection to Agent-scoped prompt assembly and request routing.
* Prompt assembly snapshots the selected model before delegating, then applies
* its provider/model pair and effort to request config so a
* concurrent switch takes effect on a later step instead of splitting the two
* surfaces. An absent selected effort clears any inherited effort, restoring
* the selected model's provider/default behavior.
*
* @param agentCtx - The selected Agent's scoped context.
* @param selection - Mutable selection owned by the calling entry point.
* @returns Disposer for both scoped waterfall listeners.
*/
function installModelSelection(agentCtx, selection) {
	const disposeAssembly = agentCtx.on("system-prompt/assemble", async (_assembly, _context, next) => {
		const selected = selection.current;
		const assembled = await next();
		selection.assembled = selected;
		if (selected === void 0) return assembled;
		return {
			...assembled,
			variables: {
				...assembled.variables,
				provider: selected.provider,
				model: selected.model
			}
		};
	});
	const disposeRequest = agentCtx.on("agent/request", async (_payload, next) => {
		const resolved = await next();
		const selected = selection.assembled;
		if (selected === void 0) return resolved;
		const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved;
		return {
			...withoutInheritedEffort,
			provider: selected.provider,
			model: selected.model,
			...selected.reasoningEffort === void 0 ? {} : { reasoningEffort: selected.reasoningEffort }
		};
	});
	return () => {
		disposeAssembly();
		disposeRequest();
	};
}
//#endregion
//#region lib/types/dispatch.js
/**
* Agent-scoped dispatch and prompt assembly helpers. The fused dispatcher
* {@link agentEvents} couples the agent subject to its scope carrier, so the
* scope key and the payload's `agent` cannot diverge; repeat dispatchers (the
* loop driver) build it once in the agent's constructor and reuse it.
* @module @deepseek-ai/dsh-agent/dispatch
*/
/**
* Build the fused scope carrier for one agent subject.
*
* The carrier is a stateless routing object. {@link agentEvents} accepts an
* existing carrier, so callers that dispatch repeatedly for the same agent
* (the loop driver) build it once in the agent's constructor and reuse it,
* keeping hot-path dispatches allocation-free.
* @param agent - the subject agent and scope key.
* @returns the carrier passed as the event dispatcher `this` value.
*/
function agentCarrier(agent) {
	return scopeTarget(agent, agent);
}
/**
* Build a dispatcher that couples the agent subject to its scope carrier.
* @param ctx - the context to dispatch through (any context of the app).
* @param agent - the subject agent; also the scope-carrier key.
* @param carrier - the scope carrier to dispatch through; defaults to
* {@link agentCarrier} for the agent. Pass a constructor-built carrier to
* avoid rebuilding it for every dispatch.
* @returns the fused dispatcher.
*/
function agentEvents(ctx, agent, carrier = agentCarrier(agent)) {
	const fused = (payload) => ({
		...payload,
		agent
	});
	return {
		emit(name, payload) {
			const args = [
				carrier,
				name,
				fused(payload)
			];
			const callbacks = ctx.events.dispatch("emit", args);
			for (const callback of callbacks) try {
				const returned = callback(...args);
				Promise.resolve(returned).catch((error) => {
					ctx.logger.warn(`agent event "${name}" listener rejected: ${String(error)}`);
				});
			} catch (error) {
				ctx.logger.warn(`agent event "${name}" listener threw: ${String(error)}`);
			}
		},
		async serial(name, payload) {
			const serial = ctx.serial;
			return await serial(carrier, name, fused(payload));
		},
		waterfall(name, payload, ...rest) {
			const waterfall = ctx.waterfall;
			return waterfall(carrier, name, fused(payload), ...rest);
		}
	};
}
/**
* Emit one contained agent notification without allocating a retained dispatcher.
* @param ctx - the context to dispatch through.
* @param agent - the subject agent and scope key.
* @param name - the agent-subject event to emit.
* @param payload - the event's payload fields; `agent` is injected.
*/
function emitAgentEvent(ctx, agent, name, payload) {
	agentEvents(ctx, agent).emit(name, payload);
}
/**
* Build the prompt assembly context with agent and scope set together, so
* agent-scoped prompt and tool contributions cannot be silently omitted.
* @param agent - the agent the assembly is for.
* @param signal - the current turn's explicit control signal, when assembly belongs to a turn.
* @returns the context to pass to `assemble()`.
*/
function assembleContextFor(agent, signal) {
	return {
		agent,
		scope: agent,
		...signal === void 0 ? {} : { signal }
	};
}
//#endregion
//#region lib/types/index.js
/**
* Agent service: live registry, factory delegation, and process-local
* initiator scope. Concrete creation and driving belong to the loop.
*
* @module @deepseek-ai/dsh-agent
*/
/** Thrown when create/resume is called before an agent factory is registered. */
const NO_FACTORY_MESSAGE = "no agent factory registered (load an agent-loop plugin)";
const NO_INITIATOR_MESSAGE = "no initiating agent is active";
const DISPOSED_INITIATOR_MESSAGE = "agent initiator scope is disposed";
/**
* Agent service (`ctx.agents`): tracks live agents and carries the initiating
* Agent through one process-local asynchronous driver chain. Agent *creation*
* is provided by whichever plugin implements the {@link AgentFactory}
* (`@deepseek-ai/dsh-agent-loop`), registered via {@link setFactory}.
*
* Initiator methods provide same-process causal attribution only. Ambient
* presence is neither liveness proof nor authorization; subjects and owners
* remain explicit, as does identity at worker, process, persistence, and wire
* boundaries. Returned Promise boundaries drain during teardown, except a
* nested lineage that starts an owning-fiber unload is excluded from its own drain.
*/
var AgentRegistry = class extends Service {
	store = /* @__PURE__ */ new Map();
	factory;
	initiators = new AsyncLocalStorage();
	initiatorRuns = new AsyncLocalStorage();
	initiatorState = "active";
	activeInitiatorRuns = 0;
	initiatorDrain;
	initiatorDisposal;
	constructor(ctx) {
		super(ctx, "agents");
		ctx.inject(["typert"], (typeCtx) => {
			typeCtx.typert.lookups.register("agent", {
				parameter: "agent",
				wire: "agentId",
				hostTypeSymbol: "@deepseek-ai/dsh-agent#Agent",
				wireTypeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
				resolve: (sessionId) => this.get(sessionId)
			});
			typeCtx.typert.contexts.registerHost("agent", {
				wire: "agentId",
				wireTypeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
				resolve: (sessionId) => this.get(sessionId)?.ctx
			});
		});
		ctx.accessor("agent", { get: () => void 0 });
		ctx.on("internal/status", (fiber) => {
			if (fiber.state === 5 && this.hasLifecycleAncestor(fiber)) this.closeInitiators();
		});
		ctx.effect(function* () {
			yield () => this.disposeInitiators();
			yield () => {
				this.closeInitiators();
			};
		}.bind(this), "agents.initiatorLifecycle()");
	}
	/**
	* Read the Agent that initiated the inherited asynchronous driver chain.
	* Use this optional form for logging, tracing, metrics, or host attribution
	* that also supports agentless calls. When a parent creates a child, setup
	* reports the causal parent while `agentCtx.agent` identifies the child.
	* @returns the inherited Agent, or `undefined` outside an initiator boundary
	*   and inside an explicit clearing boundary.
	* @throws when this service instance has been disposed.
	*/
	currentInitiator() {
		this.assertInitiatorsReadable();
		return this.initiators.getStore();
	}
	/**
	* Read the initiating Agent and fail when no initiator boundary is active.
	* Use this for private helpers contractually below a driver, or for a
	* deployment-owned outbound request whose contract forbids agentless calls.
	* Generic or direct-call paths use optional lookup or explicit request fields.
	* @returns the inherited Agent.
	* @throws when no initiator is active or this service instance has been disposed.
	*/
	requireInitiator() {
		const agent = this.currentInitiator();
		if (agent === void 0) throw new Error(NO_INITIATOR_MESSAGE);
		return agent;
	}
	/**
	* Run an operation with one exact Agent as its process-local initiator. The
	* exact synchronous value or Promise returned by the operation is preserved.
	* Custom drivers and test harnesses wrap their complete returned foreground
	* lifetime.
	* A queue or wire receiver may establish this boundary only after validating
	* explicit identity and resolving the exact live Agent; this method does neither.
	* Detached work remains owned by the subsystem that starts it.
	* @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
	* @param operation - synchronous or asynchronous operation to invoke.
	* @returns the exact value returned by `operation`.
	* @throws when the initiator scope is closing/disposed, or when `operation` throws.
	*/
	withInitiator(agent, operation) {
		return this.runWithInitiator(agent, operation);
	}
	/**
	* Run an operation inside a boundary that hides any inherited initiating
	* Agent. The exact synchronous value or Promise is preserved.
	* Use this while creating lazy shared timers, queue pumps, pool maintenance,
	* watchers, or exporters so they do not inherit the first Agent that happens
	* to initialize them. It clears only initiator attribution, not explicit
	* fields, and does not own or drain detached resources.
	* @param operation - synchronous or asynchronous operation to invoke without an initiator.
	* @returns the exact value returned by `operation`.
	* @throws when the initiator scope is closing/disposed, or when `operation` throws.
	*/
	withoutInitiator(operation) {
		return this.runWithInitiator(void 0, operation);
	}
	/**
	* Register the agent-creation factory (the loop calls this on construction,
	* effect-scoped). A traced Cordis service is canonicalized to its concrete
	* target; each create/resume call is then traced through that caller's
	* context so ownership follows the caller without stacking proxy layers.
	* Throws if a factory is already registered. Returns the disposer; on
	* dispose the factory slot is cleared.
	* @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
	* @returns the disposer that clears the factory slot. The exact
	*   Cordis effect disposer (single-shot): composite (generator) effects may
	*   yield it directly — exact identity nests the teardown in order.
	*/
	setFactory(factory) {
		return this.ctx.effect(() => {
			if (this.factory !== void 0) throw new Error("an agent factory is already registered");
			const target = factory[symbols.original] ?? factory;
			this.factory = { target };
			return () => {
				this.factory = void 0;
			};
		}, "agents.setFactory()");
	}
	/** Return the active creation factory. */
	requireFactory() {
		if (this.factory === void 0) throw new Error(NO_FACTORY_MESSAGE);
		return this.factory;
	}
	/**
	* Create and publish a new agent through the registered factory.
	* Distinct from {@link register} (which records an already-constructed
	* agent): this constructs the agent and its session. Rejects if no factory is
	* registered or creation/setup fails. The resolved {@link AgentHandle} lets
	* the owner tear down exactly this agent.
	* @param options - shared identity, session seed/metadata, and agent options.
	* @returns the handle after setup, rollback-covered publication, and loop start complete.
	*/
	async create(options) {
		const ownerCtx = this.ctx;
		const { target } = this.requireFactory();
		const receiver = getTraceable(ownerCtx, target);
		return Reflect.apply(target.createAgent, receiver, [ownerCtx, options]);
	}
	/**
	* Load a persisted session and resume an agent on it through the registered
	* factory. Rejects if no factory is registered; the factory rejects if
	* session persistence is not configured or persistence/setup fails.
	* @param options - persisted identity, configuration, and optional setup.
	* @returns the handle after setup, rollback-covered publication, and loop start complete.
	*/
	async resume(options) {
		const ownerCtx = this.ctx;
		const { target } = this.requireFactory();
		const receiver = getTraceable(ownerCtx, target);
		return Reflect.apply(target.resume, receiver, [ownerCtx, options]);
	}
	/**
	* Register a live agent. Throws if an agent with the same id is already
	* registered. Emits `agent/created` on registration and `agent/disposed`
	* when the calling fiber is disposed — both with the agent's scope carrier
	* (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
	* emits are scope-filtered regardless of which context invoked `register`
	* (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
	* requires passing the carrier). Returns the disposer.
	* @param agent - the already-constructed agent to record in the store.
	* @returns the EXACT Cordis effect disposer (single-shot; a repeat call
	*   returns undefined without awaiting an in-flight teardown). Exact
	*   identity is load-bearing: a composite (generator) effect that owns a
	*   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
	*   function so Cordis nests the unregistration at that yield position;
	*   yielding a wrapper would leave it disposing as a concurrent sibling on
	*   owner unload, unregistering the agent (and emitting `agent/disposed`)
	*   while its final turn is still draining.
	*/
	register(agent) {
		return this.ctx.effect(function* () {
			yield this.enter(agent, this.ctx.agent);
			this.announce(agent);
		}.bind(this), "agents.register()");
	}
	/**
	* Insert an already-constructed agent without announcing it. This is the
	* advanced ordered-lifecycle primitive used by the async agent factory: it
	* first completes setup while the agent is unpublished, then assigns the
	* returned detach closure into its pre-installed composite teardown before
	* calling {@link announce}. Ordinary callers use {@link register}.
	* @param agent - the prepared, unpublished agent.
	* @param owner - live agent whose scoped context created this agent, or
	*   undefined for a top-level runtime root. This is runtime ownership, not
	*   the resumed session's durable parent lineage.
	* @returns an idempotent closure that removes this exact entry and emits
	*   `agent/disposed` with listener failures contained. When called from a
	*   synchronous `agent/created` listener, removal and disposal wait until
	*   that creation dispatch unwinds.
	*/
	enter(agent, owner) {
		const id = agent.id;
		if (id !== agent.session.id) throw new Error(`agent id "${id}" does not match session id "${agent.session.id}"`);
		const carrier = scopeTarget(agent, agent);
		if (this.store.has(id)) throw new Error(`agent "${id}" is already registered`);
		const entry = {
			id,
			agent,
			owner,
			carrier,
			announced: false,
			announcing: false,
			detachRequested: false
		};
		this.store.set(id, entry);
		let entered = true;
		const detach = () => {
			if (!entered) return;
			entered = false;
			if (entry.announcing) {
				entry.detachRequested = true;
				return;
			}
			this.detachEntered(entry);
		};
		return detach;
	}
	/** Remove one exact entered agent and emit its paired disposal when announced. */
	detachEntered(entry) {
		entry.detachRequested = false;
		/* v8 ignore next -- enter() rejects replacement while this single-shot detach capability is live. */
		if (this.store.get(entry.id) !== entry) return;
		this.store.delete(entry.id);
		if (!entry.announced) return;
		this.emitDisposed(entry);
	}
	/** Emit the paired disposal edge through the entry's stable carrier. */
	emitDisposed(entry) {
		const args = [
			entry.carrier,
			"agent/disposed",
			{ agent: entry.agent }
		];
		for (const callback of this.ctx.events.dispatch("emit", args)) try {
			const returned = callback(...args);
			Promise.resolve(returned).catch((error) => {
				this.ctx.logger.warn(`agent "${entry.id}": agent/disposed listener rejected: ${String(error)}`);
			});
		} catch (error) {
			this.ctx.logger.warn(`agent "${entry.id}": agent/disposed listener threw: ${String(error)}`);
		}
	}
	/**
	* Announce an agent previously inserted with {@link enter}.
	* @param agent - the live inserted agent to announce.
	* @throws if `agent` is not the exact live registry entry for its id, or its
	*   creation announcement already began (including a reentrant call from a
	*   creation listener).
	*/
	announce(agent) {
		const entry = this.store.get(agent.id);
		if (entry === void 0 || entry.agent !== agent) throw new Error(`agent "${agent.id}" is not live in this registry`);
		if (entry.announced || entry.announcing) throw new Error(`agent "${entry.id}" was already announced`);
		entry.announcing = true;
		entry.announced = true;
		const args = [
			entry.carrier,
			"agent/created",
			{ agent: entry.agent }
		];
		try {
			for (const callback of this.ctx.events.dispatch("emit", args)) {
				const returned = callback(...args);
				Promise.resolve(returned).catch((error) => {
					this.ctx.logger.warn(`agent "${entry.id}": agent/created listener rejected: ${String(error)}`);
				});
			}
		} finally {
			entry.announcing = false;
			if (entry.detachRequested) this.detachEntered(entry);
		}
	}
	/**
	* Look up a live agent.
	* @param id - the shared agent/session id to look up.
	* @returns the agent, or undefined when no live agent has that id.
	*/
	get(id) {
		return this.store.get(id)?.agent;
	}
	/**
	* Test whether a live agent was created through one exact parent agent's
	* scoped context. Runtime ownership is independent of durable session
	* lineage and remains unambiguous when unrelated providers reuse an id.
	* @param id - the candidate child agent's shared agent/session id.
	* @param owner - the expected runtime creator agent.
	* @returns true only while the exact child entry is live under that owner.
	*/
	isOwnedBy(id, owner) {
		return this.store.get(id)?.owner === owner;
	}
	/**
	* All live agents, in registration order.
	* @returns a fresh array; mutating it does not affect the registry.
	*/
	list() {
		return [...this.store.values()].map((entry) => entry.agent);
	}
	/**
	* All live top-level agents in registration order. A top-level agent was
	* created without an owning agent context; durable session lineage does not
	* affect this runtime relation, so a resumed fork may still be a root.
	* @returns a fresh array; mutating it does not affect the registry.
	*/
	roots() {
		return [...this.store.values()].filter((entry) => entry.owner === void 0).map((entry) => entry.agent);
	}
	/** Reject new initiator boundaries while inherited continuations drain. */
	closeInitiators() {
		if (this.initiatorState === "active") this.initiatorState = "closing";
	}
	/** Wait for returned-Promise boundaries, then invalidate retained references. */
	disposeInitiators() {
		return this.initiatorDisposal ??= (async () => {
			this.closeInitiators();
			this.releaseReentrantInitiatorRuns();
			if (this.activeInitiatorRuns !== 0) {
				this.initiatorDrain ??= Promise.withResolvers();
				await this.initiatorDrain.promise;
			}
			this.initiatorState = "disposed";
			this.initiators.disable();
			this.initiatorRuns.disable();
		})();
	}
	/** Establish one tracked initiator or clearing boundary. */
	runWithInitiator(agent, operation) {
		if (this.initiatorState !== "active") throw new Error(DISPOSED_INITIATOR_MESSAGE);
		const run = {
			active: true,
			parent: this.initiatorRuns.getStore()
		};
		this.activeInitiatorRuns += 1;
		let result;
		try {
			result = this.initiatorRuns.run(run, () => this.initiators.run(agent, operation));
		} catch (error) {
			this.releaseInitiatorRun(run);
			throw error;
		}
		if (isPromise(result)) try {
			Promise.prototype.then.call(result, () => {
				this.releaseInitiatorRun(run);
			}, () => {
				this.releaseInitiatorRun(run);
			});
		} catch {
			this.releaseInitiatorRun(run);
		}
		else this.releaseInitiatorRun(run);
		return result;
	}
	/** Whether one unloading fiber owns this service's lifecycle. */
	hasLifecycleAncestor(candidate) {
		let fiber = this.ctx.fiber;
		while (true) {
			if (fiber === candidate) return true;
			const parent = fiber.parent.fiber;
			if (parent === fiber) return false;
			fiber = parent;
		}
	}
	assertInitiatorsReadable() {
		if (this.initiatorState === "disposed") throw new Error(DISPOSED_INITIATOR_MESSAGE);
	}
	/** Exclude the boundary chain that initiated this teardown from its own drain. */
	releaseReentrantInitiatorRuns() {
		let run = this.initiatorRuns.getStore();
		while (run !== void 0) {
			this.releaseInitiatorRun(run);
			run = run.parent;
		}
	}
	releaseInitiatorRun(run) {
		if (!run.active) return;
		run.active = false;
		this.activeInitiatorRuns -= 1;
		if (this.activeInitiatorRuns !== 0) return;
		this.initiatorDrain?.resolve();
		this.initiatorDrain = void 0;
	}
};
//#endregion
export { AgentRegistry, AgentRegistry as default, Inbox, agentCarrier, agentEvents, assembleContextFor, emitAgentEvent, foldConsumedWork, installModelSelection };
