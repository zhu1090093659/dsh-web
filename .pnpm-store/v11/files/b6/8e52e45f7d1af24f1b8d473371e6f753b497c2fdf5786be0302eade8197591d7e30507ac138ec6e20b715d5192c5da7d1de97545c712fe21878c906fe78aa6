/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema).
 */
import { z } from 'zod';
import { sessionIdSchema } from "./sessions.schema.js";
/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    whenToUse: z.string().optional(),
    modelInvocable: z.boolean(),
});
/** skill.list request payload. */
export const skillListRequestSchema = z.object({
    sessionId: sessionIdSchema,
});
/** skill.list response value. */
export const skillListValueSchema = z.object({
    skills: z.array(skillEntrySchema),
});
//# sourceMappingURL=skills.schema.js.map