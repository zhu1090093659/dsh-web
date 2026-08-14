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
import { randomUUID } from 'node:crypto';
import { foldConsumedWork } from '@deepseek-ai/dsh-agent';
import { finalAssistantOutput } from "./assistant-output.js";
import { SubagentRunId } from "./types.js";
/**
 * Build the contained lifecycle emitter this seam publishes every edge through.
 * Every listener is independently contained: a synchronous throw or a rejected
 * returned promise is logged without starving peer listeners, changing the run,
 * or — for provider removal, which fires from a disposer — breaking teardown.
 * @param ctx - the service's own context, owning dispatch and the logger.
 * @param carrier - resolve the scoped dispatch carrier for one delegating parent.
 * @returns the emitter both observers and the provider registry publish through.
 */
export function createLifecycleEmitter(ctx, carrier) {
    return (name, info, parent) => {
        const dispatchArgs = parent === undefined
            ? [name, info]
            : [carrier(parent), name, info];
        for (const callback of ctx.events.dispatch('emit', dispatchArgs)) {
            try {
                const returned = callback(info);
                void Promise.resolve(returned).catch((error) => {
                    ctx.logger.warn(`subagent: ${name} listener rejected: ${renderThrown(error)}`);
                });
            }
            catch (error) {
                ctx.logger.warn(`subagent: ${name} listener threw: ${renderThrown(error)}`);
            }
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
export function observeRun(emit, provider, parent, run) {
    const identity = {
        runId: SubagentRunId(randomUUID()),
        provider,
        id: run.id,
        local: run.localAgent !== undefined,
    };
    // Attach the terminal observer before dispatching start. Promise reactions
    // still run after this synchronous start emission, preserving start → end.
    void run.result.then((result) => {
        emit('subagent/end', {
            ...identity,
            stopReason: result.stopReason,
            // Omit the field when no output exists, matching continuable epochs.
            ...result.output.length === 0 ? {} : { lastAssistantMessage: result.output },
        }, parent);
    }, () => {
        emit('subagent/end', { ...identity, stopReason: 'error' }, parent);
    });
    emit('subagent/start', identity, parent);
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
export function createActivationObserver(emit, provider, childId, parent) {
    const identity = { runId: SubagentRunId(randomUUID()), provider, id: childId, local: true };
    // A cold resume replays earlier turns, so this epoch's telemetry must come
    // from the suffix it actually produced — never the whole session, which
    // would report a previous epoch's answer when this one opened no turn.
    let boundary = 0;
    // Assigned by `capture()`, which the disposal path always runs before
    // `settle()`; a resident epoch therefore always has its facts by then.
    let captured = { stopReason: 'completed' };
    // Teardown failure overrides the epoch's own outcome and withholds its
    // output: an answer this harness could not durably release is not a result.
    const terminal = (failure) => failure === undefined
        ? captured
        : { stopReason: 'error' };
    return {
        start: (child) => {
            boundary = child.session.events.length;
            emit('subagent/start', identity, parent);
        },
        capture: (child) => {
            const own = child.session.events.slice(boundary);
            const output = finalAssistantOutput(own);
            captured = {
                stopReason: epochStopReason(own),
                ...output === undefined ? {} : { output },
            };
        },
        terminal,
        settle: (failure) => {
            const { stopReason, output } = terminal(failure);
            emit('subagent/end', {
                ...identity,
                stopReason,
                ...output === undefined ? {} : { lastAssistantMessage: output },
            }, parent);
        },
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
        case 'max-tokens':
            return 'max-tokens';
        case 'aborted':
        case 'interrupted':
            return 'aborted';
        case 'error':
            return 'error';
        // A pre-step rejection — a hook deny, a policy plugin — discarded input
        // this epoch had claimed: the work was declined, not done.
        case 'blocked':
            return 'refusal';
        // A clean ending and no accounting turn at all share one rule: the epoch
        // finished what it was given unless a cancelled queue says otherwise.
        case undefined:
        case 'completed':
            return droppedUnrun ? 'aborted' : 'completed';
        /* v8 ignore next 3 -- `TurnEndReason` is merge-extensible, so this arm needs a
         * backend that adds a variant; treating an unnameable reason as success would
         * report failed work as completed. */
        default:
            return 'error';
    }
}
/** Render any listener-thrown value without letting coercion escape containment. */
function renderThrown(value) {
    try {
        return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
    }
    catch {
        return '<unrenderable thrown value>';
    }
}
//# sourceMappingURL=lifecycle.js.map