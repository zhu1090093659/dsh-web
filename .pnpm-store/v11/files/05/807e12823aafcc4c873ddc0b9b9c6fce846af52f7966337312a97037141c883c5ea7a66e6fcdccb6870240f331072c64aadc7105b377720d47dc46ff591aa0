/**
 * LLM service: adapter registry with a waterfall-interceptable streaming call
 * API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
 * provider backends, and `BlockAssembler` for chunk assembly.
 *
 * @module @deepseek-ai/dsh-llm
 */
import { Service } from '@deepseek-ai/cordis';
import { freezeMessage } from "./message.js";
import { resolveRetryPolicy } from "./retry-policy.js";
import { callConfigEquals, deepFreeze } from "./call-config.js";
import { HarnessError, INVALID_CREDENTIAL_CODE } from "./error.js";
import { normalizeLlmFailure } from "./adapter-failure.js";
import { normalizeApiKey } from "./api-key.js";
export * from "./attribution.js";
export * from "./brand.js";
export * from "./never.js";
export * from "./error.js";
export * from "./api-key.js";
export * from "./types.js";
export * from "./content.js";
export * from "./message.js";
export * from "./retry-policy.js";
export { BlockAssembler } from "./assembler.js";
export { callConfigEquals, deepFreeze, isAgentLoopRequest, markAgentLoopRequest } from "./call-config.js";
/**
 * Typed error for LLM-related failures. Extends {@link HarnessError}, so the
 * `code` string (e.g. `AUTH`, `RATE_LIMIT`, `NO_ADAPTER`) is shared taxonomy.
 */
export class LlmError extends HarnessError {
    /** Serializable facts retained beside this live Error. */
    failure;
    /**
     * @param message - non-empty human-readable failure summary.
     * @param code - non-empty stable provider-neutral machine code.
     * @param options - optional cause and validated serializable provider facts.
     */
    constructor(message, code, options) {
        if (typeof message !== 'string' || message.length === 0)
            throw new Error('LlmError message must be a non-empty string');
        if (typeof code !== 'string' || code.length === 0)
            throw new Error('LlmError code must be a non-empty string');
        if (options?.status !== undefined
            && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) {
            throw new Error('LlmError status must be an integer from 100 through 599');
        }
        if (options?.providerRetryAfterMs !== undefined
            && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) {
            throw new Error('LlmError providerRetryAfterMs must be a positive finite number');
        }
        if (options?.requestId !== undefined
            && (typeof options.requestId !== 'string' || options.requestId.length === 0)) {
            throw new Error('LlmError requestId must be a non-empty string');
        }
        super(message, code, options);
        this.name = 'LlmError';
        this.failure = Object.freeze({
            message,
            code,
            ...options?.status === undefined ? {} : { status: options.status },
            ...options?.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
            ...options?.requestId === undefined ? {} : { requestId: options.requestId },
        });
    }
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
export function assertUsableApiKey(raw, pkg, ref) {
    const checked = normalizeApiKey(raw);
    if (checked.ok)
        return checked.value;
    // The Models page is named as the writer it usually is, not as the only one:
    // the same value can arrive from a hand-edited .env or a shell export in a
    // composition that mounts no credentials seam at all, where directing the
    // user to a page that deployment does not serve would be a dead end.
    throw new LlmError(checked.reason === 'empty'
        ? `${pkg}: the API key resolved from ${ref} is blank; set ${ref} to the raw key`
            + ' (the web Models page writes it) or export it in the launching environment'
        : `${pkg}: the API key resolved from ${ref} contains characters no HTTP header can carry;`
            + ` set ${ref} to the raw key alone (the web Models page writes it)`, INVALID_CREDENTIAL_CODE);
}
/**
 * Provider-wire adapter for the harness message and stream vocabulary. Register implementations
 * with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
 * `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
 * DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
 */
export class LlmAdapter {
    /**
     * Describe one provider route owned by this adapter.
     * @param provider - a route passed to `registerAdapter()` for this instance.
     * @returns detached display metadata whose id must equal `provider`.
     */
    providerInfo(provider) {
        return { id: provider, name: provider };
    }
    /**
     * Return the provider-owned retry policy captured with this route.
     * @param _provider - a route passed to `registerAdapter()` for this instance.
     * @returns a resolved policy, or `undefined` to use the normal defaults.
     */
    providerRetryPolicy(_provider) {
        return undefined;
    }
    /**
     * List models this adapter can currently advertise for one owned provider.
     * The result is advisory: an adapter may accept unlisted model ids, and
     * consumers must not turn absence into request rejection.
     * @param _provider - one provider route owned by this adapter.
     * @returns discoverable models in adapter-preferred order.
     */
    listModels(_provider) {
        return Promise.resolve([]);
    }
    /**
     * Resolve all metadata available for one exact model. This query is
     * independent of the advisory catalog and does not validate request routing.
     * @param provider - one provider route owned by this adapter.
     * @param model - exact model id passed to {@link GenerateOptions.model}.
     * @param _signal - cancellation for this exact-model lookup; asynchronous
     *   implementations must settle promptly after it aborts.
     * @returns provider/model identity plus any context, call-default, and reasoning metadata.
     */
    resolveModel(provider, model, _signal) {
        return Promise.resolve({ provider, id: model, name: model });
    }
}
/**
 * The abstract `llm` service: an adapter registry plus a streaming model-call
 * API, interceptable via the `llm/stream` waterfall.
 */
export class LlmRuntime extends Service {
    adapters = new Map();
    directory = new Map();
    discoveries = new Map();
    constructor(ctx) {
        super(ctx, 'llm');
    }
    /** Notify topology observers without letting one broken listener veto the commit. */
    emitAdaptersUpdated() {
        // Cordis emit uses Array.map: one synchronous throw starves later
        // listeners. Registry notifications are non-vetoing, so contain each
        // callback independently; INVARIANT-coded failures still surface.
        let invariantFailure;
        for (const listener of this.ctx.events.dispatch('emit', ['llm/adapters-updated'])) {
            try {
                const returned = listener();
                if (returned != null && typeof returned.then === 'function') {
                    // An emit listener may still be an async function; its rejection
                    // cannot reach the synchronous INVARIANT rethrow below, so it is
                    // contained here instead of becoming an unhandled rejection.
                    void Promise.resolve(returned).then(undefined, (error) => {
                        this.warnAdaptersListenerFailure(error);
                    });
                }
            }
            catch (error) {
                if (error?.code === 'INVARIANT') {
                    invariantFailure ??= error;
                    continue;
                }
                this.warnAdaptersListenerFailure(error);
            }
        }
        if (invariantFailure !== undefined)
            throw invariantFailure;
    }
    /** Contained-listener diagnostic shared by the sync and async failure paths. */
    warnAdaptersListenerFailure(error) {
        this.ctx.logger.warn('llm: an llm/adapters-updated listener failed');
        this.ctx.logger.warn(error);
    }
    /**
     * Register an adapter for the given provider routes. Throws `LlmError` with code
     * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
     * Disposed with the fiber.
     * @param providers - every provider route this adapter should serve.
     * @param adapter - the adapter that streams calls for those providers.
     * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
     */
    registerAdapter(providers, adapter) {
        // The routes this registration currently holds; `replace` rewrites it, and
        // the disposer releases whatever it holds at disposal time.
        const owned = new Set();
        // The disposer has run: `owned` being empty cannot say so on its own,
        // because `replace([])` legally leaves a live registration holding none.
        let released = false;
        const dispose = this.ctx.effect(function* () {
            if (providers.length === 0)
                throw new LlmError('an adapter must register at least one provider', 'INVALID_ADAPTER');
            this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned));
            yield () => {
                released = true;
                for (const provider of owned)
                    this.adapters.delete(provider);
                owned.clear();
                this.emitAdaptersUpdated();
            };
        }.bind(this), 'llm.registerAdapter()');
        // ctx.effect's disposer returns Promise<void>; our disposer API is
        // synchronous fire-and-forget — discard the (always-resolved) promise.
        const handle = (() => void dispose());
        handle.replace = (next) => {
            // Registering here would leak: the effect's disposer already ran, so
            // nothing remains to release whatever this call would put in the map.
            if (released) {
                throw new LlmError('a disposed adapter registration cannot replace its routes', 'REGISTRATION_DISPOSED');
            }
            this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned));
        };
        return handle;
    }
    /**
     * Validate one candidate route set for `adapter`, treating routes this
     * registration already holds as available. Nothing is mutated: a rejected
     * candidate leaves the registry exactly as it was.
     */
    prepareRoutes(providers, adapter, owned) {
        const unique = new Set();
        const registrations = [];
        for (const provider of providers) {
            if (provider.length === 0)
                throw new LlmError('adapter provider names must be non-empty', 'INVALID_ADAPTER');
            if (unique.has(provider) || (this.adapters.has(provider) && !owned.has(provider))) {
                throw new LlmError(`an adapter for provider "${provider}" is already registered`, 'DUPLICATE_ADAPTER');
            }
            const info = adapter.providerInfo(provider);
            if (typeof info.id !== 'string' || info.id !== provider || typeof info.name !== 'string' || info.name.length === 0) {
                throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, 'INVALID_ADAPTER');
            }
            unique.add(provider);
            const retryPolicy = adapter.providerRetryPolicy(provider)
                ?? resolveRetryPolicy(undefined, `llm: provider "${provider}" retryPolicy`);
            registrations.push({
                adapter,
                provider: { id: info.id, name: info.name },
                retryPolicy,
            });
        }
        return registrations;
    }
    /**
     * Swap this registration's routes for the prepared ones in one synchronous
     * section, so no observer can see the registry between the release and the
     * re-registration. The route set's one mutation point is also where
     * `llm/adapters-updated` is published, so a `replace` announces itself
     * exactly like a first registration.
     */
    commitRoutes(owned, registrations) {
        for (const provider of owned)
            this.adapters.delete(provider);
        owned.clear();
        for (const registration of registrations) {
            this.adapters.set(registration.provider.id, registration);
            owned.add(registration.provider.id);
        }
        this.emitAdaptersUpdated();
    }
    /**
     * Describe provider routes with a registered adapter.
     * @returns detached provider metadata in registration order.
     */
    listProviders() {
        return [...this.adapters.values()].map(({ provider }) => ({ ...provider }));
    }
    /**
     * Declare provider routes an adapter plugin can activate through
     * configuration. Registration is all-or-nothing: an empty list, invalid
     * entry, or a provider already declared by any registration throws
     * `LlmError` without registering the rest. Disposed with the fiber.
     * @param entries - every configurable provider this plugin owns.
     * @returns a handle that withdraws all of them, and can atomically replace them.
     */
    registerConfigurableProviders(entries) {
        let held = [];
        let disposed = false;
        /**
         * Validate a candidate set in full against everything this registration
         * does not already hold, then publish it. Nothing is written until the
         * whole set passes, so a refused candidate leaves the current entries in
         * place — the property that makes `replace` a swap rather than a
         * delete-then-add that can strand the directory empty.
         */
        const commit = (candidates) => {
            const detached = [];
            const own = new Set(held.map(entry => entry.provider));
            for (const entry of candidates) {
                if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) {
                    throw new LlmError('configurable providers need a non-empty provider, displayName, and settingsNs', 'INVALID_DIRECTORY');
                }
                if (entry.settingsPath.some(segment => segment.length === 0)) {
                    throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, 'INVALID_DIRECTORY');
                }
                if ((this.directory.has(entry.provider) && !own.has(entry.provider))
                    || detached.some(seen => seen.provider === entry.provider)) {
                    throw new LlmError(`configurable provider "${entry.provider}" is already declared`, 'DUPLICATE_DIRECTORY');
                }
                detached.push({ ...entry, settingsPath: [...entry.settingsPath] });
            }
            for (const entry of held)
                this.directory.delete(entry.provider);
            for (const entry of detached)
                this.directory.set(entry.provider, entry);
            held = detached;
            this.emitAdaptersUpdated();
        };
        const dispose = this.ctx.effect(function* () {
            if (entries.length === 0) {
                throw new LlmError('a configurable-provider registration must declare at least one provider', 'INVALID_DIRECTORY');
            }
            commit(entries);
            yield () => {
                disposed = true;
                for (const entry of held)
                    this.directory.delete(entry.provider);
                held = [];
                this.emitAdaptersUpdated();
            };
        }.bind(this), 'llm.registerConfigurableProviders()');
        const handle = (() => void dispose());
        handle.replace = (next) => {
            if (disposed) {
                throw new LlmError('this configurable-provider registration was disposed', 'REGISTRATION_DISPOSED');
            }
            commit(next);
        };
        return handle;
    }
    /**
     * List every declared configurable provider, registered or dormant.
     * @returns detached directory entries in declaration order.
     */
    listConfigurableProviders() {
        return [...this.directory.values()].map(entry => ({ ...entry, settingsPath: [...entry.settingsPath] }));
    }
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
    registerModelDiscovery(settingsNs, discover) {
        const dispose = this.ctx.effect(function* () {
            if (settingsNs.length === 0) {
                throw new LlmError('model discovery needs a non-empty settings namespace', 'INVALID_DISCOVERY');
            }
            if (this.discoveries.has(settingsNs)) {
                throw new LlmError(`model discovery for "${settingsNs}" is already registered`, 'DUPLICATE_DISCOVERY');
            }
            this.discoveries.set(settingsNs, discover);
            yield () => {
                this.discoveries.delete(settingsNs);
            };
        }.bind(this), 'llm.registerModelDiscovery()');
        return () => void dispose();
    }
    /**
     * Interrogate one provider endpoint for the models it advertises. The
     * request describes a draft, not a stored route, so nothing here reads or
     * writes settings or credentials — the caller owns both, and the reply is
     * candidate metadata a surface may offer for adoption.
     * @param settingsNs - namespace whose registered discovery serves this draft.
     * @param request - the endpoint, protocol, and one-shot credential to use.
     * @returns the advertised models, deduplicated in endpoint order.
     */
    async discoverModels(settingsNs, request) {
        const discover = this.discoveries.get(settingsNs);
        if (discover === undefined) {
            throw new LlmError(`no model discovery is registered for "${settingsNs}"`, 'NO_DISCOVERY');
        }
        // One of the two identifies what to describe: a route the adapter knows, or
        // an endpoint to ask. Neither leaves nothing to answer about.
        if ((request.provider ?? '').length === 0 && (request.baseURL ?? '').length === 0) {
            throw new LlmError('model discovery needs a provider route or a baseURL', 'INVALID_DISCOVERY');
        }
        const discovered = await discover(request);
        const seen = new Set();
        const models = [];
        for (const model of discovered) {
            if (typeof model.id !== 'string' || model.id.length === 0 || seen.has(model.id))
                continue;
            seen.add(model.id);
            models.push({
                id: model.id,
                ...model.name === undefined ? {} : { name: model.name },
                ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
                ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
            });
        }
        return models;
    }
    /**
     * Resolve the retry policy captured when one provider route was registered.
     * @param provider - registered provider route to inspect.
     * @returns the provider-owned policy, with normal defaults already resolved.
     */
    providerRetryPolicy(provider) {
        return this.registration(provider).retryPolicy;
    }
    /** Detach typed adapter-owned modality metadata. */
    detachedModalities(modalities) {
        return modalities === undefined ? undefined : [...modalities];
    }
    /**
     * Discover models advertised by one registered provider. Catalog membership
     * is advisory and never changes routing or request validation.
     * @param provider - registered provider route to inspect.
     * @returns detached model metadata in adapter-preferred order.
     */
    async listModels(provider) {
        const adapter = this.registration(provider).adapter;
        const models = await adapter.listModels(provider);
        const seen = new Set();
        return models.map((model) => {
            if (typeof model.provider !== 'string'
                || model.provider !== provider
                || typeof model.id !== 'string'
                || model.id.length === 0
                || typeof model.name !== 'string'
                || model.name.length === 0
                || (model.description !== undefined && typeof model.description !== 'string')
                || seen.has(model.id)) {
                throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, 'INVALID_CATALOG');
            }
            seen.add(model.id);
            const inputModalities = this.detachedModalities(model.inputModalities);
            return {
                provider: model.provider,
                id: model.id,
                name: model.name,
                ...model.description === undefined ? {} : { description: model.description },
                ...inputModalities === undefined ? {} : { inputModalities },
            };
        });
    }
    /**
     * Resolve and validate all metadata from the adapter that owns one exact
     * route. The result is detached from adapter-owned objects; catalog
     * membership remains advisory and does not control request routing.
     * @param provider - registered provider route to inspect.
     * @param model - exact model id passed to the adapter.
     * @param signal - optional cancellation for adapter-owned asynchronous lookup.
     * @returns exact model identity plus available context and reasoning metadata.
     */
    async resolveModelInfo(provider, model, signal) {
        return this.resolveModelInfoFor(this.registration(provider), model, signal);
    }
    async resolveModelInfoFor(registration, model, signal) {
        const provider = registration.provider.id;
        const resolved = await registration.adapter.resolveModel(provider, model, signal);
        if (typeof resolved.provider !== 'string'
            || resolved.provider !== provider
            || typeof resolved.id !== 'string'
            || resolved.id !== model
            || typeof resolved.name !== 'string'
            || resolved.name.length === 0
            || (resolved.description !== undefined && typeof resolved.description !== 'string')) {
            throw new LlmError(`adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`, 'INVALID_MODEL_INFO');
        }
        const context = resolved.context;
        if (context !== undefined && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) {
            throw new LlmError(`adapter returned invalid context metadata for provider "${provider}" model "${model}"`, 'INVALID_MODEL_CONTEXT');
        }
        // Capability metadata rides through: an explicit modality omission is
        // negative capability downstream preflights act on (image admission).
        const inputModalities = this.detachedModalities(resolved.inputModalities);
        const defaultMaxTokens = resolved.defaultMaxTokens;
        if (defaultMaxTokens !== undefined
            && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) {
            throw new LlmError(`adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`, 'INVALID_MODEL_MAX_TOKENS');
        }
        const info = {
            provider,
            id: model,
            name: resolved.name,
            ...resolved.description === undefined ? {} : { description: resolved.description },
            ...inputModalities === undefined ? {} : { inputModalities },
            ...context === undefined ? {} : { context: { contextWindow: context.contextWindow } },
            ...defaultMaxTokens === undefined ? {} : { defaultMaxTokens },
        };
        const reasoning = resolved.reasoning;
        if (reasoning === undefined)
            return info;
        if (reasoning.efforts.length === 0) {
            throw new LlmError(`adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`, 'INVALID_MODEL_REASONING');
        }
        const seen = new Set();
        const efforts = reasoning.efforts.map((effort) => {
            if (typeof effort.id !== 'string'
                || effort.id.length === 0
                || typeof effort.name !== 'string'
                || effort.name.length === 0
                || (effort.description !== undefined && typeof effort.description !== 'string')
                || seen.has(effort.id)) {
                throw new LlmError(`adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`, 'INVALID_MODEL_REASONING');
            }
            seen.add(effort.id);
            return {
                id: effort.id,
                name: effort.name,
                ...effort.description === undefined ? {} : { description: effort.description },
            };
        });
        if (reasoning.defaultEffort !== undefined && !seen.has(reasoning.defaultEffort)) {
            throw new LlmError(`adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`, 'INVALID_MODEL_REASONING');
        }
        return {
            ...info,
            reasoning: {
                efforts,
                ...reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort },
            },
        };
    }
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
    async resolveCallConfig(config, signal) {
        return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
    }
    async resolveCallFor(registration, config, signal) {
        const info = await this.resolveModelInfoFor(registration, config.model, signal);
        const defaulted = config.maxTokens === undefined && info.defaultMaxTokens !== undefined
            ? { ...config, maxTokens: info.defaultMaxTokens }
            : config;
        const reasoning = info.reasoning;
        const requested = defaulted.reasoningEffort;
        let resolvedConfig = defaulted;
        if (reasoning === undefined) {
            if (requested !== undefined) {
                throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`, 'UNSUPPORTED_REASONING_EFFORT');
            }
        }
        else {
            const effective = requested ?? reasoning.defaultEffort;
            if (effective !== undefined) {
                if (!reasoning.efforts.some(effort => effort.id === effective)) {
                    throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`, 'UNSUPPORTED_REASONING_EFFORT');
                }
                if (requested !== effective)
                    resolvedConfig = { ...defaulted, reasoningEffort: effective };
            }
        }
        return {
            config: resolvedConfig,
            ...info.context === undefined ? {} : { context: info.context },
        };
    }
    /**
     * Resolve one call under its current adapter registration. The returned
     * one-shot handle keeps that registration across header logging and dispatch,
     * so HMR cannot combine one adapter's capability result with another adapter.
     * @param config - provider/model route and optional request controls.
     * @param signal - optional cancellation for adapter-owned capability lookup.
     * @returns a prepared config and its registration-bound stream entry point.
     */
    async prepareCall(config, signal) {
        const registration = this.registration(config.provider);
        const resolved = await this.resolveCallFor(registration, config, signal);
        const resolvedConfig = deepFreeze(structuredClone(resolved.config));
        const context = resolved.context === undefined
            ? undefined
            : deepFreeze(structuredClone(resolved.context));
        const adapterDefaults = deepFreeze({
            ...config.reasoningEffort === undefined && resolvedConfig.reasoningEffort !== undefined
                ? { reasoningEffort: true }
                : {},
            ...config.maxTokens === undefined && resolvedConfig.maxTokens !== undefined
                ? { maxTokens: true }
                : {},
        });
        let dispatched = false;
        return Object.freeze({
            config: resolvedConfig,
            retryPolicy: registration.retryPolicy,
            adapterDefaults,
            ...context === undefined ? {} : { context },
            stream: (options) => {
                if (dispatched) {
                    throw new LlmError('a prepared LLM call can only be dispatched once', 'INVALID_PREPARED_CALL');
                }
                if (!callConfigEquals(options, resolvedConfig)) {
                    throw new LlmError('prepared LLM call config changed before adapter dispatch', 'INVALID_PREPARED_CALL');
                }
                dispatched = true;
                return this.streamWithRegistration(options, { registration, config: resolvedConfig });
            },
        });
    }
    registration(provider) {
        const registration = this.adapters.get(provider);
        if (!registration)
            throw new LlmError(`no adapter registered for provider "${provider}"`, 'NO_ADAPTER');
        return registration;
    }
    /** Remove replay state whose historical route is owned by another adapter. */
    forAdapter(options, adapter) {
        const messages = options.messages.map((message) => {
            const source = message.source;
            if (message.role !== 'assistant' || source.kind !== 'model' || source.replayState === undefined)
                return message;
            if (this.adapters.get(source.provider)?.adapter === adapter)
                return message;
            return freezeMessage({
                ...message,
                source: { kind: 'model', provider: source.provider, model: source.model },
            });
        });
        if (messages.every((message, index) => message === options.messages[index]))
            return options;
        const filtered = { ...options, messages };
        return Object.isFrozen(options) ? deepFreeze(filtered) : filtered;
    }
    /**
     * Final adapter boundary. Adapter selection, dispatch, iterator construction,
     * and iteration failures become one terminal failure chunk. Middleware and
     * downstream consumer failures remain thrown plugin or consumer errors.
     */
    async *adapterStream(options, prepared) {
        let iterator;
        try {
            const registration = prepared?.registration ?? this.registration(options.provider);
            const resolvedConfig = prepared === undefined
                ? (await this.resolveCallFor(registration, options, options.signal)).config
                : prepared.config;
            if (prepared !== undefined && !callConfigEquals(options, resolvedConfig)) {
                throw new LlmError('prepared LLM call config changed before adapter dispatch', 'INVALID_PREPARED_CALL');
            }
            const resolvedOptions = callConfigEquals(options, resolvedConfig)
                ? options
                : Object.isFrozen(options)
                    ? deepFreeze({ ...options, ...resolvedConfig })
                    : { ...options, ...resolvedConfig };
            const adapter = registration.adapter;
            const stream = adapter.stream(this.forAdapter(resolvedOptions, adapter));
            iterator = stream[Symbol.asyncIterator]();
        }
        catch (error) {
            yield adapterFailureChunk(error, options.signal);
            return;
        }
        let completed = false;
        try {
            while (true) {
                let item;
                try {
                    const next = await iterator.next();
                    item = next.done
                        ? { done: true }
                        : { done: false, value: next.value };
                }
                catch (error) {
                    completed = true;
                    yield adapterFailureChunk(error, options.signal);
                    return;
                }
                if (item.done) {
                    completed = true;
                    return;
                }
                // End the adapter-owned try before yielding: consumer/middleware
                // failures resumed into this generator must remain thrown.
                yield item.value;
            }
        }
        finally {
            if (!completed) {
                const close = iterator.return?.bind(iterator);
                if (close)
                    await close();
            }
        }
    }
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
    stream(options) {
        return this.streamWithRegistration(options);
    }
    streamWithRegistration(options, prepared) {
        return this.ctx.waterfall(this, 'llm/stream', options, () => this.adapterStream(options, prepared));
    }
}
/** Convert one adapter throw into the stream protocol's terminal outcome. */
function adapterFailureChunk(error, signal) {
    const failure = normalizeLlmFailure(error);
    return {
        type: 'finish',
        reason: signal?.aborted || failure.code === 'ABORTED'
            ? { kind: 'aborted', failure }
            : { kind: 'error', failure },
    };
}
export default LlmRuntime;
//# sourceMappingURL=index.js.map