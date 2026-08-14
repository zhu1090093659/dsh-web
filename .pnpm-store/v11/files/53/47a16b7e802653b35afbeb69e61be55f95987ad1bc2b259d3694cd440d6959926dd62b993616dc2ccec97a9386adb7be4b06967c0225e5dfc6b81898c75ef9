/**
 * LLM service: adapter registry with a waterfall-interceptable streaming call
 * API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
 * provider backends, and `BlockAssembler` for chunk assembly.
 *
 * @module @deepseek-ai/dsh-llm
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { GenerateOptions, LlmConfigurableProvider, LlmDiscoveredModel, LlmFailure, LlmModelContext, LlmModelDiscoveryRequest, LlmModelInfo, LlmResolvedModelInfo, LlmProviderInfo, StreamChunk } from './types.ts';
import type { ResolvedRetryPolicy } from './retry-policy.ts';
import type { ProviderRequestId } from './brand.ts';
import type { LlmCallConfig, LlmCallConfigAdapterDefaults } from './call-config.ts';
import { HarnessError } from './error.ts';
export * from './attribution.ts';
export * from './brand.ts';
export * from './never.ts';
export * from './error.ts';
export * from './api-key.ts';
export * from './types.ts';
export * from './content.ts';
export * from './message.ts';
export * from './retry-policy.ts';
export { BlockAssembler } from './assembler.ts';
export { callConfigEquals, deepFreeze, isAgentLoopRequest, markAgentLoopRequest } from './call-config.ts';
export type { LlmCallConfig, LlmCallConfigAdapterDefaults } from './call-config.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        llm: LlmRuntime;
    }
    interface Events {
        /**
         * Waterfall around every streaming model call (retry, replay, routing).
         * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
         * adapter's stream, or yield your own chunks to short-circuit.
         * @param options - the full request. A LOOP-built request carries the
         *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
         *   (mutation throws): its content is a pure function of the session log (the
         *   reconstructability Agent Note), so listeners read it, never rewrite it.
         *   Hand-built calls do not carry that marker; their messages already obey
         *   the immutable creation contract.
         * @mode waterfall
         */
        'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
    }
}
/** Structured provider facts and cause accepted by {@link LlmError}. */
export interface LlmErrorOptions extends ErrorOptions {
    /** Valid HTTP status observed at the provider boundary. */
    status?: number;
    /** Positive finite provider-requested delay in milliseconds. */
    providerRetryAfterMs?: number;
    /** Non-empty opaque provider request id. */
    requestId?: ProviderRequestId;
}
/**
 * Typed error for LLM-related failures. Extends {@link HarnessError}, so the
 * `code` string (e.g. `AUTH`, `RATE_LIMIT`, `NO_ADAPTER`) is shared taxonomy.
 */
export declare class LlmError extends HarnessError {
    /** Serializable facts retained beside this live Error. */
    readonly failure: LlmFailure;
    /**
     * @param message - non-empty human-readable failure summary.
     * @param code - non-empty stable provider-neutral machine code.
     * @param options - optional cause and validated serializable provider facts.
     */
    constructor(message: string, code: string, options?: LlmErrorOptions);
}
/**
 * Accept one supplied credential, or refuse it as unusable.
 *
 * A stored key arrives from the credentials seam, a `.env` line, or a shell
 * export, all of which pick up surrounding whitespace, so trimming is silent.
 * Anything else fails here rather than inside `fetch`, whose ByteString
 * refusal names a UTF-16 code point instead of the setting to change. The key
 * never enters the message: `ref` names where to fix it, and echoing any part
 * of a secret into a log or a UI is the failure this diagnosis avoids.
 *
 * Lives beside {@link LlmError} rather than in `./api-key.ts` so the predicate
 * module stays dependency-free; both adapters share this one diagnosis instead
 * of keeping near-identical local copies.
 * @param raw - the credential exactly as supplied.
 * @param pkg - the refusing package name, prefixed to the diagnostic.
 * @param ref - the credential reference the value resolved through.
 * @returns the trimmed, usable key.
 */
export declare function assertUsableApiKey(raw: string, pkg: string, ref: string): string;
/** One model call whose config and adapter registration were resolved together. */
export interface PreparedLlmCall {
    /** Detached, deep-frozen config with any adapter-owned default materialized. */
    readonly config: LlmCallConfig;
    /** Immutable retry policy captured with the adapter registration. */
    readonly retryPolicy: ResolvedRetryPolicy;
    /** Detached context metadata resolved with the registration-bound call. */
    readonly context?: LlmModelContext;
    /** Config fields materialized by the captured adapter rather than proposed by the caller. */
    readonly adapterDefaults: LlmCallConfigAdapterDefaults;
    /**
     * Dispatch this call once through the registration captured during
     * preparation. The request's call-config fields must match {@link config};
     * reuse or mismatch fails with `INVALID_PREPARED_CALL`.
     * @param options - fully assembled request carrying the prepared config.
     * @returns the chunk stream, including the `llm/stream` waterfall.
     */
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * Provider-wire adapter for the harness message and stream vocabulary. Register implementations
 * with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
 * `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
 * DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
 */
export declare abstract class LlmAdapter {
    /**
     * Describe one provider route owned by this adapter.
     * @param provider - a route passed to `registerAdapter()` for this instance.
     * @returns detached display metadata whose id must equal `provider`.
     */
    providerInfo(provider: string): LlmProviderInfo;
    /**
     * Return the provider-owned retry policy captured with this route.
     * @param _provider - a route passed to `registerAdapter()` for this instance.
     * @returns a resolved policy, or `undefined` to use the normal defaults.
     */
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
    /**
     * List models this adapter can currently advertise for one owned provider.
     * The result is advisory: an adapter may accept unlisted model ids, and
     * consumers must not turn absence into request rejection.
     * @param _provider - one provider route owned by this adapter.
     * @returns discoverable models in adapter-preferred order.
     */
    listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
    /**
     * Resolve all metadata available for one exact model. This query is
     * independent of the advisory catalog and does not validate request routing.
     * @param provider - one provider route owned by this adapter.
     * @param model - exact model id passed to {@link GenerateOptions.model}.
     * @param _signal - cancellation for this exact-model lookup; asynchronous
     *   implementations must settle promptly after it aborts.
     * @returns provider/model identity plus any context, call-default, and reasoning metadata.
     */
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /**
     * Stream one model call as raw chunks. The only required method.
     * @param options - the fully-assembled request; implementations must honor `options.signal`.
     * @returns the chunk stream, obeying the adapter contract documented on `StreamChunk`.
     */
    abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * What {@link LlmRuntime.registerAdapter} returns: the disposer, plus an
 * atomic route replacement for the same adapter instance.
 */
export interface AdapterRegistrationHandle {
    /** Release every route this registration currently holds. */
    (): void;
    /**
     * Replace this registration's routes with `providers`, keeping the same
     * adapter instance. The candidate set is validated in full first — a
     * conflict with another adapter, an invalid name, or bad provider metadata
     * throws and leaves the current routes untouched — and the swap itself is
     * one synchronous section, so no request can observe a gap. An empty array
     * is legal here (a settings section that emptied holds zero routes while
     * staying registered), unlike an empty initial registration.
     *
     * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
     * has been released: its routes are gone and its disposer has already run,
     * so anything registered afterwards would have no owner left to release it.
     * @param providers - the complete next route set for this registration.
     */
    replace(providers: string[]): void;
}
/**
 * A live configurable-provider registration, disposable and atomically
 * replaceable — the directory counterpart of {@link AdapterRegistrationHandle}.
 */
export interface DirectoryRegistrationHandle {
    /** Withdraw every entry this registration currently holds. */
    (): void;
    /**
     * Replace this registration's entries with `entries`. The candidate set is
     * validated in full first — an entry another registration already declares,
     * a duplicate within the set, or invalid metadata throws and leaves the
     * current entries untouched — and the swap is one synchronous section, so no
     * reader observes a gap. An empty array is legal here, unlike an empty
     * initial registration.
     *
     * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
     * has been disposed.
     */
    replace(entries: readonly LlmConfigurableProvider[]): void;
}
/**
 * The abstract `llm` service: an adapter registry plus a streaming model-call
 * API, interceptable via the `llm/stream` waterfall.
 */
export declare class LlmRuntime extends Service {
    private adapters;
    private directory;
    private discoveries;
    constructor(ctx: Context);
    /** Notify topology observers without letting one broken listener veto the commit. */
    private emitAdaptersUpdated;
    /** Contained-listener diagnostic shared by the sync and async failure paths. */
    private warnAdaptersListenerFailure;
    /**
     * Register an adapter for the given provider routes. Throws `LlmError` with code
     * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
     * Disposed with the fiber.
     * @param providers - every provider route this adapter should serve.
     * @param adapter - the adapter that streams calls for those providers.
     * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
     */
    registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle;
    /**
     * Validate one candidate route set for `adapter`, treating routes this
     * registration already holds as available. Nothing is mutated: a rejected
     * candidate leaves the registry exactly as it was.
     */
    private prepareRoutes;
    /**
     * Swap this registration's routes for the prepared ones in one synchronous
     * section, so no observer can see the registry between the release and the
     * re-registration. The route set's one mutation point is also where
     * `llm/adapters-updated` is published, so a `replace` announces itself
     * exactly like a first registration.
     */
    private commitRoutes;
    /**
     * Describe provider routes with a registered adapter.
     * @returns detached provider metadata in registration order.
     */
    listProviders(): LlmProviderInfo[];
    /**
     * Declare provider routes an adapter plugin can activate through
     * configuration. Registration is all-or-nothing: an empty list, invalid
     * entry, or a provider already declared by any registration throws
     * `LlmError` without registering the rest. Disposed with the fiber.
     * @param entries - every configurable provider this plugin owns.
     * @returns a handle that withdraws all of them, and can atomically replace them.
     */
    registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle;
    /**
     * List every declared configurable provider, registered or dormant.
     * @returns detached directory entries in declaration order.
     */
    listConfigurableProviders(): LlmConfigurableProvider[];
    /**
     * Offer to interrogate provider endpoints on behalf of the settings
     * namespace this plugin owns. The namespace is the key because that is what
     * a configuration surface already holds from the configurable-provider
     * directory, and because a provider being *added* has no route to name yet.
     * Disposed with the fiber.
     * @param settingsNs - the namespace whose profiles this discovery serves.
     * @param discover - interrogates one endpoint; must honor `request.signal`.
     * @returns the disposer that withdraws the offer.
     */
    registerModelDiscovery(settingsNs: string, discover: (request: LlmModelDiscoveryRequest) => Promise<readonly LlmDiscoveredModel[]>): () => void;
    /**
     * Interrogate one provider endpoint for the models it advertises. The
     * request describes a draft, not a stored route, so nothing here reads or
     * writes settings or credentials — the caller owns both, and the reply is
     * candidate metadata a surface may offer for adoption.
     * @param settingsNs - namespace whose registered discovery serves this draft.
     * @param request - the endpoint, protocol, and one-shot credential to use.
     * @returns the advertised models, deduplicated in endpoint order.
     */
    discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<LlmDiscoveredModel[]>;
    /**
     * Resolve the retry policy captured when one provider route was registered.
     * @param provider - registered provider route to inspect.
     * @returns the provider-owned policy, with normal defaults already resolved.
     */
    providerRetryPolicy(provider: string): ResolvedRetryPolicy;
    /** Detach typed adapter-owned modality metadata. */
    private detachedModalities;
    /**
     * Discover models advertised by one registered provider. Catalog membership
     * is advisory and never changes routing or request validation.
     * @param provider - registered provider route to inspect.
     * @returns detached model metadata in adapter-preferred order.
     */
    listModels(provider: string): Promise<LlmModelInfo[]>;
    /**
     * Resolve and validate all metadata from the adapter that owns one exact
     * route. The result is detached from adapter-owned objects; catalog
     * membership remains advisory and does not control request routing.
     * @param provider - registered provider route to inspect.
     * @param model - exact model id passed to the adapter.
     * @param signal - optional cancellation for adapter-owned asynchronous lookup.
     * @returns exact model identity plus available context and reasoning metadata.
     */
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    private resolveModelInfoFor;
    /**
     * Validate a conversation call config against its exact model capability and
     * materialize adapter-configured defaults. Unsupported explicit efforts
     * reject before provider I/O; no clamping or aliasing is performed. This
     * standalone query does not bind a later dispatch; use {@link prepareCall}
     * when logging and streaming must share one adapter registration.
     * @param config - provider/model route and optional request controls.
     * @param signal - optional cancellation for adapter-owned capability lookup.
     * @returns a detached config only when a default must be materialized.
     */
    resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>;
    private resolveCallFor;
    /**
     * Resolve one call under its current adapter registration. The returned
     * one-shot handle keeps that registration across header logging and dispatch,
     * so HMR cannot combine one adapter's capability result with another adapter.
     * @param config - provider/model route and optional request controls.
     * @param signal - optional cancellation for adapter-owned capability lookup.
     * @returns a prepared config and its registration-bound stream entry point.
     */
    prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>;
    private registration;
    /** Remove replay state whose historical route is owned by another adapter. */
    private forAdapter;
    /**
     * Final adapter boundary. Adapter selection, dispatch, iterator construction,
     * and iteration failures become one terminal failure chunk. Middleware and
     * downstream consumer failures remain thrown plugin or consumer errors.
     */
    private adapterStream;
    /**
     * Stream one model call as raw chunks (token-level deltas). Replay state is
     * retained only when the same adapter instance owns its historical provider
     * and the target provider. Final adapter selection remains fixed through
     * asynchronous exact-model resolution and dispatch. Adapter selection,
     * dispatch, and iteration failures become terminal `error` or `aborted`
     * finish chunks; middleware, nested-call, cleanup, and consumer failures
     * remain thrown.
     * @param options - the full request; `options.provider` selects the adapter.
     * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
     */
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private streamWithRegistration;
}
export default LlmRuntime;
//# sourceMappingURL=index.d.ts.map