import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ApiProxy, ClientResponse, HostFrame, MuxFrame, RpcReceipt, RpcRequest, RpcResponse } from './api.ts';
import type { RequestPayload, ResponseValue, RpcMethodMap } from '@deepseek-ai/dsh-host-apiproxy/api';
import { AbstractApiClient } from './api.ts';
import type { ClientConnectionRpc } from '../rpc.ts';
/** Deterministic fixture branches used by keyless Web assembly tests. */
export interface FixtureOptions {
    /** Start with no real Workspace or Session. */
    empty?: boolean;
    /** Reject every prompt before appending its user event. */
    rejectPrompt?: boolean;
    /** Publish the Session but fail its Workspace account write. */
    failWorkspaceAttach?: boolean;
    /** Publish and frame the Session, then throw instead of returning create. */
    dropSessionCreateResponse?: boolean;
    /** Order of the two successful create frames. */
    createFrameOrder?: 'session-first' | 'workspace-first';
}
/**
 * In-memory fake host: fx-alpha carries history and replay scripts; fx-beta is fx-alpha's child session (lineage indent material).
 * @param options - fixture branches for empty state and failure timing.
 * @returns an ApiProxy backed entirely by in-memory state — no host process, no network.
 */
export declare function createFixtureApi(options?: FixtureOptions): ApiProxy;
/** Both fixture faces over one state graph. */
export interface FixtureWorld {
    /** Legacy unary/stream API the fixture still answers. */
    readonly api: ApiProxy;
    /** Generic Remote caller for the endpoints business services own. */
    readonly rpc: ClientConnectionRpc;
}
/**
 * Build both fixture faces so a caller can drive the Remote endpoints and the
 * legacy API against one in-memory state graph.
 * @param options - fixture branches for empty state and failure timing.
 * @returns the legacy API face and the Remote RPC face.
 */
export declare function createFixtureFaces(options?: FixtureOptions): FixtureWorld;
/**
 * Fixture platform subclass: there is no HTTP at all, so instead of a doFetch transport it
 * overrides the protocol-level virtuals (callUnary/openMux/openHost/respond) to dispatch
 * straight into the in-memory ApiProxy — while still minting rpcIds, fabricating the four
 * named full forms, and feeding the same tap as a real carrier. TODO: delete when the fixture
 * moves to the isomorphic pipeline (InProcessApiClient over toFetchHandler(fixtureImpl)).
 */
export declare class FixtureApiClient extends AbstractApiClient {
    private readonly api;
    /** Generic Remote caller backed by the same in-memory state as the legacy fixture API. */
    readonly rpc: ClientConnectionRpc;
    constructor();
    protected doFetch(): Promise<Response>;
    protected callUnary<K extends keyof RpcMethodMap>(method: K, payload: RequestPayload<K>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<K>>>;
    /** Method-key dispatch into the in-memory contract impl (a real carrier routes by URL path instead). */
    private dispatch;
    protected openMux(payload: {
        since?: Record<SessionId, number>;
    }, signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>>;
    protected openHost(payload: Record<never, never>, signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>>;
    private tapStream;
    /**
     * Deliver a client response to the in-memory contract impl (no HTTP POST),
     * echoing the envelope to the observation tap like every other path.
     * @param message - the client-response envelope answering a server request.
     * @returns the carrier receipt from the fixture impl.
     */
    respond(message: ClientResponse): Promise<RpcReceipt>;
}
//# sourceMappingURL=fixture.d.ts.map