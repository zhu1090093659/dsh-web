/**
 * settings domain zod schemas (names derived from map keys: settingsDescribeRequestSchema /
 * settingsDescribeValueSchema / settingsUpdate* / settingsReplace*).
 */
import { z } from 'zod';
import type { Wire } from './rpc.schema.ts';
import type { SettingsPathOpView } from './settings.ts';
/** One redacted secret slot. */
export declare const settingsSecretViewSchema: z.ZodObject<{
    path: z.ZodArray<z.ZodString>;
    set: z.ZodBoolean;
}, z.core.$strip>;
/** SettingsNamespaceView row of settings.describe and the write responses. */
export declare const settingsNamespaceViewSchema: z.ZodObject<{
    ns: z.ZodString;
    schema: z.ZodUnknown;
    value: z.ZodUnknown;
    base: z.ZodOptional<z.ZodUnknown>;
    user: z.ZodOptional<z.ZodUnknown>;
    applies: z.ZodUnion<readonly [z.ZodLiteral<"live">, z.ZodLiteral<"restart">]>;
    secrets: z.ZodArray<z.ZodObject<{
        path: z.ZodArray<z.ZodString>;
        set: z.ZodBoolean;
    }, z.core.$strip>>;
    revision: z.ZodNumber;
}, z.core.$strip>;
/** settings.describe request payload. */
export declare const settingsDescribeRequestSchema: z.ZodObject<{}, z.core.$strip>;
/** settings.describe response value. */
export declare const settingsDescribeValueSchema: z.ZodObject<{
    writable: z.ZodBoolean;
    hasDocument: z.ZodBoolean;
    namespaces: z.ZodArray<z.ZodObject<{
        ns: z.ZodString;
        schema: z.ZodUnknown;
        value: z.ZodUnknown;
        base: z.ZodOptional<z.ZodUnknown>;
        user: z.ZodOptional<z.ZodUnknown>;
        applies: z.ZodUnion<readonly [z.ZodLiteral<"live">, z.ZodLiteral<"restart">]>;
        secrets: z.ZodArray<z.ZodObject<{
            path: z.ZodArray<z.ZodString>;
            set: z.ZodBoolean;
        }, z.core.$strip>>;
        revision: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** settings.openDocument request payload. */
export declare const settingsOpenDocumentRequestSchema: z.ZodObject<{}, z.core.$strip>;
/** settings.openDocument response value. */
export declare const settingsOpenDocumentValueSchema: z.ZodObject<{
    opened: z.ZodLiteral<true>;
}, z.core.$strip>;
/** settings.update request payload. */
export declare const settingsUpdateRequestSchema: z.ZodObject<{
    ns: z.ZodString;
    patch: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    expectedRevision: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** settings.update response value: the namespace's new redacted view. */
export declare const settingsUpdateValueSchema: z.ZodObject<{
    ns: z.ZodString;
    schema: z.ZodUnknown;
    value: z.ZodUnknown;
    base: z.ZodOptional<z.ZodUnknown>;
    user: z.ZodOptional<z.ZodUnknown>;
    applies: z.ZodUnion<readonly [z.ZodLiteral<"live">, z.ZodLiteral<"restart">]>;
    secrets: z.ZodArray<z.ZodObject<{
        path: z.ZodArray<z.ZodString>;
        set: z.ZodBoolean;
    }, z.core.$strip>>;
    revision: z.ZodNumber;
}, z.core.$strip>;
/** settings.replace request payload. */
export declare const settingsReplaceRequestSchema: z.ZodObject<{
    ns: z.ZodString;
    section: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    expectedRevision: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** One path-addressed edit of settings.mutate. */
export declare const settingsPathOpSchema: z.ZodType<Wire<SettingsPathOpView>>;
/** settings.mutate request payload. */
export declare const settingsMutateRequestSchema: z.ZodObject<{
    ns: z.ZodString;
    ops: z.ZodArray<z.ZodType<Wire<SettingsPathOpView>, unknown, z.core.$ZodTypeInternals<Wire<SettingsPathOpView>, unknown>>>;
    expectedRevision: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** settings.mutate response value: the namespace's new redacted view. */
export declare const settingsMutateValueSchema: z.ZodObject<{
    ns: z.ZodString;
    schema: z.ZodUnknown;
    value: z.ZodUnknown;
    base: z.ZodOptional<z.ZodUnknown>;
    user: z.ZodOptional<z.ZodUnknown>;
    applies: z.ZodUnion<readonly [z.ZodLiteral<"live">, z.ZodLiteral<"restart">]>;
    secrets: z.ZodArray<z.ZodObject<{
        path: z.ZodArray<z.ZodString>;
        set: z.ZodBoolean;
    }, z.core.$strip>>;
    revision: z.ZodNumber;
}, z.core.$strip>;
/** settings.replace response value. */
export declare const settingsReplaceValueSchema: z.ZodObject<{
    ns: z.ZodString;
    schema: z.ZodUnknown;
    value: z.ZodUnknown;
    base: z.ZodOptional<z.ZodUnknown>;
    user: z.ZodOptional<z.ZodUnknown>;
    applies: z.ZodUnion<readonly [z.ZodLiteral<"live">, z.ZodLiteral<"restart">]>;
    secrets: z.ZodArray<z.ZodObject<{
        path: z.ZodArray<z.ZodString>;
        set: z.ZodBoolean;
    }, z.core.$strip>>;
    revision: z.ZodNumber;
}, z.core.$strip>;
//# sourceMappingURL=settings.schema.d.ts.map