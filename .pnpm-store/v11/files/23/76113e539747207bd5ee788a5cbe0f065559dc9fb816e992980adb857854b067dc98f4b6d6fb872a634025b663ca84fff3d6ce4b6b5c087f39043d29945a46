import type { Context } from '@deepseek-ai/cordis';
import type { CommandNode, CompactionSummaryNode, ConversationMatch, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client';
import type { ManualCompactionChatData } from '../contract/chat-nodes.ts';
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ChatNodeDataMap {
        /** Ordinary slash-command lifecycle. */
        command: CommandNode;
        /** Manual compact command combined with its compaction transaction. */
        'manual-compaction': ManualCompactionChatData;
    }
}
type CommandId = CommandNode['commandId'];
interface CommandState {
    readonly command: CommandNode;
    readonly summary?: ConversationMatch;
    readonly checkpoint?: ConversationMatch;
}
interface CompactionEvidence {
    readonly summary?: ConversationMatch;
    readonly checkpoint?: ConversationMatch;
}
/**
 * Read correlation identity from a compaction replacement checkpoint.
 * @param event - candidate Session event.
 * @returns correlated compaction and optional command identity.
 */
declare function compactSource(event: Parameters<ConversationNodeDefinition['match']>[0]): {
    compactionId: string;
    sourceCommandId?: CommandId;
} | undefined;
/**
 * Build the visible summary marker from optional lifecycle evidence.
 * @param match - compaction/summary Match, when loaded.
 * @param checkpoint - replacement checkpoint Match.
 * @returns final compaction summary Node data.
 */
declare function compactSummary(match: ConversationMatch | undefined, checkpoint: ConversationMatch): CompactionSummaryNode;
/**
 * Fold shared compaction evidence into a Definition-owned State.
 * @param state - current business State carrying optional compaction evidence.
 * @param match - next compaction lifecycle Match.
 * @returns adopted State, preserving reference identity when the Match adds no evidence.
 */
export declare function updateCompactionState<State extends CompactionEvidence>(state: State, match: ConversationMatch): State;
/** Slash-command lifecycle, including integrated manual compaction, Definition. */
export declare const commandDefinition: ConversationNodeDefinition<CommandState>;
/**
 * Register the command lifecycle business contribution.
 * @param ctx - owning UI Conversation context.
 */
export declare function registerCommandConversationNode(ctx: Context): void;
/** Shared structural checkpoint recognizer for automatic compaction. */
export { compactSource, compactSummary };
//# sourceMappingURL=command.d.ts.map