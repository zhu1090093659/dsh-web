/**
 * downloads domain zod schemas. The download surface has no wire
 * envelope: the request arrives as query parameters (all strings), so its
 * request schema parses the raw query-parameter object into the method's
 * exact request shape. SessionId brand cast point: sessionIdSchema, and only
 * there (hosted in sessions.schema like every other cast).
 */
import { z } from 'zod';
/**
 * session.export query params → the sessionLog request. `includeDescendants`
 * accepts exactly `true`/`false`/absent; any other value is rejected (400) so
 * a misspelled flag cannot silently under-export.
 */
export declare const sessionLogQuerySchema: z.ZodPipe<z.ZodObject<{
    sessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    includeDescendants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"true">, z.ZodLiteral<"false">]>>;
}, z.core.$strip>, z.ZodTransform<{
    includeDescendants?: true;
    sessionId: import("@deepseek-ai/dsh-session").SessionId;
}, {
    sessionId: import("@deepseek-ai/dsh-session").SessionId;
    includeDescendants?: "true" | "false" | undefined;
}>>;
//# sourceMappingURL=downloads.schema.d.ts.map