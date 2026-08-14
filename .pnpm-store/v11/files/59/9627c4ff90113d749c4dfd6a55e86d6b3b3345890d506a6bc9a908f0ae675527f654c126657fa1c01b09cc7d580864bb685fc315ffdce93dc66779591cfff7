import type { HostDescription, IApiClient, HostFrame, MuxFrame, RpcRequest } from './api.ts';
/** Reconnect/backoff tunables (deployment-varying — no hardcoded tunables; these become the
 *  future `ctx.connection` plugin's Config). All fields optional; defaults below. */
export interface ConnectionConfig {
    /** First-retry backoff cap in ms (jittered: actual delay is cap/2..cap). */
    backoffBaseMs?: number;
    /** Exponential growth factor per consecutive failed attempt. */
    backoffFactor?: number;
    /** Upper bound for the backoff cap in ms. */
    backoffMaxMs?: number;
    /** Cap on waiting for both streams' onOpen before onConnected, in ms. The strict handshake
     *  waits for mux+host stream establishment plus describe; a carrier that never
     *  fires onOpen (misbehaving proxy) must not wedge the connection forever — on timeout the
     *  generation proceeds as connected and the live-gap repair path covers stragglers. */
    streamOpenTimeoutMs?: number;
}
/** Coarse connection state for the UI: 'connected' after each generation's handshake,
 *  'reconnecting' the moment the generation fails (covers the whole backoff+retry span). */
export type ConnectionState = 'connected' | 'reconnecting';
/** Frame sink callbacks: the Controller owns the physical streams; business dispatch belongs to
 *  SessionManager. */
export interface ConnectionSinks {
    onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void;
    onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void;
    /** After each connection generation is established (both streams open + describe succeeded), first connect included. */
    onConnected?: (description: HostDescription) => void;
    /** Coarse state transitions (deduplicated: fires only on change). The initial pre-connect
     *  span reports nothing — the UI treats "no state yet" as connecting, not as an outage. */
    onStateChange?: (state: ConnectionState) => void;
}
/**
 * Opens both streams and keeps iterating (pull mode: nothing reads the socket and the tap
 * never fires unless someone for-awaits), reconnecting with exponential backoff on loss.
 * State (generation/attempt) is instance-private, never in the store.
 * The pump body feeds each frame to a sink (sink exceptions must
 * not kill the pump — a broken business layer must not drag down the connection layer).
 */
export declare class ConnectionController {
    private readonly api;
    private readonly sinks;
    private generation;
    private attempt;
    private current;
    private running;
    private lastState;
    private readonly config;
    constructor(api: IApiClient, sinks?: ConnectionSinks, config?: ConnectionConfig);
    /** Idempotent: begin the connect/pump/reconnect loop. */
    start(): void;
    /** Stop the loop and abort the current generation's streams. */
    stop(): void;
    private backoffDelay;
    /** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
    private isRunning;
    /** Re-read both mutable liveness guards after a potentially reentrant sink. */
    private isGenerationActive;
    private loop;
    /** Deduplicated state emission (sink isolation applies). */
    private emitState;
    private pumpStream;
    /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
    private callSink;
}
//# sourceMappingURL=connection.d.ts.map