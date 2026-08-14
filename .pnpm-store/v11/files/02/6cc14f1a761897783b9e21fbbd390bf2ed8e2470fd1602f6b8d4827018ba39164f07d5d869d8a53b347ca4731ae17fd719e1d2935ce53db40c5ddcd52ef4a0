import type { StreamChunk } from '@deepseek-ai/dsh-llm/types';
import type { AssistantBlock, PartialAssistant } from './conversation.ts';
/**
 * Whether a stream chunk changes the partial assistant projection shown by the UI.
 * @param type - Stream chunk discriminant.
 * @returns Whether publishing the accumulated partial can change the visible snapshot.
 */
export declare function isVisibleAssistantChunk(type: string): boolean;
/** assistant/chunk accumulator: folds StreamChunks into AssistantBlock[] with block-level immutability. */
export declare class PartialAccumulator {
    readonly turn: number;
    readonly step: number;
    private blocks;
    private changed;
    private snapshot;
    /**
     * @param turn - Owning agent turn.
     * @param step - Owning model step.
     * @param initialBlocks - Materialized prefix when accumulation begins after history replay.
     */
    constructor(turn: number, step: number, initialBlocks?: readonly AssistantBlock[]);
    /**
     * Fold one chunk.
     * @param chunk - the stream chunk.
     * @returns whether it caused a visible change (usage/finish return false, skipping notification).
     */
    push(chunk: StreamChunk): boolean;
    /**
     * Current partial projection.
     * @returns the cached snapshot (the blocks array reference only changes after a mutation).
     */
    toPartial(): PartialAssistant;
}
/**
 * Create the empty client projection for one streamed Assistant block kind.
 * @param blockType - wire block kind.
 * @returns empty projected block ready to receive deltas.
 */
export declare function emptyAssistantBlock(blockType: string): AssistantBlock;
//# sourceMappingURL=partial.d.ts.map