import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinition } from '../contract/conversation.ts';
import { ConversationDefinitionRegistry } from './definition-registry.ts';
/** Runtime registry of independently owned Conversation business Definitions. */
export declare class ConversationEventRegistry extends ConversationDefinitionRegistry<ConversationNodeDefinition> {
    private fallback;
    /** @param ctx - owning Client Runtime context. */
    constructor(ctx: Context);
    /**
     * Register a uniquely named business Definition for the caller's lifetime.
     * @param definition - Definition contribution.
     * @returns idempotent disposer.
     */
    register(definition: ConversationNodeDefinition): () => void;
    /**
     * Register the sole fallback used only when no ordinary Definition matches.
     * @param definition - fallback Definition.
     * @returns idempotent disposer.
     */
    registerFallback(definition: ConversationNodeDefinition): () => void;
    /**
     * Return the current unmatched-event fallback.
     * @returns installed fallback, when present.
     */
    fallbackEntry(): ConversationNodeDefinition | undefined;
}
//# sourceMappingURL=event-registry.d.ts.map