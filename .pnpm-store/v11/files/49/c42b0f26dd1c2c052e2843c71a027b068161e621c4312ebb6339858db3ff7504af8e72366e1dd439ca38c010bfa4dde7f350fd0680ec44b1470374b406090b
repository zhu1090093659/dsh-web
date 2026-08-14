/**
 * Incremental chunk-to-message assembler. This is the single canonical assembly
 * algorithm used by the agent loop to build an assistant message from a chunk
 * stream while logging the raw chunks for replay fidelity.
 *
 * @module @deepseek-ai/dsh-llm/assembler
 */
import { CallId } from "./brand.js";
import { assertNever } from "./never.js";
import { createMessage } from "./message.js";
/**
 * Incrementally assembles raw {@link StreamChunk}s into complete
 * {@link ContentBlock}s and a final assistant {@link Message}.
 *
 * The agent loop feeds it while logging raw chunks for replay fidelity, then
 * reads `blocks()` / `message()` / `usage` / `finish` once the stream ends.
 *
 * Tolerant of delta-only protocols (no block-start/end); deltas arriving for
 * an index already closed by `block-end` are ignored (malformed stream) so a
 * misbehaving adapter cannot grow memory or corrupt a completed block.
 */
export class BlockAssembler {
    partials = new Map();
    order = [];
    _usage;
    _finish;
    _replayState = undefined;
    /**
     * Feed one chunk into the assembly state.
     * @param chunk - the next raw chunk, in stream order.
     */
    push(chunk) {
        switch (chunk.type) {
            case 'block-start': {
                if (!this.partials.has(chunk.index)) {
                    this.order.push(chunk.index);
                    this.partials.set(chunk.index, {
                        blockType: chunk.blockType,
                        text: '',
                        toolCallArguments: '',
                    });
                }
                return;
            }
            case 'text-delta':
            case 'reasoning-delta': {
                const partial = this.ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning');
                if (partial.block)
                    return; // closed by block-end; ignore stragglers
                partial.text += chunk.text;
                return;
            }
            case 'tool-call-delta': {
                const partial = this.ensure(chunk.index, 'tool-call');
                if (partial.block)
                    return; // closed by block-end; ignore stragglers
                partial.toolCallId = chunk.id;
                if (chunk.name)
                    partial.toolCallName = chunk.name;
                partial.toolCallArguments += chunk.argumentsDelta;
                return;
            }
            case 'block-end': {
                const partial = this.ensure(chunk.index, chunk.block.type);
                // First close wins; ignoring re-close stragglers keeps streamed output
                // and the final assembled block in agreement.
                if (partial.block)
                    return;
                partial.block = chunk.block;
                return;
            }
            case 'usage': {
                this._usage = chunk.usage;
                return;
            }
            case 'finish': {
                this._finish = chunk.reason;
                this._replayState = chunk.replayState;
                return;
            }
            default: return assertNever(chunk, 'BlockAssembler.push');
        }
    }
    ensure(index, blockType) {
        let partial = this.partials.get(index);
        if (!partial) {
            partial = { blockType, text: '', toolCallArguments: '' };
            this.partials.set(index, partial);
            this.order.push(index);
        }
        return partial;
    }
    assemble(partial, index) {
        if (partial.block)
            return partial.block;
        switch (partial.blockType) {
            case 'text': return { type: 'text', text: partial.text };
            case 'reasoning': return { type: 'reasoning', text: partial.text };
            case 'tool-call': return {
                type: 'tool-call',
                id: partial.toolCallId ?? CallId(`call-${index}`),
                name: partial.toolCallName ?? '',
                arguments: partial.toolCallArguments,
            };
            default: throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`);
        }
    }
    /** Invariant accessor: every index in `order` has a partial. */
    mustGet(index) {
        const partial = this.partials.get(index);
        if (!partial)
            throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`);
        return partial;
    }
    /**
     * Assemble all blocks seen so far, in stream order.
     * @returns one block per seen index, except that max-token truncation drops
     *   tool calls that cannot be executed safely; an open block assembles from
     *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
     */
    blocks() {
        const blocks = this.order.map(index => this.assemble(this.mustGet(index), index));
        return this.finish.kind === 'max-tokens'
            ? blocks.filter(block => block.type !== 'tool-call')
            : blocks;
    }
    /** Usage from the `usage` chunk; undefined until one arrives. */
    get usage() {
        return this._usage;
    }
    /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
    get finish() {
        return this._finish ?? { kind: 'stop' };
    }
    /** Adapter-private replay state from the terminal finish chunk, if any. */
    get replayState() {
        return this._replayState;
    }
    /**
     * The assembled assistant message.
     * @param source - producer attribution for the assembled message.
     * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
     */
    message(source = { kind: 'plugin', plugin: 'dsh-llm/assembler' }) {
        return createMessage({ role: 'assistant', content: this.blocks(), source });
    }
}
//# sourceMappingURL=assembler.js.map