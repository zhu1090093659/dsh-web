/**
 * Four-quadrant RPC message model. Channels and messages are decoupled: HTTP,
 * WebSocket, and in-process SSE are physical carriers, while logical messages
 * are channel-independent and form a four-member discriminated union.
 * api/ contract layer: zero Node dependencies, importable from the browser.
 */
/**
 * Brands a string as RpcId (same precedent as core `SessionId()`). Minted by the initiator:
 * client-request → client mints; server-request → host mints (answerable frames get a stable
 * logical id, pure pushes mint a fresh one each time).
 * @param id - Raw id string (implementations mint UUIDs; tests may pass fixtures).
 * @returns The same string, branded (compile-time cast, zero runtime cost).
 */
export function RpcId(id) {
    return id;
}
/**
 * Fold a transport exception into the RpcResult error branch (unified error
 * API; 'internal' as the catch-all code). Lives with RpcResult so every
 * carrier consumer folds the same way.
 * @param error - the thrown value from the carrier.
 * @returns the error branch of an RpcResult.
 */
export function transportError(error) {
    return {
        ok: false,
        error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
    };
}
//# sourceMappingURL=rpc.js.map