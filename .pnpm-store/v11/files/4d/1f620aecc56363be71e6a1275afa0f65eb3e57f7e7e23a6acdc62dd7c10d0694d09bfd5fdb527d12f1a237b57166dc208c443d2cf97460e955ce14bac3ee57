/**
 * Canonical selection of a child's final assistant output. Backend run results
 * and `subagent/end.lastAssistantMessage` apply the same rule: select the last
 * non-empty assistant message. An empty-content message records usage only
 * when the loop appends it after a max-tokens step with no executable blocks,
 * so it does not replace earlier output. If no non-empty message exists,
 * select the accumulated assistant text. Selection is independent of the
 * run's stop reason.
 *
 * @module @deepseek-ai/dsh-subagent/assistant-output
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/**
 * Incremental fold of the selection rule, for backends that observe a child's
 * output as it streams: session-event backends {@link push} each event, and
 * transports without session events (ACP content chunks) {@link pushText} raw
 * text into the same streamed fallback.
 */
export declare class AssistantOutputFold {
    private message;
    private partial;
    /**
     * Fold one session event: a non-empty assistant message becomes the
     * candidate final answer, and a `text-delta` chunk extends the streamed
     * fallback; every other event contributes nothing.
     * @param event - the next observed session event.
     */
    push(event: SessionEvent): void;
    /**
     * Extend the streamed fallback with text observed outside session events.
     * @param text - the next streamed text piece (an empty piece is a no-op).
     */
    pushText(text: string): void;
    /**
     * Select the final output folded so far.
     * @returns the last non-empty assistant message, else the accumulated
     *   streamed text, or `undefined` when the child produced neither.
     */
    collect(): ContentBlock[] | undefined;
}
/**
 * Apply the selection rule to one complete child-owned event suffix.
 * @param events - the child-owned events (after any seed or epoch boundary).
 * @returns the selected output, or `undefined` when the child produced none.
 */
export declare function finalAssistantOutput(events: readonly SessionEvent[]): ContentBlock[] | undefined;
//# sourceMappingURL=assistant-output.d.ts.map