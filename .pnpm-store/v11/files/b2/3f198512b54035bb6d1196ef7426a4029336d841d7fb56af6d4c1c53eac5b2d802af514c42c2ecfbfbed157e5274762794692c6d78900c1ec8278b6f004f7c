/**
 * credentials domain zod schemas (names derived from map keys:
 * credentialsDescribeRequestSchema / credentialsDescribeValueSchema / …).
 * The reference-name pattern mirrors the seam's `credentialRef` guard so an
 * invalid name fails as `bad-request` before reaching the service.
 */
import { z } from 'zod';
/** POSIX-portable environment-variable name (the seam's `credentialRef` pattern). */
export declare const credentialRefNameSchema: z.ZodString;
/** CredentialView entry of credentials.describe. */
export declare const credentialViewSchema: z.ZodObject<{
    configured: z.ZodBoolean;
    source: z.ZodOptional<z.ZodString>;
    writable: z.ZodBoolean;
}, z.core.$strip>;
/** credentials.describe request payload. */
export declare const credentialsDescribeRequestSchema: z.ZodObject<{
    refs: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/** credentials.describe response value. */
export declare const credentialsDescribeValueSchema: z.ZodObject<{
    credentials: z.ZodRecord<z.ZodString, z.ZodObject<{
        configured: z.ZodBoolean;
        source: z.ZodOptional<z.ZodString>;
        writable: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** credentials.set request payload: the one direction a value crosses this wire. */
export declare const credentialsSetRequestSchema: z.ZodObject<{
    ref: z.ZodString;
    value: z.ZodString;
}, z.core.$strip>;
/** credentials.set response value. */
export declare const credentialsSetValueSchema: z.ZodObject<{}, z.core.$strip>;
/** credentials.unset request payload. */
export declare const credentialsUnsetRequestSchema: z.ZodObject<{
    ref: z.ZodString;
}, z.core.$strip>;
/** credentials.unset response value. */
export declare const credentialsUnsetValueSchema: z.ZodObject<{}, z.core.$strip>;
//# sourceMappingURL=credentials.schema.d.ts.map