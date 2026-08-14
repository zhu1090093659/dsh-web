/**
 * Log-backed session title service, deterministic fallback, and provider contract.
 * @module @deepseek-ai/dsh-session-title
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Branded } from '@deepseek-ai/dsh-brand';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
export type * from './types.ts';
export { fallbackSessionTitle, normalizeSessionTitle, truncateTitleUtf8 } from './normalize.ts';
/** Identifies one session-title provider registration. */
export type SessionTitleProviderId = Branded<'SessionTitleProviderId'>;
/**
 * Brand a raw provider id.
 * @param id - stable non-empty provider identifier supplied by a plugin.
 * @returns the same string with the session-title provider brand.
 */
export declare function SessionTitleProviderId(id: string): SessionTitleProviderId;
/** Exact auxiliary model route that produced a title. */
export interface SessionTitleModelProvenance {
    /** Registered LLM provider route. */
    readonly provider: string;
    /** Provider model id. */
    readonly model: string;
}
/** Durable ownership record for an accepted session title. */
export type SessionTitleSource = {
    readonly kind: 'fallback';
} | {
    readonly kind: 'provider';
    readonly provider: SessionTitleProviderId;
    readonly model?: SessionTitleModelProvenance;
} | {
    /** Explicit user rename: pins the title — automatic generation stops scheduling. */
    readonly kind: 'user';
};
/** Payload of the log-only `session/title` event. */
export interface SessionTitleEventData {
    /** Normalized non-empty title text. */
    readonly title: string;
    /** Exact human `user/message` seqs used to derive this title; empty for an explicit user rename. */
    readonly messageSeqs: number[];
    /** Whether the built-in fallback, a registered provider, or the user supplied the title. */
    readonly source: SessionTitleSource;
}
/** Latest folded title plus the title event's durable envelope facts. */
export interface SessionTitleSnapshot extends SessionTitleEventData {
    /** Seq of the latest `session/title` event. */
    readonly eventSeq: number;
    /** Timestamp of the latest `session/title` event. */
    readonly updatedAt: number;
}
/** Required deterministic fallback and accepted-title limits. */
export interface Config {
    /** Maximum whitespace-delimited words in the built-in fallback. */
    readonly fallbackMaxWords: number;
    /** Maximum UTF-8 bytes in the built-in fallback. */
    readonly fallbackMaxBytes: number;
    /** Maximum UTF-8 bytes in any accepted title. */
    readonly maxTitleBytes: number;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessionTitle: SessionTitleService;
    }
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * Latest-wins session title snapshot. Log-only: it never enters the model
         * surface or derived history.
         */
        'session/title': SessionTitleEventData;
    }
}
/**
 * Rejection of an explicit user title whose text normalizes to empty — the
 * one {@link SessionTitleService.rename} failure that blames the input.
 * Callers translating rename failures onto a wire (`title-invalid`) narrow on
 * this class; liveness and disposal failures stay plain `Error`s.
 */
export declare class SessionTitleInvalidError extends Error {
    readonly name = "SessionTitleInvalidError";
}
/** One eligible human text message exposed to title providers. */
export interface SessionTitleUserMessage {
    /** Source `user/message` event seq. */
    readonly seq: number;
    /** Exact concatenated text-block content. */
    readonly text: string;
}
/** Automatic generation cadence owned by a registered provider. */
export type SessionTitleAutomaticMode = 'first-prompt' | 'all-prompts';
/** Immutable input supplied to one title-provider call. */
export interface SessionTitleProviderRequest {
    /** Live session being titled. */
    readonly session: Session;
    /** All eligible human messages through this generation revision. */
    readonly messages: readonly SessionTitleUserMessage[];
    /** Exact current logged main-request route, when one has been recorded. */
    readonly route?: SessionTitleModelProvenance;
    /** Cancellation for supersession, disposal, timeout composition, or the explicit caller. */
    readonly signal: AbortSignal;
}
/** Provider output before service-owned normalization and log acceptance. */
export interface SessionTitleProviderResult {
    /** Proposed title text. */
    readonly title: string;
    /** Exact seqs from `request.messages` used by this result. */
    readonly messageSeqs: readonly number[];
    /** Auxiliary LLM route, when generation used a model. */
    readonly model?: SessionTitleModelProvenance;
}
/** One optional asynchronous title implementation registered with the service. */
export interface SessionTitleProvider {
    /** Stable id of the provider recorded with the title. */
    readonly id: SessionTitleProviderId;
    /** When new human prompts start automatic generation. */
    readonly automatic: SessionTitleAutomaticMode;
    /**
     * Produce one title revision.
     * @param request - message snapshot, current route, session, and cancellation.
     * @returns proposed title plus exact input seqs and the optional provider/model route used to generate it.
     */
    generate(request: SessionTitleProviderRequest): Promise<SessionTitleProviderResult>;
}
/**
 * Collect human text-bearing user messages in log order.
 * @param events - session log or persisted replay.
 * @param throughSeq - optional inclusive event boundary.
 * @returns eligible messages with exact source seqs.
 */
export declare function collectSessionTitleMessages(events: readonly SessionEvent[], throughSeq?: number): SessionTitleUserMessage[];
/**
 * Fold the latest logged title without consulting mutable metadata.
 * @param events - live or persisted session log.
 * @returns the latest immutable title snapshot, or `undefined`.
 */
export declare function foldSessionTitle(events: readonly SessionEvent[]): SessionTitleSnapshot | undefined;
/** Log-backed title fold plus asynchronous fallback generation. */
export declare class SessionTitleService extends Service {
    static inject: string[];
    static Config: z<Config>;
    private readonly config;
    private readonly ownerFiber;
    private registration;
    private readonly work;
    private readonly lifetime;
    private readonly inFlight;
    constructor(ctx: Context, config: Config);
    /**
     * Read the latest folded title from one live or replayed session.
     * @param session - session whose log is the title source of truth.
     * @returns latest title snapshot, or `undefined` before eligible input.
     */
    get(session: Session): SessionTitleSnapshot | undefined;
    /**
     * Accept an explicit user title. Appends a `session/title` event with the
     * `user` source, which pins the title: in-flight automatic generation is
     * superseded and later user messages schedule none (an explicit
     * {@link SessionTitleService.refresh} remains the deliberate unpin).
     * @param session - exact live session to rename.
     * @param title - raw user input; normalized before acceptance.
     * @returns the accepted title snapshot.
     * @throws {SessionTitleInvalidError} when the title normalizes to empty.
     * @throws {Error} when the session is not live or the service is disposed.
     */
    rename(session: Session, title: string): SessionTitleSnapshot;
    /**
     * Explicitly retry the registered provider, or materialize the built-in
     * fallback when no provider is registered.
     * @param session - exact live session to refresh.
     * @param signal - optional caller cancellation.
     * @returns latest accepted title, or `undefined` when no eligible text exists.
     */
    refresh(session: Session, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>;
    /**
     * Register the sole optional title provider. Disposal aborts its pending and
     * active work before another provider may register.
     * @param provider - provider identity, cadence, and generation function.
     * @returns exact Cordis effect disposer, which settles after active calls quiesce.
     */
    register(provider: SessionTitleProvider): () => Promise<void>;
    /** Schedule fallback creation and any provider cadence for one eligible event. */
    private onUserMessage;
    /** Start pending automatic work only after its exact main-request route is logged. */
    private onRequestHeader;
    /** Start unchanged-route work from the marked loop request after its header fold is current. */
    private onMainRequest;
    /** Consume one pending revision and schedule its non-blocking provider call. */
    private startPending;
    /** Start one tracked provider call after publishing its active revision. */
    private startProvider;
    /** Execute and accept one current provider revision. */
    private runProvider;
    /** Validate and normalize provider output against the supplied message snapshot. */
    private validateResult;
    /** Fail a completion whose provider, revision, session, or signal is stale. */
    private assertCurrent;
    /** Create and publish an active provider call from one fixed revision. */
    private activate;
    /** Abort older active work and reserve the next session-local revision. */
    private supersede;
    /** Return mutable work state for one session. */
    private stateFor;
    /** Queue detached service work and retain it through service disposal. */
    private defer;
    /** Retain one promise until settlement for service and optional provider teardown. */
    private track;
    /** Await every current and settling promise in one lifecycle registry. */
    private drain;
    /** Whether the owning plugin fiber can still start or commit title work. */
    private serviceActive;
    /** Reject work once the owning plugin fiber has begun unloading. */
    private assertServiceActive;
    /** Reject malformed provider registrations before publishing an effect. */
    private validateProvider;
    /**
     * Derive and append the deterministic fallback title over whatever stands
     * (the refresh unpin path: overwriting a pinned user title is the point).
     * Synchronous on purpose — no await may separate derivation from append, so
     * it needs neither ensureFallback's in-flight dedup nor its liveness
     * re-check. An underivable fallback (empty after the caps) appends nothing.
     */
    private appendFallback;
    /** Create the first deterministic fallback if the session still lacks a title. */
    private ensureFallback;
}
export default SessionTitleService;
//# sourceMappingURL=index.d.ts.map