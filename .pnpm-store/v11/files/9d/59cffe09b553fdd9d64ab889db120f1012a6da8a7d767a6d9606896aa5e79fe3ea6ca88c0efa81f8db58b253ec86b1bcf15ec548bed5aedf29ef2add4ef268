/**
 * goals domain zod schemas. Mutation-only shapes: every value schema is a
 * `{ ref }` acknowledgement (clear: `{ cleared }`) — the current goal state
 * travels exclusively on the 'goal' session projection.
 */
import { z } from 'zod';
/** GoalRef schema. */
export const goalRefSchema = z.object({
    id: z.string(),
    revision: z.number().int().positive(),
});
/** Shared `{ ref }` acknowledgement value of every non-clear mutation. */
const goalRefValueSchema = z.object({ ref: goalRefSchema });
/** goal.create request payload. */
export const goalCreateRequestSchema = z.object({
    sessionId: z.string(),
    objective: z.string().min(1),
    maxGoalRounds: z.number().int().positive().optional(),
});
/** goal.create response value. */
export const goalCreateValueSchema = goalRefValueSchema;
/** goal.edit request payload. */
export const goalEditRequestSchema = z.object({
    sessionId: z.string(),
    ref: goalRefSchema,
    objective: z.string().min(1).optional(),
    maxGoalRounds: z.number().int().positive().optional(),
}).refine(value => value.objective !== undefined || value.maxGoalRounds !== undefined, {
    message: 'goal.edit requires objective or maxGoalRounds',
});
/** goal.edit response value. */
export const goalEditValueSchema = goalRefValueSchema;
/** goal.pause request payload. */
export const goalPauseRequestSchema = z.object({
    sessionId: z.string(),
    ref: goalRefSchema,
});
/** goal.pause response value. */
export const goalPauseValueSchema = goalRefValueSchema;
/** goal.resume request payload. */
export const goalResumeRequestSchema = z.object({
    sessionId: z.string(),
    ref: goalRefSchema,
});
/** goal.resume response value. */
export const goalResumeValueSchema = goalRefValueSchema;
/** goal.complete request payload. */
export const goalCompleteRequestSchema = z.object({
    sessionId: z.string(),
    ref: goalRefSchema,
});
/** goal.complete response value. */
export const goalCompleteValueSchema = goalRefValueSchema;
/** goal.clear request payload. */
export const goalClearRequestSchema = z.object({
    sessionId: z.string(),
    ref: goalRefSchema,
});
/** goal.clear response value. */
export const goalClearValueSchema = z.object({
    cleared: z.literal(true),
});
//# sourceMappingURL=goals.schema.js.map