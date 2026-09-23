/**
 * The branch picker popover: searchable local branch list with the current
 * branch checked, the dirtiness line, switch feedback (success/error), and
 * the footer flows (create branch / Git graph).
 * @module dsh-git-graph/client/chips/BranchPopover
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { IconBranchOutlineRegular, IconCheckOutlineMedium, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { BranchesView, SwitchResult } from '../../core/types.ts'
import type { GitGraphKey } from '../locales.ts'
import { errorMessage } from './error-copy.ts'
import { cx, Backdrop } from './Chip.tsx'
import css from './context.module.css'

/** Props of the branch picker popover. */
export interface BranchPopoverProps {
  view: BranchesView
  /** Workspace-level switch verb; resolves to a stable git error on rejection. */
  onSwitch: (branch: string) => Promise<SwitchResult>
  /** Fired after a successful switch (the owner refetches its status). */
  onSwitched: () => void
  /** Open the create-branch dialog. */
  onCreate: () => void
  /** Open the Git graph panel. */
  onGraph: () => void
  /** Open the create-worktree (new isolated session) dialog. */
  onCreateWorktree: () => void
  /** Open the worktree manager. */
  onManageWorktrees: () => void
  /** Close the popover (backdrop / after a successful switch). */
  onClose: () => void
  t: Translate<GitGraphKey>
  /** Open downward from the official hero row (the default opens upward from the dock row). */
  hero?: boolean
}

/** How long the success notice stays before the popover closes itself. */
const SUCCESS_DISMISS_MS = 900

/**
 * The branch picker popover.
 * @param props - see {@link BranchPopoverProps}.
 */
export function BranchPopover({ view, onSwitch, onSwitched, onCreate, onGraph, onCreateWorktree, onManageWorktrees, onClose, t, hero = false }: BranchPopoverProps) {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Tooltip state for long branch names: first hover needs a 500ms dwell,
  // once shown, switching items shows immediately; leaving resets the dwell.
  const [tipReadyName, setTipReadyName] = useState<string | null>(null)
  const [tipActive, setTipActive] = useState(false)
  const [tipDir, setTipDir] = useState<'up' | 'down'>('up')
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    if (dismissTimer.current !== undefined) clearTimeout(dismissTimer.current)
    if (tipTimer.current !== undefined) clearTimeout(tipTimer.current)
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return view.branches
    return view.branches.filter(branch => branch.name.toLowerCase().includes(needle))
  }, [view.branches, query])

  const switchTo = (branch: string): void => {
    if (pending !== null) return
    setPending(branch)
    setError(null)
    setSuccess(null)
    void onSwitch(branch).then((result) => {
      if (result.ok) {
        onSwitched()
        setSuccess(t('toast.switchSuccess', { branchName: result.branch }))
        dismissTimer.current = setTimeout(onClose, SUCCESS_DISMISS_MS)
        return
      }
      setError(errorMessage(result.error, t))
    }).finally(() => { setPending(null) })
  }

  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={cx(css.popover, hero && css.popoverHero)} role="listbox" aria-label={t('branch.search')} data-gitgraph-popover>
        <div className={css.searchBox}>
          <IconSearchOutlineRegular size={14} />
          <input
            className={css.searchInput}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            placeholder={t('branch.search')}
            autoFocus
          />
        </div>
        {view.dirtyFiles > 0
          && <div className={css.dirty}>{t('branch.dirty', { count: view.dirtyFiles })}</div>}
        <div
          className={css.list}
          onMouseLeave={() => {
            // Leaving the whole list resets the instant-handoff state, so
            // moving between items keeps the bubble immediate while leaving
            // the popover re-arms the dwell threshold.
            if (tipTimer.current !== undefined) {
              clearTimeout(tipTimer.current)
              tipTimer.current = undefined
            }
            setTipActive(false)
            setTipReadyName(null)
          }}
        >
          {filtered.length === 0
            ? <div className={css.empty}>{t('branch.empty')}</div>
            : filtered.map(branch => (
              <button
                type="button"
                key={branch.name}
                className={cx(css.item, branch.current && css.itemActive)}
                onClick={() => { switchTo(branch.name) }}
                role="option"
                aria-selected={branch.current}
                data-tip={branch.name.length > 18 ? branch.name : ''}
                data-tip-ready={branch.name === tipReadyName ? 'true' : ''}
                aria-label={branch.name}
                data-tip-dir={tipDir}
                onMouseEnter={(event) => {
                  if (tipTimer.current !== undefined) clearTimeout(tipTimer.current)
                  // Viewport-aware flip: near the top of the scroll list the
                  // bubble would be clipped above — flip it below instead.
                  const list = event.currentTarget.parentElement
                  if (list !== null) {
                    const itemTop = event.currentTarget.getBoundingClientRect().top
                    const listTop = list.getBoundingClientRect().top
                    setTipDir(itemTop - listTop < 56 ? 'down' : 'up')
                  }
                  if (tipActive) {
                    setTipReadyName(branch.name)
                  } else {
                    tipTimer.current = setTimeout(() => {
                      setTipActive(true)
                      setTipReadyName(branch.name)
                    }, 500)
                  }
                }}
                disabled={pending !== null}
              >
                <IconBranchOutlineRegular size={14} />
                <span className={css.itemText}>
                  <span className={css.itemName} title={branch.name}>{branch.name}</span>
                </span>
                {branch.current && <IconCheckOutlineMedium className={css.check} size={14} />}
              </button>
            ))}
        </div>
        {success !== null && <div className={cx(css.notice, css.noticeOk)}>{success}</div>}
        {error !== null && <div className={css.notice}>{error}</div>}
        <div className={css.footer}>
          <button type="button" className={css.footerItem} onClick={onCreate}>
            <IconBranchOutlineRegular size={14} />
            {t('branch.create')}
          </button>
          <button type="button" className={css.footerItem} onClick={onGraph}>
            <IconBranchOutlineRegular size={14} />
            {t('branch.graph')}
          </button>
          <button type="button" className={css.footerItem} onClick={onCreateWorktree} data-dsh-part="worktree-create">
            <IconBranchOutlineRegular size={14} />
            {t('worktree.create')}
          </button>
          <button type="button" className={css.footerItem} onClick={onManageWorktrees} data-dsh-part="worktree-manage">
            <IconBranchOutlineRegular size={14} />
            {t('worktree.manage')}
          </button>
        </div>
      </div>
    </>
  )
}
