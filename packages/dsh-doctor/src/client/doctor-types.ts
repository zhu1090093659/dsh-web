/**
 * Browser-half wire types for the dsh-doctor recovery console.
 *
 * These mirror the Host/Launcher/Supervisor protocol the Host half exposes
 * under /api/doctor (core/protocol.ts). The browser half does NOT import
 * src/core: the protocol types are mirrored here as plain structural types so
 * the client bundle ships zero node dependencies. Parsing stays defensive: any
 * missing or unexpected field degrades the console instead of throwing.
 *
 * Endpoints served by the Host half:
 * - GET  /api/doctor/status        -> DoctorSupervisorResponse (snapshot)
 * - POST /api/doctor/action        -> DoctorSupervisorResponse (body { action, profileId?, incidentId? })
 * - POST /api/doctor/client-failure -> DoctorSupervisorResponse (body { message, stack?, phase?, runId? })
 * @module @linxin666/dsh-doctor/client
 */

/** Protocol version spoken by the Host half. */
export const DOCTOR_PROTOCOL_VERSION = 1

/** System-wide rescue/recovery phase. */
export type DoctorSystemPhase =
  | 'disabled'
  | 'provisioning'
  | 'armed'
  | 'degraded'
  | 'updating'
  | 'rolling-back'
  | 'uninstalling'
  | 'broken'

/** Per-profile runtime phase. */
export type DoctorProfilePhase =
  | 'idle'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'stopping'
  | 'exited'
  | 'suspected'
  | 'failed'
  | 'quarantined'

/** Incident lifecycle phase. */
export type DoctorIncidentPhase =
  | 'opened'
  | 'collecting'
  | 'rescue-starting'
  | 'rescue-active'
  | 'diagnosing'
  | 'plan-ready'
  | 'repairing'
  | 'candidate-testing'
  | 'awaiting-confirmation'
  | 'promoting'
  | 'recovered'
  | 'rolled-back'
  | 'unresolved'

/** Incident kind reported by the supervisor. */
export type DoctorIncidentKind =
  | 'boot-failure'
  | 'process-crash'
  | 'heartbeat-timeout'
  | 'http-failure'
  | 'client-failure'
  | 'dependency-failure'
  | 'configuration-failure'

/** One protected profile as reported by the supervisor. */
export interface DoctorProfileRuntime {
  identity?: {
    id?: string
    name?: string
  }
  phase?: DoctorProfilePhase
  pid?: number
  runId?: string
  command?: unknown[]
  startedAt?: string
  lastHealthyAt?: string
  restartCount?: number
  managed?: boolean
}

/** One recorded incident. */
export interface DoctorIncident {
  id: string
  profileId?: string
  kind: DoctorIncidentKind
  phase: DoctorIncidentPhase
  openedAt?: string
  updatedAt?: string
  summary: string
  evidence?: unknown[]
  repairable?: boolean
  candidateId?: string
}

/** One supervisor snapshot. */
export interface DoctorSnapshot {
  protocol?: number
  phase?: DoctorSystemPhase
  version?: string
  capsuleVersion?: string
  profiles?: DoctorProfileRuntime[]
  incidents?: DoctorIncident[]
  updatedAt?: string
  degradedReason?: string
  policy?: { fullProtection?: boolean; autoRepair?: boolean; autoMigrate?: boolean }
}

/** Wire body of every /api/doctor endpoint (SupervisorResponse plus the host envelope). */
export interface DoctorSupervisorResponse {
  ok?: boolean
  snapshot?: DoctorSnapshot
  error?: { code?: string; message?: string }
  /** Version of the host half (package.json); compares with snapshot.version. */
  hostVersion?: string
}

/** Allowed actions accepted by POST /api/doctor/action. */
export type DoctorActionName =
  | 'provision'
  | 'exercise'
  | 'diagnose'
  | 'repair'
  | 'confirm'
  | 'rollback'
  | 'pause'
  | 'resume'
  | 'uninstall'

/**
 * The doctor settings namespace, registered by the Host half through
 * installSettingsSection. The browser half reads the enabled switch; the Host
 * half mounts its routes and heartbeat only while enabled.
 */
export interface DoctorSettings {
  enabled?: boolean
  fullProtection?: boolean
  autoRepair?: boolean
  autoMigrate?: boolean
}
