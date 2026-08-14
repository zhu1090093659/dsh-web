/**
 * Server side of the fetch carrier: maps an ApiProxy onto a pure
 * WHATWG Request->Response function. Two-level parse: full form (type/rpcId/method +
 * path==method) -> payload dispatched per method. HTTP status expresses only the carrier
 * (404 unknown path / 415 non-JSON media type / 400 non-JSON body / 500 handler crash);
 * business errors are always 200 + ServerResponse.
 */
import type { ApiProxy } from '../api/index.ts';
/**
 * Wraps an ApiProxy into a pure fetch function (isomorphic point: feed the returned fetch straight to InProcessApiClient).
 * @param api - the host-side ApiProxy implementation.
 * @returns an object holding `fetch(Request)`; paths outside /api/ return 404.
 */
export declare function toFetchHandler(api: ApiProxy): {
    fetch: typeof fetch;
};
//# sourceMappingURL=handler.d.ts.map