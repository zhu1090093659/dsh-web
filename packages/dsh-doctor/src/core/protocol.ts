/** Shared wire protocol between Launcher, Supervisor, Host, and Web console. */
export const DOCTOR_PROTOCOL_VERSION = 1 as const

export type SystemPhase = 'disabled' | 'provisioning' | 'armed' | 'degraded' | 'updating' | 'rolling-back' | 'uninstalling' | 'broken'
export type ProfilePhase = 'idle' | 'starting' | 'healthy' | 'degraded' | 'stopping' | 'exited' | 'suspected' | 'failed' | 'quarantined'
export type IncidentPhase = 'opened' | 'collecting' | 'rescue-starting' | 'rescue-active' | 'diagnosing' | 'plan-ready' | 'repairing' | 'candidate-testing' | 'awaiting-confirmation' | 'promoting' | 'recovered' | 'rolled-back' | 'unresolved'
export type IncidentKind = 'boot-failure' | 'process-crash' | 'heartbeat-timeout' | 'http-failure' | 'client-failure' | 'dependency-failure' | 'configuration-failure'

/** Effective Supervisor policy written by the host and enforced out of process. */
export interface DoctorPolicy {
  fullProtection: boolean
  autoRepair: boolean
  autoMigrate: boolean
}

export const DEFAULT_DOCTOR_POLICY: DoctorPolicy = { fullProtection: true, autoRepair: false, autoMigrate: true }

export interface ProfileIdentity {
  id: string
  dshHome: string
  name: string
  dshExecutable: string
  role: 'protected' | 'rescue'
}

export interface ProfileRuntime {
  identity: ProfileIdentity
  phase: ProfilePhase
  pid?: number
  runId?: string
  command?: string[]
  startedAt?: string
  lastHealthyAt?: string
  restartCount: number
  managed: boolean
}

export interface IncidentRecord {
  id: string
  profileId: string
  kind: IncidentKind
  phase: IncidentPhase
  openedAt: string
  updatedAt: string
  summary: string
  evidence: string[]
  repairable: boolean
  candidateId?: string
}

export interface SupervisorSnapshot {
  protocol: typeof DOCTOR_PROTOCOL_VERSION
  phase: SystemPhase
  version: string
  capsuleVersion?: string
  profiles: ProfileRuntime[]
  incidents: IncidentRecord[]
  updatedAt: string
  degradedReason?: string
  /** Present when this Supervisor version enforces host policy. */
  policy?: DoctorPolicy
}

export type SupervisorRequest =
  | { protocol: typeof DOCTOR_PROTOCOL_VERSION; type: 'status' }
  | { protocol: typeof DOCTOR_PROTOCOL_VERSION; type: 'policy'; policy: DoctorPolicy }
  | { protocol: typeof DOCTOR_PROTOCOL_VERSION; type: 'heartbeat'; profileId: string; runId: string; pid: number; phase: 'booting' | 'ready' | 'degraded'; at: string; webUrl?: string; configFingerprint?: string }
  | { protocol: typeof DOCTOR_PROTOCOL_VERSION; type: 'client-failure'; profileId: string; runId?: string; at: string; message: string; stack?: string; phase?: string }
  | { protocol: typeof DOCTOR_PROTOCOL_VERSION; type: 'launcher-start'; profile: ProfileIdentity; runId: string; pid: number; argv: string[]; at: string }
  | { protocol: typeof DOCTOR_PROTOCOL_VERSION; type: 'launcher-exit'; profileId: string; runId: string; exitCode: number | null; signal: string | null; intentional: boolean; started: boolean; at: string; stderrTail?: string }
  | { protocol: typeof DOCTOR_PROTOCOL_VERSION; type: 'action'; action: 'provision' | 'exercise' | 'diagnose' | 'repair' | 'confirm' | 'rollback' | 'pause' | 'resume' | 'uninstall'; profileId?: string; incidentId?: string }

export interface SupervisorResponse {
  ok: boolean
  snapshot?: SupervisorSnapshot
  error?: { code: string; message: string }
}

export function isSupervisorRequest(value: unknown): value is SupervisorRequest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.protocol === DOCTOR_PROTOCOL_VERSION && typeof candidate.type === 'string'
}
