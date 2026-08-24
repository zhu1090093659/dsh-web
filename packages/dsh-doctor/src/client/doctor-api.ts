/**
 * Loopback /api/doctor HTTP client for the dsh-doctor recovery console.
 *
 * Wire contract owned by the Host half (host/routes.ts):
 * - GET  /api/doctor/status        -> DoctorSupervisorResponse (snapshot)
 * - POST /api/doctor/action        -> DoctorSupervisorResponse (body { action, profileId?, incidentId? })
 * - POST /api/doctor/client-failure -> DoctorSupervisorResponse (body { message, stack?, phase?, runId? })
 *
 * Every method resolves, never rejects. A disabled host half (404 or a 200 SPA
 * fallback page), a 403 fence refusal and a supervisor business failure all
 * degrade to structured errors instead of unhandled rejections. The fetch seam
 * accepts a narrow response interface so tests run in node or jsdom.
 * @module @linxin666/dsh-doctor/client
 */

import type {
  DoctorActionName,
  DoctorSupervisorResponse,
} from './doctor-types.ts'

/** Narrow response shape the client reads (global fetch Response satisfies it). */
export interface DoctorHttpResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

/** Narrow fetch signature; override in tests. */
export type DoctorFetch = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string
}) => Promise<DoctorHttpResponse>

/** Failure taxonomy of one endpoint call. */
export type DoctorApiFailureKind =
  | 'network'
  | 'loopback'
  | 'not-available'
  | 'malformed'
  | 'http'
  | 'supervisor'
  | 'unprovisioned'
  | 'supervisor-down'

/** Successful verdict of one endpoint call. */
export type DoctorApiOk<T> = { ok: true; value: T }

/** Failed verdict of one endpoint call. */
export type DoctorApiFail = { ok: false; kind: DoctorApiFailureKind; status?: number; message?: string; code?: string }

/** Result of one endpoint call (never a rejected promise). */
export type DoctorApiResult<T> = DoctorApiOk<T> | DoctorApiFail

/** Base path of the doctor API (same-origin, fenced to loopback host-side). */
export const DOCTOR_API_BASE = '/api/doctor'

/** Default fetch seam over the page global. */
const defaultFetch: DoctorFetch = async (url, init) => {
  const response = await globalThis.fetch(url, init ?? {})
  return response as unknown as DoctorHttpResponse
}

/** Extract a record from an unknown JSON body. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

/** Known incident kinds. */
const INCIDENT_KINDS = new Set(['boot-failure', 'process-crash', 'heartbeat-timeout', 'http-failure', 'client-failure', 'dependency-failure', 'configuration-failure'])

/** Known incident phases. */
const INCIDENT_PHASES = new Set(['opened', 'collecting', 'rescue-starting', 'rescue-active', 'diagnosing', 'plan-ready', 'repairing', 'candidate-testing', 'awaiting-confirmation', 'promoting', 'recovered', 'rolled-back', 'unresolved'])

/** Known profile phases. */
const PROFILE_PHASES = new Set(['idle', 'starting', 'healthy', 'degraded', 'stopping', 'exited', 'suspected', 'failed', 'quarantined'])

/** Known system phases. */
const SYSTEM_PHASES = new Set(['disabled', 'provisioning', 'armed', 'degraded', 'updating', 'rolling-back', 'uninstalling', 'broken'])

/** Lenient validation of one incident row; invalid rows are dropped. */
function parseIncident(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const id = record['id']
  const summary = record['summary']
  const kind = record['kind']
  const phase = record['phase']
  if (typeof id !== 'string' || id === '' || typeof summary !== 'string') return undefined
  if (typeof kind !== 'string' || !INCIDENT_KINDS.has(kind)) return undefined
  if (typeof phase !== 'string' || !INCIDENT_PHASES.has(phase)) return undefined
  const profileId = record['profileId']
  const openedAt = record['openedAt']
  const updatedAt = record['updatedAt']
  const repairable = record['repairable']
  const candidateId = record['candidateId']
  return {
    id,
    summary,
    kind,
    phase,
    profileId: typeof profileId === 'string' ? profileId : undefined,
    openedAt: typeof openedAt === 'string' ? openedAt : undefined,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : undefined,
    repairable: typeof repairable === 'boolean' ? repairable : undefined,
    candidateId: typeof candidateId === 'string' ? candidateId : undefined,
  }
}

/** Lenient validation of one profile row; invalid rows are dropped. */
function parseProfile(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const identity = asRecord(record['identity'])
  const phase = record['phase']
  if (phase !== undefined && (typeof phase !== 'string' || !PROFILE_PHASES.has(phase))) return undefined
  return {
    identity: identity === undefined ? undefined : {
      id: typeof identity['id'] === 'string' ? identity['id'] : undefined,
      name: typeof identity['name'] === 'string' ? identity['name'] : undefined,
    },
    phase,
    pid: typeof record['pid'] === 'number' ? record['pid'] : undefined,
    runId: typeof record['runId'] === 'string' ? record['runId'] : undefined,
    startedAt: typeof record['startedAt'] === 'string' ? record['startedAt'] : undefined,
    lastHealthyAt: typeof record['lastHealthyAt'] === 'string' ? record['lastHealthyAt'] : undefined,
    restartCount: typeof record['restartCount'] === 'number' ? record['restartCount'] : undefined,
    managed: typeof record['managed'] === 'boolean' ? record['managed'] : undefined,
  }
}

/** Lenient validation of the snapshot object. */
function parseSnapshot(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const phase = record['phase']
  const profilesValue = record['profiles']
  const incidentsValue = record['incidents']
  const profiles = Array.isArray(profilesValue)
    ? profilesValue.map(parseProfile).filter((entry): entry is Record<string, unknown> => entry !== undefined)
    : undefined
  const incidents = Array.isArray(incidentsValue)
    ? incidentsValue.map(parseIncident).filter((entry): entry is Record<string, unknown> => entry !== undefined)
    : undefined
  return {
    protocol: typeof record['protocol'] === 'number' ? record['protocol'] : undefined,
    phase: phase !== undefined && (typeof phase !== 'string' || !SYSTEM_PHASES.has(phase)) ? undefined : phase,
    version: typeof record['version'] === 'string' ? record['version'] : undefined,
    capsuleVersion: typeof record['capsuleVersion'] === 'string' ? record['capsuleVersion'] : undefined,
    profiles,
    incidents,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : undefined,
    degradedReason: typeof record['degradedReason'] === 'string' ? record['degradedReason'] : undefined,
    policy: (() => { const policy = asRecord(record['policy']); return policy === undefined ? undefined : { fullProtection: typeof policy['fullProtection'] === 'boolean' ? policy['fullProtection'] : undefined, autoRepair: typeof policy['autoRepair'] === 'boolean' ? policy['autoRepair'] : undefined } })(),
  }
}

/**
 * Validate a SupervisorResponse body. Returns undefined on malformed input;
 * the response keeps its business ok flag so callers can distinguish a
 * supervisor refusal from a transport failure.
 */
export function parseSupervisorResponse(value: unknown): DoctorSupervisorResponse | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const ok = record['ok']
  if (typeof ok !== 'boolean') return undefined
  const snapshot = parseSnapshot(record['snapshot'])
  const error = asRecord(record['error'])
  const message = error?.['message']
  const hostVersion = record['hostVersion']
  return {
    ok,
    snapshot: snapshot === undefined ? undefined : (snapshot as DoctorSupervisorResponse['snapshot']),
    error: error === undefined ? undefined : {
      code: typeof error['code'] === 'string' ? error['code'] : undefined,
      message: typeof message === 'string' ? message : undefined,
    },
    hostVersion: typeof hostVersion === 'string' ? hostVersion : undefined,
  }
}

/**
 * Loopback API client. Pass a fetch seam in tests; the browser default calls
 * the page's global fetch with the DOCTOR_API_BASE prefix.
 */
export class DoctorApi {
  private readonly fetch: DoctorFetch
  private readonly base: string

  constructor(deps?: { fetch?: DoctorFetch; base?: string }) {
    this.fetch = deps?.fetch ?? defaultFetch
    this.base = deps?.base ?? ''
  }

  /** GET /api/doctor/status (supervisor snapshot). */
  async status(): Promise<DoctorApiResult<DoctorSupervisorResponse>> {
    return await this.request('status', undefined)
  }

  /** POST /api/doctor/action: run a supervisor action by name. */
  async action(name: DoctorActionName, selection?: { profileId?: string; incidentId?: string }): Promise<DoctorApiResult<DoctorSupervisorResponse>> {
    const body: Record<string, unknown> = { action: name }
    if (selection?.profileId !== undefined) body['profileId'] = selection.profileId
    if (selection?.incidentId !== undefined) body['incidentId'] = selection.incidentId
    return await this.post('action', body)
  }

  /** POST /api/doctor/client-failure: report a browser-side failure. */
  async reportClientFailure(input: { message: string; stack?: string; phase?: string; runId?: string }): Promise<DoctorApiResult<DoctorSupervisorResponse>> {
    const body: Record<string, unknown> = { message: input.message.slice(0, 4096) }
    if (input.stack !== undefined) body['stack'] = input.stack.slice(0, 16_384)
    if (input.phase !== undefined) body['phase'] = input.phase.slice(0, 128)
    if (input.runId !== undefined) body['runId'] = input.runId
    return await this.post('client-failure', body)
  }

  private async post<T>(endpoint: string, body: unknown): Promise<DoctorApiResult<T>> {
    return await this.request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  private async request<T>(endpoint: string, init: { method?: string; headers?: Record<string, string>; body?: string } | undefined): Promise<DoctorApiResult<T>> {
    let response: DoctorHttpResponse
    try {
      response = await this.fetch(this.base + '/' + endpoint, init)
    } catch (error) {
      return { ok: false, kind: 'network', message: safeError(error) }
    }
    if (response.status === 403 || response.status === 401 || response.status === 405) {
      return { ok: false, kind: 'loopback', status: response.status, message: 'request refused' }
    }
    if (response.status === 404) {
      return { ok: false, kind: 'not-available', status: response.status }
    }
    if (response.status === 503) {
      return { ok: false, ...await serviceError(response) }
    }
    if (!response.ok) {
      return { ok: false, kind: 'http', status: response.status, message: await bodyError(response) }
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      // A 200 SPA fallback page means the host half is not mounted.
      return { ok: false, kind: 'not-available', status: response.status }
    }
    const parsed = parseSupervisorResponse(body)
    if (parsed === undefined) return { ok: false, kind: 'malformed', status: response.status }
    if (!parsed.ok) {
      const message = parsed.error?.message
      return { ok: false, kind: 'supervisor', status: response.status, message: message ?? 'supervisor refused' }
    }
    return { ok: true, value: parsed as unknown as T }
  }
}

/**
 * Classify a 503 service-deployment error. The host half answers 503 with
 * SUPERVISOR_UNPROVISIONED (state missing) or SUPERVISOR_DOWN (state present
 * but the daemon is not answering); anything else degrades to the http kind.
 */
async function serviceError(response: DoctorHttpResponse): Promise<{ kind: DoctorApiFailureKind; status: number; message?: string; code?: string }> {
  try {
    const body = await response.json()
    const record = asRecord(body)
    const error = asRecord(record?.['error'])
    const code = typeof error?.['code'] === 'string' ? error['code'] : undefined
    const message = typeof error?.['message'] === 'string' ? error['message'] : undefined
    const kind: DoctorApiFailureKind = code === 'SUPERVISOR_UNPROVISIONED' ? 'unprovisioned' : code === 'SUPERVISOR_DOWN' ? 'supervisor-down' : 'http'
    return { kind, status: response.status, message, code }
  } catch {
    return { kind: 'http', status: response.status }
  }
}

/** Read an error message from a failed response (never throws). */
async function bodyError(response: DoctorHttpResponse): Promise<string> {
  try {
    const body = await response.json()
    const record = asRecord(body)
    const error = asRecord(record?.['error'])
    const message = error?.['message'] ?? record?.['error']
    if (typeof message === 'string' && message !== '') return message
    return 'HTTP ' + String(response.status)
  } catch {
    return 'HTTP ' + String(response.status)
  }
}

/** Safe one-line error description. */
function safeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}
