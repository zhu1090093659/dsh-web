/**
 * Agent service: live registry, factory delegation, and process-local
 * initiator scope. Concrete creation and driving belong to the loop.
 *
 * @module @deepseek-ai/dsh-agent
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { TypertContext, TypertLookup } from '@deepseek-ai/dsh-typert-protocol';
import type { Agent, AgentOptions } from './runtime-types.ts';
export * from './runtime-types.ts';
export * from './types.ts';
export * from './inbox.ts';
export * from './consumed-work.ts';
export * from './model-selection.ts';
export { agentCarrier, agentEvents, assembleContextFor, emitAgentEvent } from './dispatch.ts';
export type { AgentEventDispatch, AgentSubjectEvent } from './dispatch.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertLookupMap {
        agent: TypertLookup<Agent, SessionId>;
    }
    interface TypertContextMap {
        agent: TypertContext<SessionId>;
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        agents: AgentRegistry;
        /**
         * The agent association installed as an own property on `Agent.ctx`, or
         * `undefined` on a plain context. Contexts derived from `Agent.ctx` inherit
         * the association; a deliberately nested scope may carry a nearer
         * `dsh-scope` tag while retaining it, so this field is DX context rather
         * than the scope resolver. {@link AgentRegistry} registers a root accessor
         * defaulting to `undefined`, and core packages below the agent layer use
         * `scopeOf()` for layer selection instead of reading this field.
         */
        agent?: Agent;
    }
}
/**
 * Synchronous finalizer returned by unpublished Agent setup when its
 * contributions need validation at the exact publication commit point.
 */
export interface AgentSetupCommit {
    /**
     * Validate and commit the prepared setup immediately before publication.
     * @throws when publication must roll the unpublished Agent back.
     */
    commit(): void;
}
/**
 * Compose an unpublished Agent scope and optionally return its publication commit.
 * @param agentCtx - unpublished Agent scope.
 * @returns an optional synchronous commit invoked after setup awaits settle and immediately before publication.
 */
export type AgentSetup = (agentCtx: Context) => AgentSetupCommit | Promise<AgentSetupCommit | void> | void;
/**
 * Options for programmatically creating an agent through the registry factory
 * ({@link AgentRegistry.create}). The caller supplies the single live
 * `sessionId` shared by the agent registry and session log (e.g. an
 * ACP-generated id), plus optional session metadata (the validated `cwd`, fork
 * lineage); the factory creates the session and agent under that identity.
 */
export interface CreateAgentOptions {
    /** The live agent/session identity. */
    readonly sessionId: SessionId;
    /**
     * Session creation metadata: validated absolute `cwd`, `parentSession`
     * fork lineage, the `seedLength` seed boundary, the coarse `origin`
     * classification, and the `delegationDepth` recursion budget. Mirrors the
     * `cwd`/`parentSession`/`seedLength`/`origin`/`delegationDepth` fields of
     * {@link CreateSessionOptions.meta} in dsh-session (the internal-only
     * `createdAt`, used when reconstructing a persisted session, is deliberately
     * excluded — a factory caller never sets it). This is durable session data,
     * so the session boundary validates and snapshots it before asynchronous
     * setup begins.
     */
    readonly meta?: {
        readonly cwd?: string;
        readonly parentSession?: SessionId;
        readonly seedLength?: number;
        readonly origin?: 'subagent';
        readonly delegationDepth?: number;
        readonly agentPreset?: string;
    };
    /**
     * Initial replay/fork history. A fork supplies a balanced completed-turn
     * prefix of the parent's log. The complete seed must be contiguous from seq
     * 0, carry only lossless-JSON data, and contain no open turn/step or dangling
     * tool call. The factory passes it to the session's durable
     * validator/snapshot boundary before publication.
     */
    readonly seed?: readonly SessionEvent[];
    /** Per-agent options (model, …). */
    readonly agentOptions?: AgentOptions;
    /** Optional creation-only cancellation signal; detached before the returned handle becomes visible. */
    readonly signal?: AbortSignal;
    /**
     * Creation-time composition of the agent's scoped world. The factory awaits
     * setup after minting `agentCtx` but BEFORE inserting or announcing either
     * the session or agent, so observers can never see a partially configured
     * world. Setup may return an {@link AgentSetupCommit}; the factory invokes its
     * synchronous `commit()` after every setup await settles and immediately
     * before registry publication. This lets mutable provisioning revalidate at
     * the exact publication boundary. Everything registered through `agentCtx`
     * (scoped tools, prompt sections/variables, `restrict()`, listeners, awaited
     * child plugins) exists before `session/created`, `agent/created`,
     * `agent/session-start`, and the first prompt assembly. A setup
     * throw/rejection, commit throw, or owner disposal rolls the scope back
     * without publishing either id.
     *
     * **Setup composes, it never drives**: the callback is trusted same-process
     * code and receives the full scoped context, so this is a contract rather
     * than a runtime restriction. Drive the agent only after creation resolves.
     */
    readonly setup?: AgentSetup;
}
/**
 * Options for resuming an agent on a persisted session
 * ({@link AgentRegistry.resume}).
 */
export interface ResumeAgentOptions {
    /** The persisted session id to load and use as the live agent/session identity. */
    readonly resumeSessionId: SessionId;
    /** Per-agent options (model, …). */
    readonly agentOptions?: AgentOptions;
    /** Optional creation-only cancellation signal for persistence load/setup; detached before return. */
    readonly signal?: AbortSignal;
    /**
     * Resume-time composition of the agent's fresh scoped world. Persistence is
     * loaded first; the factory then mints `agentCtx` and awaits setup while the
     * reconstructed session and agent remain unpublished. The callback has the
     * same trusted composition-only contract and optional synchronous
     * publication commit as {@link CreateAgentOptions.setup}: all registrations
     * exist before either creation announcement, and rejection, commit failure,
     * or owner disposal rolls the transaction back without publishing either id.
     */
    readonly setup?: AgentSetup;
}
/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
export interface AgentHandle {
    agent: Agent;
    dispose(): Promise<void>;
}
/**
 * The agent-creation factory the loop implementation provides to the registry
 * via {@link AgentRegistry.setFactory}. Kept on the `dsh-agent` interface so
 * consumers (e.g. the ACP bridge) program against `ctx.agents` without
 * depending on the concrete `dsh-agent-loop` package.
 */
export interface AgentFactory {
    /**
     * Create a new agent on a caller-supplied session id. Async because creation
     * awaits unpublished setup, invokes its optional synchronous commit, inserts
     * both session and agent, emits their creation notifications in order, emits
     * `agent/session-start`, and only then starts the loop. The sequence is
     * rollback-covered, but notifications delivered before a later listener
     * failure remain observable; every agent or session creation announcement
     * that began is paired by `agent/disposed` or `session/disposed` during
     * rollback. The owner disposes the resolved handle to stop/drain,
     * unregister, remove the session, and unwind the scope.
     * The registry passes a context carrying the `create()` caller's fiber and
     * scope as `ownerCtx`. The implementation attaches the unpublished
     * transaction and resulting lifecycle to that owner; it must not infer
     * ownership from the factory object's registration context.
     * @param ownerCtx - caller-bound context that owns the transaction and live handle.
     * @param options - agent/session identity, configuration, and optional setup.
     * @returns the owned handle after setup, both announcements, and loop start complete.
     */
    createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>;
    /**
     * Prepare a persisted session and resume an agent on it. Async because it awaits
     * both `ctx.sessionPersistence.prepare` and the optional unpublished setup
     * transaction; must be called after that service exists (consumers inject
     * `sessionPersistence`). Publication follows the same setup-commit and
     * ordered boundary as {@link createAgent}.
     * @param ownerCtx - caller-bound context that owns load, setup, and the live handle.
     * @param options - persisted identity, configuration, and optional setup.
     * @returns the owned handle after setup, both announcements, and loop start complete.
     */
    resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>;
}
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
export declare class AgentRegistry extends Service {
    private store;
    private factory;
    private readonly initiators;
    private readonly initiatorRuns;
    private initiatorState;
    private activeInitiatorRuns;
    private initiatorDrain;
    private initiatorDisposal;
    constructor(ctx: Context);
    /**
     * Read the Agent that initiated the inherited asynchronous driver chain.
     * Use this optional form for logging, tracing, metrics, or host attribution
     * that also supports agentless calls. When a parent creates a child, setup
     * reports the causal parent while `agentCtx.agent` identifies the child.
     * @returns the inherited Agent, or `undefined` outside an initiator boundary
     *   and inside an explicit clearing boundary.
     * @throws when this service instance has been disposed.
     */
    currentInitiator(): Agent | undefined;
    /**
     * Read the initiating Agent and fail when no initiator boundary is active.
     * Use this for private helpers contractually below a driver, or for a
     * deployment-owned outbound request whose contract forbids agentless calls.
     * Generic or direct-call paths use optional lookup or explicit request fields.
     * @returns the inherited Agent.
     * @throws when no initiator is active or this service instance has been disposed.
     */
    requireInitiator(): Agent;
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
    withInitiator<T>(agent: Agent, operation: () => T): T;
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
    withoutInitiator<T>(operation: () => T): T;
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
    setFactory(factory: AgentFactory): () => void;
    /** Return the active creation factory. */
    private requireFactory;
    /**
     * Create and publish a new agent through the registered factory.
     * Distinct from {@link register} (which records an already-constructed
     * agent): this constructs the agent and its session. Rejects if no factory is
     * registered or creation/setup fails. The resolved {@link AgentHandle} lets
     * the owner tear down exactly this agent.
     * @param options - shared identity, session seed/metadata, and agent options.
     * @returns the handle after setup, rollback-covered publication, and loop start complete.
     */
    create(options: CreateAgentOptions): Promise<AgentHandle>;
    /**
     * Load a persisted session and resume an agent on it through the registered
     * factory. Rejects if no factory is registered; the factory rejects if
     * session persistence is not configured or persistence/setup fails.
     * @param options - persisted identity, configuration, and optional setup.
     * @returns the handle after setup, rollback-covered publication, and loop start complete.
     */
    resume(options: ResumeAgentOptions): Promise<AgentHandle>;
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
    register(agent: Agent): () => void;
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
    enter(agent: Agent, owner: Agent | undefined): () => void;
    /** Remove one exact entered agent and emit its paired disposal when announced. */
    private detachEntered;
    /** Emit the paired disposal edge through the entry's stable carrier. */
    private emitDisposed;
    /**
     * Announce an agent previously inserted with {@link enter}.
     * @param agent - the live inserted agent to announce.
     * @throws if `agent` is not the exact live registry entry for its id, or its
     *   creation announcement already began (including a reentrant call from a
     *   creation listener).
     */
    announce(agent: Agent): void;
    /**
     * Look up a live agent.
     * @param id - the shared agent/session id to look up.
     * @returns the agent, or undefined when no live agent has that id.
     */
    get(id: SessionId): Agent | undefined;
    /**
     * Test whether a live agent was created through one exact parent agent's
     * scoped context. Runtime ownership is independent of durable session
     * lineage and remains unambiguous when unrelated providers reuse an id.
     * @param id - the candidate child agent's shared agent/session id.
     * @param owner - the expected runtime creator agent.
     * @returns true only while the exact child entry is live under that owner.
     */
    isOwnedBy(id: SessionId, owner: Agent): boolean;
    /**
     * All live agents, in registration order.
     * @returns a fresh array; mutating it does not affect the registry.
     */
    list(): Agent[];
    /**
     * All live top-level agents in registration order. A top-level agent was
     * created without an owning agent context; durable session lineage does not
     * affect this runtime relation, so a resumed fork may still be a root.
     * @returns a fresh array; mutating it does not affect the registry.
     */
    roots(): Agent[];
    /** Reject new initiator boundaries while inherited continuations drain. */
    private closeInitiators;
    /** Wait for returned-Promise boundaries, then invalidate retained references. */
    private disposeInitiators;
    /** Establish one tracked initiator or clearing boundary. */
    private runWithInitiator;
    /** Whether one unloading fiber owns this service's lifecycle. */
    private hasLifecycleAncestor;
    private assertInitiatorsReadable;
    /** Exclude the boundary chain that initiated this teardown from its own drain. */
    private releaseReentrantInitiatorRuns;
    private releaseInitiatorRun;
}
export default AgentRegistry;
//# sourceMappingURL=index.d.ts.map