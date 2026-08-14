/**
 * @deepseek-ai/dsh-host-apiproxy — the API gateway every client shape shares:
 * the ApiProxy contract (api/: types + zod schemas, browser-safe), the fetch
 * carrier pair (fetch/: toFetchHandler on the host side, AbstractApiClient +
 * platform subclasses on the client side), and the host-side implementation
 * (api-proxy.ts: createApiProxy + the ApiProxyService gateway plugin providing
 * `ctx.apiProxy`). Transport-agnostic by design: this package registers no
 * routes — physical carriers wrap `ctx.apiProxy` themselves.
 *
 * The gateway consumes `ctx.agentDefaultModel`, the transport-independent default
 * shared with direct entry points. Switching models persists through that
 * service; sessions that have already logged a selection remain unchanged.
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ApiProxy } from './api/index.ts';
export type * from './api/index.ts';
export { RpcId } from './api/rpc.ts';
export { toFetchHandler } from './fetch/handler.ts';
export { AbstractApiClient, InProcessApiClient } from './fetch/client.ts';
export type { IApiClient } from './fetch/client.ts';
export { createApiProxy } from './api-proxy.ts';
export type { ApiProxyDefaults } from './api-proxy.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** The host-side ApiProxy implementation (the transport-agnostic gateway face). */
        apiProxy: ApiProxy;
    }
}
/** Gateway plugin configuration. */
export interface Config {
    /**
     * Whether this deployment can hand paths to a native desktop opener —
     * the `hasDocument` capability the agent-preset roster reports. Absent,
     * the platform is asked (macOS/Windows/WSL yes; Linux only with a display
     * server); set it explicitly where detection misleads, e.g. `false` in a
     * container whose DISPLAY points nowhere a user can see.
     */
    nativeOpen?: boolean;
    /**
     * DEFLATE level for every session-log ZIP entry: `0` stores without
     * compression, `1` favors CPU/latency, and `9` favors archive size.
     * @default 6
     */
    sessionExportCompressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    /**
     * Maximum physical size of a cold Session artifact eligible for blankness
     * verification. Zero disables probes.
     * @default 1024
     */
    coldBlankProbeMaxBytes?: number;
}
/**
 * The API gateway service: implements the ApiProxy contract over the composed
 * host context and provides it as `ctx.apiProxy`. The Host cwd is the default
 * project directory.
 */
export declare class ApiProxyService extends Service implements ApiProxy {
    static inject: string[];
    static Config: z<Config>;
    readonly sessions: ApiProxy['sessions'];
    readonly subagents: ApiProxy['subagents'];
    readonly workspace: ApiProxy['workspace'];
    readonly host: ApiProxy['host'];
    readonly goals: ApiProxy['goals'];
    readonly skills: ApiProxy['skills'];
    readonly agentPresets: ApiProxy['agentPresets'];
    readonly settings: ApiProxy['settings'];
    readonly credentials: ApiProxy['credentials'];
    readonly llm: ApiProxy['llm'];
    readonly events: ApiProxy['events'];
    readonly downloads: ApiProxy['downloads'];
    readonly respond: ApiProxy['respond'];
    constructor(ctx: Context, config: Config);
}
export default ApiProxyService;
//# sourceMappingURL=index.d.ts.map