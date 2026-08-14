import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { ConversationNode, RunningToolCall } from './conversation.ts';
/** Fixed wire-safety ceiling for every recursive Tool call consumer. */
export declare const MAX_TOOL_CALL_TREE_DEPTH = 256;
/**
 * Owns Code Dispatch pairing and projects its private parent index into the
 * recursive Tool call contract exposed by conversation snapshots.
 */
export declare class ToolCallTree {
    private readonly childrenByParent;
    private readonly depthByCall;
    private readonly projectedByCall;
    private revision;
    private nodesCache;
    private runningCache;
    /** Forget all event-derived child calls before replaying a new window. */
    reset(): void;
    /**
     * Fold one event when it belongs to the Code Dispatch lifecycle.
     * @param event - Session event from the current live or history window.
     * @returns Whether the event was consumed as a child-call lifecycle event.
     */
    apply(event: SessionEvent): boolean;
    /**
     * Attach recursively projected children to all settled roots in a node list.
     * @param nodes - Cache-stable base conversation nodes.
     * @returns The original list when no root changed, otherwise a structurally shared list.
     */
    projectNodes(nodes: readonly ConversationNode[]): readonly ConversationNode[];
    /**
     * Attach recursively projected children to all running root calls.
     * @param calls - Cache-stable base running calls.
     * @returns The original list when no root changed, otherwise a structurally shared list.
     */
    projectRunningCalls(calls: readonly RunningToolCall[]): readonly RunningToolCall[];
    private projectBlock;
    /**
     * Accept an edge only when every recursive consumer can traverse it safely.
     * Host-minted ids exclude cycles and current bindings emit one level; a
     * malformed wire/history edge is consumed without hiding the rest of the session.
     */
    private acceptEdge;
    private wouldCreateCycle;
}
//# sourceMappingURL=tool-call-tree.d.ts.map