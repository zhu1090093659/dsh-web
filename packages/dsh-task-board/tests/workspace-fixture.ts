/**
 * The deployment's workspace service for spec fixtures.
 *
 * `src/index.ts` injects `workspaceRegistry`, so every real deployment serves
 * one: a run that pins no workspace resolves the deployment's most recently
 * used workspace and is refused only when there is none at all. Specs that
 * launch a card therefore model that service instead of the bare Host.
 */
import type { TaskBoardWorkspaceRegistry } from '../src/host-runner.ts'

/**
 * A workspace service listing exactly these workspaces, newest first.
 * @param ids - workspace ids, the first one being the most recently used.
 * @param options.archive - archived Session ids, when the spec exercises the
 *   reuse rule's archive refusal; omitted models a registry that reports no
 *   archive set at all.
 * @returns the registry a runner or the Host service is constructed with.
 */
export function fixtureWorkspaces(
  ids: readonly string[] = ['workspace-fixture'],
  options: { archive?: readonly string[] } = {},
): TaskBoardWorkspaceRegistry {
  return {
    list: () => ids.map((id, index) => ({
      id,
      updatedAt: new Date(Date.UTC(2026, 8, 30) - index * 60_000).toISOString(),
      sessionIds: [],
    })),
    ...(options.archive === undefined ? {} : { archivedSessionIds: options.archive }),
  } as unknown as TaskBoardWorkspaceRegistry
}
