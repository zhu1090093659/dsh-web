/**
 * events domain zod schemas: MuxFrame / HostFrame unions (discriminatedUnion('type')).
 * A frame is the payload slot of the ServerRequest full form; the SessionEvent inside
 * a session/event frame reuses sessions.schema's strict-envelope + wide-data passthrough branch.
 */
import { z } from 'zod';
import type { HostFrame, MuxFrame } from './events.ts';
/** Question fields validated strictly against core dsh-user-questions. */
export declare const askUserQuestionItemSchema: z.ZodObject<{
    id: z.ZodString;
    question: z.ZodString;
    header: z.ZodOptional<z.ZodString>;
    detail: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    multiSelect: z.ZodOptional<z.ZodBoolean>;
    intent: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"plan-review">;
        approve: z.ZodString;
    }, z.core.$strip>], "kind">>;
}, z.core.$strip>;
/** MuxFrame union (payload slot of a mux-stream ServerRequest). */
export declare const muxFrameSchema: z.ZodType<MuxFrame>;
/** HostFrame union (payload slot of a host-stream ServerRequest). */
export declare const hostFrameSchema: z.ZodType<HostFrame>;
//# sourceMappingURL=events.schema.d.ts.map