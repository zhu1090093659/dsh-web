import type { Context } from '@deepseek-ai/cordis';
import type { ChatConversationViewNode, ChatSnapshot, ConversationTimelineSnapshot, ConversationViewBuilder, ConversationViewDefinition } from '@deepseek-ai/dsh-client-runtime/client';
/** Incremental keyed Chat builder registered under the `chat` target. */
export declare class ChatSnapshotBuilder implements ConversationViewBuilder<ChatConversationViewNode, ChatSnapshot> {
    private readonly store;
    private readonly locations;
    private readonly legacy;
    private order;
    readonly empty: ChatSnapshot;
    constructor();
    replace(input: {
        readonly nodes: readonly ChatConversationViewNode[];
        readonly timeline: ConversationTimelineSnapshot;
    }): ChatSnapshot;
    apply(input: {
        readonly upserts: readonly ChatConversationViewNode[];
        readonly timeline: ConversationTimelineSnapshot;
    }): ChatSnapshot;
    private snapshot;
}
/** Chat target factory contributed to the Runtime view registry. */
export declare const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot>;
/**
 * Register the incremental Chat target builder.
 * @param ctx - owning UI Conversation context.
 */
export declare function registerChatConversationView(ctx: Context): void;
//# sourceMappingURL=chat-snapshot-builder.d.ts.map