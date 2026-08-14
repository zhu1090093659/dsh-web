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
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SubagentDescriptorData } from './descriptor.ts';
import type { ContinuableCreateRequest, ContinuableCreateSpec, SubagentStartRequest } from './types.ts';
import type { ActivationObserver } from './lifecycle.ts';
import type SubagentActivationSetupRegistry from './activation-setup-registry.ts';
/** Attribution for a model coordinator's follow-up to one of its children. */
export interface CoordinatorMessageSource {
    readonly kind: 'coordinator';
    /** A message another agent addressed to this one (`relay` context form). */
    readonly form: 'relay';
    /** Session id of the agent whose tool call produced the follow-up. */
    readonly senderSessionId: SessionId;
}
/** Durable attribution for a continuable child's explicit parent report. */
export interface SubagentReportMessageSource {
    readonly kind: 'subagent-report';
    /** A message another agent addressed to this one (`relay` context form). */
    readonly form: 'relay';
    /** Session id of the reporting child. */
    readonly senderSessionId: SessionId;
}
/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link SubagentReportMessageSource}: a report is content the child chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
export interface SubagentSettledMessageSource {
    readonly kind: 'subagent-settled';
    /** A runtime account shown without expanding the row (`notice` context form). */
    readonly form: 'notice';
    /** One-line account of how the child ended. */
    readonly summary: string;
    /** Session id of the child that settled. */
    readonly senderSessionId: SessionId;
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        coordinator: CoordinatorMessageSource;
        'subagent-report': SubagentReportMessageSource;
        'subagent-settled': SubagentSettledMessageSource;
    }
}
/** Deployment scheduling policy for accepted child reports. */
export type SubagentReportDelivery = 'quiet' | 'wakeup';
/** Options for one continuable child's report to its direct parent. */
export interface SubagentReportOptions {
    /** Already-resolved parent scheduling policy. */
    readonly delivery: SubagentReportDelivery;
    /** Caller cancellation, owning authorization and admission until acceptance. */
    readonly signal: AbortSignal;
}
/** What a caller asks for when starting a continuable background child. */
export interface ContinuableStartSpec {
    /** The `ctx.subagents` provider whose continuable-creation capability establishes the child. */
    readonly provider: string;
    /** The initial delegation's short `description`, persisted as the child's creation label. */
    readonly label: string;
    /**
     * The delegation request. The manager reserves the stable child id, resolves
     * the durable descriptor, and composes the child itself.
     */
    readonly request: Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>;
    /** Caller cancellation, owning the operation only until inbox acceptance. */
    readonly signal: AbortSignal;
}
/** Identities returned once a continuable child accepted its initial prompt. */
export interface ContinuableStart {
    /** The durable child session id, stable across activations. */
    readonly childId: SessionId;
    /** The accepted initial prompt's inbox message id. */
    readonly messageId: MessageId;
}
/**
 * Authority under which one interrupt request is admitted. `user` carries the
 * durable direct-parent address a human client presented; `ancestor` carries
 * the exact live Agent object whose recorded lineage must contain the caller.
 */
export type SubagentInterruptAuthority = {
    readonly kind: 'user';
    readonly parentSessionId: SessionId;
} | {
    readonly kind: 'ancestor';
    readonly agent: Agent;
};
/** Options for following up with one continuable child. */
export interface SubagentFollowupOptions {
    /** Durable attribution retained on the delivered message; it grants no authority. */
    readonly source: MessageSource;
    /** Caller cancellation, owning the operation only until inbox acceptance. */
    readonly signal: AbortSignal;
}
/**
 * Hooks the manager needs from the owning service. Declared here, by the
 * dependent, so the manager states exactly what it requires instead of
 * depending back on the whole {@link SubagentRuntime}. Package-private: no
 * consumer outside this package supplies a host.
 */
interface ContinuationHost {
    /**
     * Resolve one provider's continuable-creation contribution, or reject when
     * the provider is unknown or lacks the capability.
     * @param name - the configured provider name.
     * @param request - the reserved identity, delegating parent, and cancellation.
     * @returns the provider's detached creation spec.
     */
    prepareContinuable(name: string, request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>;
    /**
     * Build the lifecycle observer for one Activation's residency epoch.
     * @param provider - the provider name recorded in the durable descriptor.
     * @param childId - the durable child session id.
     * @param parent - the exact live direct parent for scoped dispatch.
     * @returns the observer whose edges this epoch publishes.
     */
    observeActivation(provider: string, childId: SessionId, parent: Agent): ActivationObserver;
}
/**
 * The continuable-subagent orchestration service behind `ctx.subagents`. Tool
 * schema and host adapters are consumers of this one contract; foreground
 * one-shot delegation keeps calling `ctx.subagents.start()` and never enters
 * this lifecycle.
 */
export declare class SubagentContinuationManager {
    private readonly ctx;
    private readonly host;
    private readonly setupRegistry;
    /** Child session id → its live Activation. Process-local, never durable. */
    private activations;
    /** Materializations admitted before drain, tracked through publication or rollback. */
    private readonly materializations;
    private readonly locks;
    /** Structural Cordis owner of every Activation handle. */
    private readonly ownerCtx;
    /**
     * Exact roots whose host teardown has begun, with the live lineage members
     * observed under each root. Entries remain until that exact root leaves the
     * Agent registry, closing admission throughout its host's teardown without
     * poisoning a later same-id replacement.
     */
    private readonly closingScopes;
    private draining;
    constructor(ctx: Context, host: ContinuationHost, setupRegistry: SubagentActivationSetupRegistry);
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
    startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>;
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
    followup(parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions): Promise<MessageId>;
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
    interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void;
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
    reportFrom(child: Agent, content: ContentBlock[], options: SubagentReportOptions): Promise<MessageId>;
    /** Authorize only the exact Agent of one resident Activation. */
    private authorizeReporter;
    /** Resolve the reporting child's live direct parent from durable lineage. */
    private resolveReportParent;
    /** Deliver one framed report through the selected parent scheduling preset. */
    private deliverReport;
    /**
     * Perform one waking send to a parent, accounted against that parent's own
     * Activation when it has one. Registering the id before the send is what
     * keeps a continuation-managed parent from being judged quiescent in the
     * window between `followup()` and the microtask that admits it.
     * @param parent - the exact live parent receiving the waking message.
     * @param message - the message whose id is accounted.
     * @param send - the synchronous waking send to perform.
     */
    private sendWaking;
    /** Send one report while translating only the parent's own rejection. */
    private sendReport;
    /**
     * Close admission, await every already-admitted materialization through
     * publication or rollback, then dispose the stable live Activation forest
     * child-first. Sibling branches drain independently: one failure is recorded
     * but never prevents the remaining handles from being attempted, and the
     * aggregate rejects only after every branch settles.
     * @returns once materialization is quiescent and every live Activation released its handle.
     * @throws an aggregate error when any branch failed to release.
     */
    drain(): Promise<void>;
    /**
     * Stop only the continuable descendants of exact live host-owned parents.
     * Admission stays closed for those parent trees until each exact parent
     * leaves the Agent registry; unrelated trees and manager-wide admission stay
     * live.
     * @param parents - exact live roots whose continuable descendants must stop.
     * @returns once every retained descendant Activation released its handle.
     * @throws an aggregate error after all scoped branches settle when any failed.
     */
    drainDescendants(parents: readonly Agent[]): Promise<void>;
    /** Dispose independent roots and report every branch failure after all settle. */
    private disposeRoots;
    /** Return the retained member set for one exact scoped-teardown root. */
    private closingMembers;
    /**
     * Return the exact currently resolvable ancestry from `agent` upward. The
     * first element is always the supplied identity, even when it is already
     * stale; each ancestor after it must be the registry's current exact entry.
     */
    private liveLineage;
    /**
     * The teardown that closed continuable admission for this agent's lineage.
     * `'manager'` is the whole manager draining; an Agent is the exact scoped root
     * whose forest is closing.
     * @param agent - the agent whose lineage is tested.
     * @returns the closing teardown, or `undefined` while admission is open.
     */
    private closingTeardownFor;
    /** Reject new admission once the manager or this exact parent tree began draining. */
    private assertAdmitting;
    /**
     * Derive residency from Agent quiescence and the owned-child set. `running`
     * covers an active admission, an open turn, or accepted waking inbox work.
     *
     * `Agent.status` alone is insufficient: it stays `idle` between an accepted
     * waking send and the microtask that admits it, so a synchronous inbox
     * observer would see `settled` while a turn is already queued. `accepted`
     * holds the ids this manager admitted but has not yet seen drained.
     */
    private stateOf;
    /**
     * Cold-resume a persisted child: inspect and authorize its Session, fold the
     * generic descriptor, create the Activation through `ctx.agents.resume()`,
     * and submit the waiting turn. This never dispatches through a subagent
     * provider — the persisted Session already holds the initial prefix and the
     * descriptor is the whole reconstruction input.
     */
    private coldResume;
    /**
     * Submit to a freshly materialized Activation or roll it back completely.
     * @param activation - the just-published Activation to admit or release.
     * @param content - the initial or resumed message content.
     * @param source - durable fields naming who supplied the accepted message.
     * @param parent - the live direct parent authorizing admission.
     * @param signal - caller cancellation owning admission until acceptance.
     * @returns the accepted inbox message id.
     */
    private submitMaterialized;
    /**
     * Create or resume the child Agent through the private activation-owner
     * scope, install the handle in a fresh Activation, and register ownership on
     * a continuation-managed parent. Rejection leaves no Activation, no handle,
     * and no ownership membership.
     */
    private materialize;
    /**
     * Perform one tracked materialization. The caller keeps the drain barrier
     * registered until this either returns a resident Activation or finishes
     * rollback.
     */
    private materializeTracked;
    /**
     * Release an Activation whose start edge was not published. The memoized
     * transaction remains in the live map until handle disposal settles, so a
     * concurrent drain or delivery observes the same closing boundary.
     */
    private rollbackUnpublished;
    /**
     * Register the child in a continuation-managed parent's owned set before the
     * child can run, so that parent cannot settle while the child is live. A
     * top-level or other non-continuation Agent has no Activation and stays
     * outside the waiting graph.
     */
    private acquireOwnership;
    /** Remove one child from its live owner's set and let that owner re-check settlement. */
    private releaseOwnership;
    /** Let a settlement watcher re-observe quiescence after ownership or inbox changes. */
    private wake;
    /**
     * Submit one message as the child's next FIFO turn and return its accepted
     * inbox id. Acceptance is the operation's success boundary; the manager owns
     * the Activation independently afterwards.
     */
    private submit;
    /**
     * Account one waking send across a resident Activation's settlement window.
     * @param activation - Activation receiving waking inbox work.
     * @param messageId - stable identity of the message about to be sent.
     * @param send - synchronous send that publishes one enqueue occurrence.
     * @returns the accepted message id.
     */
    private admitWaking;
    /**
     * Cross the final admission cutoff and submit without yielding. Signal abort,
     * manager drain, or Activation disposal that wins before this synchronous
     * span rejects without inbox acceptance.
     */
    private submitAdmitted;
    /**
     * Authorize one operation against the durable direct-parent lineage. Other
     * agents, ancestors, teams, workflows, and hosts remain rejected until an
     * explicit authority protocol has a production consumer.
     */
    private authorizeLineage;
    /**
     * Follow one Activation to settlement: wait for Agent quiescence, then for
     * every owned child to complete disposal, and dispose the handle once both
     * hold. A `next-turn` delivered while `waiting` wakes the same Agent and
     * returns it to `running`, so this re-observes rather than settling early.
     */
    private watchSettlement;
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
    private dispose;
    /**
     * Propagate stop synchronously, then finish the child-first release.
     * @param activation - the Activation whose disposal transaction is installed.
     * @returns once the handle and ownership edge are released.
     */
    private finishDisposal;
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
    private notifySettlement;
    /**
     * Request a best-effort final session flush after the child is quiescent.
     * Listener failure is logged because flush participation cannot identify a
     * particular persistence backend, and teardown must still release ownership.
     * @param activation - the Activation whose final events should be flushed.
     */
    private flushFinalState;
    /** Resolve the persistence service continuable children require, or fail loud. */
    private requirePersistence;
}
export type { SubagentDescriptorData };
export default SubagentContinuationManager;
//# sourceMappingURL=continuation.d.ts.map