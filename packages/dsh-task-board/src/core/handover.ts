/**
 * Handover bundle (issue #5, ADR 0001): the resource reference set a
 * continuation card carries — the pinned execution triplet (workspace /
 * agent preset / permission) plus doc/script references — so a picking-up
 * session can start with zero context.
 *
 * Security gate (adversarial scenario b): a bundle whose effective
 * permission is HIGHER than the session default is an unconfirmed binding.
 * It enters the pending-confirmation state (the card stores the binding
 * without a permissionConfirmedAt stamp); manual execution refuses, cron
 * refuses to schedule, and the human confirm-permission action resolves the
 * transaction by stamping the confirmation. Any later permission or
 * handover change re-arms the gate (the confirmation binds the exact
 * permission value, blocking confirm-then-swap escalation).
 */
import { isTaskPermission, type TaskPermission, type TaskRecord } from './tasks.ts'

export type { TaskPermission }

/** Wire shape of a handover bundle (before bundledAt is stamped). */
export interface TaskHandoverInput {
  workspaceId?: string
  mode?: string
  permission?: TaskPermission
  references: string[]
}

/** Persisted handover bundle on a task record. */
export interface TaskHandover extends TaskHandoverInput {
  /** When the bundle was attached/replaced (ms epoch, stamped by the use case). */
  bundledAt: number
}

/** Most references a bundle may carry. */
export const HANDOVER_MAX_REFERENCES = 32
/** Per-reference UTF-8 byte cap. */
export const HANDOVER_MAX_REFERENCE_BYTES = 512
/** Total references UTF-8 byte cap. */
export const HANDOVER_MAX_TOTAL_BYTES = 8 * 1024
/** Per target-id (workspace/preset) byte cap. */
export const HANDOVER_MAX_TARGET_BYTES = 256

/** The board's notion of the deployment session-default permission (fail-safe default). */
export const DEFAULT_SESSION_PERMISSION: TaskPermission = 'read-only'

/** Permission elevation rank (higher = more authority). */
export const PERMISSION_RANK: ReadonlyMap<TaskPermission, number> = new Map([
  ['read-only', 0],
  ['workspace-write', 1],
  ['danger-full-access', 2],
])

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Gate a handover bundle from the wire or disk: exact keys, string targets
 * under the byte cap, a known permission, and a bounded string reference
 * list. Returns the sanitized bundle, or undefined when rejected.
 */
export function sanitizeHandover(value: unknown): TaskHandoverInput | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const bundle = value as Record<string, unknown>
  const keys = Object.keys(bundle)
  if (!keys.every(key => ['workspaceId', 'mode', 'permission', 'references'].includes(key))) return undefined
  if (!Array.isArray(bundle.references)) return undefined
  if (bundle.references.length > HANDOVER_MAX_REFERENCES) return undefined
  let total = 0
  for (const reference of bundle.references) {
    if (typeof reference !== 'string' || reference === '') return undefined
    const size = byteLength(reference)
    if (size > HANDOVER_MAX_REFERENCE_BYTES) return undefined
    total += size
    if (total > HANDOVER_MAX_TOTAL_BYTES) return undefined
  }
  for (const key of ['workspaceId', 'mode'] as const) {
    const target: unknown = bundle[key]
    if (target !== undefined && (typeof target !== 'string' || byteLength(target) > HANDOVER_MAX_TARGET_BYTES)) return undefined
  }
  if (bundle.permission !== undefined && !isTaskPermission(bundle.permission)) return undefined
  const workspaceId = bundle.workspaceId
  const mode = bundle.mode
  return {
    ...(typeof workspaceId === 'string' ? { workspaceId } : {}),
    ...(typeof mode === 'string' ? { mode } : {}),
    ...(bundle.permission === undefined ? {} : { permission: bundle.permission as TaskPermission }),
    references: [...bundle.references as string[]],
  }
}

/** Build the persisted bundle from a sanitized input, stamping bundledAt. */
export function handoverOf(input: TaskHandoverInput, now: number): TaskHandover {
  return { ...input, bundledAt: now }
}

/** The permission an execution session would actually run under. */
export function effectivePermission(task: Pick<TaskRecord, 'permission' | 'handover'>): TaskPermission | undefined {
  return task.handover?.permission ?? task.permission
}

/** Whether a binding's permission is elevated above the session default. */
export function exceedsSessionDefault(permission: TaskPermission | undefined, sessionDefault: TaskPermission): boolean {
  if (permission === undefined) return false
  return (PERMISSION_RANK.get(permission) ?? -1) > (PERMISSION_RANK.get(sessionDefault) ?? -1)
}

/**
 * The confirmation-gate predicate: an elevated permission without a human
 * confirmation stamp. Manual run/rerun and cron must refuse such a card.
 */
export function requiresPermissionConfirmation(
  task: Pick<TaskRecord, 'permission' | 'handover' | 'permissionConfirmedAt'>,
  sessionDefault: TaskPermission = DEFAULT_SESSION_PERMISSION,
): boolean {
  return exceedsSessionDefault(effectivePermission(task), sessionDefault) && task.permissionConfirmedAt === undefined
}
