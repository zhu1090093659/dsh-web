/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export type { ConnectionRpcAuthority, ConnectionRpcEndpointMatcher, ConnectionRpcHandler, ConnectionRpcHandlerOptions, HostConnectionHandle, HostConnectionRpc, } from './rpc.ts';
export { HostConnectionService } from './rpc-host.ts';
export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts';
/** Stable Cordis plugin name. */
export declare const name = "client-connection";
/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
export declare const inject: string[];
/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
    /**
     * Authorities this deployment serves beyond loopback: exact `host:port`, or
     * port-less `host` matching any port. The /api trust fence refuses any
     * request whose Host is neither loopback nor listed here, so a
     * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
     * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
     * that is not a bare, canonical authority fails the plugin load.
     */
    trustedHosts?: string[];
    /** Maximum buffered JSON body for every `/api` request. */
    maxRequestBodyBytes?: number;
}
export declare const Config: z<ConnectionConfig>;
/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the browser-trust fence first (DNS-rebinding and
 * cross-site defense — [api-request-trust](./api-request-trust.ts));
 * privileged methods additionally pass it with an empty trust list, which
 * pins them to loopback.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export declare function apply(ctx: Context, config?: ConnectionConfig): void;
//# sourceMappingURL=index.d.ts.map