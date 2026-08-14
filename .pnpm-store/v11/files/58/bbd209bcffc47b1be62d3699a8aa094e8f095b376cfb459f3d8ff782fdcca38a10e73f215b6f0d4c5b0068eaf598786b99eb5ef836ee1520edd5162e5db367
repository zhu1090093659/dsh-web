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
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { createApiProxy, DEFAULT_COLD_BLANK_PROBE_MAX_BYTES } from "./api-proxy.js";
import { DEFAULT_SESSION_LOG_COMPRESSION_LEVEL, } from "./session-export.js";
export { RpcId } from "./api/rpc.js";
export { toFetchHandler } from "./fetch/handler.js";
export { AbstractApiClient, InProcessApiClient } from "./fetch/client.js";
export { createApiProxy } from "./api-proxy.js";
/**
 * The API gateway service: implements the ApiProxy contract over the composed
 * host context and provides it as `ctx.apiProxy`. The Host cwd is the default
 * project directory.
 */
export class ApiProxyService extends Service {
    static inject = [
        'agentDefaultModel', 'agents', 'attachments', 'directoryPicker', 'llm', 'sessions', 'subagents', 'sessionQuery',
        'tools', 'userQuestions', 'workspaceRegistry',
    ];
    static Config = z.object({
        nativeOpen: z.boolean(),
        sessionExportCompressionLevel: z.number().step(1).min(0).max(9)
            .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL),
        coldBlankProbeMaxBytes: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES),
    });
    sessions;
    subagents;
    workspace;
    host;
    goals;
    skills;
    agentPresets;
    settings;
    credentials;
    llm;
    events;
    downloads;
    respond;
    constructor(ctx, config) {
        super(ctx, 'apiProxy');
        const api = createApiProxy(ctx, {
            defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
            saveDefaultModelSelection: selection => ctx.agentDefaultModel.saveSelection(selection),
            cwd: process.cwd(),
            ...config.nativeOpen === undefined ? {} : { canOpenPath: () => config.nativeOpen },
            ...(config.sessionExportCompressionLevel === undefined
                ? {}
                : { sessionExportCompressionLevel: config.sessionExportCompressionLevel }),
            ...(config.coldBlankProbeMaxBytes === undefined
                ? {}
                : { coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes }),
        });
        this.sessions = api.sessions;
        this.subagents = api.subagents;
        this.workspace = api.workspace;
        this.host = api.host;
        this.goals = api.goals;
        this.skills = api.skills;
        this.agentPresets = api.agentPresets;
        this.settings = api.settings;
        this.credentials = api.credentials;
        this.llm = api.llm;
        this.events = api.events;
        this.downloads = api.downloads;
        // createApiProxy returns closures (no `this` capture), so the bind is
        // behavior-neutral.
        this.respond = api.respond.bind(api);
    }
}
export default ApiProxyService;
//# sourceMappingURL=index.js.map