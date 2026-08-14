/**
 * Incremental projection of durable agent inbox events.
 *
 * @module @deepseek-ai/dsh-agent/inbox
 */
import type { MessageId } from '@deepseek-ai/dsh-llm';
import type { Session, UserMessage } from '@deepseek-ai/dsh-session';
import type { InboxTarget } from './types.ts';
/** Live notifications committed by inbox mutations. */
export interface InboxNotifications {
    /** Publish one inserted message. */
    inserted(message: UserMessage): void;
    /** Publish one discarded message. */
    discarded(message: UserMessage): void;
    /** Publish one claimed message inside its owning turn. */
    claimed(message: UserMessage, turn: number): void;
}
/** A replay-once projection that incrementally consumes later inbox splices. */
export declare class Inbox {
    private readonly session;
    private readonly notifications;
    private readonly state;
    constructor(session: Session, notifications: InboxNotifications);
    /** Prompts awaiting individual turns. */
    get nextTurn(): readonly UserMessage[];
    /** Input awaiting the next step boundary. */
    get nextStep(): readonly UserMessage[];
    /** Whether either pending-message list contains work. */
    get hasPending(): boolean;
    /** Durably cancel all pending input, clearing next-step before next-turn. */
    clear(): void;
    /**
     * Remove and return the complete batch proposed for one step, publishing
     * each claimed message. The durable splices are pure deletions.
     * @param target - whether this boundary also consumes one queued turn.
     * @param turn - turn that will own the claimed batch.
     * @returns next-step input followed by the queued turn, when requested.
     * @internal - The agent loop's step-boundary operation, not a plugin extension point.
     */
    claim(target: InboxTarget, turn: number): UserMessage[];
    /**
     * Append one message to a pending list and durably record the insertion.
     * @param target - pending list to extend.
     * @param message - message to append.
     * @throws if the message identity is already pending.
     */
    append(target: InboxTarget, message: UserMessage): void;
    /**
     * Prepend one message to a pending list and durably record the insertion.
     * @param target - pending list to extend.
     * @param message - message to prepend.
     * @throws if the message identity is already pending.
     */
    prepend(target: InboxTarget, message: UserMessage): void;
    /**
     * Replace one pending message in place, possibly changing its identity. A
     * successful replacement publishes the old message as discarded and the new
     * message as inserted.
     * @param messageId - identity of the pending message to replace.
     * @param newMessage - replacement message.
     * @returns whether the message was still pending.
     * @throws if the replacement duplicates another pending message identity.
     */
    replace(messageId: MessageId, newMessage: UserMessage): boolean;
    /**
     * Remove one pending message and durably record its cancellation.
     * @param messageId - identity of the pending message to remove.
     * @returns whether the message was still pending.
     */
    remove(messageId: MessageId): boolean;
    /**
     * Apply standard splice semantics and durably record the normalized result.
     * The durable event commits before the live projection mutates, so synchronous
     * `session/event` observers see the pre-splice lists and can reconstruct the
     * removed messages from the normalized coordinates.
     * @param target - pending list to mutate.
     * @param start - splice position.
     * @param deleteCount - maximum number of messages to remove.
     * @param inserted - messages to insert at the resolved position.
     * @returns messages removed by the splice.
     */
    splice(target: InboxTarget, start: number, deleteCount: number, inserted: UserMessage[]): UserMessage[];
    /** Locate one pending identity across both owned lists. */
    private locate;
    /** Commit one normalized mutation and publish its live notifications. */
    private mutate;
    /** Apply one normalized durable splice to the projection. */
    private apply;
    /** Validate one normalized splice against the current projection. */
    private validate;
}
//# sourceMappingURL=inbox.d.ts.map