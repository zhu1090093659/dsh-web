import type { ConversationLocation, ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { ChatNode, ChatNodeDataMap, ChatNodeKind } from '../contract/chat-nodes.ts';
/**
 * Relative positions in one durable event's seq neighborhood: interrupted
 * Assistant, its follow-up Nodes, then follow-ups to an ordinary final. The
 * max-tokens notice sits between a closing Assistant and the turn-tail so the
 * tail stays the turn's last node and keeps its branch action enabled.
 */
export declare const CHAT_SYNTHETIC_SEQ_OFFSETS: {
    readonly interruptedAssistant: -0.9;
    readonly interruptedFollowup: -0.8;
    readonly maxTokensNotice: 0.05;
    readonly finalizedFollowup: 0.1;
};
/**
 * Resolve one Context's best currently loaded event Location.
 * @param context - assembled business Context.
 * @returns start or first-match Location, otherwise unresolved.
 */
export declare function contextLocation(context: ConversationNodeContext): ConversationLocation;
/**
 * Build one final Chat target Node with the engine-owned stable key.
 * @param context - assembled business Context.
 * @param kind - Chat renderer dispatch key.
 * @param anchorSeq - sortable render position.
 * @param data - renderer-owned payload.
 * @param options - optional Location and visibility overrides.
 * @returns final Chat view Node.
 */
export declare function chatNode<Kind extends ChatNodeKind>(context: ConversationNodeContext, kind: Kind, anchorSeq: number, data: ChatNodeDataMap[Kind], options?: {
    readonly location?: ConversationLocation;
    readonly visibility?: 'visible' | 'hidden';
}): ChatNode<Kind>;
/**
 * Read a finite non-negative integer from a structurally narrowed payload.
 * @param value - untrusted payload field.
 * @returns valid coordinate, otherwise undefined.
 */
export declare function coordinate(value: unknown): number | undefined;
//# sourceMappingURL=common.d.ts.map