/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ModelSelection } from '@deepseek-ai/dsh-agent';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Default model selection for Agents created without an explicit model. */
        agentDefaultModel: AgentDefaultModelConfig;
    }
}
/** Settings namespace carrying the default model selection for future Agents. */
export declare const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
    /** Registered provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
    /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
    reasoningEffort?: string;
}
/** Schema of the default Agent model settings section. */
export declare const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings>;
/** Composition entry for the default model selection. */
export interface Config {
    /** Registered provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
}
/**
 * Owns the default model selection independently of any Host or transport.
 * The composition entry remains usable without a settings provider; when one
 * is mounted, its user layer is read live.
 */
export declare class AgentDefaultModelConfig extends Service {
    static Config: z<Config>;
    private source;
    constructor(ctx: Context, config: Config);
    /**
     * Read the current default model selection.
     * @returns a detached provider, model, and optional reasoning selection.
     */
    currentSelection(): ModelSelection;
    /**
     * Save the complete default model selection. A deployment without a settings
     * provider keeps its composition entry.
     * @param next - resolved selection accepted by an entry point.
     * @returns fulfillment after the optional settings write settles.
     */
    saveSelection(next: ModelSelection): Promise<void>;
}
export default AgentDefaultModelConfig;
//# sourceMappingURL=index.d.ts.map