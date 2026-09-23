/**
 * Auto-isolation (experimental, settings-gated): wrap the shared workspaces
 * service's `startSession` so the New Session action of a GIT workspace
 * creates a fresh managed worktree first and starts the session there — the
 * Claude-desktop-style automatic isolation shape.
 *
 * This is a RUNTIME patch of a browser-side singleton, not a source patch:
 * the wrapper shadows the instance method, delegates everything it cannot
 * isolate, and restores the original on dispose. It depends on unpublished
 * client-runtime internals, so the shape is probed at install time and any
 * mismatch degrades to the official behavior with a console diagnostic —
 * never a hard failure. Only `startSession` is wrapped: `connectWorkspace`
 * keeps its blank-session reuse semantics, so startup selection and direct
 * workspace connects never spawn worktrees.
 * @module dsh-git-graph/client/auto-isolation
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { GitApi } from './api.ts'
import { mainViewSessionId } from './main-session.ts'

/** The mutable face the wrapper needs (probed, never assumed). */
interface WorkspacesPatchTarget {
  startSession: (workspaceId?: string) => void
  create: (input: { path: string }) => Promise<{ workspaceId: string }>
  connectWorkspace: (workspaceId: string) => Promise<string>
  list: {
    getSnapshot: () => {
      items: { workspaceId: string; path: string; sessionIds: string[] }[]
      recentWorkspaceId?: string
    }
  }
  /**
   * Registration removal (the official `workspaces.delete` the workspace list
   * calls). Optional on purpose: an older cohort without it still installs,
   * and the rollback then keeps to removing the worktree directory.
   */
  delete?: (workspaceId: string) => Promise<void>
}

/** Log line prefix for every auto-isolation diagnostic. */
const TAG = '[git-graph] auto-isolation'

/**
 * Probe the workspaces service shape: the wrapper only installs when every
 * member it shadows or calls is a function of the expected kind. A changed
 * client-runtime surface leaves the official behavior untouched.
 */
function probeWorkspaces(value: unknown): WorkspacesPatchTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<WorkspacesPatchTarget>
  if (typeof candidate.startSession !== 'function'
    || typeof candidate.create !== 'function'
    || typeof candidate.connectWorkspace !== 'function'
    || typeof candidate.list?.getSnapshot !== 'function') return null
  return candidate as WorkspacesPatchTarget
}

/**
 * Install the startSession wrapper on the shared workspaces service.
 * @param scope - client context carrying workspaces and sessions.
 * @param git - the /git/* client (config + worktree verbs).
 * @returns the disposer restoring the official method.
 */
export function installAutoIsolation(scope: ClientContext, git: GitApi): () => void {
  const workspaces = probeWorkspaces(scope.workspaces)
  if (workspaces === null) {
    console.warn(`${TAG} disabled: the workspaces service shape changed; using the official new-session behavior`)
    return () => {}
  }

  let original: WorkspacesPatchTarget['startSession']
  try {
    original = workspaces.startSession
  } catch {
    console.warn(`${TAG} disabled: startSession is not readable`)
    return () => {}
  }

  /** The official target resolution (explicit > current session's workspace > recent). */
  const resolveTarget = (workspaceId?: string): string | undefined => {
    const snapshot = workspaces.list.getSnapshot()
    const current = mainViewSessionId(scope.sessions.list.getSnapshot().byId)
    const currentWorkspaceId = current === undefined
      ? undefined
      : snapshot.items.find(item => item.sessionIds.includes(current))?.workspaceId
    return workspaceId ?? currentWorkspaceId ?? snapshot.recentWorkspaceId
  }

  /**
   * Targets with a routing flow already in flight. The new-session button
   * fires `startSession` on every click and nothing upstream debounces it, so
   * a fast double click would otherwise run two isolation flows and create two
   * worktrees; the second click is absorbed while the first is routing.
   */
  const routing = new Set<string>()

  const routed = (workspaceId?: string): void => {
    const target = resolveTarget(workspaceId)
    if (target === undefined) {
      original.call(workspaces)
      return
    }
    if (routing.has(target)) return
    routing.add(target)
    void (async () => {
      // The config is re-read per action so the settings toggle applies
      // without a page reload; both failures degrade to official behavior.
      const configResult = await git.config()
      if (!configResult.ok || !configResult.value.autoIsolate) {
        original.call(workspaces, target)
        return
      }
      const config = configResult.value
      const item = workspaces.list.getSnapshot().items.find(entry => entry.workspaceId === target)
      if (item === undefined) {
        original.call(workspaces, target)
        return
      }
      // Already inside the managed worktree home: never nest isolations.
      const home = config.worktreesHome
      if (item.path.startsWith(home + '/') || item.path.startsWith(home + '\\')) {
        original.call(workspaces, target)
        return
      }
      const status = await git.status(item.path)
      if (!status.ok || status.value === null) {
        original.call(workspaces, target)
        return
      }
      const name = `s-${Date.now().toString(36)}`
      const baseRef = config.autoBaseline === 'default' ? 'origin/HEAD' : undefined
      const created = await git.addWorktree(item.path, name, baseRef)
      if (!created.ok) {
        console.warn(`${TAG} worktree creation failed; starting the session in the main checkout instead`, created.error)
        original.call(workspaces, target)
        return
      }
      let registeredId: string | undefined
      try {
        const workspace = await workspaces.create({ path: created.value.path })
        registeredId = workspace.workspaceId
        original.call(workspaces, workspace.workspaceId)
      } catch (error) {
        // Roll back the half-created environment rather than leaking it: drop
        // the registration just made, then the worktree directory. Without the
        // registration step the list would keep an entry pointing at a path we
        // are about to delete.
        if (registeredId !== undefined && typeof workspaces.delete === 'function') {
          try {
            await workspaces.delete(registeredId)
          } catch (cleanupError) {
            console.warn(`${TAG} could not drop the failed workspace registration`, cleanupError)
          }
        }
        await git.removeWorktree(item.path, created.value.path, { force: true })
        console.warn(`${TAG} workspace registration failed; rolled back the worktree`, error)
        original.call(workspaces, target)
      }
    })().catch((error: unknown) => {
      console.warn(`${TAG} routing failed; using the official behavior`, error)
      original.call(workspaces, target)
    }).finally(() => {
      routing.delete(target)
    })
  }

  try {
    workspaces.startSession = routed
  } catch {
    console.warn(`${TAG} disabled: startSession is not writable`)
    return () => {}
  }
  return () => {
    try {
      workspaces.startSession = original
    } catch {
      // A frozen service cannot be restored; the wrapper dies with the page.
    }
  }
}