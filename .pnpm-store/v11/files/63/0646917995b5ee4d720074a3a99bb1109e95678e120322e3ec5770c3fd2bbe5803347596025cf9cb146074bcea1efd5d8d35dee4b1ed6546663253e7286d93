/**
 * questions domain zod schemas (respond is a client-response; the payload schema serves
 * the /api/respond endpoint's second parse after routing via the pending table). The question
 * identifier is the echoed rpcId; the payload carries no resource id.
 */
import { z } from 'zod';
/** AskUserQuestionAnswer validated strictly against core dsh-user-questions. */
export declare const askUserQuestionAnswerSchema: z.ZodObject<{
    answers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        selected: z.ZodArray<z.ZodString>;
        custom: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Question answer payload (the result.value slot of a client-response). */
export declare const questionResponsePayloadSchema: z.ZodObject<{
    sessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    answer: z.ZodObject<{
        answers: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            selected: z.ZodArray<z.ZodString>;
            custom: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
//# sourceMappingURL=questions.schema.d.ts.map