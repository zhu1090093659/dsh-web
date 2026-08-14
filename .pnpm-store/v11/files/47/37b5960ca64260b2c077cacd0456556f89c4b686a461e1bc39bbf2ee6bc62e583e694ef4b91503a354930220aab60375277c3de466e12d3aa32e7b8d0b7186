/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @deepseek-ai/dsh-agent/model-selection
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
    /** Registered provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
    /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
    reasoningEffort?: ReasoningEffortId;
}
/** Mutable model selection plus the value captured for the current step. */
export interface ModelSelectionRef {
    /** Model selected for the next step that enters prompt assembly. */
    current: ModelSelection | undefined;
    /** Selection captured when the current step entered prompt assembly. */
    assembled: ModelSelection | undefined;
}
/**
 * Couple one mutable selection to Agent-scoped prompt assembly and request routing.
 * Prompt assembly snapshots the selected model before delegating, then applies
 * its provider/model pair and effort to request config so a
 * concurrent switch takes effect on a later step instead of splitting the two
 * surfaces. An absent selected effort clears any inherited effort, restoring
 * the selected model's provider/default behavior.
 *
 * @param agentCtx - The selected Agent's scoped context.
 * @param selection - Mutable selection owned by the calling entry point.
 * @returns Disposer for both scoped waterfall listeners.
 */
export declare function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void;
//# sourceMappingURL=model-selection.d.ts.map