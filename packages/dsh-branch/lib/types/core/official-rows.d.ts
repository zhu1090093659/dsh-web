/**
 * Official trajectory row projection: replicates (read-only) the cell-index
 * enumeration of the shipped ui-trajectory layout so the browser injector can
 * map each official `tr[data-record-index]` to a rollback/restore state
 * without touching the official UI. This is a pure mirror of the official
 * layout rules for the current dsh SDK (rc.6); it never imports from the
 * official package at value level.
 *
 * Every official row gets an entry with its global cellIndex and the file-op
 * count applied up to that position (stateIndex). Only settled write/edit
 * calls carry a FileOp: calls whose result is outside the trajectory window
 * or still running have unknown file state and stay op-less (the row then
 * reports "no changes" instead of guessing).
 */
import type { ConversationNode, RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client';
import { type FileOp } from './trajectory.ts';
export type OfficialRowKind = 'request' | 'system' | 'compacted' | 'user' | 'message' | 'context' | 'tool' | 'subtool';
export interface OfficialRowProjection {
    /** Value of the official row's `tr[data-record-index]` attribute. */
    readonly cellIndex: number;
    readonly kind: OfficialRowKind;
    /** File op carried by this row (settled write/edit only). */
    readonly op: FileOp | undefined;
    /** File ops applied up to and including this row (applySetAt index). */
    readonly stateIndex: number;
    readonly callId?: string;
    /** Short row label (tool name or kind), used for master tree labels. */
    readonly label: string;
}
export interface OfficialRowsInput {
    readonly nodes: readonly ConversationNode[];
    /** Raw RequestView[] from the trajectory snapshot (fields are read structurally). */
    readonly requests?: readonly unknown[];
    readonly partial?: {
        readonly turn: number;
        readonly step: number;
        readonly blocks: readonly unknown[];
    } | null;
    readonly runningCalls: readonly RunningToolCall[];
}
/**
 * Enumerate the official trajectory rows and attach per-row file state.
 * @returns rows sorted by cellIndex (the official display order).
 */
export declare function projectOfficialRows(input: OfficialRowsInput): readonly OfficialRowProjection[];
//# sourceMappingURL=official-rows.d.ts.map