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
 * Two facts a run needs from the deployment live here as well, because both are
 * about the workspace rather than about the run protocol: the local directory a
 * `workspace` repository source points at, and the note a strategy attaches when
 * it could not send every local file.
 *
 * @module dsh-task-board-ssh/host/workspace-seam
 */
import type { DshSshService, ServiceLookupSeat } from '../core/contract.ts'
import type { SshWorkspaceTarget } from '../core/target.ts'
import type { SshWorkspacePreparation, SshWorkspaceStrategy } from '../core/workspace.ts'

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
 * The shape of `createWorkspaceStrategies`-style assembly in
 * `src/host/workspace/index.ts`.
 *
 * The host entry assembles its resolver through that module's single entry and
 * this declaration is the interface the two halves meet on.
 */
export type CreateSshWorkspaceStrategies = (input: SshWorkspaceAssemblyInput) => SshWorkspaceStrategyResolver

/** The resolver of a deployment that serves no placement strategy. */
export const NO_WORKSPACE_STRATEGIES: SshWorkspaceStrategyResolver = () => undefined

/** Cordis service name of the deployment's workspace registry. */
export const WORKSPACE_REGISTRY_SERVICE = 'workspaceRegistry'

/**
 * The slice of the deployment's workspace registry this package reads.
 *
 * The board resolves the same service for the same reason — a card that pins a
 * workspace id has to become a directory before anything can run in it — and
 * every member used here is one the runtime already publishes.
 */
export interface WorkspaceRegistrySeat {
  /** Every workspace this deployment knows, in store order. */
  list(): ReadonlyArray<{ id: string; path: string }>
}

/**
 * Resolve the workspace registry, when this deployment serves one.
 * @param ctx - a seat that can read services by name.
 * @returns the registry, or undefined when the deployment serves none.
 */
export function resolveWorkspaceRegistry(ctx: ServiceLookupSeat): WorkspaceRegistrySeat | undefined {
  try {
    const face = ctx.get(WORKSPACE_REGISTRY_SERVICE) as { list?: unknown } | undefined
    if (face === undefined || typeof face.list !== 'function') return undefined
    return face as WorkspaceRegistrySeat
  } catch {
    return undefined
  }
}

/**
 * Resolve one workspace id to the local repository a git run bundles.
 *
 * A missing registry, a missing workspace and a path this deployment cannot read
 * all answer undefined: the run then fails with the strategy's own "was not
 * resolved" refusal, which says more than a rejected id would.
 * @param registry - the deployment's registry, when it serves one.
 * @param workspaceId - workspace the card's target names.
 * @returns the absolute local directory, or undefined when it does not resolve.
 */
export function readWorkspaceDirectory(registry: WorkspaceRegistrySeat | undefined, workspaceId: string): string | undefined {
  if (registry === undefined || workspaceId === '') return undefined
  try {
    const workspace = registry.list().find(entry => entry.id === workspaceId)
    if (workspace === undefined) return undefined
    return typeof workspace.path === 'string' && workspace.path !== '' ? workspace.path : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the untracked-file note a preparation may carry.
 *
 * The frozen `SshWorkspacePreparation` promises one member, the directory; the
 * strategies in `src/host/workspace/` add this one, because a bundle carries
 * commits and not the untracked working tree, and a card has to be able to say
 * how much of it stayed behind. Read structurally: a strategy of this
 * deployment's own that reports nothing is a strategy that sent everything.
 * @param prepared - what a strategy returned.
 * @returns the count, or undefined when the strategy did not measure one.
 */
export function readUntrackedFiles(prepared: SshWorkspacePreparation): number | undefined {
  const value = (prepared as { untrackedFiles?: unknown }).untrackedFiles
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

/**
 * One sentence saying how many local files the run did not receive.
 *
 * It travels in the outcome the card records, which is the only free-text channel
 * an external run has: the ledger keeps the account of a run, not a second
 * schema field for a workspace detail.
 * @param files - untracked files that stayed on this machine.
 * @returns the sentence, or an empty string when there is nothing to say.
 */
export function untrackedNote(files: number | undefined): string {
  if (files === undefined || files <= 0) return ''
  return files === 1
    ? '1 untracked local file was not sent: a bundle carries commits, not the untracked working tree.'
    : `${String(files)} untracked local files were not sent: a bundle carries commits, not the untracked working tree.`
}
