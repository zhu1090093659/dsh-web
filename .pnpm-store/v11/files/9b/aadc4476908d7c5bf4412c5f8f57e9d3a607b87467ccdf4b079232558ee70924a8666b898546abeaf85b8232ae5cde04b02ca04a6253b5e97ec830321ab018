/**
 * node:http ↔ WHATWG fetch bridge for the /api transport (host side of the
 * web carrier; the fetch-shaped handler itself is transport-agnostic).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Default carrier cap for all HTTP RPC bodies: sized for the default
 * aggregate image limit (100 MiB) after base64 expansion plus envelope
 * headroom (~134.3 MiB required), rounded up for slack. The bridge buffers
 * each body in memory, so this cap is also the per-request resident bound. */
export declare const DEFAULT_MAX_REQUEST_BODY_BYTES: number;
/** Transport-independent request handler consumed by the Host HTTP bridge. */
export interface FetchHandler {
    /**
     * Handle one standard Fetch request.
     * @param request - request produced by the active transport bridge.
     * @returns complete or streaming Fetch response.
     */
    fetch(request: Request): Promise<Response>;
}
/**
 * Bridge one node:http request to the fetch-shaped handler (client close
 * aborts; SSE bodies stream out chunk by chunk).
 * @param req - incoming node:http request (fully read before dispatch).
 * @param res - node:http response the bridge writes and owns to completion.
 * @param apiHandler - fetch-shaped API carrier the request is dispatched to.
 * @param maxRequestBodyBytes - maximum body bytes buffered before dispatch.
 */
export declare function bridge(req: IncomingMessage, res: ServerResponse, apiHandler: FetchHandler, maxRequestBodyBytes?: number): Promise<void>;
//# sourceMappingURL=http-bridge.d.ts.map