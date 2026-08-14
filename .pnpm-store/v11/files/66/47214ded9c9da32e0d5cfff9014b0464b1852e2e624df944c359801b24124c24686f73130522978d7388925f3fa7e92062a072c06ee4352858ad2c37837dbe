/**
 * goals domain zod schemas. Mutation-only shapes: every value schema is a
 * `{ ref }` acknowledgement (clear: `{ cleared }`) — the current goal state
 * travels exclusively on the 'goal' session projection.
 */
import { z } from 'zod';
import type { Wire } from './rpc.schema.ts';
import type { GoalRef, RequestPayload, ResponseValue } from './index.ts';
/** GoalRef schema. */
export declare const goalRefSchema: z.ZodType<Wire<GoalRef>>;
/** goal.create request payload. */
export declare const goalCreateRequestSchema: z.ZodType<Wire<RequestPayload<"goal.create">>>;
/** goal.create response value. */
export declare const goalCreateValueSchema: z.ZodType<Wire<ResponseValue<"goal.create">>>;
/** goal.edit request payload. */
export declare const goalEditRequestSchema: z.ZodType<Wire<RequestPayload<"goal.edit">>>;
/** goal.edit response value. */
export declare const goalEditValueSchema: z.ZodType<Wire<ResponseValue<"goal.edit">>>;
/** goal.pause request payload. */
export declare const goalPauseRequestSchema: z.ZodType<Wire<RequestPayload<"goal.pause">>>;
/** goal.pause response value. */
export declare const goalPauseValueSchema: z.ZodType<Wire<ResponseValue<"goal.pause">>>;
/** goal.resume request payload. */
export declare const goalResumeRequestSchema: z.ZodType<Wire<RequestPayload<"goal.resume">>>;
/** goal.resume response value. */
export declare const goalResumeValueSchema: z.ZodType<Wire<ResponseValue<"goal.resume">>>;
/** goal.complete request payload. */
export declare const goalCompleteRequestSchema: z.ZodType<Wire<RequestPayload<"goal.complete">>>;
/** goal.complete response value. */
export declare const goalCompleteValueSchema: z.ZodType<Wire<ResponseValue<"goal.complete">>>;
/** goal.clear request payload. */
export declare const goalClearRequestSchema: z.ZodType<Wire<RequestPayload<"goal.clear">>>;
/** goal.clear response value. */
export declare const goalClearValueSchema: z.ZodType<Wire<ResponseValue<"goal.clear">>>;
//# sourceMappingURL=goals.schema.d.ts.map