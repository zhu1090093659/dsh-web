/** Reconstruct durable steering identity from the event-sourced agent inbox. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
/**
 * Incrementally identifies `user/message` events claimed from the next-step
 * inbox. The agent loop records all admitted input as `user/message`; the
 * preceding `agent/inbox/spliced` events preserve whether it came from the
 * queued-turn list or the next-step list.
 */
export declare class SteeringHistory {
    private readonly inbox;
    private readonly claimedNextStep;
    /** Clear all replay state before rebuilding a history window. */
    reset(): void;
    /**
     * Apply one event and report whether it is a durable human steering message.
     * @param event - next raw session event in sequence order.
     * @returns true only for a user-origin message previously claimed from `next-step`.
     */
    apply(event: SessionEvent): boolean;
    /** Replay one host-validated inbox splice. */
    private applySplice;
}
//# sourceMappingURL=steering-history.d.ts.map