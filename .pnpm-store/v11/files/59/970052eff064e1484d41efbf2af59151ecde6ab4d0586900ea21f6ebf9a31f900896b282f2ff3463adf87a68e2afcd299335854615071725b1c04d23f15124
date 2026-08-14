/**
 * Registry for ordered system sections, dynamic context, tool schemas, and prompt variables.
 *
 * @module @deepseek-ai/dsh-system-prompt
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ScopeKey, Scoped } from '@deepseek-ai/dsh-scope';
import type { ContextSnapshotSection, ToolSchema } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/cordis' {
    interface Context {
        systemPrompt: SystemPrompt;
    }
    interface Events {
        /**
         * Expert waterfall over the assembled sections, contexts, tools, and variables.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners
         * receive only that scope's assemblies. The returned value is authoritative.
         * A supplied signal controls only this explicit assembly request and must not
         * be retained to control later turns. A registered complete section is
         * restored after this waterfall, so listeners cannot add to or replace
         * that scope's system prompt.
         * @param assembly - the mutable assembly built from registered providers.
         * @param context - the caller's per-assembly context.
         * @mode waterfall
         */
        'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>;
        /**
         * Emitted when any prompt provider changes. This registry notification is
         * unfiltered because a global change affects every scope.
         * @mode emit
         */
        'system-prompt/change'(): void;
    }
}
/** Merge-extensible context for one prompt assembly. */
export interface AssembleContext {
    /**
     * Scope whose providers and waterfall listeners participate. When absent,
     * only global providers and subject-less listeners participate.
     */
    scope?: ScopeKey;
    /** Explicit control signal for the turn that requested this assembly, when any. */
    signal?: AbortSignal;
}
/** One contributed section of the system prompt (registry input). */
export interface PromptSection {
    /** Unique name — a duplicate registration throws (see {@link SystemPrompt.section}). */
    readonly name: string;
    /**
     * Sections are concatenated in ascending order. Convention: `-100` is the
     * harness identity, `0` the deployment persona, tool guidance uses 100–199;
     * other negative orders also render before the persona.
     */
    readonly order: number;
    /**
     * Static text or a provider evaluated at each assembly with that assembly's
     * {@link AssembleContext}. The text may reference `{{variable}}`s — they are
     * interpolated later, by {@link renderPrompt}.
     */
    readonly text: string | ((context: AssembleContext) => string);
    /**
     * Treat this contribution as the complete system prompt. Assembly still
     * runs the cooperative waterfall so tools, contexts, and variables can be
     * resolved, then restores this exact section as the sole prompt section.
     * More than one effective complete section makes assembly fail.
     */
    readonly complete?: boolean;
}
/** Dynamic model context materialized as a durable user-role snapshot. */
export interface PromptContext {
    /** Unique name — a duplicate registration throws (see {@link SystemPrompt.context}). */
    readonly name: string;
    /** Contexts are joined in ascending order. */
    readonly order: number;
    /** Static text or a provider evaluated for each assembly. Empty text contributes nothing. */
    readonly text: string | ((context: AssembleContext) => string);
}
/** One section of an assembly: {@link PromptSection} with its text resolved. */
export interface AssembledSection {
    /** The contributing section's unique name. */
    name: string;
    /** The resolved (but not yet interpolated) section text. */
    text: string;
}
/** One resolved dynamic context contribution. */
export interface AssembledContext {
    /** The contributing context's unique name. */
    name: string;
    /** The resolved text before variable interpolation. */
    text: string;
}
/** Tool schemas visible in one assembly and their pre-restriction name set. */
export interface ToolProviderResult {
    /** The schemas this provider contributes to THIS assembly. */
    readonly schemas: readonly ToolSchema[];
    /** The pre-restriction name universe for config validation (defaults to `schemas`' names). */
    readonly knownNames?: readonly string[];
}
/**
 * Merge-extensible assembled model input. Sections and contexts remain
 * uninterpolated until rendered; tools are already in canonical order.
 */
export interface PromptAssembly {
    sections: AssembledSection[];
    contexts: AssembledContext[];
    tools: ToolSchema[];
    variables: Record<string, string | undefined>;
}
/**
 * The deployment persona's section name and order. Exported because a
 * composition can replace this slot — an agent preset shadows the
 * deployment's persona with its own — and both sides naming the same section
 * is what makes the replacement work rather than duplicate.
 */
export declare const PERSONA_SECTION = "deployment:persona";
/** Prompt order of the persona slot; the first section a model reads. */
export declare const PERSONA_ORDER = 0;
/** Reserved {@link Config.toolOrder} marker for unlisted tools. */
export declare const TOOL_ORDER_REST = "<unlisted-tools>";
/** Plugin config: the deployment-authored fragment of the system prompt (see {@link Config.persona} for its contract). */
export interface Config {
    /** Include the fixed DeepSeek Harness identity before the deployment persona (default true). */
    includeHarnessIdentity?: boolean;
    /** Include dynamic runtime-context snapshots in model history (default true). */
    includeRuntimeContext?: boolean;
    /**
     * Deployment-wide order-0 persona template. A scoped section named
     * `deployment:persona` shadows it; `{{variable}}` references are strict.
     */
    persona?: string;
    /**
     * Model-facing tool names in order, with {@link TOOL_ORDER_REST} exactly once.
     * Invalid fields fail at load and unknown names fail at assembly; known names
     * hidden in one scope may be absent there. Omitted means lexicographic order.
     */
    toolOrder?: string[];
}
/**
 * Interpolate strict `{{variable}}` references, drop empty sections, and join
 * the rest with blank lines. Malformed, unknown, or undefined references throw;
 * a lone `{{` without any later `}}` is literal prose, and substituted values
 * are not scanned again.
 * @param assembly - the assembly whose sections and variables to render.
 * @returns the rendered prompt, or `''` when all sections are empty.
 */
export declare function renderPrompt(assembly: PromptAssembly): string;
/**
 * Render the complete dynamic context snapshot.
 * @param assembly - the assembly whose contexts and variables to render.
 * @returns the current full snapshot, or `''` when no context is active.
 */
export declare function renderContextSnapshot(assembly: PromptAssembly): string;
/**
 * The model-facing snapshot text for an already-rendered section list.
 *
 * A caller that also needs the sections renders them once and joins here, so a
 * request does not interpolate every context twice.
 * @param sections - sections from {@link renderContextSections}.
 * @returns the current full snapshot, or `''` when no context is active.
 */
export declare function joinContextSections(sections: readonly ContextSnapshotSection[]): string;
/**
 * The same snapshot, kept as the named contributions it was assembled from.
 *
 * {@link renderContextSnapshot} joins these for the model; a consumer that
 * presents the snapshot uses them to attribute each part to the subsystem that
 * contributed it, without re-splitting the joined prose.
 * @param assembly - the assembly whose contexts and variables to render.
 * @returns one entry per contributing context that rendered to non-empty text.
 */
export declare function renderContextSections(assembly: PromptAssembly): ContextSnapshotSection[];
/** Registry service for the prompt inputs assembled before each model step. */
export declare class SystemPrompt extends Service {
    static Config: z<Config>;
    private readonly layers;
    private readonly toolOrder;
    constructor(ctx: Context, config: Config);
    /**
     * Register an ordered prompt section in the calling context's scope. A scoped
     * section shadows a global section with the same name; duplicates within one
     * layer and non-finite orders throw. Registration and disposal emit
     * `system-prompt/change`.
     * @param section - the section to register.
     * @returns the exact Cordis effect disposer.
     */
    section(section: PromptSection): () => void;
    /**
     * Register ordered dynamic context in the calling context's scope. Scoped
     * entries shadow global entries with the same name.
     * @param context - the context contribution to register.
     * @returns the exact Cordis effect disposer.
     */
    context(context: PromptContext): () => void;
    /**
     * Suppress every dynamic runtime-context contribution in the calling
     * context's scope without changing the services that own or enforce those
     * facts. Multiple suppressors remain independently disposable.
     * @returns the exact Cordis effect disposer.
     */
    suppressRuntimeContext(): () => void;
    /**
     * Register a tool-schema provider in the calling context's scope. Global and
     * matching scoped providers both contribute; returning the reserved
     * {@link TOOL_ORDER_REST} name makes assembly fail.
     * @param provider - evaluated for each assembly with its context.
     * @returns the exact Cordis effect disposer.
     */
    tools(provider: (context: AssembleContext) => ToolProviderResult): () => void;
    /**
     * Register a prompt variable in the calling context's scope. Scoped values
     * shadow globals; invalid or duplicate names throw. A provider may return
     * `undefined`, but rendering a section that references that value then fails.
     * @param name - the `[a-z][a-z0-9_]*` reference name.
     * @param provider - evaluated for each assembly.
     * @returns the exact Cordis effect disposer.
     */
    variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void;
    /**
     * Assemble global and scoped providers, detach tool parameters, apply
     * canonical ordering, then run the assembly waterfall. Scoped sections and
     * variables shadow globals. The returned waterfall value is authoritative
     * except that an effective complete section is restored afterwards as the
     * sole prompt section.
     * @param context - the optional scope and plugin-defined assembly fields.
     * @returns the post-waterfall assembly with any complete prompt enforced.
     */
    assemble(context?: AssembleContext): Promise<PromptAssembly>;
}
export default SystemPrompt;
//# sourceMappingURL=index.d.ts.map