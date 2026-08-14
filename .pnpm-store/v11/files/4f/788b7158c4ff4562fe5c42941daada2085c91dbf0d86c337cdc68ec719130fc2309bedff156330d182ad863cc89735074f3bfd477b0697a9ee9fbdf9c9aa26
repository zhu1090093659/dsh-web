/**
 * tasks domain zod schemas: the branded job id and the wire view carried by
 * `session/jobs` frames.
 */
import { z } from 'zod';
import type { JobId } from '@deepseek-ai/dsh-jobs/brand';
/** JobId: one brand cast after non-empty string validation. */
export declare const taskIdSchema: z.ZodType<JobId>;
/**
 * One wire task view. `kind` stays an open string because producer plugins
 * extend the registry's kind map by declaration merging, so the closed set is
 * not knowable at this boundary.
 */
export declare const taskViewSchema: z.ZodObject<{
    id: z.ZodType<JobId, unknown, z.core.$ZodTypeInternals<JobId, unknown>>;
    kind: z.ZodString;
    label: z.ZodString;
    status: z.ZodUnion<readonly [z.ZodLiteral<"running">, z.ZodLiteral<"stopping">, z.ZodLiteral<"completed">, z.ZodLiteral<"killed">, z.ZodLiteral<"failed">]>;
    detail: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodNumber;
    finishedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
//# sourceMappingURL=jobs.schema.d.ts.map