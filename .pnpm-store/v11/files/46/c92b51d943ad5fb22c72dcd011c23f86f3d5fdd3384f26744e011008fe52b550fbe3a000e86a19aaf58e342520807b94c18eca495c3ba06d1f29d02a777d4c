/**
 * Agent service: live registry, factory delegation, and process-local
 * initiator scope. Concrete creation and driving belong to the loop.
 *
 * @module @deepseek-ai/dsh-agent
 */
import { getTraceable, Service, symbols } from '@deepseek-ai/cordis';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isPromise } from 'node:util/types';
import { scopeTarget } from '@deepseek-ai/dsh-scope';
export * from "./runtime-types.js";
export * from "./types.js";
export * from "./inbox.js";
export * from "./consumed-work.js";
export * from "./model-selection.js";
export { agentCarrier, agentEvents, assembleContextFor, emitAgentEvent } from "./dispatch.js";
/** Thrown when create/resume is called before an agent factory is registered. */
const NO_FACTORY_MESSAGE = 'no agent factory registered (load an agent-loop plugin)';
const NO_INITIATOR_MESSAGE = 'no initiating agent is active';
const DISPOSED_INITIATOR_MESSAGE = 'agent initiator scope is disposed';
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
export class AgentRegistry extends Service {
    store = new Map();
    factory;
    initiators = new AsyncLocalStorage();
    initiatorRuns = new AsyncLocalStorage();
    initiatorState = 'active';
    activeInitiatorRuns = 0;
    initiatorDrain;
    initiatorDisposal;
    constructor(ctx) {
        super(ctx, 'agents');
        ctx.inject(['typert'], (typeCtx) => {
            typeCtx.typert.lookups.register('agent', {
                parameter: 'agent',
                wire: 'agentId',
                hostTypeSymbol: '@deepseek-ai/dsh-agent#Agent',
                wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
                resolve: sessionId => this.get(sessionId),
            });
            typeCtx.typert.contexts.registerHost('agent', {
                wire: 'agentId',
                wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
                resolve: sessionId => this.get(sessionId)?.ctx,
            });
        });
        // The `ctx.agent` DX accessor: default `undefined` on every context, so a
        // plain plugin context reads cleanly instead of hitting the Cordis
        // unknown-property throw. Each Agent.ctx shadows it with an own property
        // (own properties resolve before the context proxy is consulted), so the
        // accessor body never needs to resolve a scope itself. Effect-scoped:
        // unwinds with this service's fiber.
        ctx.accessor('agent', { get: () => undefined });
        ctx.on('internal/status', (fiber) => {
            if (fiber.state === 5 /* FiberState.UNLOADING */ && this.hasLifecycleAncestor(fiber)) {
                this.closeInitiators();
            }
        });
        ctx.effect(function* () {
            yield () => this.disposeInitiators();
            yield () => { this.closeInitiators(); };
        }.bind(this), 'agents.initiatorLifecycle()');
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
        if (agent === undefined)
            throw new Error(NO_INITIATOR_MESSAGE);
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
        return this.runWithInitiator(undefined, operation);
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
        const dispose = this.ctx.effect(() => {
            if (this.factory !== undefined)
                throw new Error('an agent factory is already registered');
            // Avoid stacking two Cordis shadow layers when a caller passes a Service
            // already read through a context. Calls are re-traced through their
            // actual owner context below.
            const target = factory[symbols.original] ?? factory;
            this.factory = { target };
            return () => { this.factory = undefined; };
        }, 'agents.setFactory()');
        // The exact cordis effect disposer (the agents.register() convention): a
        // caller's composite effect can yield it for in-order teardown; the
        // loop's constructor effect returns it directly, identity-nesting the
        // registration under that effect.
        // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
        return dispose;
    }
    /** Return the active creation factory. */
    requireFactory() {
        if (this.factory === undefined)
            throw new Error(NO_FACTORY_MESSAGE);
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
        // Re-trace a Service-backed factory through the accessing context
        // explicitly. This preserves AgentLoop's dependency origin while binding
        // its effects to ownerCtx; plain factories receive ownerCtx as an explicit
        // capability and need no Cordis tracker magic.
        const { target } = this.requireFactory();
        const receiver = getTraceable(ownerCtx, target);
        // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply intentionally supplies the caller-traced receiver
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
        // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply intentionally supplies the caller-traced receiver
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
        const dispose = this.ctx.effect(function* () {
            yield this.enter(agent, this.ctx.agent);
            this.announce(agent);
        }.bind(this), 'agents.register()');
        // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
        return dispose;
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
        if (id !== agent.session.id) {
            throw new Error(`agent id "${id}" does not match session id "${agent.session.id}"`);
        }
        const carrier = scopeTarget(agent, agent);
        // This is the authoritative collision boundary. Concurrent create/resume
        // operations may both prepare, but only one exact entry can publish.
        if (this.store.has(id))
            throw new Error(`agent "${id}" is already registered`);
        const entry = {
            id,
            agent,
            owner,
            carrier,
            announced: false,
            announcing: false,
            detachRequested: false,
        };
        this.store.set(id, entry);
        let entered = true;
        const detach = () => {
            if (!entered)
                return;
            entered = false;
            // Every callback reached by this creation dispatch must observe the same
            // live entry, and disposal must follow creation. A listener may own
            // the advanced detach capability, so make that ordering structural:
            // visibility and the paired disposal are deferred until announce()'s
            // synchronous dispatch has unwound.
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
        // A stale capability can never delete a later same-id lifecycle. The
        // captured entry identity is the final boundary.
        /* v8 ignore next -- enter() rejects replacement while this single-shot detach capability is live. */
        if (this.store.get(entry.id) !== entry)
            return;
        this.store.delete(entry.id);
        // An insertion rolled back before announce was never externally created,
        // so emitting disposed would invent an impossible lifecycle edge. Marking
        // happens before the created emit: if a later created listener throws,
        // earlier listeners may already have observed it and must see disposal.
        if (!entry.announced)
            return;
        this.emitDisposed(entry);
    }
    /** Emit the paired disposal edge through the entry's stable carrier. */
    emitDisposed(entry) {
        const args = [entry.carrier, 'agent/disposed', { agent: entry.agent }];
        for (const callback of this.ctx.events.dispatch('emit', args)) {
            try {
                const returned = callback(...args);
                void Promise.resolve(returned).catch((error) => {
                    this.ctx.logger.warn(`agent "${entry.id}": agent/disposed listener rejected: ${String(error)}`);
                });
            }
            catch (error) {
                this.ctx.logger.warn(`agent "${entry.id}": agent/disposed listener threw: ${String(error)}`);
            }
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
        if (entry === undefined || entry.agent !== agent) {
            throw new Error(`agent "${agent.id}" is not live in this registry`);
        }
        if (entry.announced || entry.announcing) {
            throw new Error(`agent "${entry.id}" was already announced`);
        }
        // Mark before dispatch so a listener cannot recursively create a second
        // lifecycle edge; detach still pairs a partially delivered first edge.
        entry.announcing = true;
        entry.announced = true;
        const args = [entry.carrier, 'agent/created', { agent: entry.agent }];
        try {
            for (const callback of this.ctx.events.dispatch('emit', args)) {
                // A synchronous creation failure vetoes publication and rolls back.
                // Returned-promise rejection happens after this synchronous boundary, so
                // observe and report it instead of leaking an unhandled rejection.
                const returned = callback(...args);
                void Promise.resolve(returned).catch((error) => {
                    this.ctx.logger.warn(`agent "${entry.id}": agent/created listener rejected: ${String(error)}`);
                });
            }
        }
        finally {
            entry.announcing = false;
            if (entry.detachRequested)
                this.detachEntered(entry);
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
        return [...this.store.values()].map(entry => entry.agent);
    }
    /**
     * All live top-level agents in registration order. A top-level agent was
     * created without an owning agent context; durable session lineage does not
     * affect this runtime relation, so a resumed fork may still be a root.
     * @returns a fresh array; mutating it does not affect the registry.
     */
    roots() {
        return [...this.store.values()]
            .filter(entry => entry.owner === undefined)
            .map(entry => entry.agent);
    }
    /** Reject new initiator boundaries while inherited continuations drain. */
    closeInitiators() {
        if (this.initiatorState === 'active')
            this.initiatorState = 'closing';
    }
    /** Wait for returned-Promise boundaries, then invalidate retained references. */
    disposeInitiators() {
        return (this.initiatorDisposal ??= (async () => {
            this.closeInitiators();
            this.releaseReentrantInitiatorRuns();
            if (this.activeInitiatorRuns !== 0) {
                this.initiatorDrain ??= Promise.withResolvers();
                await this.initiatorDrain.promise;
            }
            this.initiatorState = 'disposed';
            this.initiators.disable();
            this.initiatorRuns.disable();
        })());
    }
    /** Establish one tracked initiator or clearing boundary. */
    runWithInitiator(agent, operation) {
        if (this.initiatorState !== 'active')
            throw new Error(DISPOSED_INITIATOR_MESSAGE);
        const run = {
            active: true,
            parent: this.initiatorRuns.getStore(),
        };
        this.activeInitiatorRuns += 1;
        let result;
        try {
            result = this.initiatorRuns.run(run, () => this.initiators.run(agent, operation));
        }
        catch (error) {
            this.releaseInitiatorRun(run);
            throw error;
        }
        if (isPromise(result)) {
            try {
                void Promise.prototype.then.call(result, () => { this.releaseInitiatorRun(run); }, () => { this.releaseInitiatorRun(run); });
            }
            catch {
                // A branded Promise may expose a failing @@species. Observer setup did
                // not attach, so preserve the exact return without leaking the run.
                this.releaseInitiatorRun(run);
            }
        }
        else {
            this.releaseInitiatorRun(run);
        }
        return result;
    }
    /** Whether one unloading fiber owns this service's lifecycle. */
    hasLifecycleAncestor(candidate) {
        let fiber = this.ctx.fiber;
        while (true) {
            if (fiber === candidate)
                return true;
            const parent = fiber.parent.fiber;
            if (parent === fiber)
                return false;
            fiber = parent;
        }
    }
    assertInitiatorsReadable() {
        if (this.initiatorState === 'disposed')
            throw new Error(DISPOSED_INITIATOR_MESSAGE);
    }
    /** Exclude the boundary chain that initiated this teardown from its own drain. */
    releaseReentrantInitiatorRuns() {
        let run = this.initiatorRuns.getStore();
        while (run !== undefined) {
            this.releaseInitiatorRun(run);
            run = run.parent;
        }
    }
    releaseInitiatorRun(run) {
        if (!run.active)
            return;
        run.active = false;
        this.activeInitiatorRuns -= 1;
        if (this.activeInitiatorRuns !== 0)
            return;
        this.initiatorDrain?.resolve();
        this.initiatorDrain = undefined;
    }
}
export default AgentRegistry;
//# sourceMappingURL=index.js.map