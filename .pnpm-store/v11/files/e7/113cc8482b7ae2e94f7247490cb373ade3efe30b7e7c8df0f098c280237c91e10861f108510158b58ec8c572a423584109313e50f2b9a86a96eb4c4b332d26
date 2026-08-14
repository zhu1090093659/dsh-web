import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinition, TurnMaxTokensNode } from '@deepseek-ai/dsh-client-runtime/client';
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ChatNodeDataMap {
        /** Turn ended by the per-request output-token cap. */
        'turn-max-tokens': TurnMaxTokensNode;
    }
}
interface TurnMaxTokensState {
    readonly turn: number;
    readonly seq: number;
    readonly time: number;
}
/** Notice Definition for a turn the provider ended at its output-token cap. */
export declare const turnMaxTokensDefinition: ConversationNodeDefinition<TurnMaxTokensState>;
/**
 * Register the max-tokens turn-end notice contribution.
 * @param ctx - owning UI Conversation context.
 */
export declare function registerTurnMaxTokensConversationNode(ctx: Context): void;
export {};
//# sourceMappingURL=turn-max-tokens.d.ts.map