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
import { Context, Service } from '@deepseek-ai/cordis';
import type { Scoped } from '@deepseek-ai/dsh-scope';
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SubagentProvider, SubagentRun, SubagentRunEndInfo, SubagentRunInfo, SubagentStartRequest } from './types.ts';
import type { ContinuableStart, ContinuableStartSpec, SubagentFollowupOptions, SubagentInterruptAuthority, SubagentReportOptions } from './continuation.ts';
import type { ContinuableSetupContribution } from './activation-setup-registry.ts';
import type { SubagentDescendantListEntry, SubagentListEntry } from './list-children.ts';
export * from './out-of-process.ts';
export { AssistantOutputFold, finalAssistantOutput } from './assistant-output.ts';
export { SubagentRunId } from './types.ts';
export type { ContinuableCreateRequest, ContinuableCreateSpec, ResolvedSubagentStartRequest, SubagentCapabilities, SubagentProvider, SubagentResult, SubagentRun, SubagentStartRequest, SubagentStopReason, SubagentStopReasonMap, } from './types.ts';
export { foldSubagentDescriptor, snapshotSubagentDescriptor, SUBAGENT_DESCRIPTOR_VERSION, } from './descriptor.ts';
export type { ContinuableSubagentDescriptorData, ContinuableSubagentDescriptorInput, OneShotSubagentDescriptorData, OneShotSubagentDescriptorInput, SubagentDescriptorData, SubagentDescriptorInput, } from './descriptor.ts';
export { seedDescriptorTurn } from './descriptor-seed.ts';
export { SubagentError } from './error.ts';
export { settleRun } from './run-settlement.ts';
export { assertSubagentMaxDepth, delegationDepthOf } from './depth.ts';
export { appendDelegatedPolicyOverrides, applyChildComposition, captureDelegatedPolicyOverrides, childSessionMeta, resolveChildAgentOptions, resolveChildDepth, SubagentDepthError, } from './child-agent.ts';
export type { ChildComposition, DelegatedPolicyOverrides } from './child-agent.ts';
export type { ContinuableStart, ContinuableStartSpec, CoordinatorMessageSource, SubagentFollowupOptions, SubagentInterruptAuthority, SubagentReportDelivery, SubagentReportMessageSource, SubagentReportOptions, SubagentSettledMessageSource, } from './continuation.ts';
export type { ContinuableSetupContribution } from './activation-setup-registry.ts';
export type { SubagentDescendantListEntry, SubagentListEntry } from './list-children.ts';
export type { SubagentRunEndInfo, SubagentRunInfo } from './types.ts';
export type { SubagentIdentityProjection, SubagentTimingProjection } from './projection-types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        subagents: SubagentRuntime;
    }
    interface Events {
        /**
         * A provider became resolvable in the registry.
         * @param provider - the registered provider.
         * @mode emit
         */
        'subagent/provider-added'(provider: SubagentProvider): void;
        /**
         * A provider left the registry. Accepted runs remain holder-owned.
         * @param name - the provider name that no longer resolves.
         * @mode emit
         */
        'subagent/provider-removed'(name: string): void;
        /**
         * A provider established a published child. For in-process providers,
         * `ctx.agents.get(info.id)` resolves during this notification.
         * Scope-filtered dispatch keys the carrier by the delegating parent, so a
         * parent-scoped listener observes only its own delegations. Paired with
         * `subagent/end`.
         * @param info - the provider and published child identity.
         * @dshScopeScan unsupported
         * @mode emit
         */
        'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void;
        /**
         * A published child settled. Scope-filtered dispatch uses the same delegating
         * parent carrier as `subagent/start`, so the lifecycle pair reaches the
         * same scoped audience.
         * @param info - the run identity and terminal outcome.
         * @dshScopeScan unsupported
         * @mode emit
         */
        'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void;
    }
}
/** Named provider registry with one-shot runs, durable discovery, and continuable-child operations. */
export declare class SubagentRuntime extends Service {
    private providers;
    private continuations;
    /** Deployment contributions composed into unpublished continuable children. */
    private readonly setupRegistry;
    /**
     * The contained lifecycle-edge publisher. Built here because scoped dispatch
     * keys its carrier by this exact service instance, whose own context filter
     * composes into the carrier.
     */
    private readonly emitLifecycle;
    constructor(ctx: Context);
    /**
     * Establish one durable continuable child and deliver its initial prompt.
     * Resolves when the child's inbox accepts that prompt, without waiting for the
     * turn to start or for the message to reach the Session log; any earlier
     * failure rejects with no ids and rolls back the child entirely.
     * @param spec - provider, delegation request, and caller cancellation.
     * @returns the durable child id and the accepted prompt's message id.
     * @throws when continuation services are unavailable or materialization fails.
     */
    startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>;
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
    followup(parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions): Promise<MessageId>;
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
    interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void;
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
    reportFrom(child: Agent, content: ContentBlock[], options: SubagentReportOptions): Promise<MessageId>;
    /**
     * Compose one deployment capability into every continuable child's
     * unpublished creation context on fresh creation and cold resume. Grants wait
     * for the next Activation; removing the contribution revokes every resident
     * installation immediately.
     * @param contribution - synchronous child-scope installer.
     * @returns the exact Cordis effect disposer.
     */
    registerContinuableSetup(contribution: ContinuableSetupContribution): () => void;
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
    drainContinuableDescendants(parents: readonly Agent[]): Promise<void>;
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
    listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>;
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
    listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>;
    /**
     * Register a provider under its name. Registration is effect-scoped and HMR
     * safe; removing a provider blocks new starts but does not revoke runs that
     * were already returned to their holders.
     * @param provider - the trusted provider implementation.
     * @returns the exact Cordis effect disposer.
     */
    registerProvider(provider: SubagentProvider): () => void;
    /**
     * Look up a provider by name.
     * @param name - the provider name.
     * @returns the provider, or undefined when absent.
     */
    getProvider(name: string): SubagentProvider | undefined;
    /**
     * List registered provider names in insertion order.
     * @returns the registered names.
     */
    list(): string[];
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
    start(name: string, request: SubagentStartRequest): Promise<SubagentRun>;
    /**
     * Resolve one provider's detached continuable-creation contribution. Method
     * presence on the provider IS the capability, so a provider without it is
     * rejected before the manager reserves any child resources.
     */
    private prepareContinuable;
    /** Look up a provider for dispatch or fail loud. */
    private expectProvider;
    /** Resolve the optional continuable-subagent manager or fail loud. */
    private requireContinuations;
    /**
     * Build the lifecycle observer for one continuable Activation's residency
     * epoch, so the manager publishes its edges without owning event dispatch.
     */
    private observeActivation;
    /** Reject the first requested capability that the provider lacks. */
    private assertCapabilities;
}
export default SubagentRuntime;
//# sourceMappingURL=index.d.ts.map