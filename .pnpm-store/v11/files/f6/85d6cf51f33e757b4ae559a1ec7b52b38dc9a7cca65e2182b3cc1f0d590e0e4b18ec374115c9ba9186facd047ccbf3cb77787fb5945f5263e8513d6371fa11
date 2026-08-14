/**
 * goals domain contract. Method signatures are the source of truth:
 * unary methods take the RpcRequest<P> narrow form and the impl echoes rpcId.
 *
 * Mutations only: the read side is the 'goal' session projection (history
 * tail-page projections block + session/projection frames), so there is no
 * goal.get and no wire goal view — responses acknowledge with the new CAS
 * ref and never feed client state (the committed goal/change event reaches
 * every client through the mux stream carrying the same whole value).
 */
export {};
//# sourceMappingURL=goals.js.map