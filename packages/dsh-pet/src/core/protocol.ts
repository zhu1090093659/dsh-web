/**
 * Versioned, transport-neutral activity types shared by the host, web pet,
 * and future desktop companion. This module must stay free of runtime SDK,
 * DOM, WebServer, and Electron dependencies.
 * @module @linxin666/dsh-pet/core/protocol
 */

/** Stable pre-extension activity protocol version. */
export const PET_ACTIVITY_PROTOCOL_VERSION = 2 as const

/** Task phases emitted by a live DSH instance. Offline is receiver-derived. */
export type PetTaskPhase =
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'tool'
  | 'review'
  | 'waiting_input'
  | 'blocked'
  | 'done'
  | 'failed'

/** Identity fields that prevent collisions across instances and restarts. */
export interface PetTaskIdentity {
  instanceId: string
  bootId: string
  sessionId: string
}

/** Safe, bounded facts about the current tool activity. */
export interface PetTaskToolSnapshot {
  name: string
  label?: string
  detail?: string
  activeCount: number
  completedCount: number
  failedCount?: number
}

/** Token usage is included only when the official source provides it. */
export interface PetTaskTokenUsage {
  input?: number
  output?: number
}

/** Progress exists only when an official source provides exact facts. */
export interface PetTaskProgress {
  current: number
  total: number
  unit?: string
}

/** One session task retained by the process-local activity registry. */
export interface PetTaskSnapshot extends PetTaskIdentity {
  taskId: string
  profile?: string
  workspaceLabel?: string
  title?: string
  phase: PetTaskPhase
  statusLine?: string
  narration?: string
  tool?: PetTaskToolSnapshot
  startedAt: number
  phaseStartedAt: number
  updatedAt: number
  finishedAt?: number
  tokenUsage?: PetTaskTokenUsage
  progress?: PetTaskProgress
}

/** Counts used by compact web and desktop summaries. */
export interface PetAggregateSummary {
  active: number
  waiting: number
  blocked: number
  failed: number
  completedRecently: number
}

/** Full process-local snapshot. V2 deliberately does not use deltas. */
export interface PetAggregateSnapshot {
  protocolVersion: typeof PET_ACTIVITY_PROTOCOL_VERSION
  sequence: number
  emittedAt: number
  primaryTaskId?: string
  tasks: PetTaskSnapshot[]
  summary: PetAggregateSummary
}

/** Metadata sent when one host connects to a desktop bridge. */
export interface PetInstanceDescriptor {
  instanceId: string
  bootId: string
  profile?: string
  workspaceLabel?: string
  startedAt: number
}

/** Message envelope shared by full snapshots and lifecycle signals. */
export interface PetActivityEnvelope<TType extends string, TPayload> {
  protocolVersion: typeof PET_ACTIVITY_PROTOCOL_VERSION
  type: TType
  instanceId: string
  bootId: string
  sequence: number
  emittedAt: number
  payload: TPayload
}

/** Version 2 bridge vocabulary. */
export type PetActivityMessage =
  | PetActivityEnvelope<'hello', { instance: PetInstanceDescriptor }>
  | PetActivityEnvelope<'snapshot', PetAggregateSnapshot>
  | PetActivityEnvelope<'heartbeat', { activeTasks: number }>
  | PetActivityEnvelope<'goodbye', { reason?: string }>

/** Create an unambiguous task ID from the protocol's composite identity. */
export function petTaskId(identity: PetTaskIdentity): string {
  const parts = [identity.instanceId, identity.bootId, identity.sessionId]
    .map(part => encodeURIComponent(part))
  return `v2:${parts.join(':')}`
}

/** Whether a value belongs to the task phase vocabulary. */
export function isPetTaskPhase(value: string): value is PetTaskPhase {
  return [
    'idle',
    'waiting',
    'thinking',
    'tool',
    'review',
    'waiting_input',
    'blocked',
    'done',
    'failed',
  ].includes(value)
}
