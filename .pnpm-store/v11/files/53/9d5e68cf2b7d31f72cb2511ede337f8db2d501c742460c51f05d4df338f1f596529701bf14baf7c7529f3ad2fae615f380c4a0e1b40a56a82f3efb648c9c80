/**
 * Same-session goal domain: event-sourced state, compare-and-set mutations,
 * and process-local continuation activation.
 * @module @deepseek-ai/dsh-goal
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { CreateGoalRequest, CreateGoalResult, EditGoalRequest, GoalBlockReason, GoalProjection, GoalRef, GoalView } from './types.ts';
export type * from './types.ts';
export type * from './domain.ts';
export { GOAL_CHANGE_VERSION, GoalError, GoalId } from './runtime.ts';
export { decodeGoalChange, foldGoal, goalChangeRef } from './fold.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        goals: GoalService;
    }
}
/**
 * Light last-wins fold of the `goal` projection unit. Unlike the strict
 * replay fold (fold.ts: transition validation, fail-loud on malformed
 * changes, Set-typed state), this transition is projection-grade: the state
 * is plain JSON (persisted-cache precondition), any non-goal or malformed
 * event returns the same reference (the registry's Object.is gate — the
 * title/todos posture), and correctness of the written change is the write
 * side's job (GoalService validated it before appending; the package
 * invariant rejects a violating stream fail-loud where it is installed).
 * @param state - the projection covering all prior events.
 * @param event - the next committed session event.
 * @returns the next projection (same reference when the event is not a goal change).
 */
export declare function applyGoalProjection(state: GoalProjection | null, event: SessionEvent): GoalProjection | null;
/** Deployment defaults for goal creation. */
export interface Config {
    /** Total rounds used when a create request omits its own cap. */
    defaultMaxGoalRounds?: number;
}
/** Resolved defaults. */
export interface ResolvedConfig {
    /** Validated positive safe-integer default round cap. */
    defaultMaxGoalRounds: number;
}
/** Goal service (`ctx.goals`) backed exclusively by the owning session log. */
export declare class GoalService extends TypertRemoteService {
    static inject: string[];
    static Config: z<Config>;
    private readonly resolved;
    private readonly caches;
    constructor(ctx: Context, config?: Config);
    /**
     * Read the current goal for one exact live agent.
     * @param agent - owning live agent.
     * @returns a fresh view or `undefined` when no goal is current.
     * @throws {@link GoalError} when the agent is not the registry's live instance.
     */
    get(agent: Agent): GoalView | undefined;
    /**
     * Remove process-local continuation authority without changing durable goal
     * phase or revision. Lifecycle owners use this before unloading a driver;
     * a later human-authorized {@link resume} records the new activation edge.
     * @param agent - owning live agent.
     * @returns a fresh disarmed view, or `undefined` when no goal is current.
     */
    disarm(agent: Agent): GoalView | undefined;
    /**
     * Create and arm a goal. A completed goal may be replaced; every other
     * current phase must be cleared or resumed instead.
     * @param agent - owning live agent.
     * @param request - objective and optional round cap.
     * @returns the created live view.
     */
    create(agent: Agent, request: CreateGoalRequest): GoalView;
    /**
     * Edit objective and/or round cap without changing phase.
     * @param agent - owning live agent.
     * @param ref - expected current revision.
     * @param request - at least one replacement field.
     * @returns the edited view.
     */
    edit(agent: Agent, ref: GoalRef, request: EditGoalRequest): GoalView;
    /**
     * Pause an active goal and disarm automatic continuation.
     * @param agent - owning live agent.
     * @param ref - expected current revision.
     * @returns the paused view.
     */
    pause(agent: Agent, ref: GoalRef): GoalView;
    /**
     * Resume and arm a stopped goal, or rearm an active goal after a
     * session-start edge, while its round budget still has capacity.
     * @param agent - owning live agent.
     * @param ref - expected current revision.
     * @returns the active view.
     */
    resume(agent: Agent, ref: GoalRef): GoalView;
    /**
     * Mark a current non-complete goal complete and disarm it.
     * @param agent - owning live agent.
     * @param ref - expected current revision.
     * @returns the completed view.
     */
    complete(agent: Agent, ref: GoalRef): GoalView;
    /**
     * Mark an active goal blocked and disarm it.
     * @param agent - owning live agent.
     * @param ref - expected current revision.
     * @param reason - policy-owned stable code and human-readable explanation.
     * @returns the blocked view with its durable reason.
     */
    block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView;
    /**
     * Clear the current goal while retaining a durable tombstone and history.
     * @param agent - owning live agent.
     * @param ref - expected current revision.
     * @returns the tombstone ref whose revision is one past the cleared snapshot.
     */
    clear(agent: Agent, ref: GoalRef): GoalRef;
    /** Resolve and validate the cache used by a mutation. */
    private prepareMutation;
    /** Reject stale or missing current-state refs. */
    private expectCurrent;
    /** Enforce exact live-agent identity rather than trusting a matching id. */
    private assertLive;
    /** Return the per-session cache, folding a seed once with activation disarmed. */
    private cache;
    /** Incrementally observe durable events and reconcile local activation intent. */
    private sync;
    /** Build a new revision with one replacement phase. */
    private withPhase;
    /** Shared validated phase transition. */
    private transition;
    /** Render a stable invalid-transition error. */
    private transitionError;
    /** Commit a mutation that retains the current goal's derived counters/times. */
    private commitCurrent;
    /** Clamp a current goal's next timestamp across backward wall-clock movement. */
    private nextMutationTime;
    /** Build and commit one full-snapshot mutation. */
    private commitSnapshot;
    /** Commit one mutation into the goal log, cache, and live event stream. */
    private commit;
    /** Build a detached current view. */
    private view;
    /**
     * Create one Goal through the remote boundary.
     * @param agent - exact live Agent resolved from the wire identity.
     * @param request - objective and optional round cap.
     * @returns the created Goal identity.
     */
    remoteExportCreate(agent: Agent, request: CreateGoalRequest): CreateGoalResult;
}
export default GoalService;
//# sourceMappingURL=index.d.ts.map