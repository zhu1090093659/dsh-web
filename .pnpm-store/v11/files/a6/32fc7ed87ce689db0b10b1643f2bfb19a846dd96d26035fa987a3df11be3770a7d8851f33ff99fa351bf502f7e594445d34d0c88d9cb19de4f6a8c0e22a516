import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinition, ModelRetryNode } from '@deepseek-ai/dsh-client-runtime/client';
import type { RetryChatData } from '../contract/chat-nodes.ts';
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ChatNodeDataMap {
        /** Producer-correlated model retry chain. */
        'model-retry': RetryChatData;
    }
}
/** Accumulated retry attempts sharing one producer-owned RetryId. */
export interface RetryState {
    readonly turn: number;
    readonly step: number;
    readonly attempts: readonly ModelRetryNode[];
}
/** Producer-correlated model retry chain Definition. */
export declare const retryDefinition: ConversationNodeDefinition<RetryState>;
/**
 * Register the correlated model-retry business contribution.
 * @param ctx - owning UI Conversation context.
 */
export declare function registerRetryConversationNode(ctx: Context): void;
//# sourceMappingURL=retry.d.ts.map