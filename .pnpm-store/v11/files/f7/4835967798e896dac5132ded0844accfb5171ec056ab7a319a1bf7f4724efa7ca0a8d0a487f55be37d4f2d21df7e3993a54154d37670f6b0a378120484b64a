/**
 * Tool registry, model presentation modes, and pre/guard/around/post/result
 * execution pipeline.
 * @module @deepseek-ai/dsh-tools
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ScopeKey, Scoped } from '@deepseek-ai/dsh-scope';
import type { CallId, ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { JsonValue, UserMessage } from '@deepseek-ai/dsh-session';
import type { ToolCallView, ToolResultView } from './presentation.ts';
import type { JsonSchemaNode } from './json-schema.ts';
export { defineTool, valueSchemaSpecToJsonSchema, parameterSchemaSpecToJsonSchema, validateArgs, ToolArgsError, type ValueSchemaAnnotations, type StringValueSchemaSpec, type NumberValueSchemaSpec, type IntegerValueSchemaSpec, type BooleanValueSchemaSpec, type NullValueSchemaSpec, type ArrayValueSchemaSpec, type ObjectValueSchemaSpec, type JsonValueSchemaSpec, type OneOfValueSchemaSpec, type ValueSchemaSpec, type ParameterPropertySpec, type ParameterSchemaSpec, type ParameterJsonSchema, type InferValue, type InferArgs, type DefineToolOptions, } from './schema.ts';
export { assertSupportedJsonSchema, assertObjectJsonSchema, validateJsonSchemaValue, JsonSchemaError, type JsonSchemaNode, type ObjectJsonSchema, type JsonSchemaType, type JsonSchemaScalar, } from './json-schema.ts';
export type { JsonValue } from '@deepseek-ai/dsh-session';
export type { CodeDispatchEventData, CodeDispatchStartEventData } from './types.ts';
export { CodeRunFailedError, RUN_CODE_NAME } from './code-mode.ts';
export { jsonSchemaToTs, renderToolsSdk } from './ts-types.ts';
export { jsonSchemaToPy, renderToolsSdkPy } from './py-types.ts';
export { defineContentToolFixture, type ContentToolFixtureOptions } from './testing.ts';
export type { ToolCallKind, FileLocation, FileDiff, ReadFileLine, ToolCallView, GenericCallView, TerminalCallView, DiffCallView, ToolResultView, GenericResultView, TerminalResultView, DiffResultView, SearchResultView, SearchMatchesResultView, SearchPathsResultView, SearchFileMatches, SearchLineMatch, ReadResultView, WebResultView, WebSearchResultView, WebFetchResultView, WebSource, } from './presentation.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        tools: ToolRuntime;
    }
    interface Events {
        /**
         * Allow, deny, or ask before dispatch. `next()` delegates to allow; missing
         * approval support turns `ask` into denial. Async gates must observe
         * `exec.signal`; the registry rechecks cancellation after they settle but
         * never abandons their promise.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
         * @param exec - the pending call (name, parsed arguments, caller agent).
         * @mode waterfall
         */
        'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>;
        /**
         * Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns
         * a normalized result; wrappers may change only `exec.signal`, while call
         * identity remains immutable. The registry re-fuses the original caller
         * signal before the body, so replacement cannot detach caller cancellation;
         * wrappers must still restore their signal and reach quiescence.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
         * @param exec - the allowed call about to dispatch (name, parsed arguments, caller agent, signal).
         * @mode waterfall
         */
        'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>;
        /**
         * Accept, replace, enrich, or block a normalized dispatch result. `next()`
         * accepts it unchanged; thrown tools still reach this waterfall as errors. Async
         * listeners must observe `exec.signal`; after they settle, caller
         * cancellation replaces only a successful accepted outcome with the code
         * selected by whether the tool body was invoked.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
         * @param exec - the call that just ran (name, parsed arguments, caller agent).
         * @param result - the dispatch outcome a listener may accept, replace, or block.
         * @mode waterfall
         */
        'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>;
        /**
         * Allow a listener to replace content in the DURABLE LOG COPY of one
         * `run_code` sub-dispatch outcome before the bridge appends its
         * `tool/code-dispatch` event. `next()` keeps the
         * content unchanged; a listener may return replacement blocks (e.g. the
         * spill policy's preview + locator for an oversized text result). Only the
         * logged copy is affected — the program already received the complete
         * value, and the model sees neither. A throwing listener is contained:
         * the bridge falls back to logging the original settled content.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.
         * @param dispatch - the parent execution, sub-call identity, and the settled content to log.
         * @mode waterfall
         */
        'tools/code-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: CodeDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>;
        /**
         * Observe the frozen, lossless-JSON final outcome. Listener failures are contained.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.
         * @param exec - the execution object that traversed the pipeline.
         * @param result - a deep-frozen snapshot of the final returned result.
         * @mode emit
         */
        'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined;
        /**
         * A tool was registered or unregistered, or a scoped restriction changed
         * (the available tool set changed — possibly for one scope only). An
         * UNFILTERED registry-subject notification, deliberately not scope-filtered
         * dispatch: a global change concerns every agent's next assembly, so a
         * scoped listener subscribing here sees every change, not just its own
         * scope's.
         * @mode emit
         */
        'tools/change'(): void;
    }
}
/** Tool-owned canonical output contract used after the body returns a JSON value. */
export interface ToolOutputDefinition {
    /** Raw supported JSON Schema enforced against every successful canonical value. */
    readonly schema: JsonSchemaNode;
    /** Pure projection from validated arguments and value to Native/model content. */
    render(args: unknown, value: JsonValue): ContentBlock[];
    /** Pure replayable presentation projection, computed only for top-level calls. */
    presentationMeta?(args: unknown, value: JsonValue): JsonValue;
}
/** A registered tool: its schema plus the execution function. */
export interface ToolDefinition extends ToolSchema {
    /** Mandatory canonical output declaration. */
    readonly output: ToolOutputDefinition;
    /**
     * Run one accepted call and return only its canonical lossless-JSON value.
     * Async work must observe or forward `exec.signal` and settle only after its
     * owned work reaches quiescence. The registry preserves caller cancellation
     * through around-dispatch signal replacement and does not abandon this
     * promise, but it cannot hard-kill same-process code.
     * @param args - losslessly snapshotted, frozen model arguments.
     * @param exec - execution identity, cancellation signal, and context deferral.
     * @returns the canonical value declared by `output.schema`.
     */
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
    /**
     * Synchronous last-mile transform for model-facing content. The registry
     * snapshots this callback when execution starts and invokes it exactly once
     * for every normalized outcome, including pipeline failures that bypass
     * `tools/post-execute`, immediately before lossless materialization.
     * Returning `undefined` preserves the content; every other result field
     * remains registry-owned. The callback must be total and must not throw.
     * @param exec - immutable execution identity and arguments.
     * @param result - complete normalized outcome before materialization.
     * @returns replacement content, or `undefined` to preserve it.
     */
    finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined;
    /**
     * Cooperative tool-call timeout budget in milliseconds. Omit for no deadline.
     * Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper); it
     * is NEVER sent to the model — `schemas()` whitelists only name/description/
     * parameters. Declaring it asserts this tool forwards `exec.signal` to a
     * cooperative implementation that can reach quiescence when the signal aborts.
     */
    timeoutMs?: number;
    /**
     * Pure synchronous classifier for overlap with sibling tool calls. Only
     * `true` opts in; omission, exceptions, non-`true` returns, and invalid
     * `defineTool` arguments are exclusive. This metadata is never model-visible.
     *
     * Opted-in executions must not mutate parent-owned state. Shared state must
     * tolerate concurrent dispatch; recorder races are permitted only when they
     * commute or fail closed. See the
     * [parallel-tool-call Agent Note](../../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)
     * for the full contract.
     * @param args - parsed arguments; `defineTool` validates before calling.
     * @returns Whether this call may join a parallel group.
     */
    isConcurrencySafe?(args: unknown): boolean;
    /**
     * Optional: how to present the PENDING state of one call in a UI, derived from
     * the call's `args` (parsed arguments, `unknown` — the tool validates/narrows
     * its own input). Returns a {@link ToolCallView} (a `card`-tagged render intent),
     * or `undefined` (or omit the method) to fall back to a generic presentation
     * (title = tool name, raw args as input). Pure and side-effect-free: a UI may
     * call it during live streaming AND a session-log replay, so it must depend
     * only on `args`.
     */
    presentCall?(args: unknown): ToolCallView | undefined;
    /**
     * Optional: how to present the COMPLETED state, given the same `args` and the
     * durable result projection (`content`, failure state, and optional `meta`). Returns a
     * {@link ToolResultView}, or `undefined` (or omit the method) to keep the
     * pending title and render the raw result content. Pure and side-effect-free
     * for the same replay reason.
     */
    presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined;
}
/** The completed outcome handed to {@link ToolDefinition.presentResult}. */
export interface ToolResult {
    /** The final model-facing content (or the rendered error text on failure). */
    content: ContentBlock[];
    /** Whether the call failed. */
    isError: boolean;
    /**
     * The tool-private presentation payload projected by its output declaration
     * and threaded verbatim from the `tool/result` event. Absent when the tool
     * declared no projector or the call was nested under a composite transport.
     */
    meta?: JsonValue;
}
declare const toolExecutionTokenBrand: unique symbol;
/** Opaque call identity that permits correlation without exposing mutable execution state. */
export type ToolExecutionToken = symbol & {
    readonly [toolExecutionTokenBrand]: true;
};
/**
 * Caller-supplied description of one tool call. {@link ToolRuntime.execute}
 * adds the registry-owned token to form a pipeline {@link ToolExecution};
 * callers do not choose that token.
 */
export interface ToolExecutionInput {
    readonly callId: CallId;
    /**
     * Root model-requested call owning this execution tree. Callers omit it for
     * a root execution; nested dispatchers propagate the enclosing value.
     */
    readonly rootCallId?: CallId;
    readonly name: string;
    /** Losslessly JSON-serializable parsed arguments (tools validate their own schema). */
    readonly arguments: unknown;
    /** The agent on whose behalf the call runs (set by the agent loop). */
    readonly agent?: Agent;
    /**
     * Opaque token of the enclosing transport execution, when one exists. Code
     * Mode sets this on SDK sub-dispatches so commit-style observers can wait for
     * the outer `run_code` outcome without receiving its live mutable execution.
     * The token also marks the call as a transport sub-dispatch rather than a
     * model-direct call: under `mode: 'code'`, only calls WITH a parent may
     * execute a native tool name — a model-direct call (no parent) is denied as
     * `UNKNOWN_TOOL` before the policy pipeline. See {@link ToolRuntime.execute}.
     */
    readonly parent?: ToolExecutionToken;
    /** Required caller-owned cancellation for this invocation. */
    readonly signal: AbortSignal;
}
/**
 * Scheduling mode for one pending call. `parallel` may overlap with siblings;
 * `exclusive` runs alone and forms an ordering barrier.
 */
export type ToolExecutionMode = {
    kind: 'parallel';
} | {
    kind: 'exclusive';
};
/**
 * One settled `run_code` sub-dispatch about to be logged, as seen by the
 * `tools/code-dispatch-log` waterfall: the parent execution (session owner,
 * outer call identity), the sub-call identity, and the outcome whose durable
 * copy a listener may reshape. `content` is the RENDERED result projection
 * (what a native `tool/result` would carry) — the program itself received
 * the structured `value` (or just the error message on failure); only the
 * `tool/code-dispatch` event's copy changes.
 */
export interface CodeDispatchLog {
    /** The outer `run_code` execution. */
    readonly exec: ToolExecution;
    /** The calling agent (the scope routing key and the spill owner), when the outer call has one. */
    readonly agent?: Agent;
    /** Deterministic sub-call id (`<parent>:code:<n>`). */
    readonly subCallId: CallId;
    /** The dispatched sub-tool name. */
    readonly name: string;
    /** Whether the sub-call settled as an error. */
    readonly isError: boolean;
    /** The sub-call's complete model-facing content (the settle event's default payload). */
    readonly content: ContentBlock[];
}
/**
 * One pending tool call inside the registry pipeline. Parsed arguments cross
 * one lossless-JSON materialization boundary before policy and are deep-frozen;
 * call identity, the caller signal, and the registry-assigned {@link token} are
 * readonly. The registry freezes the complete object before `tools/result`
 * observers run.
 */
export interface ToolExecution extends ToolExecutionInput {
    /** Root model-requested call, resolved for every root and nested execution. */
    readonly rootCallId: CallId;
    /** Registry-assigned identity shared with nested calls only as their opaque `parent` token. */
    readonly token: ToolExecutionToken;
}
/**
 * Around-dispatch view of a {@link ToolExecution}. A `tools/execute` wrapper
 * may replace the signal for its delegated lifetime, but it cannot remove it.
 * The registry fuses every replacement with the captured caller signal.
 */
export interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> {
    /** Cancellation signal visible to the next wrapper or tool body. */
    signal: AbortSignal;
}
/**
 * Runtime context handed to a tool implementation after the registry has
 * accepted a {@link ToolExecution}. {@link deferContext} attaches context to
 * this execution's own result — a composite tool ferries nested-dispatch
 * context back to the outer result, and a leaf tool may mint a fresh
 * plugin-sourced instruction; the loop appends it only after the
 * `tool/result`.
 */
export interface ToolRunContext extends ToolExecution {
    /**
     * Defer one context — typically a nested-dispatch context ferried by a
     * composite tool, or a fresh plugin-sourced instruction — until this tool's
     * final result reaches the agent loop. Contexts retain their individual
     * source and metadata and are emitted in call order.
     */
    deferContext(context: UserMessage): void;
    /**
     * Mark a successful final result as terminal for the current agent turn.
     * The marker rides this execution's own result (`concludesTurn` exists only
     * on {@link ToolExecutionSuccess}); a composite that dispatches nested
     * calls forwards it from the nested result, exactly like
     * `additionalContexts`, so only an authoritative nested success can
     * conclude the enclosing run.
     */
    concludeTurn(): void;
}
/**
 * Scheduler-only result after ordered pre-execute and guards. A `post-result`
 * still receives post-execute; a `final-result` bypasses it.
 * @internal
 */
export type ScheduledToolPreparation = {
    kind: 'dispatch';
    exec: ToolRunContext;
} | {
    kind: 'post-result';
    exec: ToolRunContext;
    result: ToolExecutionResult;
} | {
    kind: 'final-result';
    exec: ToolRunContext;
    result: ToolExecutionResult;
};
/**
 * Scheduler-only dispatch result. A `post-result` still receives post-execute;
 * a `final-result` already matches {@link ToolRuntime.execute} failure semantics.
 * @internal
 */
export type ScheduledToolDispatch = {
    kind: 'post-result';
    result: ToolExecutionResult;
} | {
    kind: 'final-result';
    result: ToolExecutionResult;
};
/**
 * Symbol-keyed scheduler view that keeps pre/post policy ordered while
 * overlapping dispatch. Ordinary callers use {@link ToolRuntime.execute};
 * this is not a plugin extension point.
 * @internal
 */
export interface ToolRuntimeScheduler {
    /** Materialize input, run the ordered pre-execute/guard gate, and decide what stage follows. */
    prepare(exec: ToolExecutionInput): Promise<ScheduledToolPreparation>;
    /** Run only the around-dispatch/body stage. */
    dispatch(exec: ToolRunContext): Promise<ScheduledToolDispatch>;
    /** Run post-execute and definition-owned content finalization, then materialize and notify. */
    finalize(exec: ToolRunContext, result: ToolExecutionResult): Promise<ToolExecutionResult>;
    /** Run definition-owned content finalization, then materialize and notify without post-execute. */
    finish(exec: ToolRunContext, result: ToolExecutionResult): ToolExecutionResult;
}
/**
 * Scheduler entry point omitted from the generated named service API.
 * @internal
 */
export declare const TOOL_RUNTIME_SCHEDULER: unique symbol;
/** Canonical error code for cancellation after a tool body was invoked. */
export declare const TOOL_ABORTED = "ABORTED";
/** Canonical error code for cancellation before a tool body was invoked. */
export declare const TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";
/** Structured error metadata for a failed tool call (alongside the model-facing text). */
export interface ToolErrorInfo {
    name: string;
    code: string;
}
/** Canonical failure detail; internal routing information remains optional. */
export interface ToolFailure {
    /** Human-readable failure message without the Native `Error: ` envelope. */
    message: string;
    /** Internal error class/code used by policy and durable diagnostics. */
    info?: ToolErrorInfo;
}
/**
 * Thrown (internally) when the model requests a tool that isn't registered.
 * Extends {@link HarnessError} (`code: 'UNKNOWN_TOOL'`) so an unknown-tool
 * failure is as routable as a tool-thrown one — retry/sandbox/replay code can
 * distinguish it from a tool body's own error.
 */
export declare class ToolNotFoundError extends HarnessError {
    /**
     * @param toolName - the name the caller asked for.
     * @param reachableFrom - how the model reaches this tool instead, when the
     *   name IS visible and only the presentation denies calling it directly.
     *   Omitted for a name that is registered nowhere.
     */
    constructor(toolName: string, reachableFrom?: string);
}
/** Thrown when a tool body or post-policy value violates its declared output. */
export declare class ToolOutputError extends HarnessError {
    /** Schema/value violations in validation order. */
    readonly violations: string[];
    constructor(toolName: string, violations: string[]);
}
/** Successful canonical tool execution, including its Native/model projection. */
export interface ToolExecutionSuccess {
    readonly isError: false;
    /** Execution-local canonical value; deliberately omitted from durable events. */
    readonly value: JsonValue;
    readonly content: ContentBlock[];
    readonly error?: never;
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    /** The agent loop stops after committing this successful result batch. */
    readonly concludesTurn?: true;
}
/** Failed canonical tool execution; failures never carry a successful value. */
export interface ToolExecutionFailure {
    readonly isError: true;
    readonly error: ToolFailure;
    readonly value?: never;
    readonly content: ContentBlock[];
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: never;
}
/** The discriminated, execution-local outcome of one tool call. */
export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;
/**
 * Pre-dispatch decision. `allow` runs the call; `deny` materializes an error;
 * `ask` runs only after an approval service returns `allowed-once` and otherwise
 * denies. Input rewriting is excluded because arguments are already logged and
 * presented.
 */
export type PreToolDecision = {
    kind: 'allow';
} | {
    kind: 'deny';
    reason: string;
} | {
    kind: 'ask';
    reason?: string;
};
/**
 * Post-dispatch decision: accept, replace one projection, attach context for the
 * next request, or block by turning corrective feedback into an error result.
 */
export type PostToolDecision = {
    kind: 'accept';
    content?: ContentBlock[];
    value?: never;
    additionalContexts?: UserMessage[];
} | {
    kind: 'accept';
    value: JsonValue;
    content?: never;
    additionalContexts?: UserMessage[];
} | {
    kind: 'block';
    feedback: ContentBlock[];
    additionalContexts?: UserMessage[];
};
/** How the registry presents its tools to the model (see {@link Config.mode}). */
export type ToolPresentationMode = 'native' | 'code' | 'both';
/** Plugin config: how the registered tools are presented to the model. */
export interface Config {
    /**
     * Model presentation. `native` (default) sends every visible schema; `code`
     * sends only `run_code` plus a generated SDK prompt and collapses the
     * executor to the same surface (a model-direct call may only name
     * `run_code`; `run_code` SDK sub-dispatches keep every visible tool); `both`
     * sends both forms. Code modes require a `ctx.codeRuntime` whose `language`
     * has a registered SDK renderer (TypeScript or Python) and fail prompt
     * assembly when it is absent or has no renderer. Under `code`, native names
     * in `toolOrder` are invalid.
     */
    mode?: ToolPresentationMode;
    /**
     * Concurrency cap for a `run_code` program's overlapping sub-calls
     * (default 10, the loop scheduler's own default). Sub-calls follow the
     * native scheduling contract — only calls whose tools classify
     * concurrency-safe overlap; exclusive calls form barriers — so `1`
     * restores strictly serial dispatch. Must be a positive integer.
     */
    maxParallelSubCalls?: number;
}
/**
 * Per-scope filter over global tools. Restrictions intersect and do not affect
 * scoped registrations or the reserved Code Mode transport.
 */
export interface ToolRestriction {
    /** Global tool names that stay visible; everything else is removed. */
    readonly allow?: readonly string[];
    /** Global tool names removed from visibility. */
    readonly deny?: readonly string[];
}
/**
 * A monotonic execution guard evaluated after every `tools/pre-execute`
 * listener and before the tool body. Returning a reason denies the call;
 * returning `undefined` leaves it unchanged. Because guards have no allow
 * result, listener ordering cannot turn a denial back into permission.
 * @param execution - the identity-protected call after extensible pre-execute policy completed.
 * @returns a final denial reason, or `undefined` to leave the call allowed.
 */
export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined;
/**
 * Tool registry and execution pipeline. Scoped registrations shadow globals;
 * one visibility resolver feeds presentation, lookup, and dispatch.
 */
export declare class ToolRuntime extends Service {
    static inject: string[];
    static Config: z<Config>;
    /** Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler. */
    readonly [TOOL_RUNTIME_SCHEDULER]: ToolRuntimeScheduler;
    /** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
    private deferredContexts;
    /** Executions whose tool body declared the current turn complete. */
    private concludingExecutions;
    /** Original caller cancellation, kept outside the wrapper-mutable execution object. */
    private cancellationStates;
    /** Definition-owned final content transform snapshotted before policy begins. */
    private contentFinalizers;
    private readonly layers;
    /** Presentation for scopes that declare none; {@link presentAs} shadows it per scope. */
    private readonly defaultMode;
    private readonly maxParallelSubCalls;
    /**
     * Reserved presentation transport, kept outside the filterable registration
     * layers. Built on first need rather than at construction: which agents run
     * a code mode is no longer known when the service is constructed, and the
     * transport is stateless beyond its closures over `this`.
     */
    private codeTransport;
    constructor(ctx: Context, config?: Config);
    /**
     * The prompt statement of the `code` executor collapse, registered wherever
     * {@link sdkSection} is and rendering empty outside an effective `code`.
     *
     * Every tool contributes its own guidance section naming its tool, none of
     * them qualify how that tool is reached, and they all render before the SDK
     * (orders 100-199 against {@link SDK_SECTION_ORDER}). Without this the model
     * reads a catalog of tools it is told to use and no statement that only
     * `run_code` may be called, so it emits a native call, receives
     * `UNKNOWN_TOOL` for a tool the prompt just declared, and concludes the
     * deployment is inconsistent. {@link COLLAPSE_SECTION_ORDER} places the rule
     * before that guidance rather than after it.
     *
     * `both` renders empty: native calls do execute there, so the rule is false.
     * @returns the section registration.
     */
    private collapseSection;
    /**
     * The generated-SDK prompt section, registered globally by a code-mode
     * deployment and per scope by {@link presentAs}.
     *
     * The body regenerates from the CALLING scope, and renders empty for an
     * agent presenting natively — an agent that opted out under a code-mode
     * deployment still sees the global registration, and an empty section is
     * dropped from the rendered prompt.
     * @returns the section registration.
     */
    private sdkSection;
    /**
     * The presentation one scope's agent sees: its own declaration, else the
     * deployment default.
     * @param scope - the calling agent, or undefined for the global view.
     * @returns the resolved presentation mode.
     */
    private modeFor;
    /**
     * The reserved `run_code` transport, built on first need.
     *
     * It never enters the global layer: per-agent restrictions must not remove
     * it, and a scoped registration must not shadow it. The visibility resolver
     * appends it after resolving the filterable global/scoped capability layers,
     * and only for scopes whose mode actually presents it.
     * @returns the shared transport definition.
     */
    private requireCodeTransport;
    /**
     * Present the calling scope's tools in `mode` instead of the deployment
     * default. Nearest scope on the chain wins, so a preset's standing
     * declaration covers every agent joined under it.
     *
     * Scoped only, and one declaration per scope: this is how an agent preset
     * composes Code Mode agents beside native ones in the same process, and a
     * process-global override would be the `mode` config field instead.
     * @param mode - the presentation the covered agents' models see.
     * @returns the exact disposer that restores the deployment default.
     */
    presentAs(mode: ToolPresentationMode): () => void;
    /**
     * Build one scope's wire schemas and names for prompt-order validation.
     * Restrictions do not make known tools invalid, but a mode collapse does.
     */
    private wireSchemas;
    /**
     * Resolve the code runtime or throw the actionable misconfiguration error.
     * Read at use time (assembly / run_code execution), NOT via static
     * `inject`: an inject entry would hold `ctx.tools` — and every tool plugin
     * behind it — hostage to a code runtime existing even under `mode:
     * 'native'` (the loop's optional-backend idiom, same as
     * `sessionPersistence`).
     *
     * Assembly and `run_code` execution read separately, so the language is not
     * bound to a request. Harmless while one published backend exists — both
     * reads return the same flavor — but a reload that swapped in a second
     * language between them would hand a program written against one SDK to the
     * other. Binding it is deferred until a second backend ships (the first
     * point it is testable); rationale in the
     * [language-dispatch note](../../../../.agents/notes/implemented/feature/2026-07-31-code-mode-language-dispatch.md).
     */
    private requireCodeRuntime;
    /**
     * Register globally or in the calling agent scope. Scoped tools shadow
     * globals; duplicates within one layer and the reserved `run_code` name fail.
     * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
     * @returns the exact disposer that unregisters the tool.
     */
    register(definition: ToolDefinition): () => void;
    /**
     * Restrict global tools for the calling agent scope. Empty filters, unknown
     * names, scope-local names, and reserved transport names fail. Restrictions
     * intersect; scoped registrations remain visible.
     * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
     * @returns the exact disposer that lifts this restriction.
     */
    restrict(filter: ToolRestriction): () => void;
    /**
     * Register a monotonic guard after the extensible `tools/pre-execute`
     * waterfall. A plain-context guard applies globally; one registered through
     * `agent.ctx` applies only to that agent. Any matching guard may deny by
     * returning a reason, while no guard can force-allow a call another guard
     * denied. The exact effect disposer is returned for ordered ownership and
     * HMR cleanup.
     * @param guard - synchronous check; a returned string denies the execution.
     * @returns the exact disposer that unregisters the guard.
     */
    guard(guard: ToolGuard): () => void;
    /** First monotonic denial from the global then the scope chain's guard layers, farthest first. */
    private guardReason;
    /**
     * Resolve every registry fact one scope needs in one layer traversal. The
     * visible map applies restrictions to the INHERITED surface, then the
     * scope's own registrations and the reserved presentation transport; the
     * other sets retain the pre-restriction facts needed by restriction and
     * prompt-order validation.
     *
     * A restriction filters what a scope inherits — the global layer and every
     * ancestor layer on its chain — and never what its OWN layer registers.
     * That exemption is what a per-child capability filter has to keep intact:
     * the delegation runtime registers a child's reporting and structured-output
     * tools into the child's own layer, and a filter naming the capabilities the
     * child may use must not strip the machinery it answers through.
     *
     * Reading the exempt set as "the global layer" instead of "not mine" held
     * only while every model-facing tool sat in the host composition. Once
     * presets moved them onto the agent plane they became an ANCESTOR
     * contribution, so a child's filter silently stopped constraining anything
     * it was given.
     * @param scope - the viewing scope (the agent), or undefined for the global view.
     * @returns the complete derived view for that scope.
     */
    private view;
    /**
     * Look up a tool as one scope sees it (scoped
     * shadows global; a restricted-away global reads as absent). Presenters pass
     * the calling agent so the rendered card matches the definition that
     * actually executed.
     * @param name - the tool name as registered.
     * @param scope - the viewing scope (the agent); omitted = the global view.
     * @returns the definition the scope resolves, or undefined when none is visible.
     */
    get(name: string, scope?: ScopeKey): ToolDefinition | undefined;
    /**
     * Resolve the definition that MAY EXECUTE for a call, applying the mode
     * collapse at the operation boundary that owns it. The registry view
     * (`get`) is presentation-agnostic; here a MODEL-DIRECT call under `code`
     * may only name the reserved `run_code` transport, while a nested
     * sub-dispatch (a `parent` token set — the `run_code` SDK calling a tool
     * it bound) may call any visible tool. Denial surfaces as `UNKNOWN_TOOL`
     * through the executor, matching an absent definition.
     * @param name - the tool name as registered.
     * @param scope - the viewing scope (the agent); omitted = the global view.
     * @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
     * @returns the definition that may run, or undefined when the call must be rejected.
     */
    private resolveExecution;
    /**
     * Project visible definitions onto the allowlisted model-facing schema fields,
     * excluding execution and presentation callbacks.
     * @param scope - the viewing scope (the agent); omitted = the global view.
     * @returns one deep-cloned schema per visible tool.
     */
    schemas(scope?: ScopeKey): ToolSchema[];
    /** Project visible callable tools onto the generated Code Mode SDK contract. */
    private sdkSchemas;
    /** Project one definition onto the model-facing schema fields. */
    private schemaOf;
    /**
     * Classify a pending call through the caller's visible tool definition. Only
     * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
     * throwing classifiers are exclusive.
     * @param exec - call name, parsed arguments, and optional agent scope.
     * @returns the fail-closed scheduling mode.
     */
    executionMode(exec: ToolExecutionInput): ToolExecutionMode;
    /**
     * Run the `tools/code-dispatch-log` waterfall over one settled sub-dispatch
     * and return the content the bridge should log on `tool/code-dispatch`.
     * Contained: when a listener throws, the method logs the original settled
     * content; that failure must not fail the dispatch or omit the settle event. Private:
     * the ONE consumer is the `run_code` bridge this registry constructs, which
     * receives it as a capability parameter (the `requireRuntime` idiom) — the
     * waterfall, not this invoker, is the public extension point.
     */
    private shapeDispatchLog;
    /**
     * Whether the `code` mode collapse denies a model-direct call: only the
     * reserved `run_code` transport may be named. Nested sub-dispatches (a
     * `parent` token set) bypass the collapse. One home for the
     * security-relevant predicate, shared by {@link resolveExecution} and
     * {@link createExecution} so the two can never drift apart.
     *
     * Resolved through {@link modeFor}, NOT `defaultMode`: an agent given `code`
     * by an agent preset under a native deployment is the composition
     * `dsh-agent-tool-presentation` exists for, and reading the deployment default would
     * leave exactly that agent uncollapsed — announcing one surface while
     * executing another, which is the bypass this collapse closes.
     * @param name - the tool name as registered.
     * @param scope - the viewing scope whose effective presentation mode applies.
     * @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
     */
    private collapses;
    /**
     * Execute through pre-policy, guards, around-dispatch, post-policy,
     * definition-owned content finalization, and final notification. Tool and
     * listener failures resolve as materialized error results; an invisible tool
     * reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
     * snapshot final observers receive. Cancellation
     * arriving after entry and before final result materialization skips a
     * not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
     * successful started outcome with `ABORTED`; already-started work is still
     * drained and may retain a tool-owned structured error.
     * @param exec - the typed same-process call input. The registry assigns its
     *   correlation token before policy begins.
     * @returns the materialized final result.
     */
    execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>;
    private completeScheduledExecution;
    private createExecution;
    /**
     * Run the ordered pre-execute and monotonic guard stages for the scheduler.
     * @param input - the caller-supplied execution input.
     * @returns the prepared execution plus the next scheduler stage.
     * @internal
     */
    private prepareScheduledExecution;
    private prepareExecution;
    /** Whether the original caller signal is currently aborted. */
    private callerCancelled;
    /** Canonical cancellation outcome selected by whether the tool body started. */
    private cancellationResult;
    /**
     * Dispatch the registered body with the original caller signal fused back
     * into any around-wrapper replacement. Cancellation never abandons the body:
     * a started promise reaches quiescence before its outcome becomes `ABORTED`.
     */
    private dispatchToolBody;
    /**
     * Run around-dispatch and the tool body. Tool and unknown-tool failures still
     * receive post-execute; pipeline failures are already final.
     * @param exec - the prepared execution.
     * @returns whether the result still needs post-execute.
     * @internal
     */
    private dispatchScheduledExecution;
    /**
     * Run ordered post-execute, then apply definition-owned content finalization,
     * materialize, and notify the final outcome.
     * @param exec - the prepared execution.
     * @param result - dispatch/pre result that still needs post-execute.
     * @returns the materialized final result.
     * @internal
     */
    private finalizeScheduledExecution;
    /**
     * Materialize the candidate, apply definition-owned content finalization,
     * then materialize and notify the authoritative result.
     * @param exec - the prepared execution.
     * @param result - final result.
     * @returns the materialized final result.
     * @internal
     */
    private finishScheduledExecution;
    /** Apply the snapshotted tool-owned content transform without exposing other result fields. */
    private applyFinalContent;
    /** Notify observers without exposing a mutation or error channel into the outcome. */
    private notifyResult;
    /**
     * Resolve an `ask` decision to allow/deny through the approval seam. The
     * seam is consumed opportunistically with `ctx.get('approval')` — a
     * deployment that composes no ApprovalService keeps the historical degrade
     * to deny, and an unmount mid-session degrades the same way on the next ask.
     * An agent-less execution also degrades: without an agent there is no
     * session to audit to and no UI to route to. Otherwise the outcome maps
     * one-to-one — `allowed-once` proceeds; the three non-grants deny with
     * distinct reasons so the model can tell a human "no" from an absent
     * approval channel.
     */
    private serviceAsk;
    /**
     * Run the `tools/post-execute` waterfall over a dispatched `result` and apply
     * its {@link PostToolDecision}: `accept` keeps the call successful (replacing
     * `content` when given), `block` turns it into an `isError` whose content is
     * the corrective `feedback`. Either decision may attach `additionalContexts`,
     * which are ferried on the returned result for the loop's active-batch FIFO.
     * Context deferred by the tool body survives an accepted result but is
     * discarded when the outer call is blocked; a block exposes only context the
     * blocking decision explicitly supplied.
     * Runs inside `execute`'s outer try/catch (a throwing listener → isError).
     */
    private postExecute;
    /** Registry-normalized results and the exact dispatch that validated each value. */
    private readonly canonicalResults;
    /** Mark one registry-normalized result as canonical only for its owning dispatch. */
    private markCanonical;
    /** Snapshot, validate, render, and optionally project one successful body value. */
    private createSuccessResult;
    /** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
    private normalizeDispatchResult;
    /** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
    private materializeFinalResult;
}
export default ToolRuntime;
//# sourceMappingURL=index.d.ts.map