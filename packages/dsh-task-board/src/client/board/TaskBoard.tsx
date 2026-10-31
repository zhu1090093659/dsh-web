/**
 * Board view: the multi-column kanban that replaces the middle column while
 * active. Cards open the task detail (never execute directly); the header
 * offers filter, new-task, and a back-to-chat escape.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { selectedTaskOf, type BoardController } from '../../core/controller.ts'
import { COLUMNS, MANUAL_STATUSES, canMoveTask, collectKnownTags, hasOpenExecution, tagTone, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { IconChevronLeft, IconCompactRows, IconExpandRows, IconPlus } from './icons.tsx'
import { NewTaskModal } from './NewTaskModal.tsx'
import { usePresence } from './overlay.tsx'
import { STATUS_KEY } from './status-key.ts'
import { TagManagerModal } from './TagManagerModal.tsx'
import { cardTimeline, groupByRecency, readCompactColumns, RECENCY_KEY, writeCompactColumns, type RecencyGroup } from './card-view.ts'
import { TaskCard } from './TaskCard.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { groupTasksBySource, isSourceGroupFolded, readSourceGroupFolds, sourceGroupFoldKey, writeSourceGroupFolds, type SourceGroupView } from './source-group.ts'

/** Sentinel option value of the project row's "register a new project" entry. */
export const NEW_PROJECT_VALUE = '__dsh_new_project__'

/**
 * Collect every string leaf of an opaque extension payload. The board does not
 * interpret provider data, but a provider's identifiers and labels should stay
 * searchable from the board's own filter, so the leaf strings join the haystack.
 */
function collectSearchLeaves(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchLeaves(item, out)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) collectSearchLeaves(nested, out)
  }
}

/**
 * Case-insensitive title/description/tag/freeze-snapshot/provider-payload match.
 *
 * A leading `#` is dropped from the needle. Providers render their own
 * identifiers with that prefix (`#1758`) and the board attaches no meaning to
 * it: stripping it keeps the identifier searchable exactly as it is written on
 * screen, without the board learning any provider's vocabulary.
 */
export function matchesFilter(task: TaskRecord, filter: string): boolean {
  const query = filter.trim().toLowerCase()
  if (query === '') return true
  const needle = query.startsWith('#') ? query.slice(1) : query
  const haystacks = [task.title, task.description, ...(task.tags ?? []).map(tag => tag.name)]
  if (task.freeze !== undefined) haystacks.push(task.freeze.goal, task.freeze.progress, task.freeze.next)
  if (task.integrations !== undefined) {
    const leaves: string[] = []
    collectSearchLeaves(task.integrations, leaves)
    haystacks.push(...leaves)
  }
  return haystacks.some(text => text.toLowerCase().includes(needle))
}

/**
 * Whether a task carries every selected label (issue #1521). Multi-select is
 * conjunctive: adding a label narrows the board instead of widening it, which
 * is the only reading that keeps "工作" selected from dragging unrelated cards
 * back in when a second label is added.
 */
export function matchesTagFilter(task: TaskRecord, selected: readonly string[]): boolean {
  if (selected.length === 0) return true
  const names = new Set((task.tags ?? []).map(tag => tag.name))
  return selected.every(name => names.has(name))
}

/**
 * Memoized per-card adapter: with a stable `onOpen` from the board and an
 * immutable task record (only the changed card gets a new object ref), a card
 * re-renders only when its own task changes — not when a sibling card status,
 * the filter, or the selection moves.
 */
const MemoTaskCard = memo(function MemoTaskCard({ task, pending, timeZone, onOpen, onOpenSession, compact, subtaskCount, isSubtask, subtasksDone, subtasksRunning, subtasksFailed }: {
  task: TaskRecord
  pending: boolean
  timeZone?: string
  onOpen: (id: string) => void
  onOpenSession: (sessionId: string) => void
  compact: boolean
  subtaskCount: number
  isSubtask: boolean
  subtasksDone: number
  subtasksRunning: number
  subtasksFailed: number
}) {
  const onClick = useCallback(() => { onOpen(task.id) }, [task.id, onOpen])
  return (
    <TaskCard
      task={task}
      pending={pending}
      timeZone={timeZone}
      onClick={onClick}
      onOpenSession={onOpenSession}
      compact={compact}
      subtaskCount={subtaskCount}
      isSubtask={isSubtask}
      subtasksDone={subtasksDone}
      subtasksRunning={subtasksRunning}
      subtasksFailed={subtasksFailed}
    />
  )
})

/** Settled columns whose cards group by recency and fold the oldest group. */
const GROUPED_COLUMNS: readonly TaskStatus[] = ['done', 'failed']

/** Cards a grouped column renders before the oldest group folds. */
export const COLUMN_FOLD_THRESHOLD = 30

/** Column key of the archive view in the fold-open set. */
const ARCHIVE_COLUMN = 'archived'

/** Board component; subscribes to the controller snapshot. */
export function TaskBoard({ controller }: { controller: BoardController }) {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot())
  useEffect(
    () => controller.subscribe(() => setSnapshot(controller.getSnapshot())),
    [controller],
  )
  const [filter, setFilter] = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  // Subtask cards are real board cards, but a tree with dozens of children
  // turns a column into a wall: the board starts from the parent cards only and
  // the header switch reveals the flat view. A text or label filter re-enables
  // them automatically, so searching a subtask title still finds it.
  const [hideSubtasks, setHideSubtasks] = useState(true)
  // Density is a per-column browser preference: the long settled column starts
  // compact, and each column header toggles its own density.
  const [compactColumns, setCompactColumns] = useState<TaskStatus[]>(() => readCompactColumns(globalThis.localStorage))
  // Source-group fold overrides persist per browser; done starts folded.
  const [sourceFolds, setSourceFolds] = useState(() => readSourceGroupFolds(globalThis.localStorage))
  // Grouped columns whose folded "earlier" group the user expanded this visit.
  const [unfolded, setUnfolded] = useState<string[]>([])
  const [showNew, setShowNew] = useState(false)
  const [showTagManager, setShowTagManager] = useState(false)
  // Project partition (#1536): '' means "all projects". A selected project
  // narrows the board and becomes the new-task form's default workspace.
  const [projectId, setProjectId] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectPath, setNewProjectPath] = useState('')
  const [newProjectError, setNewProjectError] = useState<string | undefined>(undefined)
  const [newProjectPending, setNewProjectPending] = useState(false)
  const selected = selectedTaskOf(snapshot)
  const archiveView = snapshot.archiveView
  // Overlay lifecycle: both the detail view and the create dialog keep the
  // last thing they showed while their exit leg runs, so closing one is the
  // return trip of opening it instead of a node disappearing from under the
  // pointer. The detail view's task is remembered so the surface still has its
  // content to animate out after the selection is cleared.
  const detailPresence = usePresence(selected !== undefined)
  const lastDetail = useRef<TaskRecord | undefined>(undefined)
  useEffect(() => { if (selected !== undefined) lastDetail.current = selected }, [selected])
  const detailTask = selected ?? lastDetail.current
  const newTaskPresence = usePresence(showNew)
  const tagManagerPresence = usePresence(showTagManager)
  // Every label in use across the ledger (board and archive alike), so the
  // filter never loses an option just because its task was archived.
  const knownTags = collectKnownTags(snapshot.tasks)
  // The family of cards this view owns: the board columns, or the archive. A
  // provider-hidden card (board hidden flag, or any registered visibility
  // predicate rejecting it) never appears here.
  const onBoard = snapshot.tasks.filter(task => {
    if (task.hidden === true) return false
    if (!(snapshot.visibility ?? []).every(predicate => predicate(task))) return false
    return archiveView ? task.archivedAt !== undefined : task.archivedAt === undefined
  })
  // Direct subtask count and state roll-up per task, for the card badge: a
  // hidden tree still has to report how many children run, fail, or finish.
  const subtaskCounts = new Map<string, number>()
  const subtaskRollup = new Map<string, { done: number; running: number; failed: number }>()
  for (const task of onBoard) {
    if (task.parentId === undefined) continue
    subtaskCounts.set(task.parentId, (subtaskCounts.get(task.parentId) ?? 0) + 1)
    const rollup = subtaskRollup.get(task.parentId) ?? { done: 0, running: 0, failed: 0 }
    // "Running" in the badge means the runner is executing that subtask; a
    // subtask parked in the running column by hand is not executing anything.
    if (hasOpenExecution(task)) rollup.running += 1
    else if (task.status === 'done') rollup.done += 1
    else if (task.status === 'failed') rollup.failed += 1
    subtaskRollup.set(task.parentId, rollup)
  }
  const hasSubtasks = subtaskCounts.size > 0
  const searchActive = filter.trim() !== '' || tagFilter.length > 0
  const hidingSubtasks = hideSubtasks && !searchActive
  const visible = onBoard.filter(task =>
    (projectId === '' || task.workspaceId === projectId)
    && (!hidingSubtasks || task.parentId === undefined)
    && matchesFilter(task, filter)
    && matchesTagFilter(task, tagFilter),
  )
  const projects = snapshot.executionOptions.workspaces
  const canCreateProject = snapshot.canCreateWorkspace === true
  const submitNewProject = async (): Promise<void> => {
    const path = newProjectPath.trim()
    if (path === '') return
    setNewProjectPending(true)
    setNewProjectError(undefined)
    try {
      const created = await controller.createWorkspace(path)
      setProjectId(created.workspaceId)
      setShowNewProject(false)
      setNewProjectPath('')
    } catch (error) {
      setNewProjectError(error instanceof Error ? error.message : String(error))
    } finally {
      setNewProjectPending(false)
    }
  }
  const toggleTag = useCallback((name: string): void => {
    setTagFilter(current => current.includes(name)
      ? current.filter(entry => entry !== name)
      : [...current, name])
  }, [])
  const openTask = useCallback((id: string): void => { controller.openTask(id) }, [controller])
  const openSession = useCallback((sessionId: string): void => { controller.openSession(sessionId) }, [controller])
  const toggleCompact = useCallback((status: TaskStatus): void => {
    setCompactColumns(current => {
      const next = current.includes(status) ? current.filter(entry => entry !== status) : [...current, status]
      writeCompactColumns(globalThis.localStorage, next)
      return next
    })
  }, [])
  const timeZone = snapshot.host?.scheduler.timeZone
  const now = Date.now()
  const renderCard = (task: TaskRecord, compact: boolean) => (
    <MemoTaskCard
      key={task.id}
      task={task}
      pending={snapshot.pendingTaskIds.includes(task.id)}
      timeZone={timeZone}
      onOpen={openTask}
      onOpenSession={openSession}
      compact={compact}
      subtaskCount={subtaskCounts.get(task.id) ?? 0}
      isSubtask={task.parentId !== undefined}
      subtasksDone={subtaskRollup.get(task.id)?.done ?? 0}
      subtasksRunning={subtaskRollup.get(task.id)?.running ?? 0}
      subtasksFailed={subtaskRollup.get(task.id)?.failed ?? 0}
    />
  )
  /**
   * Recency groups nested inside one source group. The fold key includes the
   * source, so expanding one repository's earlier cards opens no other group's.
   */
  const renderRecencyGroups = (foldScope: string, tasks: TaskRecord[], compact: boolean, archived: boolean) => {
    const buckets = groupByRecency(tasks, task => cardTimeline(task, archived).at, now, timeZone)
    const foldable = !searchActive && tasks.length > COLUMN_FOLD_THRESHOLD && buckets.length > 1
    const open = unfolded.includes(foldScope)
    return buckets.map(bucket => {
      const folded = foldable && bucket.group === buckets[buckets.length - 1]!.group && !open
      return (
        <div key={bucket.group} className={css.cardGroup} data-dsh-part="card-group" data-group={bucket.group}>
          <div className={css.cardGroupHeader}>
            <span>{t(RECENCY_KEY[bucket.group as RecencyGroup])}</span>
            <span className={css.cardGroupCount}>{bucket.items.length}</span>
            {foldable && bucket.group === buckets[buckets.length - 1]!.group && (
              <button
                type="button"
                className={css.linkButton}
                data-dsh-part="card-group-toggle"
                aria-expanded={!folded}
                onClick={() => {
                  setUnfolded(current => current.includes(foldScope) ? current.filter(entry => entry !== foldScope) : [...current, foldScope])
                }}
              >
                {folded ? t('board.group.expand', { count: String(bucket.items.length) }) : t('board.group.collapse')}
              </button>
            )}
          </div>
          {!folded && bucket.items.map(task => renderCard(task, compact))}
        </div>
      )
    })
  }

  /** Every column and the archive first split by provider-owned source. */
  const renderSourceGroups = (view: SourceGroupView, tasks: TaskRecord[], compact: boolean, archived: boolean) => {
    const recency = archived || GROUPED_COLUMNS.includes(view as TaskStatus)
    return groupTasksBySource(tasks, snapshot.grouping ?? []).map(bucket => {
      const foldKey = sourceGroupFoldKey(view, bucket.id)
      const folded = isSourceGroupFolded(sourceFolds, view, bucket.id, searchActive)
      const label = bucket.local ? t('board.source.local') : bucket.label
      return (
        <div key={bucket.id} className={`${css.cardGroup} ${css.sourceGroup}`} data-dsh-part="card-group">
          <div className={`${css.cardGroupHeader} ${css.sourceGroupHeader}`}>
            <span className={css.sourceGroupLabel}>{label}</span>
            <span className={css.cardGroupCount}>{bucket.items.length}</span>
            <button
              type="button"
              className={css.linkButton}
              data-dsh-part="card-group-toggle"
              aria-expanded={!folded}
              disabled={searchActive}
              onClick={() => {
                setSourceFolds(current => {
                  const next = { ...current, [foldKey]: !isSourceGroupFolded(current, view, bucket.id, false) }
                  writeSourceGroupFolds(globalThis.localStorage, next)
                  return next
                })
              }}
            >
              {folded ? t('board.group.expand', { count: String(bucket.items.length) }) : t('board.group.collapse')}
            </button>
          </div>
          {!folded && (recency
            ? renderRecencyGroups(foldKey, bucket.items, compact, archived)
            : bucket.items.map(task => renderCard(task, compact)))}
        </div>
      )
    })
  }

  return (
    <div className={css.board} data-dsh-taskboard-board="" data-dsh-plugin="task-board">
      <header className={css.boardHeader}>
        {/* Shared hook: dsh-web-all offsets center-view back controls beside the collapsed mobile sidebar. */}
        <button
          type="button"
          className={`${css.ghostButton} ${css.backButton}`}
          data-dsh-center-view-back=""
          aria-label={t('board.close')}
          onClick={() => { controller.closeBoard() }}
        >
          <IconChevronLeft size={15} />
          <span>{t('board.close')}</span>
        </button>
        <h2 className={css.boardTitle}>{t('board.title')}</h2>
        {snapshot.host !== undefined && (
          <span className={css.detailMeta}>
            {t('board.hostMeta', {
              revision: String(snapshot.host.revision),
              timeZone: snapshot.host.scheduler.timeZone,
            })}
          </span>
        )}
        {/* Filters, view toggles and the create action share one toolbar group so
            the header reads as identity + tools instead of one long strip. The
            toggles keep the outlined control and only change role colour when
            they are on, so pressing one never resizes the row. */}
        <div className={css.boardTools}>
          {(projects.length > 0 || canCreateProject) && (
            <label className={css.projectFilter}>
              <span className={css.projectFilterLabel}>{t('board.project')}</span>
              <select
                className={css.select}
                data-dsh-part="project-filter"
                value={projectId}
                aria-label={t('board.project')}
                onChange={event => {
                  const value = event.target.value
                  if (value === NEW_PROJECT_VALUE) {
                    setNewProjectError(undefined)
                    setShowNewProject(true)
                    return
                  }
                  setProjectId(value)
                }}
              >
                <option value="">{t('board.projectAll')}</option>
                {projects.map(project => (
                  <option key={project.workspaceId} value={project.workspaceId}>{project.title}</option>
                ))}
                {canCreateProject && <option value={NEW_PROJECT_VALUE}>{t('board.projectNew')}</option>}
              </select>
            </label>
          )}
          <input
            className={css.search}
            type="search"
            placeholder={t('board.search')}
            value={filter}
            onChange={event => { setFilter(event.target.value) }}
            aria-label={t('board.search')}
          />
          {hasSubtasks && (
            <button
              type="button"
              className={css.ghostButton}
              data-dsh-part="subtask-filter"
              data-active={hidingSubtasks ? 'true' : undefined}
              aria-pressed={hidingSubtasks}
              title={t('board.subtaskFilterHint')}
              onClick={() => { setHideSubtasks(value => !value) }}
            >
              {hidingSubtasks ? t('board.showSubtasks') : t('board.hideSubtasks')}
            </button>
          )}
          <button
            type="button"
            className={css.ghostButton}
            data-active={archiveView ? 'true' : undefined}
            aria-pressed={archiveView}
            onClick={() => { controller.toggleArchiveView() }}
          >
            {archiveView
              ? t('board.backToBoard')
              : t('board.archiveView', { count: String(snapshot.tasks.filter(task => task.archivedAt !== undefined).length) })}
          </button>
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => { setShowNew(true) }}
          >
            <IconPlus size={15} />
            {t('board.new')}
          </button>
        </div>
      </header>

      {showNewProject && (
        <div className={css.projectDialog} data-dsh-part="project-dialog">
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('board.projectNewPath')}</span>
            <input
              className={css.input}
              value={newProjectPath}
              placeholder={t('board.projectNewPathPlaceholder')}
              spellCheck={false}
              onChange={event => { setNewProjectPath(event.target.value); setNewProjectError(undefined) }}
            />
          </label>
          {newProjectError !== undefined && <p className={css.formError}>{t('board.projectCreateFailed', { error: newProjectError })}</p>}
          <div className={css.projectDialogActions}>
            <button
              type="button"
              className={css.ghostButton}
              onClick={() => { setShowNewProject(false); setNewProjectError(undefined) }}
            >
              {t('new.cancel')}
            </button>
            <button
              type="button"
              className={css.primaryButton}
              disabled={newProjectPending || newProjectPath.trim() === ''}
              onClick={() => { void submitNewProject() }}
            >
              {t('board.projectCreate')}
            </button>
          </div>
        </div>
      )}

      {!archiveView && knownTags.length > 0 && (
        <div className={css.tagFilter} data-dsh-part="tag-filter">
          <span className={css.tagFilterLabel}>{t('board.tagFilter')}</span>
          {knownTags.map(tag => {
            const active = tagFilter.includes(tag.name)
            return (
              <button
                key={tag.name}
                type="button"
                className={css.tagChip}
                data-dsh-part="tag-chip"
                data-tag-tone={tagTone(tag.name)}
                data-active={active ? 'true' : undefined}
                aria-pressed={active}
                title={tag.promptPrefix === undefined ? tag.name : tag.promptPrefix}
                onClick={() => { toggleTag(tag.name) }}
              >
                {tag.name}
              </button>
            )
          })}
          {/* The row can only shrink through the manager: without it a label
              created once stays on the board forever. */}
          <button
            type="button"
            className={css.linkButton}
            data-dsh-part="tag-manage"
            onClick={() => { setShowTagManager(true) }}
          >
            {t('board.tagManage')}
          </button>
          {tagFilter.length > 0 && (
            <button type="button" className={css.linkButton} onClick={() => { setTagFilter([]) }}>
              {t('board.tagFilterClear')}
            </button>
          )}
        </div>
      )}

      {snapshot.transportError !== undefined && (
        <div className={css.formError}>
          {t('board.hostError', { error: snapshot.transportError })}{' '}
          <button type="button" className={css.linkButton} onClick={() => { void controller.retryHostSync() }}>
            {t('board.retryHost')}
          </button>
        </div>
      )}

      <div className={css.columns}>
        {archiveView ? (
          <section className={css.column} data-status="archived" data-dsh-part="column">
            <header className={css.columnHeader}>
              <h3 className={css.columnTitle}>{t('board.archive')}</h3>
              <span className={css.columnCount}>{visible.length}</span>
            </header>
            <div className={css.cards}>
              {renderSourceGroups(ARCHIVE_COLUMN, visible, false, true)}
              {visible.length === 0 && (
                <div className={css.columnEmpty}>{tagFilter.length > 0 ? t('board.tagEmpty') : t('archive.empty')}</div>
              )}
            </div>
          </section>
        ) : (
          COLUMNS.map(column => {
            const tasks = visible.filter(task => task.status === column.status)
            // Every manually reachable column accepts a drop; `running`
            // never does, because only the runner opens an execution.
            const isManualDropTarget = MANUAL_STATUSES.includes(column.status)
            const compact = compactColumns.includes(column.status)
            return (
              <section
                key={column.status}
                className={css.column}
                data-status={column.status}
                data-dsh-part="column"
                onDragOver={isManualDropTarget ? (event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                } : undefined}
                onDrop={isManualDropTarget ? (event) => {
                  event.preventDefault()
                  const taskId = event.dataTransfer.getData('text/plain')
                  if (!taskId) return
                  const dropped = snapshot.tasks.find(t => t.id === taskId)
                  if (dropped && canMoveTask(dropped, column.status)) {
                    controller.moveTask(taskId, column.status)
                  }
                } : undefined}
              >
                <header className={css.columnHeader}>
                  <span className={css.statusDot} data-status={column.status} aria-hidden="true" />
                  <h3 className={css.columnTitle}>{t(STATUS_KEY[column.status])}</h3>
                  <span className={css.columnCount}>{tasks.length}</span>
                  <button
                    type="button"
                    className={css.densityToggle}
                    data-dsh-part="density-toggle"
                    data-active={compact ? 'true' : undefined}
                    aria-pressed={compact}
                    title={compact ? t('board.density.comfortable') : t('board.density.compact')}
                    aria-label={compact ? t('board.density.comfortable') : t('board.density.compact')}
                    onClick={() => { toggleCompact(column.status) }}
                  >
                    {compact ? <IconExpandRows size={13} /> : <IconCompactRows size={13} />}
                  </button>
                </header>
                <div className={css.cards}>
                  {renderSourceGroups(column.status, tasks, compact, false)}
                  {tasks.length === 0 && (
                    <div className={css.columnEmpty}>{tagFilter.length > 0 ? t('board.tagEmpty') : t('board.empty')}</div>
                  )}
                </div>
              </section>
            )
          })
        )}
      </div>

      {detailTask !== undefined && detailPresence.mounted && (
        <TaskDetail controller={controller} task={detailTask} phase={detailPresence.phase} />
      )}
      {newTaskPresence.mounted && (
        <NewTaskModal
          controller={controller}
          {...(projectId === '' ? {} : { defaultWorkspaceId: projectId })}
          onClose={() => { setShowNew(false) }}
          phase={newTaskPresence.phase}
        />
      )}
      {tagManagerPresence.mounted && (
        <TagManagerModal
          controller={controller}
          onClose={() => { setShowTagManager(false) }}
          phase={tagManagerPresence.phase}
        />
      )}
    </div>
  )
}
