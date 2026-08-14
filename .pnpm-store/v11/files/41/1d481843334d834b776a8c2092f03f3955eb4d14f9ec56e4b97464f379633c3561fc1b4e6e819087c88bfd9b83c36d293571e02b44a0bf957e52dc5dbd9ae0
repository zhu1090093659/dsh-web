/**
 * Client side of the fetch carrier. AbstractApiClient holds every protocol invariant: rpcId minting,
 * four-quadrant envelope wrap/unwrap, zod parsing, in-process SSE frame decoding, and the payload-direct
 * IApiClient domain methods (business code never mints). Platform differences ride two aspects:
 * abstract doFetch (transport) + overridable onEnvelope (tap). ApiProxy (the impl face) is untouched.
 */
import type { z } from 'zod';
import type { ApiProxy, HostFrame, MuxFrame } from '../api/index.ts';
import type { RequestPayload, ResponseValue, RpcMethodMap } from '../api/rpc-map.ts';
import type { ClientResponse, RpcMessage, RpcReceipt, RpcRequest, RpcResponse } from '../api/rpc.ts';
import { RpcId } from '../api/rpc.ts';
/**
 * Client consumption face of the contract (shape a): same domain tree as ApiProxy, but unary
 * methods take the business payload directly — the carrier mints the rpcId and wraps the
 * envelope. Business code needing the call's rpcId reads it from the RpcResponse echo.
 * Unary methods and respond accept an optional external AbortSignal as the last parameter.
 * Bounded calls merge it with the instance timeout via AbortSignal.any; user-paced calls
 * carry only that external signal. In both cases the signal rides beside the request, never
 * on the wire, like the stream signatures.
 * Stream methods accept an optional onOpen callback: it fires once the physical transport is
 * readable (before any frame) — the "stream established" signal
 * connection controllers need for the readiness handshake. Generators are lazy, so the
 * underlying fetch (and therefore onOpen) only happens once iteration starts.
 * Relationship: ApiProxy is the narrow-form signature contract the impl side implements;
 * IApiClient is the payload-direct view clients consume; AbstractApiClient bridges the two.
 * Derived per method key from RpcMethodMap so a map row addition updates this mechanically.
 */
export interface IApiClient {
    sessions: {
        list(payload: RequestPayload<'session.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.list'>>>;
        search(payload: RequestPayload<'session.search'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.search'>>>;
        create(payload: RequestPayload<'session.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.create'>>>;
        history(payload: RequestPayload<'session.history'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.history'>>>;
        models(payload: RequestPayload<'session.models'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.models'>>>;
        selectModel(payload: RequestPayload<'session.selectModel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.selectModel'>>>;
        rename(payload: RequestPayload<'session.rename'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.rename'>>>;
        fork(payload: RequestPayload<'session.fork'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.fork'>>>;
        prompt(payload: RequestPayload<'session.prompt'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.prompt'>>>;
        attachment(payload: RequestPayload<'session.attachment'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.attachment'>>>;
        updateQueue(payload: RequestPayload<'session.updateQueue'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.updateQueue'>>>;
        cancel(payload: RequestPayload<'session.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.cancel'>>>;
    };
    subagents: {
        list(payload: RequestPayload<'subagent.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'subagent.list'>>>;
        history(payload: RequestPayload<'subagent.history'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'subagent.history'>>>;
        prompt(payload: RequestPayload<'subagent.prompt'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'subagent.prompt'>>>;
        interrupt(payload: RequestPayload<'subagent.interrupt'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'subagent.interrupt'>>>;
    };
    host: {
        describe(payload: RequestPayload<'host.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.describe'>>>;
        pickDirectory(payload: RequestPayload<'host.pickDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.pickDirectory'>>>;
        listDirectory(payload: RequestPayload<'host.listDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.listDirectory'>>>;
        createDirectory(payload: RequestPayload<'host.createDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.createDirectory'>>>;
        openPath(payload: RequestPayload<'host.openPath'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.openPath'>>>;
    };
    workspace: {
        list(payload: RequestPayload<'workspace.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.list'>>>;
        create(payload: RequestPayload<'workspace.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.create'>>>;
        rename(payload: RequestPayload<'workspace.rename'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.rename'>>>;
        delete(payload: RequestPayload<'workspace.delete'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.delete'>>>;
        insertBefore(payload: RequestPayload<'workspace.insertBefore'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.insertBefore'>>>;
        insertSessionBefore(payload: RequestPayload<'workspace.insertSessionBefore'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.insertSessionBefore'>>>;
        archiveSession(payload: RequestPayload<'workspace.archiveSession'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.archiveSession'>>>;
    };
    skills: {
        list(payload: RequestPayload<'skill.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'skill.list'>>>;
    };
    agentPresets: {
        list(payload: RequestPayload<'agentPreset.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.list'>>>;
        select(payload: RequestPayload<'agentPreset.select'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.select'>>>;
        read(payload: RequestPayload<'agentPreset.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.read'>>>;
        copy(payload: RequestPayload<'agentPreset.copy'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.copy'>>>;
        openDocument(payload: RequestPayload<'agentPreset.openDocument'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.openDocument'>>>;
        remove(payload: RequestPayload<'agentPreset.remove'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.remove'>>>;
    };
    events: {
        mux(payload: Parameters<ApiProxy['events']['mux']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>>;
        host(payload: Parameters<ApiProxy['events']['host']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>>;
    };
    goals: {
        create(payload: RequestPayload<'goal.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.create'>>>;
        edit(payload: RequestPayload<'goal.edit'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.edit'>>>;
        pause(payload: RequestPayload<'goal.pause'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.pause'>>>;
        resume(payload: RequestPayload<'goal.resume'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.resume'>>>;
        complete(payload: RequestPayload<'goal.complete'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.complete'>>>;
        clear(payload: RequestPayload<'goal.clear'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.clear'>>>;
    };
    settings: {
        describe(payload: RequestPayload<'settings.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.describe'>>>;
        openDocument(payload: RequestPayload<'settings.openDocument'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.openDocument'>>>;
        update(payload: RequestPayload<'settings.update'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.update'>>>;
        replace(payload: RequestPayload<'settings.replace'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.replace'>>>;
        mutate(payload: RequestPayload<'settings.mutate'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.mutate'>>>;
    };
    credentials: {
        describe(payload: RequestPayload<'credentials.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.describe'>>>;
        set(payload: RequestPayload<'credentials.set'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.set'>>>;
        unset(payload: RequestPayload<'credentials.unset'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.unset'>>>;
    };
    llm: {
        providers(payload: RequestPayload<'llm.providers'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.providers'>>>;
        models(payload: RequestPayload<'llm.models'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.models'>>>;
        discoverModels(payload: RequestPayload<'llm.discoverModels'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.discoverModels'>>>;
    };
    /** client-response passthrough (rpcId is a backfill of the server-request's id — never minted here). */
    respond(message: ClientResponse, signal?: AbortSignal): Promise<RpcReceipt>;
}
/** Whether a unary call uses the transport health deadline or only caller/connection cancellation. */
type UnaryTimeoutPolicy = 'default' | 'caller-signal-only';
/**
 * Abstract fetch-carrier client. Subclasses supply the transport (doFetch) and may refine the
 * per-message tap (onEnvelope) — platform aspects stay in subclasses, protocol invariants stay
 * here. Envelope observation is a first-class aspect of this data middle layer: the instance
 * owns a microtask-batched buffer (frame storms must not cost one consumer update per frame),
 * and observers subscribe via subscribeEnvelopes. The isomorphic point survives: an in-process
 * subclass whose doFetch is toFetchHandler(api).fetch never touches the network.
 */
export declare abstract class AbstractApiClient implements IApiClient {
    protected readonly timeoutMs: number;
    /** Instance-owned observation buffer (module-level state would leak across instances/tests). */
    private envelopeBatch;
    private flushScheduled;
    private readonly envelopeListeners;
    /** @param timeoutMs - timeout for bounded unary calls; user-paced calls and streams do not use it. */
    constructor(timeoutMs?: number);
    /** Transport aspect: browser fetch, injected handler.fetch, IPC bridge, ... */
    protected abstract doFetch(input: URL, init?: RequestInit): Promise<Response>;
    /**
     * Subscribe to batched envelope observation (diagnostics/logging consumers).
     * Batches follow microtask boundaries; a listener throw is isolated (observation
     * must never break the carrier).
     * @param listener - receives each flushed batch in arrival order.
     * @returns unsubscribe function.
     */
    subscribeEnvelopes(listener: (batch: readonly RpcMessage[]) => void): () => void;
    /** Per-message tap: feeds the instance buffer. Subclasses may override to observe unbatched (call super to keep batching). */
    protected onEnvelope(message: RpcMessage): void;
    /** Browser = same-origin (a fake authority would fail DNS on real requests); no-location env (Node) = fake authority. */
    protected resolveBase(): string;
    protected mintRpcId(): RpcId;
    /**
     * Shared POST leg of both C→S carriers (callUnary/respond): JSON body,
     * optional default timeout merged with the caller's external signal, non-2xx → transport throw.
     */
    private postJson;
    /**
     * Unary protocol path: mint → tap → POST full form → envelope parse → verify
     * echo → value parse → tap → narrow. Virtual so a fake carrier (fixture) can
     * override transport at this layer.
     */
    protected callUnary<K extends keyof RpcMethodMap>(method: K, payload: RequestPayload<K>, signal?: AbortSignal, timeoutPolicy?: UnaryTimeoutPolicy): Promise<RpcResponse<ResponseValue<K>>>;
    /** Mux stream opener; virtual for the same override reason as callUnary. */
    protected openMux(_payload: Parameters<ApiProxy['events']['mux']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>>;
    /** Host stream opener; virtual. */
    protected openHost(_payload: Parameters<ApiProxy['events']['host']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>>;
    /**
     * SSE protocol path: streaming fetch (not EventSource), '\n\n' framing, ServerRequest envelope +
     * frame-schema parse, tap, narrow yield. onOpen fires once the response headers are in and the
     * body is readable — the stream-established signal, before any frame arrives. A frame that fails
     * either parse level is reported and skipped (one corrupt frame must not kill the stream; the
     * client's gap detection covers whatever the frame carried).
     */
    protected readSse<F extends MuxFrame | HostFrame>(path: string, signal: AbortSignal, frameSchema: z.ZodType<F>, onOpen?: () => void): AsyncGenerator<RpcRequest<F>>;
    readonly sessions: IApiClient['sessions'];
    readonly subagents: IApiClient['subagents'];
    readonly host: IApiClient['host'];
    readonly workspace: IApiClient['workspace'];
    readonly skills: IApiClient['skills'];
    readonly agentPresets: IApiClient['agentPresets'];
    readonly goals: IApiClient['goals'];
    readonly settings: IApiClient['settings'];
    readonly credentials: IApiClient['credentials'];
    readonly llm: IApiClient['llm'];
    readonly events: IApiClient['events'];
    respond(message: ClientResponse, signal?: AbortSignal): Promise<RpcReceipt>;
}
/**
 * In-process client over an injected fetch-shaped handler (the isomorphic point:
 * `new InProcessApiClient(toFetchHandler(api))` never touches the network). Lives here because
 * in-process injection is this package's own capability (handler and client are both local).
 */
export declare class InProcessApiClient extends AbstractApiClient {
    private readonly handler;
    constructor(handler: {
        fetch: typeof fetch;
    }, timeoutMs?: number);
    /**
     * Faithful to real fetch: reject on signal abort even when the in-process
     * handler ignores the signal (a hung impl must not defeat timeout/cancel).
     */
    protected doFetch(input: URL, init?: RequestInit): Promise<Response>;
}
export {};
//# sourceMappingURL=client.d.ts.map