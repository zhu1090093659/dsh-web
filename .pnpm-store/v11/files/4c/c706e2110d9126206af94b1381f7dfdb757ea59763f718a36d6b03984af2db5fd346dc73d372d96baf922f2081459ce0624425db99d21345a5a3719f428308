/**
 * credentials domain zod schemas (names derived from map keys:
 * credentialsDescribeRequestSchema / credentialsDescribeValueSchema / …).
 * The reference-name pattern mirrors the seam's `credentialRef` guard so an
 * invalid name fails as `bad-request` before reaching the service.
 */
import { z } from 'zod';
/** POSIX-portable environment-variable name (the seam's `credentialRef` pattern). */
export const credentialRefNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
/** CredentialView entry of credentials.describe. */
export const credentialViewSchema = z.object({
    configured: z.boolean(),
    source: z.string().optional(),
    writable: z.boolean(),
});
/** credentials.describe request payload. */
export const credentialsDescribeRequestSchema = z.object({
    refs: z.array(credentialRefNameSchema).max(64),
});
/** credentials.describe response value. */
export const credentialsDescribeValueSchema = z.object({
    credentials: z.record(z.string(), credentialViewSchema),
});
/** credentials.set request payload: the one direction a value crosses this wire. */
export const credentialsSetRequestSchema = z.object({
    ref: credentialRefNameSchema,
    value: z.string().min(1),
});
/** credentials.set response value. */
export const credentialsSetValueSchema = z.object({});
/** credentials.unset request payload. */
export const credentialsUnsetRequestSchema = z.object({
    ref: credentialRefNameSchema,
});
/** credentials.unset response value. */
export const credentialsUnsetValueSchema = z.object({});
//# sourceMappingURL=credentials.schema.js.map