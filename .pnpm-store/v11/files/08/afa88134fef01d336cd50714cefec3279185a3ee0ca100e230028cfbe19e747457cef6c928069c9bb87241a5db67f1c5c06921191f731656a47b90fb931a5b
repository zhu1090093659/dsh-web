/**
 * Code Mode `run_code` transport. Programs call the registry's agent-visible
 * tools through nested executions scheduled under the native concurrency
 * contract; each sub-dispatch is logged for reconstruction, while only the
 * outer curated result enters model history.
 * @module @deepseek-ai/dsh-tools/src/code-mode
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { CodeRuntime } from '@deepseek-ai/dsh-code-runtime';
import type { CodeDispatchLog, ToolDefinition, ToolRuntime } from './index.ts';
/** The model-facing name of the Code Mode tool. */
export declare const RUN_CODE_NAME = "run_code";
/** The `tools:sdk` section order: inside the 100–199 tool-guidance band, after per-tool guidance sections. */
export declare const SDK_SECTION_ORDER = 150;
/**
 * The languages Code Mode ships a presentation for. Both per-language tables —
 * {@link RUN_CODE_FLAVORS} here and `SDK_RENDERERS` in {@link ./index.ts} — are
 * checked against this union with `satisfies`, so a language added to one and
 * not the other fails `typecheck` instead of waiting for a runtime that reports
 * it. The tables stay declared `Record<string, …>` because `CodeRuntime.language`
 * is an unconstrained `string`: this union pins what the harness ships, while the
 * `Object.hasOwn` guards reject what a mounted runtime may report.
 */
export type CodeSdkLanguage = 'typescript' | 'python';
/**
 * Thrown by `run_code` when the program run itself failed — a program
 * exception, a budget expiry, an abort, or substrate death. Extends
 * {@link HarnessError} (`code: 'CODE_RUN_FAILED'`); the registry's execution
 * pipeline converts it into a structured `isError` result whose text carries
 * the failure kind plus the captured logs, so the model can self-correct.
 */
export declare class CodeRunFailedError extends HarnessError {
    constructor(message: string);
}
/**
 * Registry-private capabilities the bridge receives at construction — the
 * `requireRuntime` idiom: operations only the owning registry can mint stay
 * off its public service API and flow here as closures instead.
 */
export interface RunCodeBridgeOptions {
    /** Resolves `ctx.codeRuntime` or throws the loud misconfiguration error (shared with the registry's assembly-time checks). */
    requireRuntime: () => CodeRuntime;
    /**
     * Reads `ctx.codeRuntime` without throwing: `undefined` when none is mounted.
     * Lets schema emission tell "no runtime" (degrade to TS; the readers that
     * reach it are {@link resolveFlavor}'s) apart from "unknown language" (fail
     * loud).
     */
    peekRuntime: () => CodeRuntime | undefined;
    /** The run's overlap cap for parallel-classified sub-calls (the registry passes its validated `maxParallelSubCalls`). */
    maxParallel: number;
    /** Runs the contained `tools/code-dispatch-log` waterfall over one settled sub-dispatch (the registry's private invoker). */
    shapeDispatchLog: (dispatch: CodeDispatchLog) => Promise<ContentBlock[]>;
}
/**
 * Build the `run_code` {@link ToolDefinition}: required `code` and
 * `description` parameters, executed through the dispatch bridge described
 * above. The
 * registry reserves it as presentation infrastructure under non-native modes,
 * outside the filterable global/scoped capability layers.
 * @param registry - the owning registry (sub-calls go through its `execute`,
 *   bindings cover its registered tools).
 * @param options - the registry-private capabilities described above.
 * @returns the registry-ready definition.
 */
export declare function createRunCodeTool(registry: ToolRuntime, options: RunCodeBridgeOptions): ToolDefinition;
//# sourceMappingURL=code-mode.d.ts.map