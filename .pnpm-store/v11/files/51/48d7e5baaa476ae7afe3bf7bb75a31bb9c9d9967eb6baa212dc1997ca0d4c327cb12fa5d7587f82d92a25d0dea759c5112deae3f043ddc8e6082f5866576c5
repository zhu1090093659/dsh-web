/**
 * Message-layer zod schemas: the four wire full forms + error body +
 * carrier receipt. The payload slot is unknown in the full-form schemas — business payloads
 * get a second parse dispatched by method (two-level parse discipline).
 * Brand cast point: rpcIdSchema, and only there.
 */
import { z } from 'zod';
import type { ClientRequest, ClientResponse, RpcError, RpcId, ServerRequest, ServerResponse } from './rpc.ts';
/**
 * Wire widening of a contract type: widens every property (deeply) to `original | undefined`.
 * The repo enables exactOptionalPropertyTypes while zod `.optional()` outputs `T | undefined`,
 * so `satisfies z.ZodType<ContractType>` is unusable across the board; anchoring is always
 * written `satisfies z.ZodType<Wire<ContractType>>` — the widening only adds undefined, so
 * missing fields / wrong types still fail to compile. On the JSON wire, "absent" and
 * "value undefined" serialize identically, so the widening loses no validation semantics.
 */
export type Wire<T> = T extends readonly (infer E)[] ? Wire<E>[] : T extends object ? {
    [K in keyof T]: Wire<T[K]> | undefined;
} : T;
/**
 * RpcId: one brand cast after schema validation (the only cast point in this
 * file). No min-length: the id is an opaque echo token, and rejecting values
 * here would only turn a correlatable error report into a client-side parse
 * failure (the handler substitutes a sentinel when a request's id is unreadable).
 */
export declare const rpcIdSchema: z.ZodType<RpcId>;
/** Error body: discriminated by code, per-branch details aligned to RpcErrorDetailsMap; details is required. */
export declare const rpcErrorSchema: z.ZodType<RpcError>;
/**
 * Business success/failure result schema (generic, reusable).
 * @param value - Schema for the business value.
 * @returns Schema for RpcResult<T>.
 */
export declare function rpcResultSchema<T>(value: z.ZodType<T>): z.ZodUnion<readonly [z.ZodType, z.ZodType]>;
/** ClientRequest full form (payload stays wide — the business layer runs the second parse). */
export declare const clientRequestSchema: z.ZodType<ClientRequest>;
/** ServerResponse full form (result.value stays wide). */
export declare const serverResponseSchema: z.ZodType<ServerResponse>;
/** ServerRequest full form (payload stays wide). */
export declare const serverRequestSchema: z.ZodType<ServerRequest>;
/** ClientResponse full form (result.value stays wide). */
export declare const clientResponseSchema: z.ZodType<ClientResponse>;
/** Wire full-form union (discriminated by type). */
export declare const rpcMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<Readonly<{
    [k: string]: z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
}>, z.core.$strip>, z.ZodObject<Readonly<{
    [k: string]: z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
}>, z.core.$strip>, z.ZodObject<Readonly<{
    [k: string]: z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
}>, z.core.$strip>, z.ZodObject<Readonly<{
    [k: string]: z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
}>, z.core.$strip>], "type">;
/** Carrier receipt schema. */
export declare const rpcReceiptSchema: z.ZodUnion<readonly [z.ZodObject<{
    accepted: z.ZodLiteral<true>;
}, z.core.$strip>, z.ZodObject<{
    accepted: z.ZodLiteral<false>;
    reason: z.ZodUnion<readonly [z.ZodLiteral<"not-pending">, z.ZodLiteral<"bad-response">]>;
}, z.core.$strip>]>;
//# sourceMappingURL=rpc.schema.d.ts.map