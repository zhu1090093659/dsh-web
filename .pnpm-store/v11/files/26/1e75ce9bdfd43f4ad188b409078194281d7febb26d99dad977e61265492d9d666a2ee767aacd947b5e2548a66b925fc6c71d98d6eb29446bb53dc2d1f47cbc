/**
 * Provider-side vocabulary for OUT-OF-PROCESS subagent backends — the pieces
 * that enforce this seam's own contracts around a child in another process:
 * the no-capabilities advertisement, timing-bound validation, child
 * working-directory resolution (config override, else the delegating parent
 * session's workspace), the never-reject result settlement, and the standard
 * run-handle publication. Backends compose these with their own wire drivers;
 * the process machinery itself (spawn, env scrub, tree-scoped teardown)
 * belongs to the `dsh-subprocess` seam.
 *
 * @module @deepseek-ai/dsh-subagent/out-of-process
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SubagentCapabilities, SubagentResult, SubagentRun, SubagentStopReason } from './types.ts';
/**
 * The capability advertisement of an out-of-process backend: NONE. A child in
 * another process cannot honor parent-enforced start features
 * (`outputSchema`/`maxDepth`/`toolFilter`/`persona`), so the service rejects a
 * request needing any of them before `start` runs — never accepted-then-ignored.
 */
export declare const NO_START_CAPABILITIES: SubagentCapabilities;
/**
 * Assert a configured timing bound is a positive finite number (it bounds a
 * teardown or shutdown wait; zero, negative, or NaN would skip or wedge it).
 * @param prefix - the consuming plugin's diagnostic prefix (e.g. `subagent-acp`).
 * @param name - the config field name, for the diagnostic.
 * @param value - the configured value.
 */
export declare function assertPositiveFinite(prefix: string, name: string, value: number): void;
/**
 * Assert `cwd` can actually host the child: absolute (it doubles as the
 * child's workspace identity, and a relative path would be re-anchored to the
 * server process's launch directory) and an existing directory (fail here,
 * before the process boundary, instead of as an ambiguous spawn ENOENT).
 * @param prefix - the consuming plugin's diagnostic prefix.
 * @param label - which source supplied the value, for the diagnostic.
 * @param cwd - the candidate working directory.
 * @returns `cwd`, validated.
 */
export declare function assertUsableCwd(prefix: string, label: string, cwd: string): string;
/**
 * Validate a configured `cwd` override ONCE, at plugin load: reject the empty
 * string (`path.resolve('')` is the process cwd — it would silently
 * reintroduce the launch-directory fallback this resolution removes),
 * interpret a relative path against the harness launch directory, and require
 * an enterable directory.
 * @param prefix - the consuming plugin's diagnostic prefix.
 * @param cwd - the configured override, or `undefined` when the config omits it.
 * @returns the validated absolute override, or `undefined` when omitted.
 */
export declare function validateConfiguredCwd(prefix: string, cwd: string | undefined): string | undefined;
/**
 * Resolve the child's working directory at start: the deployment override
 * when configured (already validated at load), else the parent session's
 * workspace cwd (validated here, its earliest resolvable point). Fails loud
 * when neither exists — falling back to the harness process cwd would
 * silently bind the child to the server's launch directory instead of the
 * delegating session's workspace (one server process serves many sessions,
 * each with its own cwd).
 * @param prefix - the consuming plugin's diagnostic prefix.
 * @param configured - the load-validated override, or `undefined`.
 * @param parentCwd - the delegating parent session's workspace cwd, if any.
 * @returns the absolute child working directory.
 */
export declare function resolveChildCwd(prefix: string, configured: string | undefined, parentCwd: string | undefined): string;
/** Inputs to {@link settleRunResult}. */
export interface RunResultSettlement {
    /** The turn attempt (typically racing local cancellation); returns the terminal result. */
    attempt: () => Promise<SubagentResult>;
    /** Snapshot the provider exposes when cancellation or failure wins settlement. */
    collectOutput: () => ContentBlock[];
    /** Whether local cancellation settled before the attempt's outcome is observed. */
    cancelled: () => boolean;
    /** Diagnostic sink for a failure flattened to a stop reason; a throw from it is contained. */
    onError?: ((error: Error, stopReason: SubagentStopReason) => void) | undefined;
    /** The request's cancellation signal (the listener is removed at settlement). */
    signal: AbortSignal;
    /** The abort listener registered on {@link signal} at start. */
    onAbort: () => void;
}
/**
 * Settle an out-of-process run result under the seam contract: `result` never
 * rejects after publication. A normally completed or rejected attempt resolves
 * as `aborted` when cancellation already settled locally; another rejection is
 * flattened to `stopReason: 'error'` through the contained diagnostic sink.
 * The abort listener is removed on every path.
 * @param parts - the attempt, output snapshot, cancellation state, sink, and signal wiring.
 * @returns the terminal result (never a rejection).
 */
export declare function settleRunResult(parts: RunResultSettlement): Promise<SubagentResult>;
/** Inputs to {@link subprocessRunHandle}. */
export interface SubprocessRunHandleParts {
    /** The parent-scoped run id. */
    id: SubagentRun['id'];
    /** The flattened, never-rejecting result (the seam contract). */
    result: Promise<SubagentResult>;
    /** The request's cancellation signal (the listener is removed on dispose). */
    signal: AbortSignal;
    /** The abort listener registered on {@link signal} at start. */
    onAbort: () => void;
    /** Settle local cancellation so {@link result} resolves without the child. */
    requestCancel: () => void;
    /** Tear the child process down to quiescence (backend-owned ladder). */
    teardown: () => Promise<void>;
}
/**
 * Publish the seam run handle for an out-of-process child. `dispose()` is
 * idempotent (one memoized teardown): it removes the abort listener, settles
 * local cancellation — there is no assumption the child cooperates — and then
 * awaits the backend's teardown to actual exit.
 * @param parts - the run identity, result, cancellation wiring, and teardown.
 * @returns the seam run handle (`localAgent` is `undefined` for remote runs).
 */
export declare function subprocessRunHandle(parts: SubprocessRunHandleParts): SubagentRun;
//# sourceMappingURL=out-of-process.d.ts.map