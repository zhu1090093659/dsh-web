/**
 * Pure folds for durable provider-reported token usage and context occupancy.
 */
import { z } from 'zod';
import { foldSurfaceProjection } from "./surface-projection.js";
const zeroBuckets = () => ({
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
});
const bucketsFrom = (usage) => ({
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
});
const bucketsEqual = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens;
const addReplacing = (totals, previous, next) => ({
    uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
    outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
    cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
});
const projectionSchema = z.object({
    uncachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
}).strict();
// Cast for the optional values: under exactOptionalPropertyTypes zod infers
// `number | undefined` where the interface declares absent-or-number fields.
const pressureSchema = z.object({
    pressureTokens: z.number().int().nonnegative().optional(),
    projectedTokens: z.number().int().nonnegative().optional(),
    contextWindow: z.number().int().positive().optional(),
}).strict();
/** Prompt-side pressure of one request: input plus cache traffic, no output. */
const pressureFrom = (usage) => usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
/** The usage a chunk or finalized message reports for its step, if any. */
const usageOf = (event) => event.type === 'assistant/chunk' && event.data.chunk.type === 'usage'
    ? event.data.chunk.usage
    : event.type === 'assistant/message'
        ? event.data.usage
        : undefined;
/**
 * Token-meter's session projection unit.
 *
 * Usage chunks provide an early sample that survives a later request failure;
 * an assistant message provides the final sample for the same turn/step. A
 * repeated sample replaces that step's earlier value instead of double
 * counting it. The single `last` slot relies on the session-log invariant
 * that usage reports for one turn/step are adjacent: once a later step begins,
 * a legal log never reports usage for an earlier step again.
 */
export const tokenUsageProjectionDefinition = {
    key: 'tokenUsage',
    schema: projectionSchema,
    init: () => ({ totals: zeroBuckets(), last: null }),
    apply: (state, event) => {
        let turn;
        let step;
        let usage;
        if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
            ;
            ({ turn, step } = event.data);
            usage = event.data.chunk.usage;
        }
        else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
            ;
            ({ turn, step, usage } = event.data);
        }
        else {
            return state;
        }
        const buckets = bucketsFrom(usage);
        const previous = state.last !== null
            && state.last.turn === turn
            && state.last.step === step
            ? state.last.buckets
            : undefined;
        if (previous !== undefined && bucketsEqual(previous, buckets))
            return state;
        return {
            totals: addReplacing(state.totals, previous, buckets),
            last: { turn, step, buckets },
        };
    },
    view: state => state.totals,
    stateVersion: 1,
};
/**
 * Token-meter's context-occupancy projection unit.
 *
 * Independent last-wins slots: the newest usage sample supplies the provider
 * numerator, the newest `request/context` record the denominator. Both are
 * whole values, so replay order alone decides the result and no cross-field
 * consistency is claimed — the pair is explicitly not one atomic request
 * observation (see {@link ContextPressureProjection}).
 *
 * `pressureTokens` is prompt-side only, so it holds still while a turn streams
 * and steps forward once the next request reports its usage. Because nothing
 * but a request reports usage, it also cannot see a compaction: the fold
 * therefore carries a running surface total alongside it and publishes
 * `projectedTokens` — the sample plus the surface's signed movement since it
 * was taken — so occupancy answers for the next request rather than the last
 * one. The total rides {@link foldSurfaceProjection}, so the state stays O(1)
 * and a replacement shrinks it by its logged shadow price. A replacement
 * without a claim preserves the previous total. A usage sample is stamped
 * BEFORE the same event joins the surface, so an `assistant/message` anchors
 * against the surface its own request saw.
 */
export const contextPressureProjectionDefinition = {
    key: 'contextPressure',
    schema: pressureSchema,
    init: () => ({ surfaceTokens: 0 }),
    apply: (state, event) => {
        const fold = foldSurfaceProjection(state.claim, event);
        let next = state;
        if (event.type === 'request/context') {
            const contextWindow = event.data.contextWindow;
            if (contextWindow !== state.contextWindow) {
                if (contextWindow !== undefined) {
                    next = { ...next, contextWindow };
                }
                else {
                    const { contextWindow: _removed, ...withoutContextWindow } = next;
                    next = withoutContextWindow;
                }
            }
        }
        const usage = usageOf(event);
        if (usage !== undefined) {
            const pressureTokens = pressureFrom(usage);
            if (pressureTokens !== next.pressureTokens || next.sampledSurfaceTokens !== next.surfaceTokens) {
                next = { ...next, pressureTokens, sampledSurfaceTokens: next.surfaceTokens };
            }
        }
        if (fold.deltaTokens !== 0) {
            next = { ...next, surfaceTokens: next.surfaceTokens + fold.deltaTokens };
        }
        // A defined fold.claim is always freshly built, so presence decides claim
        // bookkeeping: no claim before or after this event leaves `next` as is.
        if (state.claim === undefined && fold.claim === undefined)
            return next;
        const { claim: _expired, ...withoutClaim } = next;
        return fold.claim === undefined ? withoutClaim : { ...withoutClaim, claim: fold.claim };
    },
    view: ({ contextWindow, pressureTokens, surfaceTokens, sampledSurfaceTokens }) => ({
        ...contextWindow === undefined ? {} : { contextWindow },
        ...pressureTokens === undefined ? {} : { pressureTokens },
        ...pressureTokens === undefined || sampledSurfaceTokens === undefined
            ? {}
            : { projectedTokens: Math.max(0, pressureTokens + surfaceTokens - sampledSurfaceTokens) },
    }),
    stateVersion: 4,
};
//# sourceMappingURL=usage-projection.js.map