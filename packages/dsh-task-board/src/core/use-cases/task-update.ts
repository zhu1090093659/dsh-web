/**
 * Update-task use case: apply an editable-field patch (title/description/
 * prompt plus the execution targets workspaceId/mode/permission) with a
 * fresh updatedAt. Pure ledger transition (no persistence or notify — the
 * controller orchestrates those).
 *
 * An explicit `undefined` in the patch clears the field (the task falls
 * back to the runtime default); an unknown permission string is ignored so
 * stale UI can never persist a value the execution service rejects.
 */
import { freezeOf, isTaskPermission, normalizeTags, normalizeTargetId, type TaskRecord, type TaskPermission, type TaskTag } from '../tasks.ts'
import { normalizeAttachments, type TaskAttachment } from '../attachment.ts'
import type { FreezeSnapshot } from '../freeze-snapshot.ts'
import type { TaskHandoverInput } from '../handover.ts'

/**
 * Editable fields on a task (the update patch surface). `freeze` replaces the
 * continuation-card snapshot (restamping frozenAt); an explicit null clears it.
 */
export type TaskUpdatePatch = Partial<Pick<TaskRecord, 'title' | 'description' | 'prompt' | 'workspaceId' | 'mode' | 'permission' | 'model' | 'reasoningEffort' | 'reuseSession'>> & {
  freeze?: FreezeSnapshot & { redacted?: boolean } | null
  /** Replaces the handover bundle (restamping bundledAt); an explicit null clears it. */
  handover?: TaskHandoverInput | null
  /**
   * Replaces the task's labels (issue #1521). Unlike the content fields, tags
   * stay editable after the first run: they classify the task and shape the
   * NEXT execution prompt, they are not the record of what already ran. An
   * explicit null (or a list that normalizes to nothing) clears them.
   */
  tags?: TaskTag[] | null
  /**
   * Replaces the card's attachments (issue #1979).
   *
   * The attachments freeze WITH the card content: they are part of what the
   * card hands to its execution, so an executed or archived card keeps the
   * ones it ran with, exactly as it keeps the prompt it ran with. An explicit
   * null clears them; a present array replaces the whole set.
   */
  attachments?: TaskAttachment[] | null
}

/** The fields that edit the task's content (what the user reads and what the
 * next execution sends). Unlike the execution targets they stay editable only
 * while the task has never started executing — after the first run the
 * recorded prompt is the record of what actually ran, so it becomes read-only.
 */
export const TASK_CONTENT_FIELDS = ['title', 'description', 'prompt'] as const

/**
 * The fields that freeze with the card content: the text the card says AND
 * the attachments it carries.
 *
 * The attachments freeze with the content because they ARE part of what the
 * card hands to its execution: a card whose first run already consumed an
 * image keeps that image, and the record of what ran stays what it was. An
 * executed or archived card therefore refuses an attachment change exactly
 * as it refuses a prompt change.
 */
export const TASK_FROZEN_FIELDS = [...TASK_CONTENT_FIELDS, 'attachments'] as const

/** Whether an update patch touches any task-content field. */
export function hasContentPatch(patch: TaskUpdatePatch): boolean {
  return (TASK_FROZEN_FIELDS as readonly string[]).some(field => field in patch)
}

/**
 * Whether a task's content may still be edited: the task must be on-board
 * (not archived) and must never have started executing. Fail-closed: a task
 * with any execution record — running, settled, or cancelled before launch —
 * keeps its content fixed. The run, not the column, is the trigger: a card
 * parked in 'running' by hand has nothing recorded yet and stays editable.
 */
export function canEditTaskContent(task: TaskRecord): boolean {
  return task.archivedAt === undefined && task.executions.length === 0
}

/** Keep an unknown permission string from entering the ledger. */
function normalizePermission(
  current: TaskPermission | undefined,
  value: TaskPermission | undefined,
): TaskPermission | undefined {
  if (value === undefined) return undefined
  return isTaskPermission(value) ? value : current
}

/**
 * Apply an update across the ledger. Tasks that do not match the id are left
 * untouched; the matched task receives the patch plus a fresh updatedAt.
 * @param tasks - current ledger.
 * @param id - the task to update.
 * @param patch - editable-field changes.
 * @param now - clock instant (ms epoch).
 */
export function applyUpdateTask(
  tasks: readonly TaskRecord[],
  id: string,
  patch: TaskUpdatePatch,
  now: number,
): readonly TaskRecord[] {
  return tasks.map(task => {
    if (task.id !== id) return task
    const { freeze: freezePatch, handover: handoverPatch, tags: tagsPatch, attachments: attachmentsPatch, ...rest } = patch
    const workspaceId = 'workspaceId' in patch ? normalizeTargetId(patch.workspaceId) : undefined
    const mode = 'mode' in patch ? normalizeTargetId(patch.mode) : undefined
    const permission = 'permission' in patch ? normalizePermission(task.permission, patch.permission) : undefined
    const model = 'model' in patch ? normalizeTargetId(patch.model) : undefined
    const reasoningEffort = 'reasoningEffort' in patch ? normalizeTargetId(patch.reasoningEffort) : undefined
    const next: TaskRecord = { ...task, ...rest, updatedAt: now }
    // Content fields normalize like creation does (trimmed); an explicit
    // undefined keeps the current value — content cannot be cleared.
    for (const field of TASK_CONTENT_FIELDS) {
      if (!(field in patch)) continue
      const value = patch[field]
      next[field] = value === undefined ? task[field] : value.trim()
    }
    // null (or a vanished key value) clears the snapshot; a present object
    // replaces it with a fresh frozenAt stamp.
    next.freeze = freezePatch == null ? undefined : freezeOf(freezePatch, now)
    // Handover follows the same null-clears convention, restamping bundledAt.
    next.handover = handoverPatch == null ? undefined : { ...handoverPatch, bundledAt: now }
    // Tags use the same convention: a present array replaces the set (after
    // repair), an explicit null or a fully-invalid list clears it.
    if ('tags' in patch) next.tags = tagsPatch == null ? undefined : normalizeTags(tagsPatch)
    // Attachments follow the same convention: a present array replaces the
    // whole set (after repair), an explicit null clears it.
    if ('attachments' in patch) next.attachments = attachmentsPatch == null ? undefined : normalizeAttachments(attachmentsPatch)
    // The permission confirmation binds the exact permission value: a change
    // of the pinned permission or of the handover bundle re-arms the gate
    // (blocking confirm-then-swap escalation). handover was destructured out
    // of rest above, so the stamp survives only when explicitly kept.
    if (('permission' in patch && patch.permission !== undefined && patch.permission !== task.permission) || 'handover' in patch) {
      next.permissionConfirmedAt = undefined
    }
    // Session reuse is a boolean opt-in; false (or an explicit null from a
    // caller that needs to clear it) returns the task to one session per run.
    if ('reuseSession' in patch) next.reuseSession = patch.reuseSession === true ? true : undefined
    if (workspaceId !== undefined || 'workspaceId' in patch) next.workspaceId = workspaceId
    if (mode !== undefined || 'mode' in patch) next.mode = mode
    if (permission !== undefined || 'permission' in patch) next.permission = permission
    if (model !== undefined || 'model' in patch) next.model = model
    // The effort is bound to the model route above it: blank text (or an
    // explicit undefined) returns the card to the model's own default level,
    // and only the launch decides whether the value can be sent at all.
    if (reasoningEffort !== undefined || 'reasoningEffort' in patch) next.reasoningEffort = reasoningEffort
    return next
  })
}
