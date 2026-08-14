/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema).
 */
import { z } from 'zod';
/** SkillEntry row of skill.list. */
export declare const skillEntrySchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    whenToUse: z.ZodOptional<z.ZodString>;
    modelInvocable: z.ZodBoolean;
}, z.core.$strip>;
/** skill.list request payload. */
export declare const skillListRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
}, z.core.$strip>;
/** skill.list response value. */
export declare const skillListValueSchema: z.ZodObject<{
    skills: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        whenToUse: z.ZodOptional<z.ZodString>;
        modelInvocable: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
//# sourceMappingURL=skills.schema.d.ts.map