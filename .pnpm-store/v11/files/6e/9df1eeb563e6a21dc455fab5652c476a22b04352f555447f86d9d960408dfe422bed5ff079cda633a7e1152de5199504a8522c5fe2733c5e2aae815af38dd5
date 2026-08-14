import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client';
interface InboxIdentity {
    readonly id: string;
}
/** Cumulative state after one durable inbox splice. */
export interface InboxState {
    readonly pending: readonly InboxIdentity[];
    readonly claimed: ReadonlySet<string>;
}
/** Cumulative next-turn inbox splice Definition. */
export declare const nextTurnInboxDefinition: ConversationNodeDefinition<InboxState>;
/** Cumulative next-step inbox splice Definition used to classify steering. */
export declare const nextStepInboxDefinition: ConversationNodeDefinition<InboxState>;
/**
 * Register the two durable Inbox-state contributions.
 * @param ctx - owning UI Conversation context.
 */
export declare function registerInboxConversationNodes(ctx: Context): void;
export {};
//# sourceMappingURL=inbox.d.ts.map