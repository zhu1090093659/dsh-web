/**
 * host domain zod schemas (names derived from map keys).
 */
import { z } from 'zod';
/** host.describe request payload (empty object literal). */
export declare const hostDescribeRequestSchema: z.ZodObject<{}, z.core.$strip>;
/** host.describe response value. */
export declare const hostDescribeValueSchema: z.ZodObject<{
    version: z.ZodString;
    cwd: z.ZodString;
    provider: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    attachedSessions: z.ZodNumber;
    canOpenPath: z.ZodBoolean;
}, z.core.$strip>;
/** host.pickDirectory request payload (empty object literal). */
export declare const hostPickDirectoryRequestSchema: z.ZodObject<{}, z.core.$strip>;
/** host.pickDirectory response value; null means the user cancelled. */
export declare const hostPickDirectoryValueSchema: z.ZodObject<{
    path: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** Directory row shared by listing entries and breadcrumb crumbs. */
export declare const directoryEntrySchema: z.ZodObject<{
    name: z.ZodString;
    path: z.ZodString;
    hidden: z.ZodBoolean;
}, z.core.$strip>;
/** host.listDirectory request payload; an absent path lists the home directory. */
export declare const hostListDirectoryRequestSchema: z.ZodObject<{
    path: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** host.listDirectory response value. */
export declare const hostListDirectoryValueSchema: z.ZodObject<{
    path: z.ZodString;
    home: z.ZodString;
    crumbs: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        path: z.ZodString;
        hidden: z.ZodBoolean;
    }, z.core.$strip>>;
    entries: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        path: z.ZodString;
        hidden: z.ZodBoolean;
    }, z.core.$strip>>;
    truncated: z.ZodBoolean;
}, z.core.$strip>;
/** host.createDirectory request payload: name must be one plain path segment. */
export declare const hostCreateDirectoryRequestSchema: z.ZodObject<{
    path: z.ZodString;
    name: z.ZodString;
}, z.core.$strip>;
/** host.createDirectory response value: the created directory's absolute path. */
export declare const hostCreateDirectoryValueSchema: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strip>;
/** host.openPath request payload. */
export declare const hostOpenPathRequestSchema: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strip>;
/** host.openPath response value. */
export declare const hostOpenPathValueSchema: z.ZodObject<{
    opened: z.ZodLiteral<true>;
}, z.core.$strip>;
//# sourceMappingURL=host.schema.d.ts.map