import { Service } from '@deepseek-ai/cordis';
/** Shared lifecycle and stable-entry storage for one Conversation Definition registry. */
export declare abstract class ConversationDefinitionRegistry<Definition> extends Service {
    protected readonly definitions: Map<string, Definition>;
    private listeners;
    private cached;
    /**
     * Return reference-stable Definitions in registration order.
     * @returns current Definitions.
     */
    entries(): readonly Definition[];
    /**
     * Observe low-frequency registry changes.
     * @param listener - synchronous invalidation callback.
     * @returns unsubscribe callback.
     */
    subscribe(listener: () => void): () => void;
    /**
     * Register one uniquely keyed Definition for the caller's lifetime.
     * @param key - registry-local unique key.
     * @param definition - contributed Definition.
     * @param duplicateMessage - error raised when the key is already owned.
     * @param effectName - Cordis effect diagnostic label.
     * @returns idempotent disposer.
     */
    protected registerDefinition(key: string, definition: Definition, duplicateMessage: string, effectName: string): () => void;
    /** Refresh cached entries and synchronously invalidate subscribers. */
    protected refresh(): void;
}
//# sourceMappingURL=definition-registry.d.ts.map