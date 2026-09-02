import { mkdir, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path/posix'
import { DEFAULT_DOCTOR_POLICY, isSupervisorRequest, type DoctorPolicy, type SupervisorRequest, type SupervisorResponse } from '../core/protocol.ts'
import { appendJsonLine, readJson, writeJsonAtomic } from '../core/store.ts'
import { ensureToken, tokensEqual, type WireEnvelope } from './ipc.ts'
import { doctorPaths, type DoctorPaths } from './paths.ts'
import { provisionCapsule, removeCapsuleCredentialFiles } from './capsule.ts'
import { resolveDshHome } from '../core/profile.ts'
import { findRealDsh } from './launch.ts'
import { currentPackageVersion } from './version.ts'
import { emptyState, openIncident, recordFailure, snapshotOf, upsertProfile, type PersistedState } from './state.ts'

export interface SupervisorOptions {
  paths?: DoctorPaths
  version?: string
  now?: () => string
  heartbeatTimeoutMs?: number
  /** Capsule provisioning seam; tests inject a fake and skip real dsh runs. */
  provisioner?: (paths: DoctorPaths) => Promise<void>
}

export class DoctorSupervisor {
  readonly paths: DoctorPaths
  private state: PersistedState = emptyState()
  private token = ''
  private server?: Server
  private sweep?: NodeJS.Timeout
  private readonly version: string
  private readonly now: () => string
  private readonly heartbeatTimeoutMs: number
  private readonly provisioner: ((paths: DoctorPaths) => Promise<void>) | undefined
  private provisioning = false
  lastSelfHeal: Promise<void> | undefined

  constructor(options: SupervisorOptions = {}) {
    this.paths = options.paths ?? doctorPaths()
    this.version = options.version ?? currentPackageVersion()
    this.now = options.now ?? (() => new Date().toISOString())
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15_000
    this.provisioner = options.provisioner
  }

  async start(): Promise<void> {
    await mkdir(this.paths.state, { recursive: true, mode: 0o700 })
    this.token = await ensureToken(this.paths.token)
    this.state = await readJson(join(this.paths.state, 'supervisor.json'), emptyState())
    this.state.policy = await readJson<DoctorPolicy>(join(this.paths.state, 'policy.json'), this.state.policy ?? DEFAULT_DOCTOR_POLICY)
    this.state.phase = this.state.paused ? 'disabled' : 'armed'
    if (process.platform !== 'win32') await rm(this.paths.socket, { force: true })
    this.server = createServer({ allowHalfOpen: true }, socket => {
      socket.setEncoding('utf8')
      let body = ''
      let handled = false
      const respond = (value: SupervisorResponse): void => {
        if (socket.destroyed || socket.writableEnded) return
        socket.end(JSON.stringify(value))
      }
      socket.on('data', chunk => {
        body += chunk
        if (body.length > 256 * 1024) socket.destroy(new Error('doctor: IPC body too large'))
        if (!handled && body.includes('\n')) {
          handled = true
          void this.handleWire(body).then(respond, error => respond({ ok: false, error: { code: 'INTERNAL', message: String(error) } }))
        }
      })
      socket.on('error', () => undefined)
      socket.on('end', () => {
        if (!handled) {
          handled = true
          void this.handleWire(body).then(respond, error => respond({ ok: false, error: { code: 'INTERNAL', message: String(error) } }))
        }
      })
    })
    await new Promise<void>((resolvePromise, reject) => { this.server!.once('error', reject); this.server!.listen(this.paths.socket, () => resolvePromise()) })
    this.sweep = setInterval(() => { void this.sweepHeartbeats() }, 5000); this.sweep.unref?.()
    await this.persist()
  }

  async stop(): Promise<void> {
    if (this.sweep) clearInterval(this.sweep)
    if (this.server) await new Promise<void>(resolvePromise => this.server!.close(() => resolvePromise()))
    if (process.platform !== 'win32') await rm(this.paths.socket, { force: true })
    await this.persist()
  }

  async handleWire(body: string): Promise<SupervisorResponse> {
    let envelope: WireEnvelope
    try { envelope = JSON.parse(body.trim()) as WireEnvelope } catch { return { ok: false, error: { code: 'INVALID_JSON', message: 'Invalid request' } } }
    if (!tokensEqual(envelope.token ?? '', this.token)) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }
    if (!isSupervisorRequest(envelope.request)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Unsupported request' } }
    return this.handle(envelope.request)
  }

  async handle(request: SupervisorRequest): Promise<SupervisorResponse> {
    const at = this.now()
    if (request.type === 'status') return { ok: true, snapshot: snapshotOf(this.state, this.version, at) }
    if (request.type === 'policy') {
      this.state.policy = { fullProtection: request.policy.fullProtection, autoRepair: request.policy.autoRepair, autoMigrate: request.policy.autoMigrate }
      for (const profile of Object.values(this.state.profiles)) profile.managed = request.policy.fullProtection
    } else if (request.type === 'launcher-start') {
      if (request.profile.role === 'rescue') return { ok: true, snapshot: snapshotOf(this.state, this.version, at) }
      const profile = upsertProfile(this.state, request.profile); Object.assign(profile, { phase: 'starting', pid: request.pid, runId: request.runId, command: request.argv, startedAt: request.at, managed: this.state.policy.fullProtection })
    } else if (request.type === 'heartbeat') {
      const profile = this.state.profiles[request.profileId]
      if (profile) Object.assign(profile, { phase: request.phase === 'ready' ? 'healthy' : request.phase === 'degraded' ? 'degraded' : 'starting', pid: request.pid, runId: request.runId, lastHealthyAt: request.at })
    } else if (request.type === 'launcher-exit') {
      const profile = this.state.profiles[request.profileId]
      if (profile) { profile.pid = undefined; profile.phase = request.intentional || request.exitCode === 0 ? 'exited' : 'failed'
        if (this.state.policy.fullProtection && !this.state.paused && !request.intentional && request.exitCode !== 0) { const failures = recordFailure(this.state, request.profileId, request.at); profile.restartCount = failures; if (failures >= 2) profile.phase = 'quarantined'; openIncident(this.state, request.profileId, request.started ? 'process-crash' : 'boot-failure', request.started ? 'DSH process crashed after startup' : 'DSH profile failed during startup', [request.stderrTail ?? ''].filter(Boolean), request.at) }
        if (this.state.policy.autoRepair && this.state.policy.fullProtection && !this.state.paused && !request.intentional && request.exitCode !== 0 && !request.started) {
          this.lastSelfHeal = this.selfHealBootFailure(profile, request.stderrTail ?? '', request.at)
          void this.lastSelfHeal
        }
      }
    } else if (request.type === 'client-failure') {
      if (this.state.policy.fullProtection && !this.state.paused) openIncident(this.state, request.profileId, 'client-failure', request.message, [request.stack ?? '', request.phase ?? ''].filter(Boolean), request.at)
    } else if (request.type === 'action') {
      if (request.action === 'pause') { this.state.paused = true; this.state.phase = 'disabled' }
      else if (request.action === 'resume') { this.state.paused = false; this.state.phase = 'armed' }
      else if (request.action === 'provision') { await this.startProvision() }
      else if (request.action === 'uninstall') { this.state.phase = 'uninstalling'; this.state.degradedReason = undefined; await this.cleanupCapsuleCredentials() }
      else if (request.incidentId) { const incident = this.state.incidents[request.incidentId]; if (incident) { incident.phase = request.action === 'rollback' ? 'rolled-back' : request.action === 'confirm' || request.action === 'repair' ? 'repairing' : request.action === 'diagnose' ? 'diagnosing' : incident.phase; if (request.action === 'diagnose' || request.action === 'repair' || request.action === 'confirm' || request.action === 'rollback') await this.runRecovery(request.action, request.incidentId, at) } }
    }
    await appendJsonLine(join(this.paths.logs, 'journal.jsonl'), { at, request: request.type })
    await this.persist()
    return { ok: true, snapshot: snapshotOf(this.state, this.version, at) }
  }

  /**
   * Self-heal one boot failure: attribute the error trace to a plugin row,
   * and when exactly one row is implicated, disable it in the profile patch
   * so the next `dsh web` boots without it. Debounced by the profile's
   * recent-failure window (recordFailure already ran; the second failure in
   * ten minutes is the trigger). Refuses to act when attribution is absent
   * or ambiguous — a wrong guess would disable a healthy plugin.
   */
  private async selfHealBootFailure(profile: PersistedState['profiles'][string], stderrTail: string, at: string): Promise<void> {
    try {
      const failures = this.state.recentFailures[profile.identity.id]?.length ?? 1
      // First failure: observe only. The user may have just broken something
      // transiently (an in-progress edit); disabling on the first strike is
      // too aggressive.
      if (failures < 2) return
      const { attributeBootFailure } = await import('../core/boot-attribution.ts')
      const { parsePatchList } = await import('../core/patch.ts')
      const { createYamlEngine } = await import('../core/yaml.ts')
      const { nodeFs: fs } = await import('../core/fs.ts')
      const patchPath = profile.identity.dshHome + '/profiles/' + profile.identity.name + '/cordis.patch.yml'
      const text = await fs.readText(patchPath).catch(() => undefined)
      if (text === undefined) return
      const parsed = parsePatchList(text, createYamlEngine(), 'profile patch')
      if (parsed.error !== undefined) return // unparseable: the D-040 lane owns it
      const rowIds: string[] = []
      const namesByRowId: Record<string, string> = {}
      const walk = (entries: readonly unknown[]): void => {
        for (const entry of entries) {
          if (typeof entry !== 'object' || entry === null) continue
          const row = entry as { id?: unknown; name?: unknown; insert?: unknown; config?: unknown }
          if (typeof row.id === 'string') { rowIds.push(row.id); if (typeof row.name === 'string') namesByRowId[row.id] = row.name }
          if (Array.isArray(row.insert)) walk(row.insert)
          if (Array.isArray(row.config)) walk(row.config)
        }
      }
      walk(parsed.entries)
      const verdict = attributeBootFailure({ stderrTail, rowIds, namesByRowId })
      const incident = Object.values(this.state.incidents).find(item => item.profileId === profile.identity.id && !['recovered', 'rolled-back', 'unresolved'].includes(item.phase))
      if (verdict === undefined) {
        if (incident !== undefined) incident.evidence = [...new Set([...incident.evidence, 'self-heal: boot failure could not be attributed to a single plugin row; no automatic disable'])]
        return
      }
      const { quarantinePluginRow } = await import('../core/plugin-quarantine.ts')
      const outcome = await quarantinePluginRow({ home: profile.identity.dshHome, profile: profile.identity.name, rowId: verdict.rowId, reason: 'boot failure (' + verdict.source + ')', fs, now: this.now })
      const note = 'self-heal: ' + verdict.rowId + ' disabled after repeated boot failure — ' + outcome.phase + (outcome.message !== undefined ? ' (' + outcome.message + ')' : '')
      if (incident !== undefined) { incident.updatedAt = at; incident.evidence = [...new Set([...incident.evidence, note, verdict.evidence])] }
      else openIncident(this.state, profile.identity.id, 'boot-failure', 'self-healed: plugin ' + verdict.rowId + ' disabled after repeated boot failures', [note, verdict.evidence], at)
      await appendJsonLine(join(this.paths.logs, 'journal.jsonl'), { at, request: 'self-heal', rowId: verdict.rowId, outcome: outcome.phase })
    } catch (error) {
      await appendJsonLine(join(this.paths.logs, 'journal.jsonl'), { at, request: 'self-heal-error', error: String(error) }).catch(() => undefined)
    }
  }

  /**
   * Run the deterministic recovery workflow for one incident; records the outcome on the incident.
   */
  private async runRecovery(action: 'diagnose' | 'repair' | 'confirm' | 'rollback', incidentId: string, at: string): Promise<void> {
    const incident = this.state.incidents[incidentId]
    const profile = this.state.profiles[incident?.profileId ?? '']
    if (incident === undefined || profile === undefined) return
    try {
      const request = { home: profile.identity.dshHome, profile: profile.identity.name, dshPath: profile.identity.dshExecutable }
      const { confirmRepair, diagnoseAndPlan, repairProfile, rollbackTransaction } = await import('../core/recover.ts')
      let outcome
      if (action === 'diagnose') outcome = await diagnoseAndPlan(request)
      else if (action === 'rollback') {
        const { readdir, readFile } = await import('node:fs/promises')
        const { doctorRoot } = await import('../core/paths.ts')
        const dir = doctorRoot(request.home) + '/transactions'
        let latest
        try { latest = (await readdir(dir)).filter(name => name.endsWith('.json')).sort().reverse()[0] } catch { latest = undefined }
        outcome = latest === undefined ? undefined : await rollbackTransaction(request, latest.slice(0, -5))
      } else {
        const running = profile.pid !== undefined && profile.pid > 0
        if (action === 'confirm') {
          outcome = incident.candidateId === undefined ? undefined : await confirmRepair({ ...request, allowLive: !running }, incident.candidateId)
        } else {
          outcome = await repairProfile({ ...request, allowLive: !running, autoPromote: this.state.policy.autoRepair })
        }
      }
      if (outcome === undefined) return
      incident.updatedAt = at
      incident.evidence = [...new Set([...incident.evidence, 'recovery: ' + outcome.phase + (outcome.message !== undefined ? ' - ' + outcome.message : '')])]
      if (outcome.phase === 'staged') { incident.phase = 'awaiting-confirmation'; if (outcome.txnId !== undefined) incident.candidateId = outcome.txnId }
      else if (outcome.ok) incident.phase = action === 'rollback' ? 'rolled-back' : 'recovered'
      else if (outcome.phase === 'failed' || outcome.phase === 'blocked' || outcome.phase === 'aborted') incident.phase = 'unresolved'
    } catch (error) {
      incident.updatedAt = at
      incident.evidence = [...incident.evidence, 'recovery error: ' + (error instanceof Error ? error.message : String(error))]
    }
  }

  /**
   * Enter the provisioning phase and refresh the rescue capsule in the
   * background. The IPC response returns immediately with the provisioning
   * snapshot; the outcome (armed or degraded) is persisted when the capsule
   * run settles. Concurrent provision requests are coalesced.
   */
  async startProvision(): Promise<void> {
    if (this.provisioning) return
    this.provisioning = true
    this.state.phase = 'provisioning'
    await this.persist()
    void this.finishProvision(this.runCapsuleProvision())
  }

  private async finishProvision(pending: Promise<void>): Promise<void> {
    try {
      await pending
      this.state.phase = this.state.paused ? 'disabled' : 'armed'
      this.state.degradedReason = undefined
      this.state.capsuleVersion = this.version
    } catch (error) {
      this.state.phase = 'degraded'
      this.state.degradedReason = 'capsule provision failed: ' + (error instanceof Error ? error.message : String(error))
    } finally {
      this.provisioning = false
      await this.persist()
    }
  }

  private async runCapsuleProvision(): Promise<void> {
    if (this.provisioner !== undefined) {
      await this.provisioner(this.paths)
      return
    }
    const explicit = process.env.DSH_DOCTOR_REAL_DSH?.trim()
    const first = Object.values(this.state.profiles).find(profile => profile.identity.role !== 'rescue')
    const dshExecutable = explicit && explicit !== '' ? explicit : (first?.identity.dshExecutable ?? this.locateDsh())
    const spec = process.env.DSH_DOCTOR_PACKAGE?.trim() || '@linxin666/dsh-doctor@' + this.version
    const sourceHome = first?.identity.dshHome ?? resolveDshHome()
    const sourceProfile = first?.identity.name ?? 'web'
    await provisionCapsule({ paths: this.paths, dshExecutable, doctorSpec: spec, doctorPackageDir: process.env.DSH_DOCTOR_PACKAGE_DIR?.trim(), doctorVersion: this.version, sourceHome, sourceProfile, mirrorCredentials: process.env.DSH_DOCTOR_CREDENTIALS !== 'off' })
  }

  private async cleanupCapsuleCredentials(): Promise<void> {
    try { await removeCapsuleCredentialFiles(this.paths) } catch { /* best effort */ }
  }

  private locateDsh(): string {
    try { return findRealDsh() } catch { return 'dsh' }
  }

  private persistQueue: Promise<void> = Promise.resolve()

  /** Serialized persist: concurrent handle/sweep writes queue instead of racing on the temp file. */
  private persist(): Promise<void> {
    const write = (): Promise<void> => writeJsonAtomic(join(this.paths.state, 'supervisor.json'), this.state)
    this.persistQueue = this.persistQueue.catch(() => undefined).then(write)
    return this.persistQueue
  }

  private async sweepHeartbeats(): Promise<void> {
    const at = this.now(); const now = Date.parse(at)
    if (this.state.paused || !this.state.policy.fullProtection) return
    for (const profile of Object.values(this.state.profiles)) {
      if (profile.phase === 'healthy' && profile.lastHealthyAt && now - Date.parse(profile.lastHealthyAt) > this.heartbeatTimeoutMs) {
        profile.phase = 'suspected'
        openIncident(this.state, profile.identity.id, 'heartbeat-timeout', 'Doctor heartbeat timed out', ['last heartbeat: ' + profile.lastHealthyAt], at)
      }
    }
    await this.persist()
  }
}

export async function runSupervisor(): Promise<void> {
  const supervisor = new DoctorSupervisor(); await supervisor.start()
  const stop = (): void => { void supervisor.stop().finally(() => process.exit(0)) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
}
