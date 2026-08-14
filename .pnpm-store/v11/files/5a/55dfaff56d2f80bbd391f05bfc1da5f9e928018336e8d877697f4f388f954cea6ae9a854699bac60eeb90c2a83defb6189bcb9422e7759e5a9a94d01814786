/**
 * approvals domain zod schemas (respond is a client-response; the payload schema serves
 * the /api/respond endpoint's second parse after routing via the pending table).
 * ApprovalRequestId brand cast point: one.
 */
import { z } from 'zod';
import { sessionIdSchema } from "./sessions.schema.js";
/** ApprovalRequestId: one brand cast after schema validation (the only cast point in this domain). */
export const approvalRequestIdSchema = z.string().min(1);
/** Approval answer payload (the result.value slot of a client-response). */
export const approvalResponsePayloadSchema = z.object({
    sessionId: sessionIdSchema,
    approvalId: approvalRequestIdSchema,
    outcome: z.union([z.literal('allowed-once'), z.literal('rejected')]),
});
//# sourceMappingURL=approvals.schema.js.map