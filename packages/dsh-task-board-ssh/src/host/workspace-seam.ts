/**
 * The seam the placement strategies are assembled behind.
 *
 * The strategies themselves live in `src/host/workspace/` and are owned there;
 * the engine only ever sees the frozen interface from `src/core/workspace.ts`
 * through this resolver. That keeps two things true at once: the engine never
 * imports a strategy implementation, and a deployment that serves none still
 * mounts — a git run then fails on the card with a diagnosable reason instead of
 * silently working in the wrong place.
 *
 * @module dsh-task-board-ssh/host/workspace-seam
 */
import type { DshSshService } from '../core/contract.ts'
import type { SshWorkspaceTarget } from '../core/target.ts'
import type { SshWorkspaceStrategy } from '../core/workspace.ts'

/**
 * Resolve the placement strategy for one pinned workspace target.
 *
 * The whole target is passed rather than its kind, because which strategy serves
 * a git run depends on where its repository comes from: a URL the host reaches
 * and the local workspace sent as a bundle are two mechanisms behind one kind.
 * Called once per run, at the moment the run is prepared, so it may answer
 * differently as a deployment's strategies change.
 */
export type SshWorkspaceStrategyResolver = (target: SshWorkspaceTarget) => SshWorkspaceStrategy | undefined

/** What a strategy assembly receives. */
export interface SshWorkspaceAssemblyInput {
  /** The shared `dshSsh` face: every remote operation a strategy makes goes through it. */
  ssh: DshSshService
}

/**
 * The shape of `createWorkspaceStrategies` in `src/host/workspace/index.ts`.
 *
 * The host entry assembles its resolver through this factory. Until that module
 * lands, the entry passes {@link NO_WORKSPACE_STRATEGIES}, and this declaration
 * is the interface the two halves meet on.
 */
export type CreateSshWorkspaceStrategies = (input: SshWorkspaceAssemblyInput) => SshWorkspaceStrategyResolver

/** The resolver of a deployment that serves no placement strategy. */
export const NO_WORKSPACE_STRATEGIES: SshWorkspaceStrategyResolver = () => undefined
