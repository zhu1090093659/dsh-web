/**
 * Shared in-process child composition: the delegation-depth budget, the
 * durable session metadata, the resolved child `AgentOptions`, the delegated
 * policy seed, and the scoped setup a child agent needs. Both the one-shot
 * provider driver and the continuation manager compose children this way, so
 * depth accounting, lineage stamping, and delegation policy have one home.
 *
 * @module @deepseek-ai/dsh-subagent/child-agent
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions, CreateAgentOptions } from '@deepseek-ai/dsh-agent';
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import type { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { ToolRestriction } from '@deepseek-ai/dsh-tools';
/** Thrown when starting a child would exceed the requested depth cap. */
export declare class SubagentDepthError extends Error {
    readonly attemptedDepth: number;
    readonly maxDepth: number;
    constructor(attemptedDepth: number, maxDepth: number);
}
/**
 * Resolve the child's delegation depth from its parent and enforce an optional
 * cap. The persisted parent header is the monotone floor, so a resumed parent
 * cannot delegate as if it were top-level.
 * @param parent - the delegating parent agent.
 * @param maxDepth - optional absolute cap the resolved depth must not exceed.
 * @returns the child's non-negative safe-integer depth.
 * @throws {SubagentDepthError} when the resolved depth exceeds `maxDepth`.
 * @throws {RangeError} when the resolved depth leaves the safe-integer range.
 */
export declare function resolveChildDepth(parent: Agent, maxDepth: number | undefined): number;
/**
 * Resolve the child's `AgentOptions`: the parent's provider/model/maxTokens
 * route unless the request overrides it, stamped with the child's own
 * delegation depth.
 * @param parent - the delegating parent whose route the child inherits.
 * @param requested - per-child overrides, if any.
 * @param childDepth - the resolved delegation depth to stamp.
 * @returns the resolved options for `ctx.agents.create()`.
 */
export declare function resolveChildAgentOptions(parent: Agent, requested: AgentOptions | undefined, childDepth: number): AgentOptions;
/**
 * Build the child session's durable creation metadata: the parent's workspace,
 * its direct lineage, coarse product origin, the recursion budget that must
 * survive persistence, the seed boundary that separates inherited parent
 * history from child work, and the composition the child runs under.
 *
 * The preset is read from the parent's LIVE scope chain rather than from its
 * header, because a parent that switched preset while blank runs on the newer
 * composition and its header still names the older one. Recording it is what
 * makes a child's history reconstructable: without it a cold read of the child
 * resolves the deployment default and rebuilds turns under a tool set the
 * child never had.
 * @param parent - the delegating parent agent.
 * @param childDepth - the resolved delegation depth to persist.
 * @param lineageSeedLength - how many leading events came from the parent's log.
 * @returns the `meta` for `ctx.agents.create()`.
 */
export declare function childSessionMeta(parent: Agent, childDepth: number, lineageSeedLength: number): NonNullable<CreateAgentOptions['meta']>;
/** The scoped composition a child agent's creation window applies. */
export interface ChildComposition {
    /** Per-child persona shadowing the deployment persona. */
    readonly persona?: string | undefined;
    /** Per-child tool scoping. */
    readonly toolFilter?: ToolRestriction | undefined;
}
/**
 * Model-facing delegation-scope statement for every in-process child. A
 * runtime-context contribution rather than a system-prompt section, so the
 * deployment's system prompt stays uniform across parents and children.
 */
export declare const SUBAGENT_DELEGATION_CONTEXT: string;
/**
 * Compose one child inside its creation window: join its parent's preset,
 * register the fixed delegation-scope statement, then apply the child's own
 * shadowing persona section and tool restriction, all owned by the child's
 * scope and therefore invisible to its parent and siblings. Creation and cold
 * resume both pass through here.
 *
 * The join comes first and the child's own registrations second, which is the
 * order the layering already implies — the nearest scope wins a name, and a
 * per-child restriction intersects with everything its chain admits — but
 * stating it here keeps the two steps from being read as independent.
 *
 * The join and the per-child registrations live in ONE call because a child
 * composed without the join is exactly the defect this function exists to
 * prevent: with every model-facing row on the agent plane, a child that joins
 * no preset sees an empty tool registry and none of its parent's prompt
 * sections. Taking the parent as a parameter is what makes that omission
 * unrepresentable at the call sites.
 * @param childCtx - the child agent's scoped creation context.
 * @param parent - the delegating parent whose composition the child joins.
 * @param composition - the per-child persona and tool filter to install.
 */
export declare function applyChildComposition(childCtx: Context, parent: Agent, composition: ChildComposition): void;
/** Policy seeded onto a child session's log at the delegation boundary. */
export interface DelegatedPolicyOverrides {
    /** The parent session's explicit sandbox-mode override, or `undefined` without one. */
    readonly sandboxMode: SandboxMode | undefined;
    /**
     * `'never'` whenever the approval capability is composed, `undefined`
     * otherwise: a delegated child acts only within the sandbox scope fixed at
     * delegation, so its asks are rejected deterministically.
     */
    readonly approvalPolicy: 'never' | undefined;
}
/**
 * Capture the policy to seed into one delegation. Call synchronously before
 * the child start's first await: a later parent switch belongs to the
 * parent's future, not to this child. Only the parent session's explicit
 * sandbox override is captured — never deployment defaults or one-shot
 * grants — and the approval policy is pinned to `'never'` regardless of the
 * parent's own policy.
 * @param parent - the delegating parent agent.
 * @returns the sandbox override (or `undefined` without one) and the approval pin.
 */
export declare function captureDelegatedPolicyOverrides(parent: Agent): DelegatedPolicyOverrides;
/**
 * Append the captured delegation policy onto the child's own log as
 * `source: 'delegation'` events inside the unpublished creation window, so the
 * child's effective policy is reconstructable from its log alone. Appends land
 * after any fork seed, so fresh policy wins stale seed state; later child
 * switches still win over these events.
 * @param childSession - the unpublished child's session.
 * @param overrides - the policy captured at delegation.
 */
export declare function appendDelegatedPolicyOverrides(childSession: Session, overrides: DelegatedPolicyOverrides): void;
/** Identity and lineage inputs shared by every in-process child creation. */
export interface ChildCreateInputs {
    /** The child's reserved session id. */
    readonly sessionId: SessionId;
    /** The delegating parent agent. */
    readonly parent: Agent;
    /** The resolved delegation depth. */
    readonly childDepth: number;
    /** How many leading seed events came from the parent's log. */
    readonly lineageSeedLength: number;
}
//# sourceMappingURL=child-agent.d.ts.map