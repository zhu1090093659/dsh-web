/**
 * The git branch selector chip for blank sessions. It mounts in the selector
 * context hole (`conversation.input.selector.context`) beside the official
 * workspace selector. On shells that dropped the hole, it uses
 * `conversation.input.dock` only for the blank-session hero phase and lifts
 * itself into the official hero chip row. It is intentionally absent while a
 * session is running.
 * @module dsh-git-graph/client/chips/BranchChip
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BranchesView, RepoStatus } from '../../core/types.ts'
import type { GitGraphInjected } from '../index.ts'
import { Chip, cx } from './Chip.tsx'
import { BranchPopover } from './BranchPopover.tsx'
import { CreateBranchDialog } from './CreateBranchDialog.tsx'
import { CreateWorktreeDialog } from './CreateWorktreeDialog.tsx'
import { WorktreeManager } from '../worktrees/WorktreeManager.tsx'
import { GraphDialog } from '../graph/GraphDialog.tsx'
import css from './context.module.css'

/** Full props of the branch chip: either seat's runtime share (the session-maybe context hole or the dock fallback's blank-session hero) + the git-graph inject face + the locale seat. */
export type BranchChipProps =
  (PropsRuntime<'conversation.input.selector.context'> | PropsRuntime<'conversation.input.dock'>)
  & GitGraphInjected
  & PropsLocale<'git-graph'>

/** Minimum gap between window-focus git refetches (ms). */
export const FOCUS_REFRESH_MIN_MS = 5_000

const SKIN_CENTER_BODY_ATTR = 'data-dsh-skin-center'
const DARK_THEME_BODY_ATTR = 'data-ds-dark-theme'
const DSH_BODY_ATTR_PREFIX = 'data-dsh-'

/** Whether a body attribute belongs to an applied skin rather than the skin center shell. */
function hasAppliedSkinBodyAttr(name: string): boolean {
  return name.startsWith(DSH_BODY_ATTR_PREFIX) && name !== SKIN_CENTER_BODY_ATTR
}

/** Whether the page is using the unskinned stock light theme. */
function readStockLightTheme(): boolean {
  if (typeof document === 'undefined') return false
  const body = document.body
  if (!body.hasAttribute(SKIN_CENTER_BODY_ATTR) || body.hasAttribute(DARK_THEME_BODY_ATTR)) return false
  return !body.getAttributeNames().some(hasAppliedSkinBodyAttr)
}

/** Track stock-light theme changes from body attributes. */
function useStockLightTheme(): boolean {
  const [stockLightTheme, setStockLightTheme] = useState(readStockLightTheme)

  useEffect(() => {
    const update = (): void => { setStockLightTheme(readStockLightTheme()) }
    update()
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return undefined
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true })
    return () => { observer.disconnect() }
  }, [])

  return stockLightTheme
}

function isConnectedElement(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement && node.isConnected
}

/**
 * Resolve the hero workspace row element that the branch chip should join
 * during the blank-session hero phase.
 */
function findHeroRow(anchor: HTMLElement | null): HTMLElement | null {
  if (anchor === null || !anchor.isConnected) return null
  const outlet = anchor.parentElement
  if (outlet === null) return null
  // 1. Direct previous sibling (the official hero row in ConversationRoot)
  const prev = outlet.previousElementSibling as HTMLElement | null
  if (prev !== null && isConnectedElement(prev) && prev.className.includes('heroWorkspaceRow')) {
    return prev
  }
  // 2. Query inside the composerStack parent
  const stack = outlet.closest('[class*="composerStack"], [class*="composerHero"]')
  const rowInStack = stack?.querySelector('[class*="heroWorkspaceRow"]') as HTMLElement | null
  if (rowInStack !== null && isConnectedElement(rowInStack)) return rowInStack

  // 3. Fallback to any heroWorkspaceRow in the document
  if (typeof document !== 'undefined') {
    const docRow = document.querySelector('[class*="heroWorkspaceRow"]') as HTMLElement | null
    if (docRow !== null && isConnectedElement(docRow)) return docRow
  }
  return null
}

/**
 * The git branch selector chip for blank sessions.
 * @param props - the composed entry props of whichever seat it mounted in.
 */
export function BranchChip(props: BranchChipProps) {
  const sessionId = props.sessionId
  // Blank-session flag from the standard session list. The selector never
  // throws for a missing session id / row, so the hook can stay mounted
  // while the session baseline is still loading.
  const blankSession = props.useSessions((state): boolean => {
    if (sessionId === undefined) return false
    const sessions = state as { byId?: Record<string, { blank?: boolean }> }
    return sessions.byId?.[sessionId]?.blank === true
  })
  // The dock seat carries the composer snapshot. It exposes the selector
  // only in the blank hero phase; the session-maybe context seat uses the
  // session baseline's blank flag instead.
  const dockSeat = 'session' in props && 'input' in props
  const sessionSnapshot = dockSeat ? props.session : undefined
  // 0.1.2 cohort: the composer phase machine is gone from the snapshot; the
  // blank empty-log mirror plus open state covers the same show-selector seat.
  const heroSeat = sessionSnapshot?.blank === true && (sessionSnapshot.openState === 'open' || blankSession === true)
  const showBranchSelector = dockSeat ? heroSeat : blankSession
  const stockLightTheme = useStockLightTheme()

  /** Repository state: undefined = loading, null = not a repository, else the snapshot. */
  const [repo, setRepo] = useState<RepoStatus | null | undefined>(undefined)
  /** Fresh branch list, fetched when the branch popover opens. */
  const [branchesView, setBranchesView] = useState<BranchesView | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [worktreeCreateOpen, setWorktreeCreateOpen] = useState(false)
  const [worktreeManageOpen, setWorktreeManageOpen] = useState(false)
  const [heroRow, setHeroRow] = useState<HTMLElement | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  // Hero-phase placement: the rc.6 shell renders the dock as its own row
  // between the official hero chip row and the composer card. In the blank
  // hero phase, the chip portals directly into that hero row to sit
  // immediately after the agent-preset seat, matching the official row gap,
  // tokens, and alignment without manual pixel measurement.
  useLayoutEffect(() => {
    if (!heroSeat || repo === undefined || repo === null) {
      setHeroRow(null)
      return undefined
    }
    const update = (): void => {
      const found = findHeroRow(anchorRef.current)
      setHeroRow(prev => (prev === found ? prev : found))
    }
    update()
    const parent = anchorRef.current?.parentElement
    if (parent === null || parent === undefined || typeof MutationObserver === 'undefined') return undefined
    const observer = new MutationObserver(update)
    observer.observe(parent.parentElement ?? parent, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [heroSeat, repo !== undefined && repo !== null])

  const refetch = useCallback(() => {
    let live = true
    props.repoStatus(sessionId)
      .then((status) => { if (live) setRepo(status) })
      .catch(() => { if (live) setRepo(null) })
    return () => { live = false }
  }, [props.repoStatus, sessionId])

  // Blank-session data stays fresh through the initial load, host-pushed
  // changes, and a throttled focus refresh. Active sessions never subscribe
  // or start a Git status round trip.
  const lastFocusRefetch = useRef(0)
  useEffect(() => {
    if (!showBranchSelector) return undefined
    return refetch()
  }, [showBranchSelector, refetch])
  useEffect(() => {
    if (!showBranchSelector) return undefined
    const unsubscribe = props.subscribeChanges(sessionId, () => { refetch() })
    const onFocus = (): void => {
      const now = Date.now()
      if (now - lastFocusRefetch.current < FOCUS_REFRESH_MIN_MS) return
      lastFocusRefetch.current = now
      refetch()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [showBranchSelector, props.subscribeChanges, sessionId, refetch])

  const closeCreate = (): void => {
    setCreateOpen(false)
    refetch()
  }

  // Fetch the fresh branch list each time the popover opens. All hooks stay
  // above the data-gated returns so the hook order is stable while `repo`
  // settles from undefined (loading) to a snapshot.
  useEffect(() => {
    if (!showBranchSelector || !branchOpen) return undefined
    let live = true
    setBranchesView(null)
    props.branches(sessionId).then((view) => { if (live) setBranchesView(view) })
    return () => { live = false }
  }, [showBranchSelector, branchOpen, props.branches, sessionId])

  // Active sessions intentionally expose no branch-selection control. Loading
  // and non-repository workspaces likewise render no dead control.
  if (!showBranchSelector || repo === undefined || repo === null) return null

  const openBranchPopover = (): void => {
    setBranchOpen(open => !open)
  }

  const chipNode = (
    <div
      data-gitgraph-chip-anchor
      data-dsh-plugin="git-graph"
      data-dsh-part="chip"
      data-gitgraph-stock-light={stockLightTheme || undefined}
      className={cx(css.anchor, heroSeat && css.anchorHero)}
    >
      <div className={css.chipWrap}>
        <Chip
          hero={heroSeat}
          icon={<IconBranchOutline16 size={14} />}
          label={repo.branch === '' ? props.t('branch.detached') : repo.branch}
          ariaLabel={props.t('chip.aria.branch')}
          open={branchOpen}
          onClick={openBranchPopover}
        />
        {branchOpen && branchesView !== null && (
          <BranchPopover
            hero={heroSeat}
            view={branchesView}
            onSwitch={(branch) => props.switchBranch(sessionId, branch)}
            onSwitched={refetch}
            onCreate={() => {
              setBranchOpen(false)
              setCreateOpen(true)
            }}
            onGraph={() => {
              setBranchOpen(false)
              setGraphOpen(true)
            }}
            onCreateWorktree={() => {
              setBranchOpen(false)
              setWorktreeCreateOpen(true)
            }}
            onManageWorktrees={() => {
              setBranchOpen(false)
              setWorktreeManageOpen(true)
            }}
            onClose={() => { setBranchOpen(false) }}
            t={props.t}
          />
        )}
      </div>
      {createOpen && (
        <CreateBranchDialog
          onCreate={(name) => props.createBranch(sessionId, name)}
          onClose={closeCreate}
          t={props.t}
        />
      )}
      {graphOpen && (
        <GraphDialog
          graph={(limit) => props.graph(sessionId, limit)}
          onClose={() => { setGraphOpen(false) }}
          t={props.t}
        />
      )}
      {worktreeCreateOpen && branchesView !== null && (
        <CreateWorktreeDialog
          branches={branchesView.branches}
          currentBranch={branchesView.branch}
          onCreate={(name, baseRef) => props.createWorktreeSession(sessionId, name, baseRef)}
          onClose={() => {
            setWorktreeCreateOpen(false)
            refetch()
          }}
          t={props.t}
        />
      )}
      {worktreeManageOpen && (
        <WorktreeManager
          fetchWorktrees={() => props.worktrees(sessionId)}
          onRemove={(worktreePath, opts) => props.removeWorktree(sessionId, worktreePath, opts)}
          onClose={() => { setWorktreeManageOpen(false) }}
          t={props.t}
        />
      )}
    </div>
  )

  if (heroSeat) {
    return (
      <>
        <div ref={anchorRef} style={{ display: 'none' }} />
        {heroRow !== null && isConnectedElement(heroRow) ? createPortal(chipNode, heroRow) : chipNode}
      </>
    )
  }

  return (
    <div ref={anchorRef} style={{ display: 'contents' }}>
      {chipNode}
    </div>
  )
}
