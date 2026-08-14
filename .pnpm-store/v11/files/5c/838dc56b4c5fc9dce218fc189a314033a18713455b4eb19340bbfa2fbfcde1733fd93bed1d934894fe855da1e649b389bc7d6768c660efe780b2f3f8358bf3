/**
 * tasks domain zod schemas: the branded job id and the wire view carried by
 * `session/jobs` frames.
 */
import { z } from 'zod';
/** JobId: one brand cast after non-empty string validation. */
export const taskIdSchema = z.string().min(1);
/**
 * One wire task view. `kind` stays an open string because producer plugins
 * extend the registry's kind map by declaration merging, so the closed set is
 * not knowable at this boundary.
 */
export const taskViewSchema = z.object({
    id: taskIdSchema,
    kind: z.string().min(1),
    label: z.string().min(1),
    status: z.union([
        z.literal('running'),
        z.literal('stopping'),
        z.literal('completed'),
        z.literal('killed'),
        z.literal('failed'),
    ]),
    detail: z.string().optional(),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().optional(),
});
//# sourceMappingURL=jobs.schema.js.map