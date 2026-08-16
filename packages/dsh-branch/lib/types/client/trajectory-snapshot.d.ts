/**
 * Locally-spelled trajectory snapshot contract: the published npm SDK (rc.6)
 * ships an empty ConversationViewSnapshotMap; the running shell's
 * ui-trajectory publishes the real snapshot under the 'trajectory' key.
 */
import type { ConversationLocation, ConversationNode, PartialAssistant, RequestView, RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client';
export interface BranchTrajectorySnapshot {
    readonly eventNodes: readonly ConversationNode[];
    readonly eventLocations?: ReadonlyMap<number, ConversationLocation>;
    readonly requests?: readonly RequestView[];
    readonly callSchemas?: ReadonlyMap<string, unknown>;
    readonly partial: PartialAssistant | null;
    readonly runningCalls: readonly RunningToolCall[];
}
declare module '@deepseek-ai/dsh-client-runtime/client' {
    interface ConversationViewSnapshotMap {
        trajectory: BranchTrajectorySnapshot;
    }
}
export declare const EMPTY_TRAJECTORY_SNAPSHOT: BranchTrajectorySnapshot;
//# sourceMappingURL=trajectory-snapshot.d.ts.map