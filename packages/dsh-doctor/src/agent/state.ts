import { randomUUID } from 'node:crypto'
import type { DoctorPolicy, IncidentRecord, ProfileIdentity, ProfileRuntime, SupervisorSnapshot } from '../core/protocol.ts'
import { DEFAULT_DOCTOR_POLICY, DOCTOR_PROTOCOL_VERSION } from '../core/protocol.ts'

export interface PersistedState { phase: SupervisorSnapshot['phase']; profiles: Record<string, ProfileRuntime>; incidents: Record<string, IncidentRecord>; recentFailures: Record<string, string[]>; paused: boolean; policy: DoctorPolicy; capsuleVersion?: string; degradedReason?: string }
export function emptyState(): PersistedState { return { phase: 'disabled', profiles: {}, incidents: {}, recentFailures: {}, paused: false, policy: { ...DEFAULT_DOCTOR_POLICY } } }
export function snapshotOf(state: PersistedState, version: string, now = new Date().toISOString()): SupervisorSnapshot {
  return { protocol: DOCTOR_PROTOCOL_VERSION, phase: state.phase, version, capsuleVersion: state.capsuleVersion, degradedReason: state.degradedReason, policy: { ...(state.policy ?? DEFAULT_DOCTOR_POLICY) }, profiles: Object.values(state.profiles), incidents: Object.values(state.incidents).sort((a, b) => b.openedAt.localeCompare(a.openedAt)), updatedAt: now }
}
export function upsertProfile(state: PersistedState, identity: ProfileIdentity): ProfileRuntime {
  const current = state.profiles[identity.id] ?? { identity, phase: 'idle', restartCount: 0, managed: true }
  current.identity = identity; state.profiles[identity.id] = current; return current
}
export function openIncident(state: PersistedState, profileId: string, kind: IncidentRecord['kind'], summary: string, evidence: string[], now: string): IncidentRecord {
  const active = Object.values(state.incidents).find(item => item.profileId === profileId && !['recovered', 'rolled-back', 'unresolved'].includes(item.phase))
  if (active) { active.updatedAt = now; const merged = evidence.length > 0 ? evidence : [summary]; active.evidence = [...new Set([...active.evidence, ...merged])]; return active }
  const incident: IncidentRecord = { id: randomUUID(), profileId, kind, phase: 'opened', openedAt: now, updatedAt: now, summary, evidence: evidence.length > 0 ? evidence : [summary], repairable: true }
  state.incidents[incident.id] = incident; return incident
}
export function recordFailure(state: PersistedState, profileId: string, at: string, windowMs = 10 * 60_000): number {
  const cutoff = Date.parse(at) - windowMs
  const retained = (state.recentFailures[profileId] ?? []).filter(value => Date.parse(value) >= cutoff)
  retained.push(at); state.recentFailures[profileId] = retained; return retained.length
}
