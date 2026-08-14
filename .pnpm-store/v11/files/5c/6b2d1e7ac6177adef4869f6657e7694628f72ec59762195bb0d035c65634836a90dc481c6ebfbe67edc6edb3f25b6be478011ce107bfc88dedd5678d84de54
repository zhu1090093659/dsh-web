import type { MuxFrame } from '@deepseek-ai/dsh-api-remotes/client';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { QueuedMessage } from './conversation.ts';
type QueueItems = Extract<MuxFrame, {
    type: 'session/queue';
}>['items'];
/** Authoritative transient queue projection and durable steering handoff. */
export declare class SessionQueueMirror {
    private current;
    /**
     * Return the current immutable queue projection.
     * @returns current queue rows.
     */
    snapshot(): readonly QueuedMessage[];
    /**
     * Drop the stale generation before its replacement queue baseline arrives.
     * @returns whether any projected queue row was removed.
     */
    reset(): boolean;
    /**
     * Replace from one authoritative stream queue frame.
     * @param items - complete host queue snapshot.
     */
    replace(items: QueueItems): void;
    /**
     * Retire a transient steering row once its durable message enters the log.
     * @param event - newly contiguous durable Session event.
     * @returns whether the projection changed.
     */
    acceptDurable(event: SessionEvent): boolean;
}
export {};
//# sourceMappingURL=queue-mirror.d.ts.map