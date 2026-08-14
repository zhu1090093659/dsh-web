/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
 * answerers fail closed; grants apply only to the requested action.
 * @module @deepseek-ai/dsh-user-approval
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type CallId } from '@deepseek-ai/dsh-llm';
import type { Scoped } from '@deepseek-ai/dsh-scope';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
declare module '@deepseek-ai/cordis' {
    interface Context {
        approval: ApprovalService;
    }
    interface Events {
        /**
         * Ask composed answerers for one decision. Return an outcome to claim the
         * request or call `next()`; failure yields the fail-closed default.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
         * @param req - the pending decision (agent, tool identity, reason, signal).
         * @mode waterfall
         */
        'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>;
    }
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * An approval question was put to the answerer chain — log-only audit
         * (like `hook/*`; NOT a surface event, carries no `surfaceOp`). `id` pairs
         * it with the `approval/decided` that always follows; `toolName` is the
         * tool the question is about, `callId` the exact tool call when the asker
         * had one, `reason` the asker's human-readable explanation (e.g. a hook's
         * permission-decision reason).
         */
        'approval/asked': {
            id: ApprovalRequestId;
            toolName: string;
            callId?: CallId;
            reason?: string;
        };
        /**
         * The outcome of a prior `approval/asked` (same `id`) — log-only audit.
         * Exactly one per ask, appended when the outcome is known: a decision, a
         * cancellation, or the fail-closed `'unavailable'`.
         */
        'approval/decided': {
            id: ApprovalRequestId;
            outcome: ApprovalOutcome;
        };
        /**
         * The session's approval policy was switched — log-only, durable,
         * replayable, never in the model transcript (the model learns the policy
         * from the runtime-context snapshot and live switch notices). The LAST
         * such event is the session's override ({@link effectiveApprovalPolicy}).
         * `source: 'delegation'` marks an override seeded into a child; an absent
         * source is a runtime switch.
         */
        'approval/policy': {
            policy: ApprovalPolicy;
            /** Marks an override seeded into a child at delegation. */
            source?: 'delegation';
        };
    }
}
import { ApprovalRequestId } from './types.ts';
import type { ApprovalOutcome } from './types.ts';
export { ApprovalRequestId } from './types.ts';
export type { ApprovalOutcome } from './types.ts';
/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
export type ApprovalPolicy = 'ask' | 'never';
/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
export declare const APPROVAL_POLICIES: readonly ApprovalPolicy[];
/**
 * The session's approval-policy override: the last `approval/policy` event in
 * the log, or undefined when the session never switched (callers apply the
 * plugin's configured default). The pure fold — resume needs no catch-up
 * machinery because replaying the log IS the state.
 * @param events - session events in log order (other event types are skipped).
 * @returns the policy of the last switch event, or undefined without one.
 */
export declare function effectiveApprovalPolicy(events: readonly SessionEvent[]): ApprovalPolicy | undefined;
/**
 * Append the sole durable representation of a session policy override. Invalid
 * values throw before the log changes; consumers fold the new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export declare function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void;
/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
export interface ApprovalRequest {
    /**
     * The agent on whose behalf the question is asked. Routes the question (a
     * UI answerer only answers for agents it owns) and receives the audit
     * events on its session log.
     */
    readonly agent: Agent;
    /** The tool the question is about (presentation and audit). */
    readonly toolName: string;
    /**
     * The exact tool call being decided, when the asker has one — lets a UI
     * attach the prompt to the tool call it already streamed.
     */
    readonly callId?: CallId;
    /** The asker's human-readable explanation of WHY it is asking. */
    readonly reason?: string;
    /**
     * Aborting withdraws the question: the request settles `'cancelled'`
     * immediately and a late answer from a still-pending answerer is discarded.
     */
    readonly signal?: AbortSignal;
}
/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
    /**
     * The deployment's default {@link ApprovalPolicy} for sessions without an
     * `approval/policy` override — `'ask'` delegates to the composed answerers
     * (fail-closed with none); `'never'` auto-rejects every ask without
     * prompting (the deterministic CI/unattended stance).
     */
    readonly policy?: ApprovalPolicy;
}
/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. It exposes deterministic policy
 * changes to the model through the runtime-context snapshot and switch notices.
 */
export declare class ApprovalService extends Service {
    config: Config;
    static Config: z<Config>;
    constructor(ctx: Context, config: Config);
    /**
     * Switch one live agent's policy and queue the transition for its next model
     * step. Session initialization uses {@link setApprovalPolicy} directly
     * because there is no previously visible policy to change.
     * @param agent - the live agent whose policy is changing.
     * @param policy - the new effective policy.
     */
    setPolicy(agent: Agent, policy: ApprovalPolicy): void;
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
    request(req: ApprovalRequest): Promise<ApprovalOutcome>;
    /**
     * The session's effective policy: its own `approval/policy` fold, else the
     * configured default (the schema already defaulted an omitted policy to
     * `'ask'`; the `??` only narrows the optional-input TYPE).
     * @param session - the exact accepted session whose policy applies.
     * @returns the policy every ask for this session resolves under right now.
     */
    private effectivePolicy;
    /**
     * Read the session override without applying the configured default.
     * @param session - session whose log supplies the override.
     * @returns the last logged policy, or `undefined` without one.
     */
    overrideOf(session: Session): ApprovalPolicy | undefined;
    /**
     * Dispatch the waterfall, contained and raced against the request signal.
     * @param req - the borrowed public request.
     * @param session - the request agent's session used for policy lookup.
     * @returns the normalized closed outcome.
     */
    private decide;
}
export default ApprovalService;
//# sourceMappingURL=index.d.ts.map