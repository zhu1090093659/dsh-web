/**
 * Lossless storage packing for `assistant/chunk` delta runs. Providers stream
 * token-sized deltas, so a log stores hundreds of near-identical event lines
 * whose JSON envelopes dwarf their payloads (~56× measured on a real DeepSeek
 * session). This module packs each run of consecutive same-block delta chunks
 * into ONE storage row — `text-chunks`, `reasoning-chunks`, or
 * `tool-call-chunks` — and expands rows back to the exact original events.
 *
 * Storage rows are a durable-encoding vocabulary, NOT session events: they
 * never enter `Session.events`, have no `SessionEventMap` entry, and use bare
 * (slash-less) type tags so a reader cannot confuse them with the event
 * taxonomy (precedent: the JSONL header line's `session` tag). The encoder
 * whitelists exact shapes — anything it does not fully recognize is stored
 * verbatim, so unknown fields or future chunk variants lose compression, never
 * data. The decoder validates before expanding and fails loud on a malformed
 * row-tagged value instead of silently dropping a whole run.
 *
 * @module @deepseek-ai/dsh-session/chunk-rows
 */
import { CallId } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from './types.ts';
/**
 * Fields shared by every packed run: placement, block correlation, and member
 * timestamps as gaps. Member `k` reconstructs as seq `seq0 + k` and time
 * `time0` plus the first `k` gaps; a gap may be negative when the wall clock
 * stepped backwards between events.
 */
interface RunDataBase {
    turn: number;
    step: number;
    /** The stream block index every member shares. */
    index: number;
    /** Epoch-ms gaps between consecutive members; length is one less than the member count. */
    dt: number[];
}
/** Payload of a `text-chunks`/`reasoning-chunks` row: one entry per member, never joined — token boundaries are data. */
interface TextRunData extends RunDataBase {
    texts: string[];
}
/** Payload of a `tool-call-chunks` row: the run-constant call identity plus each member's raw arguments fragment. */
interface ToolCallRunData extends RunDataBase {
    id: CallId;
    /** Present iff every member carried it, with one uniform value (a mixed run never packs). */
    name?: string;
    args: string[];
}
/**
 * A packed run of consecutive delta chunk events, discriminated on `type`.
 * `seq0`/`time0` anchor the first member; text and reasoning rows share the
 * {@link TextRunData} payload, tool-call rows carry {@link ToolCallRunData}.
 */
export type ChunkRow = {
    type: 'text-chunks';
    seq0: number;
    time0: number;
    data: TextRunData;
} | {
    type: 'reasoning-chunks';
    seq0: number;
    time0: number;
    data: TextRunData;
} | {
    type: 'tool-call-chunks';
    seq0: number;
    time0: number;
    data: ToolCallRunData;
};
/** One durable log line's JSON value: a session event verbatim, or a packed chunk row. */
export type StorageRecord = SessionEvent | ChunkRow;
/**
 * Pack an event batch for storage: each run of at least {@link MIN_RUN}
 * consecutive whitelisted same-kind, same-block delta chunk events becomes one
 * {@link ChunkRow}; every other event passes through verbatim, in order.
 * Pure and stateless — safe over any array, including a batch whose runs were
 * split by flush boundaries (the split runs simply pack per batch).
 *
 * @param events - the batch to encode, in log order.
 * @returns the storage records to write, one JSONL line each.
 */
export declare function packChunkRuns(events: readonly SessionEvent[]): StorageRecord[];
/**
 * Decode one parsed JSONL line value into the session event(s) it stores.
 * Chunk-row-tagged values validate and expand (a malformed row throws — it is
 * corrupt storage, and treating it as an event would silently drop a whole
 * run); every other value passes through as a single event, unvalidated.
 *
 * @param value - one line's `JSON.parse` result.
 * @returns the stored events, in log order.
 */
export declare function decodeStorageRecord(value: unknown): SessionEvent[];
export {};
//# sourceMappingURL=chunk-rows.d.ts.map