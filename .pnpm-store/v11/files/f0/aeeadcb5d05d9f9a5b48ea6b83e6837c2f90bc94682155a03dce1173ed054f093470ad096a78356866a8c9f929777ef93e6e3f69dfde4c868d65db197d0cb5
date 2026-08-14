/**
 * Host-side ApiProxy implementation. Signature discipline: unary takes the
 * narrow RpcRequest<P> and echoes request.rpcId on the RpcResponse<T>.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { JsonValue } from '@deepseek-ai/dsh-session';
import type { ApiProxy } from './api/index.ts';
import { type SessionLogCompressionLevel } from './session-export.ts';
/** Default maximum artifact size eligible for one cold blankness read. */
export declare const DEFAULT_COLD_BLANK_PROBE_MAX_BYTES = 1024;
/**
 * Narrow one allowlisted host event's argument list to the JSON values the
 * wrapper frame carries. A rejected argument is an allowlist mistake (the
 * forwarded path applies no projection), not hostile input, so it throws rather
 * than degrading to a lossy frame. The throw surfaces where the forwarding
 * listener runs, so the emitter's own listener containment logs it and drops
 * that frame — loud in the Host log, not at load or at the emit. Exported for
 * the test that owns this decision: every currently allowlisted event has a
 * statically JSON-safe payload, so a type-legal `ctx.emit` cannot reach the
 * rejection branch.
 * @param event - forwarded host event name, named in the failure.
 * @param args - the emitter's argument list.
 * @returns the same arguments typed as JSON values.
 */
export declare function assertJsonArgs(event: string, args: readonly unknown[]): JsonValue[];
/** Resolved Agent model and project-directory defaults consumed by the API implementation. */
export interface ApiProxyDefaults {
    /**
     * The model selection a session starts from when its own log names none. Read on
     * every access rather than captured, so a default saved during this process
     * reaches the sessions that have not run a turn yet.
     */
    defaultModelSelection: () => ModelSelection;
    /**
     * Record a selection as the new default. Either absent, or a closure that
     * may itself decline — the gateway plugin always passes one, and it no-ops
     * when the deployment mounts no settings provider or when the write races
     * service teardown. A switch then stays process-local. A rejection is
     * reported and swallowed: the switch already applies to its own session,
     * and undoing it because storage failed would be the worse outcome.
     */
    saveDefaultModelSelection?: (selection: ModelSelection) => Promise<void>;
    /** Default project directory for new sessions whose create request carries no cwd. */
    cwd: string;
    /** Native open-with-default-application; injectable for carrier tests. */
    openPath?: (path: string, signal: AbortSignal) => Promise<void>;
    /** Native text-editor handoff; injectable for settings-document tests. */
    openTextFile?: (path: string, signal: AbortSignal) => Promise<void>;
    /** Validated DEFLATE level for session-log ZIP entries; defaults to 6. */
    sessionExportCompressionLevel?: SessionLogCompressionLevel;
    /** Maximum artifact size eligible for one cold blankness read. */
    coldBlankProbeMaxBytes?: number;
    /**
     * Whether handing a path to the native opener can work at all — the
     * `hasDocument` capability the preset roster reports, and the switch
     * between opening a preset directory and answering its path as text.
     * Absent, an injected `openPath` counts as openable and everything else
     * falls back to platform detection ({@link canOpenNativePath}).
     */
    canOpenPath?: () => boolean;
}
/**
 * Implement ApiProxy over a composed host context.
 * @param ctx - a context with the Host spine and Workspace registry mounted.
 * @param defaults - host routing and project-directory defaults.
 * @returns the ApiProxy implementation.
 */
export declare function createApiProxy(ctx: Context, defaults: ApiProxyDefaults): ApiProxy;
//# sourceMappingURL=api-proxy.d.ts.map