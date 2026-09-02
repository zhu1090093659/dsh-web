/**
 * The 会话归档管理 first-level settings section: full inventory list with
 * filters/search/sort, cross-result multi-select, batch archive/unarchive/
 * physical delete with progress and per-session reasons, session preview,
 * and the automatic-maintenance settings panel.
 * @module @linxin666/dsh-session-archive/client/SessionArchiveCard
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionArchiveConfig } from '../core/config.ts'
import {
  AUTO_ARCHIVE_DAYS_MAX,
  AUTO_ARCHIVE_DAYS_MIN,
  AUTO_DELETE_DAYS_MAX,
  AUTO_DELETE_DAYS_MIN,
  validateDays,
} from '../core/config.ts'
import type { ArchiveSessionRow } from '../core/types.ts'
import { filterRows, PAGE_SIZE, selectionSummary, sortRows, type SortDir, type SortKey } from '../core/selection.ts'
import type { ArchiveController } from './archive-controller.ts'
import { formatBytes, formatTime, BatchDialog, DeleteConfirmDialog, PreviewDialog } from './dialogs.tsx'
import { AutoSettingsPanel } from './AutoSettings.tsx'
import { Select } from './Select.tsx'
import { t } from './locales.ts'
import styles from './archive.module.css'

/** The registration-side face the section's slot entry injects. */
export interface SessionArchiveFace {
  controller: ArchiveController
  settings: SettingsScope<SessionArchiveConfig>
}

export interface SessionArchiveProps extends SessionArchiveFace {
  /** Close the settings panel (the shell owns the open state). */
  close: () => void
}

/** Row status chips: the conjunction of running/blank/archived facts. */
function statusChips(row: ArchiveSessionRow, currentId: string | undefined): { key: string; label: string; tone: string }[] {
  const chips: { key: string; label: string; tone: string }[] = []
  if (row.running) chips.push({ key: 'running', label: t('arch.status.running'), tone: styles.chipWarn })
  else if (row.blank) chips.push({ key: 'blank', label: t('arch.status.blank'), tone: styles.chipNeutral })
  else chips.push({ key: 'active', label: t('arch.status.active'), tone: styles.chipSuccess })
  if (row.archived) chips.push({ key: 'archived', label: t('arch.status.archived'), tone: styles.chipBusiness })
  if (row.origin === 'subagent') chips.push({ key: 'subagent', label: t('arch.status.subagent'), tone: styles.chipNeutral })
  if (currentId !== undefined && row.id === currentId) chips.push({ key: 'current', label: t('arch.current.badge'), tone: styles.chipDanger })
  return chips
}

function issueLabels(row: ArchiveSessionRow): string[] {
  return row.issues.map((issue) => t(`arch.issue.${issue}`))
}

export function SessionArchiveCard(props: SessionArchiveProps): ReactNode {
  const { controller } = props
  const ui = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)
  const [currentId, setCurrentId] = useState<string | undefined>(undefined)

  useEffect(() => {
    void controller.load()
    setCurrentId(controller.getCurrentSessionId())
  }, [controller])

  const rows = ui.inventory?.rows ?? []
  const workspaces = ui.inventory?.workspaces ?? []
  const filtered = useMemo(
    () => sortRows(filterRows(rows, ui.filter), ui.sortKey, ui.sortDir),
    [rows, ui.filter, ui.sortKey, ui.sortDir],
  )
  const selection = useMemo(() => new Set(ui.selection), [ui.selection])
  const summary = selectionSummary(selection, filtered)
  // Pagination is a render window only: the filtered set (and therefore
  // select-all) always spans the complete result, never just this page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(ui.page, totalPages - 1)
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const busy = ui.batch !== null && ui.batch.running

  const workspaceTitle = (id: string): string => workspaces.find((workspace) => workspace.id === id)?.title ?? id

  const onSelectAll = (): void => {
    controller.store.actions.selectMany(filtered.map((row) => row.id), true)
  }

  const runBatch = (kind: 'archive' | 'unarchive'): void => {
    void controller.runBatch(kind, ui.selection)
  }
  const requestDelete = (ids: string[]): void => {
    void controller.confirmDelete(ids)
  }

  return (
    <div className={styles.root} data-dsh-plugin="session-archive">
      <div className={styles.header} data-dsh-part="header">
        <div className={styles.headerTitle}>
          <span className={styles.title}>{t('arch.title')}</span>
          <span className={styles.count}>{t('arch.results.count', { n: filtered.length })}</span>
        </div>
        <button type="button" className={styles.button} disabled={ui.status === 'loading'} onClick={() => { void controller.load() }}>
          {ui.status === 'loading' ? t('arch.refreshing') : t('arch.refresh')}
        </button>
      </div>

      {ui.status === 'error' && (
        <div className={styles.errorBanner}>
          <span>{t('arch.error', { error: ui.error ?? '' })}</span>
          <button type="button" className={styles.button} onClick={() => { void controller.load() }}>{t('arch.retry')}</button>
        </div>
      )}

      <div className={styles.toolbar} data-dsh-part="toolbar">
        <div className={styles.tabs} role="tablist">
          {(['all', 'active', 'archived'] as const).map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={ui.filter.status === status}
              className={`${styles.tab} ${ui.filter.status === status ? styles.tabActive : ''}`}
              onClick={() => { controller.store.actions.setFilter({ status }) }}
            >
              {t(`arch.filter.${status}`)}
            </button>
          ))}
        </div>
        <Select
          value={ui.filter.workspaceId}
          ariaLabel={t('arch.filter.workspace')}
          options={[
            { value: 'any', label: t('arch.filter.workspace.any') },
            { value: 'none', label: t('arch.filter.workspace.none') },
            ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.title })),
          ]}
          onChange={(value) => { controller.store.actions.setFilter({ workspaceId: value }) }}
        />
        <input
          type="search"
          className={styles.search}
          placeholder={t('arch.filter.search')}
          value={ui.filter.query}
          onChange={(event) => { controller.store.actions.setFilter({ query: event.target.value }) }}
        />
        <Select
          value={`${ui.sortKey}:${ui.sortDir}`}
          ariaLabel={t('arch.sort')}
          options={(['lastActivity', 'archivedAt', 'createdAt', 'title', 'size'] as const).flatMap((key) => [
            { value: `${key}:desc`, label: t('arch.sort.desc'), group: t(`arch.sort.${key}`) },
            { value: `${key}:asc`, label: t('arch.sort.asc'), group: t(`arch.sort.${key}`) },
          ])}
          onChange={(value) => {
            const [key, dir] = value.split(':') as [SortKey, SortDir]
            controller.store.actions.setSort(key, dir)
          }}
        />
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={ui.filter.issuesOnly}
            onChange={(event) => { controller.store.actions.setFilter({ issuesOnly: event.target.checked }) }}
          />
          <span>{t('arch.filter.issues')}</span>
        </label>
      </div>

      <div className={styles.selectionBar} data-dsh-part="selection-bar">
        <button type="button" className={styles.button} onClick={onSelectAll}>{t('arch.select.all')}</button>
        <button type="button" className={styles.button} onClick={() => { controller.store.actions.clearSelection() }} disabled={selection.size === 0}>
          {t('arch.select.clear')}
        </button>
        <span className={styles.selectedCount}>{t('arch.select.selected', { n: selection.size })}</span>
        {summary.outside > 0 && (
          <span className={styles.holdNote}>{t('arch.select.holdNote', { selected: summary.selected, outside: summary.outside })}</span>
        )}
        <span className={styles.batchActions}>
          <button type="button" className={styles.button} disabled={selection.size === 0 || busy} onClick={() => { runBatch('archive') }}>
            {t('arch.batch.archive')}
          </button>
          <button type="button" className={styles.button} disabled={selection.size === 0 || busy} onClick={() => { runBatch('unarchive') }}>
            {t('arch.batch.unarchive')}
          </button>
          <button type="button" className={styles.dangerButton} disabled={selection.size === 0 || busy} onClick={() => { requestDelete(ui.selection) }}>
            {t('arch.batch.delete')}
          </button>
        </span>
      </div>

      <div className={styles.list} data-dsh-part="list">
        {filtered.length === 0 && <div className={styles.empty}>{t('arch.empty')}</div>}
        {shown.map((row) => {          const chips = statusChips(row, currentId)
          const issues = issueLabels(row)
          const selected = selection.has(row.id)
          return (
            <div key={row.id} className={`${styles.row} ${selected ? styles.rowSelected : ''}`} data-dsh-part="row">
              <input
                type="checkbox"
                aria-label={row.title ?? row.id}
                checked={selected}
                onChange={(event) => { controller.store.actions.toggleRow(row.id, event.target.checked) }}
              />
              <div className={styles.rowMain}>
                <div className={styles.rowTitleLine}>
                  <span className={styles.rowTitle}>{row.title ?? t('arch.row.noTitle')}</span>
                  {chips.map((chip) => (
                    <span key={chip.key} className={`${styles.chip} ${chip.tone}`}>{chip.label}</span>
                  ))}
                  {row.childCount > 0 && <span className={`${styles.chip} ${styles.chipNeutral}`}>{t('arch.row.children', { n: row.childCount })}</span>}
                </div>
                <div className={styles.rowMeta}>
                  <code className={styles.rowId}>{row.id}</code>
                  {row.workspaceIds.length > 0
                    ? <span>{row.workspaceIds.map(workspaceTitle).join(' · ')}</span>
                    : <span className={styles.muted}>{t('arch.filter.workspace.none')}</span>}
                  <span>{row.lastActivityAt === undefined ? t('arch.row.lastActivity.unknown') : t('arch.row.lastActivity', { time: formatTime(row.lastActivityAt) })}</span>
                  {row.archived && <span>{row.archivedAt === undefined ? t('arch.row.archivedAt.unknown') : t('arch.row.archivedAt', { time: formatTime(row.archivedAt) })}</span>}
                  {row.sizeBytes !== undefined && <span>{t('arch.row.size', { size: formatBytes(row.sizeBytes) })}</span>}
                  {issues.length > 0 && <span className={styles.issueText}>{issues.join(' · ')}</span>}
                </div>
              </div>
              <div className={styles.rowActions}>
                <button type="button" className={styles.linkButton} onClick={() => { void controller.openPreview(row.id) }}>{t('arch.op.preview')}</button>
                {!row.archived && (
                  <button type="button" className={styles.linkButton} disabled={busy} onClick={() => { void controller.runBatch('archive', [row.id]) }}>
                    {t('arch.op.archive')}
                  </button>
                )}
                {row.archived && (
                  <button type="button" className={styles.linkButton} disabled={busy} onClick={() => { void controller.runBatch('unarchive', [row.id]) }}>
                    {t('arch.op.unarchive')}
                  </button>
                )}
                <button type="button" className={`${styles.linkButton} ${styles.linkDanger}`} disabled={busy} onClick={() => { requestDelete([row.id]) }}>
                  {t('arch.op.delete')}
                </button>
              </div>
            </div>
          )
        })}
        {filtered.length > 0 && (
          <div className={styles.moreRow} data-dsh-part="pagination">
            <button
              type="button"
              className={styles.button}
              disabled={page === 0}
              onClick={() => { controller.store.actions.setPage(page - 1) }}
            >
              {t('arch.page.prev')}
            </button>
            <span className={styles.muted}>{t('arch.page.info', { page: page + 1, pages: totalPages, n: filtered.length })}</span>
            <button
              type="button"
              className={styles.button}
              disabled={page >= totalPages - 1}
              onClick={() => { controller.store.actions.setPage(page + 1) }}
            >
              {t('arch.page.next')}
            </button>
          </div>
        )}
      </div>

      <AutoSettingsPanel settings={props.settings} controller={controller} auto={ui.inventory?.auto} />

      {ui.confirmDelete !== null && (        <DeleteConfirmDialog
          state={ui.confirmDelete}
          onConfirm={() => { void controller.runBatch('delete', ui.confirmDelete?.ids ?? []) }}
          onCancel={() => { controller.store.actions.setConfirmDelete(null) }}
        />
      )}
      {ui.batch !== null && (
        <BatchDialog
          batch={ui.batch}
          onClose={() => { controller.store.actions.closeBatch() }}
          onRetryFailed={() => { void controller.retryFailed() }}
        />
      )}
      {ui.preview !== null && (
        <PreviewDialog
          preview={ui.preview}
          onClose={() => { controller.store.actions.setPreview(null) }}
          onRetry={() => { void controller.openPreview(ui.preview?.id ?? '') }}
        />
      )}
    </div>
  )
}
