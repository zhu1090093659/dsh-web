/**
 * The durable subagent-child descriptor: the versioned, model-hidden
 * `subagent/descriptor` session event that identifies every session-backed
 * subagent and records whether it is one-shot or continuable. Continuable
 * descriptors additionally preserve the declared composition required for
 * cold resume. Providers append it turn-enclosed in the child's initial turn.
 *
 * The descriptor deliberately snapshots explicit fields rather than the
 * merge-extensible `AgentOptions` object: an unrelated extension value cannot
 * make continuation fail merely because it is not JSON, and later composition
 * inputs require a deliberate {@link SUBAGENT_DESCRIPTOR_VERSION} change. It
 * omits `subagentDepth` — cold resume trusts the persisted header's
 * `delegationDepth` as the monotone floor — and `outputSchema`, which belongs
 * to one activation's result contract rather than durable child composition.
 * Per-activation knobs such as `maxTokens` are omitted for the same reason as
 * `outputSchema`: they budget one activation. Cold resume requires the exact
 * live parent for authorization but reconstructs child options only from the
 * durable descriptor, so it neither restores the prior budget nor inherits
 * the parent's current one; the resumed route's defaults apply instead.
 *
 * @module @deepseek-ai/dsh-subagent/descriptor
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ToolRestriction } from '@deepseek-ai/dsh-tools';
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * Durable identity and lifecycle mode of a session-backed subagent child,
         * appended once by the establishing provider inside the child's initial
         * turn, before its first request. Continuable records also carry their
         * resumable composition. Log-only: it carries no `surfaceOp`, never enters
         * model history, and survives compaction.
         */
        'subagent/descriptor': SubagentDescriptorData;
    }
}
/**
 * The current descriptor format version, stamped into every appended
 * `subagent/descriptor` event and required verbatim by {@link foldSubagentDescriptor}.
 * Supporting another composition input is a deliberate version change, never
 * an implicit extra field.
 */
export declare const SUBAGENT_DESCRIPTOR_VERSION = 2;
/** Fields shared by every supported `subagent/descriptor` payload. */
interface SubagentDescriptorBase {
    /** Descriptor format version ({@link SUBAGENT_DESCRIPTOR_VERSION}). */
    readonly version: number;
    /** Whether the child is a terminal one-shot run or a resumable conversation. */
    readonly mode: 'one-shot' | 'continuable';
    /** The `ctx.subagents` provider name that established the child. */
    readonly provider: string;
}
/** A session-backed subagent that cannot be cold-resumed after its run. */
export interface OneShotSubagentDescriptorData extends SubagentDescriptorBase {
    readonly mode: 'one-shot';
    /**
     * The initial delegation's short `description`, kept as the child's durable
     * creation label so enumeration can identify the conversation without
     * replaying parent tool results or exposing the child prompt.
     */
    readonly label?: string;
}
/** A session-backed subagent whose declared composition supports cold resume. */
export interface ContinuableSubagentDescriptorData extends SubagentDescriptorBase {
    readonly mode: 'continuable';
    /** The initial delegation's short `description`, used for durable enumeration. */
    readonly label: string;
    /** Resolved child `agentOptions.provider`, when one was declared. */
    readonly agentProvider?: string;
    /** Resolved child `agentOptions.model`, when one was declared. */
    readonly agentModel?: string;
    /** Per-child persona that shadows the deployment persona on resume. */
    readonly persona?: string;
    /** Child tool scoping reapplied on resume. */
    readonly toolFilter?: ToolRestriction;
}
/** The supported durable subagent identity and optional continuation composition. */
export type SubagentDescriptorData = OneShotSubagentDescriptorData | ContinuableSubagentDescriptorData;
/** Fields shared by descriptor snapshot inputs. */
interface SubagentDescriptorInputBase {
    /** Whether the child is a terminal one-shot run or a resumable conversation. */
    readonly mode: 'one-shot' | 'continuable';
    /** The `ctx.subagents` provider name that will establish the child. */
    readonly provider: string;
}
/** Input for a one-shot child's durable identity. */
export interface OneShotSubagentDescriptorInput extends SubagentDescriptorInputBase {
    readonly mode: 'one-shot';
    /** Optional initial delegation `description` used as the durable creation label. */
    readonly label?: string;
}
/** Input for a continuable child's durable identity and resumable composition. */
export interface ContinuableSubagentDescriptorInput extends SubagentDescriptorInputBase {
    readonly mode: 'continuable';
    /** Initial delegation `description` used for durable enumeration. */
    readonly label: string;
    /** Requested child `agentOptions.provider`. */
    readonly agentProvider?: string;
    /** Requested child `agentOptions.model`. */
    readonly agentModel?: string;
    /** Requested per-child persona. */
    readonly persona?: string;
    /** Requested child tool scoping. */
    readonly toolFilter?: ToolRestriction;
}
/** Inputs {@link snapshotSubagentDescriptor} validates and detaches. */
export type SubagentDescriptorInput = OneShotSubagentDescriptorInput | ContinuableSubagentDescriptorInput;
/**
 * Validate and detach descriptor inputs into the durable payload, before any
 * Task or provider work begins — the same detached lossless-JSON boundary the
 * session log itself enforces, applied early so a synchronous validation
 * failure rejects the tool call without creating a Task.
 * @param input - the caller-collected composition fields.
 * @returns the versioned, detached descriptor payload.
 * @throws when a field is not losslessly JSON-serializable.
 */
export declare function snapshotSubagentDescriptor(input: OneShotSubagentDescriptorInput): OneShotSubagentDescriptorData;
/**
 * Validate and detach a continuable descriptor input.
 * @param input - the caller-collected continuable composition fields.
 * @returns the versioned, detached continuable descriptor payload.
 * @throws when a field is not losslessly JSON-serializable.
 */
export declare function snapshotSubagentDescriptor(input: ContinuableSubagentDescriptorInput): ContinuableSubagentDescriptorData;
/**
 * Fold a persisted child log to its supported descriptor. The first
 * `subagent/descriptor` event is authoritative — the establishing provider
 * appends exactly one, so a later same-type event cannot rewrite the declared
 * composition.
 * @param events - the loaded child session events.
 * @returns the descriptor, or `undefined` when the log has none or its
 *   version is not {@link SUBAGENT_DESCRIPTOR_VERSION} (the child cannot be
 *   classified by this runtime).
 * @throws when a current-version persisted payload does not match its complete
 *   declared schema.
 */
export declare function foldSubagentDescriptor(events: readonly SessionEvent[]): SubagentDescriptorData | undefined;
export {};
//# sourceMappingURL=descriptor.d.ts.map