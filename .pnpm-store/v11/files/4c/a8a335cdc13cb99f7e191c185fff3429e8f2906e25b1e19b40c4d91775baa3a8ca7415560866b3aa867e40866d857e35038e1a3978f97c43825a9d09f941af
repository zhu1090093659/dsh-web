/** Browser API carrier: HTTP upstream plus one WebSocket per downstream event stream. */
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest } from './api.ts';
import { AbstractApiClient } from './api.ts';
/** Browser platform subclass: unary/respond use fetch; mux/host use downlink-only WebSockets. */
export declare class WebApiClient extends AbstractApiClient {
    protected doFetch(input: URL, init?: RequestInit): Promise<Response>;
    protected openMux(_payload: Parameters<ApiProxy['events']['mux']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>>;
    protected openHost(_payload: Parameters<ApiProxy['events']['host']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>>;
    private readWebSocket;
}
//# sourceMappingURL=web-api-client.d.ts.map