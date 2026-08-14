import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinition, TurnErrorNode } from '@deepseek-ai/dsh-client-runtime/client';
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ChatNodeDataMap {
        /** Terminal turn failure not superseded by retry. */
        'turn-error': TurnErrorNode;
    }
}
interface TurnErrorState {
    readonly turn: number;
    readonly hidden: boolean;
    readonly failure?: {
        readonly seq: number;
        readonly time: number;
        readonly message: string;
        readonly code?: string;
    };
}
/** Terminal turn failure Definition, suppressed when the turn owns a retry chain. */
export declare const turnErrorDefinition: ConversationNodeDefinition<TurnErrorState>;
/**
 * Register the terminal Turn-error business contribution.
 * @param ctx - owning UI Conversation context.
 */
export declare function registerTurnErrorConversationNode(ctx: Context): void;
export {};
//# sourceMappingURL=turn-error.d.ts.map