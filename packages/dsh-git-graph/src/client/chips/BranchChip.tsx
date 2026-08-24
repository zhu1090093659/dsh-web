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
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BranchesView, RepoStatus } from '../../core/types.ts'
import type { GitGraphInjected } from '../index.ts'
import { Chip, cx } from './Chip.tsx'
import { BranchPopover } from './BranchPopover.tsx'
import { CreateBranchDialog } from './CreateBranchDialog.tsx'
import { GraphDialog } from '../graph/GraphDialog.tsx'
import css from './context.module.css'

/** Full props of the branch chip: either seat's runtime share (the session-maybe context hole or the dock fallback's blank-session hero) + the git-graph inject face + the locale seat. */
export type BranchChipProps =
  (PropsRuntime<'conversation.input.selector.context'> | PropsRuntime<'conversation.input.dock'>)
  & GitGraphInjected
  & PropsLocale<'git-graph'>

/** Horizontal gap between the official hero-row chips (WorkspaceChip / AgentPresetSeat). */
const HERO_CHIP_GAP = 2

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

/**
 * The right edge of the rightmost painted chip of `root`, excluding `root`
 * itself. The hero row's direct children can be display:contents slot
 * outlets, so the visible chip boundary must be found by walking. Only
 * interactive chips (button / role=button / role=switch) are measured by
 * default: the official seats' outlet wrappers and label spans can be laid
 * out wider than what they actually paint (invisible measurement padding),
 * which used to push this chip past the agent-preset seat instead of hugging
 * it with the official row gap. Falls back to the full walk for shells that
 * render non-button chips.
 */
function paintedRight(root: Element): number | null {
  let right: number | null = null
  const consider = (node: Element): void => {
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      right = right === null ? rect.right : Math.max(right, rect.right)
    }
  }
  root.querySelectorAll('button, [role="button"], [role="switch"]').forEach((el) => {
    if (el !== root) consider(el)
  })
  if (right !== null) return right
  const visit = (node: Element): void => {
    if (node !== root) consider(node)
    for (const child of Array.from(node.children)) visit(child)
  }
  visit(root)
  return right
}

/**
 * Coalesce repeated placement updates into one animation-frame callback so
 * observer bursts in the same frame measure only once. When the environment
 * provides no requestAnimationFrame, updates run synchronously instead.
 */
function frameScheduler(update: () => void): { schedule: () => void, cancel: () => void } {
  let pending = false
  let frame: number | null = null
  const flush = (): void => {
    pending = false
    frame = null
    update()
  }
  return {
    schedule: () => {
      if (pending) return
      pending = true
      if (typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(flush)
      } else {
        flush()
      }
    },
    cancel: () => {
      pending = false
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
    },
  }
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
  const heroSeat = sessionSnapshot?.composerPhase === 'blank' && (sessionSnapshot.openState === 'open' || blankSession === true)
  const showBranchSelector = dockSeat ? heroSeat : blankSession
  const stockLightTheme = useStockLightTheme()

  /** Repository state: undefined = loading, null = not a repository, else the snapshot. */
  const [repo, setRepo] = useState<RepoStatus | null | undefined>(undefined)
  /** Fresh branch list, fetched when the branch popover opens. */
  const [branchesView, setBranchesView] = useState<BranchesView | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  /** Measured hero-row placement (relative to the composer stack); null until measured. */
  const [heroPlacement, setHeroPlacement] = useState<{ left: number, top: number } | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  // Hero-phase placement: the rc.6 shell renders the dock as its own row
  // between the official hero chip row and the composer card. The chip is
  // instead lifted into that hero row, immediately after its rightmost
  // painted chip (the agent-preset seat — "梁神模式"), by anchoring to the
  // composer stack and matching the official row gap. The slot outlet uses
  // display:contents, so the anchor's outlet parent is the boundary between
  // the hero row (previous element sibling) and the composer card below.
  useLayoutEffect(() => {
    if (!heroSeat) return
    const anchor = anchorRef.current
    const outlet = anchor?.parentElement ?? null
    const stack = outlet?.parentElement ?? null
    const heroRow = outlet?.previousElementSibling ?? null
    if (anchor === null || outlet === null || stack === null || heroRow === null) return
    const measure = (): void => {
      const stackRect = stack.getBoundingClientRect()
      const rowRect = heroRow.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()
      if (stackRect.width <= 0 || rowRect.width <= 0 || anchorRect.width <= 0) return
      const right = paintedRight(heroRow)
      if (right === null) return
      const left = Math.max(0, right - stackRect.left + HERO_CHIP_GAP)
      const top = Math.max(0, rowRect.top - stackRect.top + (rowRect.height - anchorRect.height) / 2)
      setHeroPlacement(previous => {
        if (previous !== null && Math.abs(previous.left - left) < 0.5 && Math.abs(previous.top - top) < 0.5) return previous
        return { left, top }
      })
    }
    const scheduler = frameScheduler(measure)
    scheduler.schedule()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduler.schedule)
    for (const target of [anchor, outlet, stack, heroRow]) observer?.observe(target)
    window.addEventListener('resize', scheduler.schedule)
    return () => {
      scheduler.cancel()
      observer?.disconnect()
      window.removeEventListener('resize', scheduler.schedule)
    }
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

  return (
    <div
      ref={anchorRef}
      data-gitgraph-chip-anchor
      data-dsh-plugin="git-graph"
      data-dsh-part="chip"
      data-gitgraph-stock-light={stockLightTheme || undefined}
      className={cx(css.anchor, heroSeat && css.anchorHero)}
      style={heroSeat && heroPlacement !== null
        ? { left: `${heroPlacement.left}px`, top: `${heroPlacement.top}px`, paddingLeft: 0 }
        : undefined}
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
    </div>
  )
}
