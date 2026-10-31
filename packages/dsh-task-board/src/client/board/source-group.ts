/**
 * Source grouping and fold preferences for the board view. Providers contribute
 * opaque groups through the client contract; this module owns only ordering,
 * local fallback, and browser persistence, never provider metadata semantics.
 */
import type { TaskBoardGroupingSelector, TaskBoardSourceGroup } from '../../core/extension.ts'
import type { TaskRecord, TaskStatus } from '../../core/tasks.ts'

/** Reserved group for cards no provider claimed. */
export const LOCAL_SOURCE_GROUP_ID = 'local'
/** Browser storage key for explicit source-fold overrides. */
export const SOURCE_GROUP_FOLDS_KEY = 'dsh.taskBoard.sourceGroupFolds.v1'

export type SourceGroupView = TaskStatus | 'archived'
export type SourceGroupFolds = Readonly<Record<string, boolean>>

export interface SourceGroupBucket extends TaskBoardSourceGroup {
  items: TaskRecord[]
  local: boolean
}

function compareText(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a < b) return -1
  if (a > b) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Group cards in their incoming order, then sort provider groups by full label. */
export function groupTasksBySource(tasks: readonly TaskRecord[], selectors: readonly TaskBoardGroupingSelector[]): SourceGroupBucket[] {
  const groups = new Map<string, SourceGroupBucket>()
  for (const task of tasks) {
    let source: TaskBoardSourceGroup | undefined
    for (const selector of selectors) {
      try {
        const candidate = selector(task)
        if (candidate === undefined) continue
        const id = candidate.id.trim()
        const label = candidate.label.trim()
        if (id === '' || label === '') continue
        source = { id, label }
        break
      } catch {
        // A faulty provider loses its grouping contribution, not the board.
      }
    }
    const group = source ?? { id: LOCAL_SOURCE_GROUP_ID, label: '' }
    const bucket = groups.get(group.id) ?? { ...group, items: [], local: source === undefined }
    bucket.items.push(task)
    groups.set(group.id, bucket)
  }
  return [...groups.values()].sort((left, right) => {
    if (left.local !== right.local) return left.local ? 1 : -1
    return compareText(left.label, right.label) || compareText(left.id, right.id)
  })
}

/** Compound key keeps a fold choice scoped to one column/view and one source. */
export function sourceGroupFoldKey(view: SourceGroupView, sourceId: string): string {
  return `${view}:${sourceId}`
}

/** Read explicit overrides; malformed or unavailable storage falls back to defaults. */
export function readSourceGroupFolds(storage: Pick<Storage, 'getItem'> | undefined): SourceGroupFolds {
  try {
    const raw = storage?.getItem(SOURCE_GROUP_FOLDS_KEY)
    if (raw === null || raw === undefined) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, boolean> = Object.create(null) as Record<string, boolean>
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== '' && typeof value === 'boolean') result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

/** Persist overrides; a storage failure only loses the preference. */
export function writeSourceGroupFolds(storage: Pick<Storage, 'setItem'> | undefined, folds: SourceGroupFolds): void {
  try {
    storage?.setItem(SOURCE_GROUP_FOLDS_KEY, JSON.stringify(folds))
  } catch {
    // Preference only: the in-memory choice still works.
  }
}

/** Search always reveals matches; otherwise an override beats the column default. */
export function isSourceGroupFolded(folds: SourceGroupFolds, view: SourceGroupView, sourceId: string, searchActive: boolean): boolean {
  if (searchActive) return false
  return folds[sourceGroupFoldKey(view, sourceId)] ?? view === 'done'
}
