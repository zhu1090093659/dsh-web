/** Host registry and HTTP adapter for generic Connection RPC channels. */
import { Context, Service } from '@deepseek-ai/cordis';
import { type FetchHandler } from './http-bridge.ts';
import type { HostConnectionHandle, HostConnectionRpc } from './rpc.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Host Connection transport and RPC registrations. */
        connection: HostConnectionHandle;
    }
}
/** Host Connection service whose channel registrations belong to the caller fiber. */
export declare class HostConnectionService extends Service implements HostConnectionHandle {
    private readonly trustedHosts;
    private readonly interceptors;
    /**
     * Provide the Host half over the active HTTP server.
     * @param ctx - owning Connection plugin context.
     * @param trustedHosts - deployment authorities accepted by trusted-host channels.
     */
    constructor(ctx: Context, trustedHosts: readonly string[]);
    /** Generic channel registry scoped to the Context reading this service. */
    get rpc(): HostConnectionRpc;
    /**
     * Compose one shared-channel Fetch handler from its interceptor and fallback.
     * @param channel - shared channel mounted by Connection.
     * @param fallback - handler for endpoints not claimed by the interceptor.
     * @returns Fetch handler that selects exactly one target for each request.
     */
    createSharedFetchHandler(channel: '/api', fallback: FetchHandler): FetchHandler;
    private register;
    private registerInterceptor;
}
//# sourceMappingURL=rpc-host.d.ts.map