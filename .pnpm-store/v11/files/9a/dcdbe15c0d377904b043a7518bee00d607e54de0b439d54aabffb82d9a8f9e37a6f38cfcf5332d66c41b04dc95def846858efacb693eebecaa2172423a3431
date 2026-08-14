/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
 * answerers fail closed; grants apply only to the requested action.
 * @module @deepseek-ai/dsh-user-approval
 */
import { randomUUID } from 'node:crypto';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { scopeTarget } from '@deepseek-ai/dsh-scope';
import { ApprovalRequestId } from "./types.js";
export { ApprovalRequestId } from "./types.js";
/** Every {@link ApprovalOutcome}, for runtime normalization of answerer returns. */
const OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable'];
/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
export const APPROVAL_POLICIES = ['ask', 'never'];
/** Model-facing statement for the deterministic `'never'` policy. */
const NEVER_SENTENCE = 'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).';
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = 'Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.';
/**
 * The session's approval-policy override: the last `approval/policy` event in
 * the log, or undefined when the session never switched (callers apply the
 * plugin's configured default). The pure fold — resume needs no catch-up
 * machinery because replaying the log IS the state.
 * @param events - session events in log order (other event types are skipped).
 * @returns the policy of the last switch event, or undefined without one.
 */
export function effectiveApprovalPolicy(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === 'approval/policy')
            return event.data.policy;
    }
    return undefined;
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
        if (type === 'turn/start')
            return true;
        if (type === 'turn/end')
            return false;
    }
    return false;
}
/**
 * Append the sole durable representation of a session policy override. Invalid
 * values throw before the log changes; consumers fold the new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export function setApprovalPolicy(session, policy) {
    if (!APPROVAL_POLICIES.includes(policy)) {
        throw new TypeError('approval policy must be one of "ask" or "never"');
    }
    session.append('approval/policy', { policy });
}
/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. It exposes deterministic policy
 * changes to the model through the runtime-context snapshot and switch notices.
 */
export class ApprovalService extends Service {
    config;
    static Config = z.object({
        policy: z.union(['ask', 'never']).default('ask'),
    });
    constructor(ctx, config) {
        super(ctx, 'approval');
        this.config = config;
        const effective = (agent) => this.effectivePolicy(agent.session);
        // The complete current value travels after retained history, so switching
        // policy does not rewrite the stable system-prompt cache prefix.
        ctx.inject(['systemPrompt'], (scope) => {
            scope.systemPrompt.context({
                name: 'approval:policy',
                order: 115,
                text: (context) => {
                    const agent = context.agent;
                    // A bare assemble() (tests, diagnostics) has no session to state.
                    if (agent === undefined)
                        return '';
                    const policy = effective(agent);
                    return policy === 'never' ? NEVER_SENTENCE : ASK_SENTENCE;
                },
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
        if (previous === policy)
            return;
        setApprovalPolicy(agent.session, policy);
        agent.inject(createUserMessage({
            content: [{
                    type: 'text',
                    text: `The approval policy changed from "${previous}" to "${policy}" (changed by the user).`,
                }],
            source: { kind: 'plugin', plugin: 'user-approval' },
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
        if (!hasOpenTurn(session.events)) {
            throw new Error('approval.request() outside an open turn: the approval/asked + approval/decided audit pair '
                + 'must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). '
                + 'Ask from inside the turn that needs the decision.');
        }
        const id = ApprovalRequestId(randomUUID());
        session.append('approval/asked', {
            id,
            toolName: req.toolName,
            ...req.callId !== undefined ? { callId: req.callId } : {},
            ...req.reason !== undefined ? { reason: req.reason } : {},
        });
        const outcome = await this.decide(req, session);
        session.append('approval/decided', { id, outcome });
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
        return this.overrideOf(session) ?? this.config.policy ?? 'ask';
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
        if (signal?.aborted)
            return 'cancelled';
        // The 'never' policy is decided HERE, before any dispatch: a listener
        // registered with `prepend: true` after this service mounts would sit
        // ahead of any gate LISTENER, so a listener-shaped gate cannot keep the
        // documented promise that 'never' rejects deterministically regardless
        // of registration order — only the service's own request path can.
        if (this.effectivePolicy(session) === 'never')
            return 'rejected';
        // Enter the promise chain BEFORE dispatching: a listener that throws
        // SYNCHRONOUSLY (before its first await) must land in the same rejection
        // path as an async one — `Promise.resolve(call())` would let it escape
        // the containment into the caller.
        const answer = Promise.resolve().then(() => this.ctx.waterfall(scopeTarget(this, req.agent), 'approval/request', req, () => Promise.resolve('unavailable'))).then(
        // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
        // outcome instead of leaking it into callers' closed-union switches.
        outcome => OUTCOMES.includes(outcome) ? outcome : 'unavailable', 
        // A throwing answerer must fail the QUESTION closed, not the caller's
        // tool call open — the seam contains its callbacks.
        () => 'unavailable');
        if (signal === undefined)
            return answer;
        return await new Promise((resolve) => {
            const onAbort = () => {
                signal.removeEventListener('abort', onAbort);
                resolve('cancelled');
            };
            signal.addEventListener('abort', onAbort, { once: true });
            void answer.then((outcome) => {
                signal.removeEventListener('abort', onAbort);
                // After an abort won the race this resolve is a settled-promise no-op:
                // the late answer is discarded by construction.
                resolve(outcome);
            });
        });
    }
}
export default ApprovalService;
//# sourceMappingURL=index.js.map