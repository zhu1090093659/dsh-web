/**
 * questions domain zod schemas (respond is a client-response; the payload schema serves
 * the /api/respond endpoint's second parse after routing via the pending table). The question
 * identifier is the echoed rpcId; the payload carries no resource id.
 */
import { z } from 'zod';
import { sessionIdSchema } from "./sessions.schema.js";
/** AskUserQuestionAnswer validated strictly against core dsh-user-questions. */
export const askUserQuestionAnswerSchema = z.object({
    answers: z.array(z.object({
        id: z.string(),
        selected: z.array(z.string()),
        custom: z.string().optional(),
    })),
});
/** Question answer payload (the result.value slot of a client-response). */
export const questionResponsePayloadSchema = z.object({
    sessionId: sessionIdSchema,
    answer: askUserQuestionAnswerSchema,
});
//# sourceMappingURL=questions.schema.js.map