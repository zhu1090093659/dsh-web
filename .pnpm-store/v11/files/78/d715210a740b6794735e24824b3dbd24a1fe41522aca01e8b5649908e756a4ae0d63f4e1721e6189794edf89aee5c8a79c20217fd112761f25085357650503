/**
 * approvals domain zod schemas (respond is a client-response; the payload schema serves
 * the /api/respond endpoint's second parse after routing via the pending table).
 * ApprovalRequestId brand cast point: one.
 */
import { z } from 'zod';
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types';
/** ApprovalRequestId: one brand cast after schema validation (the only cast point in this domain). */
export declare const approvalRequestIdSchema: z.ZodType<ApprovalRequestId>;
/** Approval answer payload (the result.value slot of a client-response). */
export declare const approvalResponsePayloadSchema: z.ZodObject<{
    sessionId: z.ZodType<import("@deepseek-ai/dsh-session").SessionId, unknown, z.core.$ZodTypeInternals<import("@deepseek-ai/dsh-session").SessionId, unknown>>;
    approvalId: z.ZodType<ApprovalRequestId, unknown, z.core.$ZodTypeInternals<ApprovalRequestId, unknown>>;
    outcome: z.ZodUnion<readonly [z.ZodLiteral<"allowed-once">, z.ZodLiteral<"rejected">]>;
}, z.core.$strip>;
//# sourceMappingURL=approvals.schema.d.ts.map