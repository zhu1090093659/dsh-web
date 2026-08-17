/**
 * The Changes (SCM) panel: per-repo working-tree status grouped into staged /
 * unstaged / untracked, with stage/unstage/discard actions on every row and
 * bulk actions in the section header. The host status is the only truth — no
 * optimistic rows; a failed batch surfaces its paths and the next refresh
 * clears the flag. Discard confirms with copy split by recoverability
 * (untracked = delete vs tracked = irreversible restore).
 *
 * AionUi ScmPanel behavior (Apache-2.0, re-implemented): window focus
 * refreshes (external editors write without git events), unknown states
 * render as a quiet '?', conflicted rows are visually distinct AND have no
 * actions.
 * @module dsh-aionui-panel/client/components/ScmPanel
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitChangeRow, GitStatusView } from '../../core/types.ts'
import { t, format } from '../locales.ts'
import { useStore } from '../hooks/useStore.ts'
import { scmRowKey, type PanelStores } from '../store.ts'
import { ConfirmDialog } from './overlay.tsx'
import { activateOnKey } from './a11y.ts'
import { FileTypeIcon } from './FileIcon.tsx'
import { BranchIcon, ChevronDownIcon, ChevronRightIcon, ListIcon, MinusIcon, PlusIcon, TreeIcon, UndoIcon } from './icons.tsx'
import scmCss from '../styles/scm.module.css'

/** Minimum gap between window-focus SCM refreshes (ms). */
const FOCUS_REFRESH_MIN_MS = 5_000

/** Badge letter + color class per state. */
const BADGE: Record<string, { letter: string; className: string }> = {
  created: { letter: 'A', className: scmCss.badgeCreated },
  modified: { letter: 'M', className: scmCss.badgeModified },
  deleted: { letter: 'D', className: scmCss.badgeDeleted },
  renamed: { letter: 'R', className: scmCss.badgeCreated },
  conflicted: { letter: '!', className: scmCss.badgeConflicted },
  untracked: { letter: '?', className: scmCss.badgeUntracked },
  unknown: { letter: '?', className: scmCss.badgeUntracked },
}

/** The parent dir of a path ('' for root-level). */
function dirOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : ''
}

/** Build a display-only directory tree from rows. */
function buildTree(rows: GitChangeRow[]): Map<string, GitChangeRow[]> {
  const byDir = new Map<string, GitChangeRow[]>()
  for (const row of rows) {
    const dir = dirOf(row.path)
    const list = byDir.get(dir)
    if (list === undefined) byDir.set(dir, [row])
    else list.push(row)
  }
  return byDir
}

/** Last path segment of a repository root, separator-agnostic. */
function repositoryName(root: string): string {
  const parts = root.replaceAll('\\', '/').replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || root
}

/** The SCM tab body.
 * @param stores - the panel store bundle.
 */
export function ScmPanel({ stores }: { stores: PanelStores }): JSX.Element {
  const scm = stores.scm
  const preview = stores.preview
  const state = useStore(scm)
  const [discardTargets, setDiscardTargets] = useState<{ repository: string; rows: GitChangeRow[] } | null>(null)

  // Window focus refreshes (catches external editors writing the tree).
  // Throttled: a focus burst must not spawn a git status per event — the
  // fs watch (host) and the 30s host poll already cover the steady state.
  // -Infinity so the first focus after mount always fires (production
  // Date.now() is enormous anyway; the sentinel makes the throttle explicit
  // and testable at clock 0).
  const lastFocusRefresh = useRef(-Infinity)
  useEffect(() => {
    const onFocus = (): void => {
      const now = Date.now()
      if (now - lastFocusRefresh.current < FOCUS_REFRESH_MIN_MS) return
      lastFocusRefresh.current = now
      void scm.refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [scm])

  const requestDiscard = (repository: string, rows: GitChangeRow[]): void => {
    if (rows.length === 0) return
    setDiscardTargets({ repository, rows })
  }
  const confirmDiscard = (): void => {
    if (discardTargets === null) return
    void scm.discard(discardTargets.repository, discardTargets.rows.map((row) => row.path))
    setDiscardTargets(null)
  }

  if (state.loading && state.repositories.length === 0) {
    return <div className={`aionui-root ${scmCss.panel}`}><div className={scmCss.loading}>{t('scm.loading')}</div></div>
  }
  if (state.gitMissing) {
    return <div className={`aionui-root ${scmCss.panel}`}><div className={scmCss.notRepo}>{t('scm.gitMissing')}</div></div>
  }
  if (state.repositories.length === 0) {
    return <div className={`aionui-root ${scmCss.panel}`}><div className={scmCss.notRepo}>{t('scm.notRepo')}</div></div>
  }

  const allUntracked = discardTargets !== null && discardTargets.rows.every((row) => row.state === 'untracked')

  return (
    <div className={`aionui-root ${scmCss.panel}`}>
      {state.repositories.map((status) => (
        <RepositorySection
          key={status.root}
          status={status}
          stores={stores}
          onDiscard={(rows) => requestDiscard(status.root, rows)}
        />
      ))}

      {discardTargets !== null && (
        <ConfirmDialog
          title={t('scm.discard')}
          body={allUntracked
            ? format(t('scm.discardConfirmUntracked'), { count: discardTargets.rows.length })
            : format(t('scm.discardConfirmTracked'), { count: discardTargets.rows.length })}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={confirmDiscard}
          onCancel={() => setDiscardTargets(null)}
        />
      )}
    </div>
  )
}

/** One independent repository and its staged/worktree groups. */
function RepositorySection({
  status,
  stores,
  onDiscard,
}: {
  status: GitStatusView
  stores: PanelStores
  onDiscard: (rows: GitChangeRow[]) => void
}): JSX.Element {
  const scm = stores.scm
  const state = useStore(scm)
  const sectionId = `repository:${status.root}`
  const open = state.sectionCollapsed[sectionId] !== true
  const staged = status.staged
  const unstaged = status.unstaged
  const untracked = status.untracked
  const hasChanges = staged.length + unstaged.length + untracked.length > 0
  const toggle = (): void => { scm.setSectionCollapsed(sectionId, open) }

  return (
    <div className={scmCss.section}>
      <div
        className={scmCss.sectionHeader}
        onClick={toggle}
        onKeyDown={activateOnKey(toggle)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={status.root}
      >
        <span className={`${scmCss.sectionChevron}${open ? ` ${scmCss.sectionChevronOpen}` : ''}`}>
          <ChevronRightIcon size={13} />
        </span>
        <span className={scmCss.sectionTitle}>{repositoryName(status.root)}</span>
        {status.branch !== '' && (
          <span className={scmCss.branchName}>
            <BranchIcon size={12} />
            {status.branch}
          </span>
        )}
        <span className={scmCss.sectionActions} onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={scmCss.sectionAction}
            title={t('scm.stageAll')}
            onClick={() => void scm.stage(status.root, [...unstaged, ...untracked].map((row) => row.path))}
            disabled={unstaged.length + untracked.length === 0}
          >
            <PlusIcon size={13} />
          </button>
          <button
            type="button"
            className={scmCss.sectionAction}
            title={t('scm.discardAll')}
            onClick={() => onDiscard([...unstaged, ...untracked])}
            disabled={unstaged.length + untracked.length === 0}
          >
            <UndoIcon size={13} />
          </button>
          <button
            type="button"
            className={scmCss.sectionAction}
            title={t('scm.viewList')}
            style={{ color: state.viewMode === 'list' ? 'var(--aion-brand)' : undefined }}
            onClick={() => scm.setViewMode('list')}
          >
            <ListIcon size={13} />
          </button>
          <button
            type="button"
            className={scmCss.sectionAction}
            title={t('scm.viewTree')}
            style={{ color: state.viewMode === 'tree' ? 'var(--aion-brand)' : undefined }}
            onClick={() => scm.setViewMode('tree')}
          >
            <TreeIcon size={13} />
          </button>
        </span>
      </div>
      {open && (
        <div className={scmCss.sectionBody}>
          {!hasChanges && <div className={scmCss.empty}>{t('scm.empty')}</div>}
          {staged.length > 0 && (
            <Group
              repository={status.root}
              scm={scm}
              preview={stores.preview}
              title={t('scm.staged')}
              rows={staged}
              bulkLabel={t('scm.unstage')}
              onBulk={(rows) => void scm.unstage(status.root, rows.map((row) => row.path))}
              onDiscard={onDiscard}
            />
          )}
          {unstaged.length > 0 && (
            <Group
              repository={status.root}
              scm={scm}
              preview={stores.preview}
              rows={unstaged}
              bulkLabel={t('scm.stage')}
              onBulk={(rows) => void scm.stage(status.root, rows.map((row) => row.path))}
              onDiscard={onDiscard}
            />
          )}
          {untracked.length > 0 && (
            <Group
              repository={status.root}
              scm={scm}
              preview={stores.preview}
              title={t('scm.untracked')}
              rows={untracked}
              bulkLabel={t('scm.stage')}
              onBulk={(rows) => void scm.stage(status.root, rows.map((row) => row.path))}
              onDiscard={onDiscard}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** One change group (staged / unstaged / untracked) with list or tree body. */
function Group({
  repository,
  scm,
  preview,
  rows,
  title,
  bulkLabel,
  onBulk,
  onDiscard,
}: {
  repository: string
  scm: PanelStores['scm']
  preview: PanelStores['preview']
  rows: GitChangeRow[]
  title?: string
  bulkLabel: string
  onBulk: (rows: GitChangeRow[]) => void
  onDiscard: (rows: GitChangeRow[]) => void
}): JSX.Element {
  const state = useStore(scm)
  const tree = useMemo(() => buildTree(rows), [rows])
  const viewTree = state.viewMode === 'tree'
  const allActionable = rows.filter((row) => row.state !== 'conflicted')
  // O(1) lookups for row rendering: an includes() per row per array is
  // O(rows x ops) on every batch operation.
  const busySet = useMemo(() => new Set(state.busy), [state.busy])
  const failedSet = useMemo(() => new Set(state.failed), [state.failed])
  const expandedSet = useMemo(() => new Set(state.treeExpanded), [state.treeExpanded])

  return (
    <div>
      {title !== undefined && (
        <div className={scmCss.groupTitle}>
          {title}
          <button
            type="button"
            className={scmCss.groupAction}
            title={bulkLabel}
            onClick={() => onBulk(allActionable)}
            disabled={allActionable.length === 0}
          >
            {bulkLabel === t('scm.unstage') ? <MinusIcon size={12} /> : <PlusIcon size={12} />}
          </button>
        </div>
      )}
      {viewTree ? (
        [...tree.entries()].map(([dir, dirRows]) => (
          <DirNode
            key={dir === '' ? '\u0000' : dir}
            dir={dir}
            rows={dirRows}
            depth={0}
            state={state}
            repository={repository}
            expandedSet={expandedSet}
            busySet={busySet}
            failedSet={failedSet}
            scm={scm}
            preview={preview}
            onDiscard={onDiscard}
          />
        ))
      ) : (
        rows.map((row) => (
          <ChangeRow
            key={`${row.staged ? 's' : 'u'}:${row.path}`}
            row={row}
            repository={repository}
            state={state}
            busy={busySet.has(scmRowKey(repository, row.path))}
            failed={failedSet.has(scmRowKey(repository, row.path))}
            scm={scm}
            preview={preview}
            onDiscard={onDiscard}
          />
        ))
      )}
    </div>
  )
}

/** Tree-view directory node (expandable). */
function DirNode({
  repository,
  dir,
  rows,
  depth,
  state,
  expandedSet,
  busySet,
  failedSet,
  scm,
  preview,
  onDiscard,
}: {
  repository: string
  dir: string
  rows: GitChangeRow[]
  depth: number
  state: ReturnType<PanelStores['scm']['getSnapshot']>
  expandedSet: ReadonlySet<string>
  busySet: ReadonlySet<string>
  failedSet: ReadonlySet<string>
  scm: PanelStores['scm']
  preview: PanelStores['preview']
  onDiscard: (rows: GitChangeRow[]) => void
}): JSX.Element {
  const expanded = expandedSet.has(dir)
  const label = dir === '' ? '/' : dir.split('/').pop() ?? dir
  const toggleExpanded = (): void => {
    const next = expanded
      ? state.treeExpanded.filter((item) => item !== dir)
      : [...state.treeExpanded, dir]
    scm.setTreeExpanded(next)
  }
  return (
    <>
      <div
        className={scmCss.dirRow}
        style={{ paddingLeft: 12 + depth * 12 }}
        title={dir}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggleExpanded}
        onKeyDown={activateOnKey(toggleExpanded)}
      >
        <span className={`${scmCss.dirArrow}${expanded ? ` ${scmCss.dirArrowOpen}` : ''}`}>
          <ChevronRightIcon size={13} />
        </span>
        <FileTypeIcon name={label} isDir expanded={expanded} />
        <span style={{ fontSize: 13, color: 'var(--aion-text-primary)' }}>{label}</span>
      </div>
      {expanded &&
        rows.map((row) => (
          <ChangeRow
            key={`${row.staged ? 's' : 'u'}:${row.path}`}
            row={row}
            repository={repository}
            state={state}
            busy={busySet.has(scmRowKey(repository, row.path))}
            failed={failedSet.has(scmRowKey(repository, row.path))}
            scm={scm}
            preview={preview}
            onDiscard={onDiscard}
            indent={depth + 1}
            hideDir
          />
        ))}
    </>
  )
}

/** One change row: badge + name + dimmed dir + hover actions.
 * Clicking the row opens the path's diff in the preview panel (every state
 * has a diff — deleted rows show the removal, untracked rows a new-file diff).
 */
function ChangeRow({
  repository,
  row,
  state,
  busy,
  failed,
  scm,
  preview,
  onDiscard,
  indent = 0,
  hideDir = false,
}: {
  repository: string
  row: GitChangeRow
  state: ReturnType<PanelStores['scm']['getSnapshot']>
  busy: boolean
  failed: boolean
  scm: PanelStores['scm']
  preview: PanelStores['preview']
  onDiscard: (rows: GitChangeRow[]) => void
  indent?: number
  hideDir?: boolean
}): JSX.Element {
  const badge = BADGE[row.state] ?? BADGE.unknown
  const conflicted = row.state === 'conflicted'
  const displayName = row.oldPath !== undefined ? `${row.oldPath.split('/').pop()} -> ${row.path.split('/').pop()}` : (row.path.split('/').pop() ?? row.path)
  const dir = dirOf(row.path)

  const openInPreview = (): void => {
    scm.select(repository, row.path)
    // Staged rows diff the index against HEAD; unstaged rows the worktree
    // against the index — the side the row was listed under.
    preview.openDiff(state.root, row.path, row.staged, repository)
  }

  return (
    <div
      className={`${scmCss.changeRow}${state.selected === scmRowKey(repository, row.path) ? ` ${scmCss.changeRowSelected}` : ''}${failed ? ` ${scmCss.rowFailed}` : ''}`}
      style={{ paddingLeft: 12 + indent * 12 }}
      title={row.path}
      onClick={openInPreview}
      onKeyDown={activateOnKey(openInPreview)}
      role="button"
      tabIndex={0}
    >
      <span className={`${scmCss.badge} ${badge.className}`}>{badge.letter}</span>
      <span className={scmCss.changeName}>{displayName}</span>
      {!hideDir && dir !== '' && <span className={scmCss.changeDir}>{dir}</span>}
      <span className={`${scmCss.rowActions}${busy || failed ? ` ${scmCss.rowActionsVisible}` : ''}`}>
        {conflicted ? null : row.staged ? (
          <>
            <button
              type="button"
              className={scmCss.rowAction}
              title={t('scm.unstage')}
              disabled={busy}
              onClick={(event) => { event.stopPropagation(); void scm.unstage(repository, [row.path]) }}
            >
              <MinusIcon size={13} />
            </button>
            <button
              type="button"
              className={scmCss.rowAction}
              title={t('scm.discard')}
              disabled={busy}
              onClick={(event) => { event.stopPropagation(); onDiscard([row]) }}
            >
              <UndoIcon size={13} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={scmCss.rowAction}
              title={t('scm.stage')}
              disabled={busy}
              onClick={(event) => { event.stopPropagation(); void scm.stage(repository, [row.path]) }}
            >
              <PlusIcon size={13} />
            </button>
            <button
              type="button"
              className={scmCss.rowAction}
              title={t('scm.discard')}
              disabled={busy}
              onClick={(event) => { event.stopPropagation(); onDiscard([row]) }}
            >
              <UndoIcon size={13} />
            </button>
          </>
        )}
      </span>
    </div>
  )
}
