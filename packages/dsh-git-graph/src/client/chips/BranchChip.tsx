/**
 * The floating overlay entry: the git branch selector chip, mounted in the
 * composer's floating overlay anchor (`conversation.input.overlay`, a
 * session-scoped list slot) and floating above the composer card's top edge,
 * left-aligned with the input text. The seat is session-scoped, so the chip
 * mounts once a session is active and hides itself only when its data source
 * is absent (no session cwd, or not a git repository).
 * @module dsh-git-graph/client/chips/BranchChip
 */

import { useCallback, useEffect, useState } from 'react'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BranchesView, RepoStatus } from '../../core/types.ts'
import type { GitGraphInjected } from '../index.ts'
import { Chip } from './Chip.tsx'
import { BranchPopover } from './BranchPopover.tsx'
import { CreateBranchDialog } from './CreateBranchDialog.tsx'
import { GraphDialog } from '../graph/GraphDialog.tsx'
import css from './context.module.css'

/** Full props of the branch chip: the overlay anchor's runtime share (empty owner) + the git-graph inject face + the locale seat. */
export type BranchChipProps =
  PropsRuntime<'conversation.input.overlay'>
  & GitGraphInjected
  & PropsLocale<'git-graph'>

/**
 * The git branch selector chip.
 * @param props - the composed overlay entry props.
 */
export function BranchChip(props: BranchChipProps) {
  /** Repository state: undefined = loading, null = not a repository, else the snapshot. */
  const [repo, setRepo] = useState<RepoStatus | null | undefined>(undefined)
  /** Fresh branch list, fetched when the branch popover opens. */
  const [branchesView, setBranchesView] = useState<BranchesView | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)

  const refetch = useCallback(() => {
    let live = true
    props.repoStatus(props.sessionId)
      .then((status) => { if (live) setRepo(status) })
      .catch(() => { if (live) setRepo(null) })
    return () => { live = false }
  }, [props.repoStatus, props.sessionId])

  // Initial load + host-pushed external changes + focus refresh. A session
  // switch changes props.sessionId and re-fetches through the session-keyed
  // verbs.
  useEffect(() => refetch(), [refetch])
  useEffect(() => {
    const unsubscribe = props.subscribeChanges(props.sessionId, () => { refetch() })
    const onFocus = (): void => { refetch() }
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [props.subscribeChanges, props.sessionId, refetch])

  const closeCreate = (): void => {
    setCreateOpen(false)
    refetch()
  }

  // Fetch the fresh branch list each time the popover opens. All hooks stay
  // above the data-gated returns so the hook order is stable while `repo`
  // settles from undefined (loading) to a snapshot.
  useEffect(() => {
    if (!branchOpen) return
    let live = true
    setBranchesView(null)
    props.branches(props.sessionId).then((view) => { if (live) setBranchesView(view) })
    return () => { live = false }
  }, [branchOpen, props.branches, props.sessionId])

  // Loading or not a repository: no chip (no dead control). A workspace that
  // becomes a repository appears on the next refresh.
  if (repo === undefined || repo === null) return null

  const openBranchPopover = (): void => {
    setBranchOpen(open => !open)
  }

  return (
    <div className={css.anchor}>
      <Chip
        icon={<IconBranchOutline16 size={14} />}
        label={repo.branch === '' ? props.t('branch.detached') : repo.branch}
        ariaLabel={props.t('chip.aria.branch')}
        open={branchOpen}
        onClick={openBranchPopover}
      />
      {branchOpen && branchesView !== null && (
        <BranchPopover
          view={branchesView}
          onSwitch={(branch) => props.switchBranch(props.sessionId, branch)}
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
      {createOpen && (
        <CreateBranchDialog
          onCreate={(name) => props.createBranch(props.sessionId, name)}
          onClose={closeCreate}
          t={props.t}
        />
      )}
      {graphOpen && (
        <GraphDialog
          graph={(limit) => props.graph(props.sessionId, limit)}
          onClose={() => { setGraphOpen(false) }}
          t={props.t}
        />
      )}
    </div>
  )
}
