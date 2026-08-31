/**
 * Git-graph surface plugin, browser half. The branch selector is rendered
 * only for blank sessions: it uses the input selector row's context hole
 * (`conversation.input.selector.context`) beside the official workspace
 * selector. When that shell slot is unavailable, it waits for
 * {@link CONTEXT_FALLBACK_MS} then uses `conversation.input.dock` for the
 * blank-session hero phase, where it joins the official hero chip row after
 * the agent-preset seat. Active sessions render no branch-selection control.
 *
 * All git facts arrive through this package's host /git routes. The inject
 * face carries the business verbs and the components remain pure props. The
 * published npm SDK (rc.6) dropped the context-hole type, so it is declared
 * locally below for type-checked registration.
 * @module dsh-git-graph/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the conversation
// slots); the selector-context hole is spelled locally below because the
// published npm SDK (rc.6) dropped it while the running shell still renders it.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-session standard-props merge (sessionId on
// session/session-maybe slots, useSessions on GlobalStandardProps); the
// 0.1.2-alpha.2 cohort trimmed ui-conversation's peer set, so this edge is
// no longer reachable transitively and must be declared here.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BranchesView, GitError, GitFeatureConfig, GraphView, RepoStatus, SwitchResult,
  WorktreeAddResult, WorktreeListView, WorktreeRemoveResult,
} from '../core/types.ts'
import { GitApi, subscribeChanges } from './api.ts'
import { BranchChip } from './chips/BranchChip.tsx'
import { installAutoIsolation } from './auto-isolation.ts'
import { en, zh, type GitGraphKey } from './locales.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

export type { GitGraphKey } from './locales.ts'
export { BranchChip } from './chips/BranchChip.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The git-graph chip copy. */
    'git-graph': GitGraphKey
  }

  interface SlotMap {
    /**
     * The input selector context-chip hole: feature chips rendered right
     * after the workspace selector (the git branch selector's seat).
     * Session-maybe: the component identifies blank sessions from the
     * baseline and renders no control for an active session.
     *
     * Declared and rendered by the running dsh web shell
     * (ui-conversation's InputSelectorRow); the published npm SDK (rc.6)
     * dropped this hole, so it is spelled locally to keep the chip's
     * registration type-checked without depending on the sibling SDK surface.
     */
    'conversation.input.selector.context': {
      kind: 'list'
      scope: 'session-maybe'
      owner: InputSelectorContextOwnerProps
    }
  }
}

/** Owner share of the input selector context-chip hole (empty by contract). */
export interface InputSelectorContextOwnerProps {}

/** Dictionary namespace owned by this plugin. */
const NS = 'git-graph'

/** Required services: slots for the selector-context entry, sessions for the cwd lookup, workspaces for worktree sessions, locale for the copy. */
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'locale']

/** Injected business face of the branch chip: git verbs, keyed by the current session id. */
export interface GitGraphInjected {
  /** The workspace repository snapshot; null when not a repository. */
  repoStatus: (sessionId: SessionId | undefined) => Promise<RepoStatus | null>
  /** Local branch list with the current branch marked. */
  branches: (sessionId: SessionId | undefined) => Promise<BranchesView | null>
  /** Workspace-level `git switch --no-guess <branch>`. */
  switchBranch: (sessionId: SessionId | undefined, branch: string) => Promise<SwitchResult>
  /** `git switch --no-guess -c <name>` from the current HEAD. */
  createBranch: (sessionId: SessionId | undefined, name: string) => Promise<SwitchResult>
  /** Topo-ordered commit graph. */
  graph: (sessionId: SessionId | undefined, limit?: number) => Promise<GraphView | null>
  /** All linked worktrees of the session's repository. */
  worktrees: (sessionId: SessionId | undefined) => Promise<WorktreeListView | null>
  /** Create a managed worktree, register it as a workspace, and start a session in it. */
  createWorktreeSession: (sessionId: SessionId | undefined, name: string, baseRef?: string) => Promise<WorktreeAddResult>
  /** Remove a managed worktree and unregister its workspace when linked. */
  removeWorktree: (sessionId: SessionId | undefined, worktreePath: string, opts?: { force?: boolean; deleteBranch?: boolean }) => Promise<WorktreeRemoveResult>
  /** The live feature config (auto-isolation flags + managed home). */
  gitConfig: () => Promise<GitFeatureConfig | null>
  /** Host-pushed branch-state changes for the session's workspace. */
  subscribeChanges: (sessionId: SessionId | undefined, onChange: () => void) => () => void
}

/** The session-cwd lookup failure shared by the injected verbs. */
const NO_WORKSPACE: GitError = { code: 'workspace-unknown', message: 'session has no workspace' }

/**
 * How long the chip waits for the selector-context declaration before
 * falling back to the input dock. The window covers the shell's first
 * render of the input selector row after the conversation service is up;
 * shells that never declare the hole (rc.6) land on the dock after it.
 */
export const CONTEXT_FALLBACK_MS = 2000

/**
 * Client plugin body: the branch chip entry with its git verbs, on the
 * selector-context hole with an input-dock fallback.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-git-graph' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-git-graph: dictionaries')

  const git = new GitApi()

  // Auto-isolation (settings-gated host-side, probed here): wrap the shared
  // workspaces service's startSession so New Session on a git workspace
  // lands in a fresh managed worktree. Shape mismatch degrades to the
  // official behavior. The fiber's dispose restores the official method.
  ctx.inject(['workspaces', 'sessions'], (worktreeScope: ClientContext) => {
    worktreeScope.effect(() => installAutoIsolation(worktreeScope, git), 'dsh-git-graph: auto-isolation')
  })

  // The context-fallback timer, armed once the conversation seam is up and
  // cleared when this fiber unloads (the slot inject waits die with the
  // fiber too, so no seat survives an unload).
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  ctx.effect(() => () => {
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
  }, 'dsh-git-graph: context fallback timer')

  // Conditional mount: the conversation service being up is the
  // registration-safe signal (the GoalDock/QueueDock seam). The chip then
  // prefers the selector-context hole and falls back to the input dock when
  // that declaration never arrives.
  ctx.inject(['slots', 'conversation', 'sessions'], (scope: ClientContext) => {
    const sessions = scope.sessions

    /** The session's workspace root, resolved at call time from the sessions baseline. */
    const cwdOf = (sessionId: SessionId | undefined): string | undefined =>
      sessionId === undefined ? undefined : sessions.list.getSnapshot().byId[sessionId]?.cwd

    /** The injected face shared by every seat this chip registers into. */
    const injected = (): GitGraphInjected => {
      /** Resolve the workspace root for one git call. */
      const pathOf = (sessionId: SessionId | undefined): { ok: true; path: string } | { ok: false; error: GitError } => {
        const cwd = cwdOf(sessionId)
        if (cwd === undefined || cwd === '') return { ok: false, error: NO_WORKSPACE }
        return { ok: true, path: cwd }
      }
      return {
        repoStatus: async (sessionId) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return null
          const result = await git.status(resolved.path)
          return result.ok ? result.value : null
        },
        branches: async (sessionId) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return null
          const result = await git.branches(resolved.path)
          return result.ok ? result.value : null
        },
        switchBranch: async (sessionId, branch) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return { ok: false, error: resolved.error }
          const result = await git.switchBranch(resolved.path, branch)
          return result.ok ? { ok: true, branch: result.value.branch } : result
        },
        createBranch: async (sessionId, name) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return { ok: false, error: resolved.error }
          const result = await git.createBranch(resolved.path, name)
          return result.ok ? { ok: true, branch: result.value.branch } : result
        },
        graph: async (sessionId, limit) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return null
          const result = await git.graph(resolved.path, limit)
          return result.ok ? result.value : null
        },
        worktrees: async (sessionId) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return null
          const result = await git.worktrees(resolved.path)
          return result.ok ? result.value : null
        },
        createWorktreeSession: async (sessionId, name, baseRef) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return { ok: false, error: resolved.error }
          const created = await git.addWorktree(resolved.path, name, baseRef)
          if (!created.ok) return { ok: false, error: created.error }
          // Register the worktree as a workspace and open its blank session;
          // a registration failure rolls the worktree back (no half-made env).
          try {
            const workspace = await scope.workspaces.create({ path: created.value.path })
            // 0.1.2 cohort: workspace-side session launch moved to the sessions
            // face. ISessions.create only adopts the target workspace and
            // resolves the new SessionId; open() is the separate navigation
            // step that selects it (matching the old startSession behavior).
            const createdSessionId = await scope.sessions.create({ workspaceId: workspace.workspaceId })
            scope.sessions.open(createdSessionId)
          } catch (error: unknown) {
            await git.removeWorktree(resolved.path, created.value.path, { force: true })
            return { ok: false, error: { code: 'internal', message: `workspace registration failed: ${String(error)}` } }
          }
          return { ok: true, path: created.value.path, branch: created.value.branch, name: created.value.name }
        },
        removeWorktree: async (sessionId, worktreePath, opts) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return { ok: false, error: resolved.error }
          const removed = await git.removeWorktree(resolved.path, worktreePath, opts)
          if (!removed.ok) return { ok: false, error: removed.error }
          // Unregister the linked workspace after the disk removal succeeds,
          // so a rejection never orphans the registration.
          const linked = scope.workspaces.list.getSnapshot().items.find(item => item.path === worktreePath)
          if (linked !== undefined) {
            await scope.workspaces.delete(linked.workspaceId)
          }
          return { ok: true }
        },
        gitConfig: async () => {
          const result = await git.config()
          return result.ok ? result.value : null
        },
        subscribeChanges: (sessionId, onChange) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return () => {}
          return subscribeChanges(resolved.path, onChange)
        },
      }
    }

    // The entry shape shared by both seats; each register call spells the
    // seat's literal name so its own declaration is checked.
    const chipEntry = { id: 'git-graph', order: 100, locale: NS, inject: injected } as const

    // Declaration-aware with a fallback. A bare register() would throw on
    // shells that dropped the hole (SDK SlotCore.register rejects undeclared
    // slots), so both seats route through inject like the pet / remote-web-ui
    // entries. The preferred context wait resolves the moment the shell
    // declares the hole; when it never does (rc.6 and the current shipped
    // shell), the fallback disposes that wait and uses the dock only for the
    // blank-session hero phase. Exactly one seat mounts: a context declaration
    // landing after the fallback finds the wait gone.
    let mounted = false
    const disposeContextWait = scope.slots.inject('conversation.input.selector.context', () => {
      mounted = true
      try {
        return scope.slots.register(
          { name: 'conversation.input.selector.context', ...chipEntry },
          BranchChip)
      } catch {
        return () => {}
      }
    })
    fallbackTimer = setTimeout(() => {
      if (mounted) return
      disposeContextWait()
      scope.slots.inject('conversation.input.dock', () => {
        try {
          return scope.slots.register(
            { name: 'conversation.input.dock', ...chipEntry },
            BranchChip)
        } catch {
          return () => {}
        }
      })
    }, CONTEXT_FALLBACK_MS)
  })
}
