/**
 * Git-graph surface plugin, browser half: the git branch selector chip in
 * the input selector row's context hole (`conversation.input.selector
 * .context`, a session-maybe list slot declared and rendered by the shipped
 * ui-conversation shell), docked right beside the official workspace
 * selector above the input card. All git facts arrive through the host
 * /git routes (this package's own host half); the inject face carries the
 * business verbs, the components stay pure props.
 *
 * The context hole is session-maybe: the chip stays mounted from cold start
 * through the active phase and hides itself when its data source is absent
 * (no session cwd, or not a git repository) — no workspace selector lives
 * here, the official selector chip docked above the input card owns that
 * surface. An earlier revision (acbcf80) moved the chip to
 * `conversation.input.dock` on the wrong premise that the selector-context
 * hole was undeclared; the running shell declares it, so the chip registers
 * here to sit in the same row as the workspace chip. The published npm SDK
 * (rc.6) dropped the hole's type, so it is spelled locally below.
 * @module dsh-git-graph/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the conversation
// slots); the selector-context hole is spelled locally below because the
// published npm SDK (rc.6) dropped it while the running shell still renders it.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BranchesView, GitError, GraphView, RepoStatus, SwitchResult,
} from '../core/types.ts'
import { GitApi, subscribeChanges } from './api.ts'
import { BranchChip } from './chips/BranchChip.tsx'
import { en, zh, type GitGraphKey } from './locales.ts'

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
     * Session-maybe: entries stay mounted without a session and hide
     * themselves when their data source is absent.
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

/** Required services: slots for the selector-context entry, sessions for the cwd lookup, locale for the copy. */
export const inject = ['slots', 'sessions', 'connection', 'locale']

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
  /** Host-pushed branch-state changes for the session's workspace. */
  subscribeChanges: (sessionId: SessionId | undefined, onChange: () => void) => () => void
}

/** The session-cwd lookup failure shared by the injected verbs. */
const NO_WORKSPACE: GitError = { code: 'workspace-unknown', message: 'session has no workspace' }

/**
 * Client plugin body: the selector-context entry with its git verbs.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git-graph: dictionaries')

  const git = new GitApi()

  // Conditional mount: 'conversation.input.selector.context' is declared by
  // the shipped ui-conversation entry (the InputSelectorRow context hole);
  // the conversation service being up is the registration-safe signal (the
  // GoalDock/QueueDock seam).
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
        subscribeChanges: (sessionId, onChange) => {
          const resolved = pathOf(sessionId)
          if (!resolved.ok) return () => {}
          return subscribeChanges(resolved.path, onChange)
        },
      }
    }

    // Declaration-aware: the chip registers only when the shell declares the
    // selector-context hole. A bare register() would throw on shells that
    // dropped the hole (SDK SlotCore.register rejects undeclared slots), so
    // route through inject like the pet / remote-web-ui entries.
    scope.slots.inject('conversation.input.selector.context', () =>
      scope.slots.register({
        name: 'conversation.input.selector.context',
        id: 'git-graph',
        order: 100,
        locale: NS,
        inject: injected,
      }, BranchChip))
  })
}
