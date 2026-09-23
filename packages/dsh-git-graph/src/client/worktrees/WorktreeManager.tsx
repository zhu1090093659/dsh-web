/**
 * The worktree manager dialog: every linked worktree of the repository with
 * its branch/head, plus removal of managed worktrees. Dirty worktrees reject
 * once and surface an inline force-confirm; the wt/ branch survives removal
 * unless the row's delete-branch checkbox is on. The primary checkout row is
 * display-only.
 * @module dsh-git-graph/client/worktrees/WorktreeManager
 */

import { useCallback, useEffect, useState } from 'react'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { WORKTREE_BRANCH_PREFIX } from '../../core/git-command.ts'
import type { WorktreeInfo, WorktreeListView, WorktreeRemoveResult } from '../../core/types.ts'
import type { GitGraphKey } from '../locales.ts'
import { errorMessage } from '../chips/error-copy.ts'
import { Backdrop, cx } from '../chips/Chip.tsx'
import css from '../chips/context.module.css'

/** Props of the worktree manager dialog. */
export interface WorktreeManagerProps {
  /** Fetch the fresh worktree list. */
  fetchWorktrees: () => Promise<WorktreeListView | null>
  /** Remove one managed worktree (force/deleteBranch options ride through). */
  onRemove: (worktreePath: string, opts: { force?: boolean; deleteBranch?: boolean }) => Promise<WorktreeRemoveResult>
  /** Close the dialog. */
  onClose: () => void
  t: Translate<GitGraphKey>
}

/**
 * The worktree manager dialog.
 * @param props - see {@link WorktreeManagerProps}.
 */
export function WorktreeManager({ fetchWorktrees, onRemove, onClose, t }: WorktreeManagerProps) {
  const [view, setView] = useState<WorktreeListView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Row awaiting an inline force-confirm after a worktree-dirty rejection. */
  const [forcePath, setForcePath] = useState<string | null>(null)
  /** Rows whose wt/ branch should be deleted together with the worktree. */
  const [branchDelete, setBranchDelete] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<string | null>(null)

  const reload = useCallback(() => {
    let live = true
    setLoading(true)
    void fetchWorktrees().then((fresh) => {
      if (!live) return
      setView(fresh)
      setLoading(false)
    })
    return () => { live = false }
  }, [fetchWorktrees])

  useEffect(() => reload(), [reload])

  const remove = (item: WorktreeInfo, force: boolean): void => {
    if (pending !== null) return
    setPending(item.path)
    setError(null)
    void onRemove(item.path, { force, deleteBranch: branchDelete.has(item.path) }).then((result) => {
      if (result.ok) {
        setForcePath(null)
        reload()
        return
      }
      if (result.error.code === 'worktree-dirty' && !force) {
        setForcePath(item.path)
        return
      }
      setError(errorMessage(result.error, t))
    }).finally(() => { setPending(null) })
  }

  const toggleBranchDelete = (path: string): void => {
    setBranchDelete((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const rows = view?.worktrees ?? []

  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={css.dialog} role="dialog" aria-label={t('worktree.manager.title')} data-gitgraph-worktree-manager>
        <h3 className={css.dialogTitle}>{t('worktree.manager.title')}</h3>
        <div className={css.managerList}>
          {loading && <div className={css.graphEmpty}>{t('worktree.manager.loading')}</div>}
          {!loading && rows.length <= 1 && <div className={css.graphEmpty}>{t('worktree.manager.empty')}</div>}
          {!loading && rows.map(item => (
            <div key={item.path} className={css.managerRow} data-main={item.main || undefined}>
              <div className={css.managerInfo}>
                <div className={css.managerHeadline}>
                  <IconBranchOutlineRegular size={13} />
                  <span className={css.managerBranch}>
                    {item.branch === '' ? t('worktree.manager.detached') : item.branch}
                  </span>
                  {item.main && <span className={css.managerBadge}>{t('worktree.manager.main')}</span>}
                  <span className={css.managerOid}>{item.head.slice(0, 7)}</span>
                </div>
                <div className={css.managerPath} title={item.path}>{item.path}</div>
                {forcePath === item.path && (
                  <div className={css.managerConfirm}>
                    <span>{t('worktree.manager.forceConfirm')}</span>
                    <button
                      type="button"
                      className={css.dialogButton}
                      disabled={pending !== null}
                      onClick={() => { remove(item, true) }}
                    >
                      {t('worktree.manager.forceYes')}
                    </button>
                  </div>
                )}
              </div>
              {!item.main && (
                <div className={css.managerActions}>
                  {item.branch.startsWith(WORKTREE_BRANCH_PREFIX) && (
                    <label className={css.managerCheck}>
                      <input
                        type="checkbox"
                        checked={branchDelete.has(item.path)}
                        onChange={() => { toggleBranchDelete(item.path) }}
                      />
                      {t('worktree.manager.deleteBranch')}
                    </label>
                  )}
                  <button
                    type="button"
                    className={css.dialogButton}
                    disabled={pending !== null}
                    onClick={() => { remove(item, false) }}
                  >
                    {t('worktree.manager.remove')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {error !== null && <div className={css.dialogError}>{error}</div>}
        <div className={css.dialogActions}>
          <button type="button" className={cx(css.dialogButton)} onClick={onClose}>
            {t('worktree.manager.close')}
          </button>
        </div>
      </div>
    </>
  )
}