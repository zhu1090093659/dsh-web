/**
 * Single replay-aware token-meter service for request and surface pressure.
 *
 * @module @deepseek-ai/dsh-token-meter
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Message } from '@deepseek-ai/dsh-llm';
import type { EpochHeader, Session } from '@deepseek-ai/dsh-session';
import type { TokenMeasurement, TokenMeterConfig } from './types.ts';
export type * from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        tokenMeter: TokenMeter;
    }
}
/** Replay owner for one service-wide estimator and isolated per-session folds. */
export declare class TokenMeter extends Service {
    static Config: z<TokenMeterConfig>;
    private readonly states;
    constructor(ctx: Context, config?: TokenMeterConfig);
    /**
     * Measure current request pressure and surface through the durable tail.
     *
     * Provider usage is reused only when the latest successful call's canonical
     * request envelope matches `requestHeader` and its total is no lower than
     * that call's full heuristic anchor; otherwise the complete envelope and
     * surface are heuristically repriced.
     *
     * `requestHeader` affects request pressure only; surface fields always
     * describe the current session surface. Every call clones those positional
     * nodes, so measurement is O(surface).
     *
     * @param session - session to replay through its current durable tail.
     * @param requestHeader - optional effective request envelope replacing the latest logged header.
     * @returns a detached deeply immutable pressure and surface measurement.
     */
    measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement;
    /**
     * Heuristically price one model-visible message (instance face of the pure
     * `estimateMessage` export from `estimate.ts`).
     * @param message - message to price without mutation.
     * @returns content and role-framing tokens under the fixed service heuristic.
     */
    estimateMessage(message: Message): number;
    /** Catch one session's fold up to the current durable tail. */
    private _sync;
    /**
     * Validate and prepare every fallible part before mutating replay state.
     * A malformed event remains unread on every retry instead of partially
     * applying the same mutation more than once.
     */
    private _foldEvent;
    /**
     * Reassemble provider output from the exact cited chunk seqs for a usage anchor.
     * Missing legacy source seqs conservatively treat the durable output as the
     * provider output; an explicit empty list prices a known empty stream.
     */
    private _estimateProviderAssistant;
}
export default TokenMeter;
//# sourceMappingURL=index.d.ts.map