/**
 * Recovery orchestration: snapshot, diagnose, plan, stage, verify, promote.
 *
 * This module wires the deterministic engine pieces into one fail-closed
 * transaction. It never edits a live profile directly: every mutation lands
 * in a staged candidate, the candidate passes isolated health gates, and
 * only then is promoted with the original quarantined. Any gate failure
 * aborts or rolls back the transaction and leaves a journal trail.
 *
 * Everything external (fs, yaml engine, process client, http client, clocks)
 * is injected so the flow is hermetic in tests.
 */
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { createYamlEngine, type YamlEngine } from './yaml.ts'
import { createLockManager, LockError } from './lock.ts'
import { createJournal, type Journal } from './journal.ts'
import { captureSnapshot, listProfileFiles } from './snapshot.ts'
import { diagnoseProfile, diagnoseFallback } from './diagnose.ts'
import { planRepair } from './plan.ts'
import { createCandidateTransaction, type CandidateTransaction, type CandidateTransactionDeps } from './transaction.ts'
import { redactText } from './redact.ts'
import { readProfileManifest } from './manifest.ts'
import { parsePatchList } from './patch.ts'
import { movePath, nodeFs, type FsLike } from './fs.ts'
import { writeJsonAtomicFs } from './store.ts'
import type { GateDeps as GateDepsAlias } from './gates.ts'
import { runDumpDefaultGate, runStartGate } from './gates.ts'
import {
  doctorRoot,
  journalPath,
  quarantineDir,
  resolveProfileDir,
  profilesDir,
  snapshotsDir,
  validateSegment,
  workDir,
} from './paths.ts'
import type { CandidateRecord, Diagnostic, GateReport, PlanAction } from './types.ts'

const nodeRequire = createRequire(import.meta.url)

export interface RecoveryRequest {
  /** The harness home (DSH_HOME) holding the profile. */
  home: string
  /** Safe profile name under profiles/. */
  profile: string
  /** Absolute path of the dsh executable used by the gates. */
  dshPath: string
  /** Injected filesystem (default nodeFs). */
  fs?: FsLike
  /** Injected gate dependencies (process, http, yaml, redaction, clock). */
  gate?: GateDepsAlias
  /** ISO timestamp provider (default now). */
  now?: () => string
  /** Milliseconds clock for locks and gate duration (default Date.now). */
  clock?: () => number
  /** Process id for lock tokens (default process.pid). */
  pid?: number
  /** Alive probe for stale-lock detection (default: pid 0 dead, others alive). */
  pidAlive?: (pid: number) => boolean
  /**
   * Promote only when truthy. The supervisor passes whether the profile is
   * currently running; the CLI defaults to blocked (fail-closed).
   */
  allowLive?: boolean
}

export interface RecoveryOutcome {
  ok: boolean
  phase: 'blocked' | 'diagnosed' | 'noop' | 'planned' | 'staged' | 'verified' | 'promoted' | 'rolled-back' | 'aborted' | 'failed'
  diagnostics: Diagnostic[]
  actions: PlanAction[]
  /** Actions that touch files outside the profile dir (home-level patch). Never auto-applied. */
  manualActions: PlanAction[]
  snapshotId?: string
  gates?: GateReport[]
  txnId?: string
  message?: string
}

/** Inputs needed to restore an existing transaction; no DSH process is run. */
export type RollbackRequest = Pick<RecoveryRequest, 'home' | 'profile' | 'fs' | 'now' | 'clock' | 'pid' | 'pidAlive'>

export interface RealGateOptions {
  /** Extra env for the gate runs (default process.env). */
  env?: Record<string, string | undefined>
  timeoutMs?: number
}

/** Build real process/http gate dependencies for a repair run. */
export function realGateDeps(options: { clock?: () => number; engine?: YamlEngine } = {}): GateDepsAlias {
  const engine = options.engine ?? createYamlEngine()
  const clock = options.clock ?? Date.now
  return {
    client: {
      spawn(command: string[], opts: { cwd?: string; env?: Record<string, string | undefined> }) {
        const child = spawnNode(command, opts)
        return {
          onStdout(cb) { (child.stdout as NodeJS.ReadableStream | null)?.on('data', (chunk: Buffer) => cb(String(chunk))) },
          onStderr(cb) { (child.stderr as NodeJS.ReadableStream | null)?.on('data', (chunk: Buffer) => cb(String(chunk))) },
          onExit(cb) { child.once('close', (code, signal) => cb(code, signal)) },
          kill(signal?: string) { child.kill(signal as NodeJS.Signals) },
        }
      },
    },
    http: {
      async get(url: string, opts: { timeoutMs: number }) {
        const response = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs) })
        return { status: response.status, body: await response.text() }
      },
    },
    engine,
    redactText: (text) => redactText(text),
    clock,
  }
}

function spawnNode(command: string[], opts: { cwd?: string; env?: Record<string, string | undefined> }) {
  const cp = nodeRequire('node:child_process') as typeof import('node:child_process')
  return cp.spawn(command[0]!, command.slice(1), { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv })
}

/** Snapshot one profile (read-only aside from the snapshot store). */
export async function snapshotProfile(request: RecoveryRequest): Promise<RecoveryOutcome> {
  const fs: FsLike = request.fs ?? nodeFs
  const now = request.now ?? (() => new Date().toISOString())
  const dir = resolveProfileDir(request.home, request.profile)
  const snapshotDir = snapshotsDir(request.home) + '/' + makeId(request.profile, now())
  await fs.mkdir(snapshotDir, { recursive: true })
  const manifest = await captureSnapshot({
    fs, home: request.home, profile: request.profile, profileDir: dir, snapshotDir, now,
    redactTexts: (text) => redactText(text),
  })
  return { ok: true, phase: 'diagnosed', diagnostics: [], actions: [], manualActions: [], snapshotId: manifest.snapshotId }
}

/** Diagnose and plan one profile without mutating it. */
export async function diagnoseAndPlan(request: RecoveryRequest): Promise<RecoveryOutcome> {
  const fs: FsLike = request.fs ?? nodeFs
  const engine: YamlEngine = request.gate?.engine ?? createYamlEngine()
  return await diagnoseAndPlanInner(request, fs, engine)
}

async function diagnoseAndPlanInner(request: RecoveryRequest, fs: FsLike, engine: YamlEngine): Promise<RecoveryOutcome> {
  const home = request.home
  const profile = request.profile
  const dir = resolveProfileDir(home, profile)
  const profilePatchPath = dir + '/cordis.patch.yml'
  const homePatchPath = home + '/cordis.patch.yml'
  const manifest = await readProfileManifest(fs, dir).catch(() => null)
  const manifestFacts: import('./types.ts').ManifestFacts = manifest?.facts ?? ({ hasDshProfile: false, bundles: [] } as unknown as import('./types.ts').ManifestFacts)
  const manifestText = manifest?.text ?? ''
  const profilePatch = parsePatchListSafe(await patchText(fs, profilePatchPath), engine, 'profile patch')
  const homePatch = parsePatchListSafe(await patchText(fs, homePatchPath), engine, 'home patch')
  const fallbacks = await diagnoseFallback(fs, home)
  const moduleNames = await collectModuleNames(fs, profilesDir(home) + '/node_modules')
  const profileModules = await collectModuleNames(fs, dir + '/node_modules')
  const bundleResolvable = (name: string): boolean =>
    name.startsWith('@deepseek-ai/') || profileModules.has(name) || moduleNames.has(name)
  const diagnostics = [
    ...diagnoseProfile({
      home,
      profile,
      dir,
      fs,
      manifest: manifestFacts,
      manifestText,
      bundleResolvable,
      bundleDeclaresPatch: () => undefined,
      profilePatch,
      homePatch,
      env: { DSH_HOME: home },
    }),
    ...fallbacks,
  ]
  const files: Record<string, string> = {}
  const addFile = async (path: string): Promise<void> => {
    if (files[path] !== undefined) return
    files[path] = await patchText(fs, path)
  }
  for (const diag of diagnostics) await addFile(diag.path)
  await addFile(profilePatchPath)
  await addFile(homePatchPath)
  const plan = planRepair({
    profile,
    diagnostics,
    files,
    patchPathByCode: { 'D-040': profilePatchPath, 'D-050': homePatchPath },
  })
  const manualActions = plan.actions.filter(action => !isInsideProfile(action.target, dir))
  const autoActions = plan.actions.filter(action => isInsideProfile(action.target, dir))
  const critical = diagnostics.filter(d => d.severity === 'critical' || d.severity === 'error')
  const actionable = critical.length > 0 || autoActions.length > 0 || manualActions.length > 0
  return {
    ok: critical.length === 0 || autoActions.length > 0,
    phase: actionable ? 'planned' : 'noop',
    diagnostics,
    actions: autoActions,
    manualActions,
    message: critical.length === 0 ? 'profile is healthy or advisory only' : undefined,
  }
}

async function collectModuleNames(fs: FsLike, root: string): Promise<Set<string>> {
  const names = new Set<string>()
  let entries
  try { entries = await fs.readdir(root) } catch { return names }
  for (const entry of entries) {
    if (entry.name.startsWith('@') && entry.kind === 'dir') {
      let scoped
      try { scoped = await fs.readdir(root + '/' + entry.name) } catch { continue }
      for (const child of scoped) names.add(entry.name + '/' + child.name)
    } else {
      names.add(entry.name)
    }
  }
  return names
}

async function patchText(fs: FsLike, path: string): Promise<string> {
  try { return await fs.readText(path) } catch { return '' }
}

function parsePatchListSafe(text: string, engine: YamlEngine, label: string): ReturnType<typeof parsePatchList> {
  if (text.trim() === '') return { entries: [], warnings: [], error: undefined } as unknown as ReturnType<typeof parsePatchList>
  try {
    return parsePatchList(text, engine, label)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) } as unknown as ReturnType<typeof parsePatchList>
  }
}

function isInsideProfile(target: string, profileDir: string): boolean {
  return target === profileDir || target.startsWith(profileDir + '/')
}

function makeId(profile: string, now: string): string {
  return profile + '-' + now.replace(/[^0-9]/g, '').slice(0, 14)
}

/** Run the full repair transaction (stage, apply, gates, promote, verify, commit). */
export async function repairProfile(request: RecoveryRequest, gateOptions: RealGateOptions = {}): Promise<RecoveryOutcome> {
  if (request.allowLive !== true) {
    return { ok: false, phase: 'blocked', diagnostics: [], actions: [], manualActions: [], message: 'repair blocked: allowLive is not set (a running instance may own the profile)' }
  }
  const fs: FsLike = request.fs ?? nodeFs
  const now = request.now ?? (() => new Date().toISOString())
  const clock = request.clock ?? Date.now
  const engine: YamlEngine = createYamlEngine()
  const gates = request.gate ?? realGateDeps({ clock, engine })
  const home = request.home
  const dir = resolveProfileDir(home, request.profile)
  if (!(await fs.exists(dir))) return { ok: false, phase: 'failed', diagnostics: [], actions: [], manualActions: [], message: 'profile dir missing: ' + dir }

  const journal = createJournal({ fs, file: journalPath(home), now })
  const locks = createLockManager({ fs, home, pid: request.pid ?? process.pid, host: 'local', clock, iso: now, pidAlive: request.pidAlive ?? ((pid) => pid !== 0) })
  const globalLock = await locks.acquire('global', undefined, { intent: 'repair ' + request.profile })
  let profileLock: Awaited<ReturnType<typeof locks.acquire>> | undefined
  try {
    profileLock = await locks.acquire('profile', request.profile, { intent: 'repair' })
    const diagnosis = await diagnoseAndPlan(request)
    const snapshotResult = await snapshotProfile(request)
    const txnDeps: CandidateTransactionDeps = {
      fs,
      home,
      profile: request.profile,
      now,
      journal,
      beforeCompensation: async () => {
        await globalLock.touch(clock())
        if (profileLock === undefined) throw new LockError('LOCK_LOST', 'profile', 'profile/' + request.profile, 'profile lock is no longer held')
        await profileLock.touch(clock())
      },
    }
    const txn = createCandidateTransaction(txnDeps)
    if (diagnosis.actions.length === 0 && diagnosis.manualActions.length > 0) {
      await journal.append({ op: 'repair:manual-required', ok: false, detail: { profile: request.profile, manual: diagnosis.manualActions } })
      await profileLock.release()
      profileLock = undefined
      return { ok: false, phase: 'planned', diagnostics: diagnosis.diagnostics, actions: [], manualActions: diagnosis.manualActions, snapshotId: snapshotResult.snapshotId, message: 'manual confirmation required for home-level repairs' }
    }
    if (diagnosis.actions.length === 0 && diagnosis.manualActions.length === 0) {
      await journal.append({ op: 'repair:noop', ok: true, detail: { profile: request.profile } })
      await profileLock.release()
      profileLock = undefined
      return { ...diagnosis, ok: true, phase: 'noop', snapshotId: snapshotResult.snapshotId, txnId: txn.txnId }
    }
    await txn.stage()
    await journal.append({ op: 'repair:stage', ok: true, detail: { txn: txn.txnId } })
    for (const action of diagnosis.actions) {
      const rel = action.target.slice(dir.length + 1)
      const stagedTarget = txn.record.stagingPath + '/' + rel
      if (action.op === 'move-path') {
        await fs.rename(stagedTarget, stagedTarget + '.doctor-broken')
        await journal.append({ op: 'repair:apply-move', ok: true, detail: { txn: txn.txnId, target: action.target } })
      } else if (action.op === 'write-file' && action.content !== undefined) {
        await fs.writeText(stagedTarget, action.content)
        await journal.append({ op: 'repair:apply-write', ok: true, detail: { txn: txn.txnId, target: action.target } })
      }
    }
    const isolated = workDir(home) + '/' + txn.txnId
    await fs.mkdir(isolated, { recursive: true })
    const isolatedProfileDir = isolated + '/profiles/' + request.profile
    await fs.mkdir(isolatedProfileDir, { recursive: true })
    await copyProfileFiles(fs, txn.record.stagingPath, isolatedProfileDir)
    const env = gateEnvironmentOf(request, gateOptions, isolated)
    const dump = await runDumpDefaultGateSafe(gates, request.dshPath, isolated, request.profile, env, gateOptions.timeoutMs)
    const start = dump.ok ? await runStartGateSafe(gates, request.dshPath, isolated, request.profile, env, gateOptions.timeoutMs) : undefined
    const gateReports = [dump, ...(start !== undefined ? [start] : [])]
    if (!dump.ok || start === undefined || !start.ok) {
      await txn.abort()
      await journal.append({ op: 'repair:gates-failed', ok: false, detail: { txn: txn.txnId, report: gateReports } })
      return { ok: false, phase: 'aborted', diagnostics: diagnosis.diagnostics, actions: diagnosis.actions, manualActions: diagnosis.manualActions, snapshotId: snapshotResult.snapshotId, gates: gateReports, txnId: txn.txnId, message: 'candidate failed the isolated health gates' }
    }
    // Surface a lost background lease before the first live-profile mutation.
    await globalLock.touch(clock())
    await profileLock.touch(clock())
    try {
      await txn.promote()
      // Persist the promoted layout before any auxiliary journal write. If
      // lease verification then fails, a new owner can recover from this
      // record without relying on the in-memory transaction object.
      await writeTransactionRecord(fs, home, txn.record)
      await globalLock.touch(clock())
      await profileLock.touch(clock())
      await journal.append({ op: 'repair:promote', ok: true, detail: { txn: txn.txnId } })
      const liveEnv = gateEnvironmentOf(request, gateOptions, home)
      const liveDump = await runDumpDefaultGateSafe(gates, request.dshPath, home, request.profile, liveEnv, gateOptions.timeoutMs)
      // A live verification can outlast the lease interval. Revalidate both
      // generations before rollback or commit mutates the promoted layout.
      await globalLock.touch(clock())
      await profileLock.touch(clock())
      if (!liveDump.ok) {
        await rollbackPromotedFailure(fs, home, journal, txn, 'live verification failed')
        await journal.append({ op: 'repair:live-verify-failed', ok: false, detail: { txn: txn.txnId } })
        return { ok: false, phase: 'rolled-back', diagnostics: diagnosis.diagnostics, actions: diagnosis.actions, manualActions: diagnosis.manualActions, snapshotId: snapshotResult.snapshotId, gates: gateReports, txnId: txn.txnId, message: 'live verification failed after promote; rolled back' }
      }
      // Keep the transaction rollback-capable until every fallible recovery
      // side effect has completed. commit() is deliberately the final await.
      await journal.append({ op: 'repair:commit', ok: true, detail: { txn: txn.txnId } })
      await txn.commit()
      return { ok: true, phase: 'promoted', diagnostics: diagnosis.diagnostics, actions: diagnosis.actions, manualActions: diagnosis.manualActions, snapshotId: snapshotResult.snapshotId, gates: gateReports, txnId: txn.txnId }
    } catch (error) {
      // If ownership cannot be proved, do not perform compensating live-path
      // mutations either. The durable promoted record is safe to recover on
      // the next invocation that successfully acquires both locks.
      if (error instanceof LockError) throw error
      if (txn.phase() === 'promoted') {
        // The triggering error may be unrelated to the lock while a
        // background heartbeat has already failed. Prove both generations
        // again before any compensating live-profile move.
        await globalLock.touch(clock())
        await profileLock.touch(clock())
        try {
          await rollbackPromotedFailure(fs, home, journal, txn, error instanceof Error ? error.message : String(error))
        } catch (rollbackError) {
          throw new Error('post-promote failure: ' + String(error) + '; automatic rollback failed: ' + String(rollbackError))
        }
      }
      throw error
    }
  } catch (error) {
    await journal.append({ op: 'repair:error', ok: false, detail: { error: error instanceof Error ? error.message : String(error) } }).catch(() => undefined)
    return { ok: false, phase: 'failed', diagnostics: [], actions: [], manualActions: [], message: error instanceof Error ? error.message : String(error) }
  } finally {
    await profileLock?.release().catch(() => undefined)
    await globalLock.release().catch(() => undefined)
  }
}

async function rollbackPromotedFailure(fs: FsLike, home: string, journal: Journal, txn: CandidateTransaction, cause: string): Promise<void> {
  let rollbackWarning: string | undefined
  try {
    await txn.rollback()
  } catch (error) {
    rollbackWarning = error instanceof Error ? error.message : String(error)
  }
  if (txn.phase() !== 'rolled-back') {
    throw new Error(rollbackWarning ?? 'transaction remained in phase ' + txn.phase())
  }
  await writeTransactionRecord(fs, home, txn.record)
  await journal.append({
    op: 'repair:post-promote-rollback',
    ok: false,
    detail: { txn: txn.txnId, cause, ...(rollbackWarning === undefined ? {} : { rollbackWarning }) },
  }).catch(() => undefined)
}

/** Restore a promoted transaction by moving the quarantine back. */
export async function rollbackTransaction(request: RollbackRequest, txnId: string): Promise<RecoveryOutcome> {
  const fs: FsLike = request.fs ?? nodeFs
  const home = request.home
  const now = request.now ?? (() => new Date().toISOString())
  const clock = request.clock ?? Date.now
  let profile: string
  try {
    validateSegment(txnId, 'transaction id')
    profile = validateSegment(request.profile, 'profile')
    resolveProfileDir(home, profile)
  } catch (error) {
    return rollbackFailure(txnId, 'invalid rollback request: ' + String(error))
  }

  const recordPath = transactionRecordPath(home, txnId)
  const journal = createJournal({ fs, file: journalPath(home), now })
  const locks = createLockManager({ fs, home, pid: request.pid ?? process.pid, host: 'local', clock, iso: now, pidAlive: request.pidAlive ?? ((pid) => pid !== 0) })
  let globalLock: Awaited<ReturnType<typeof locks.acquire>> | undefined
  let profileLock: Awaited<ReturnType<typeof locks.acquire>> | undefined
  try {
    globalLock = await locks.acquire('global', undefined, { intent: 'rollback ' + profile + '/' + txnId })
    profileLock = await locks.acquire('profile', profile, { intent: 'rollback ' + txnId })

    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readText(recordPath)) as unknown
    } catch (error) {
      throw new Error('no readable transaction record for ' + txnId + ': ' + String(error))
    }
    const { record, livePath, quarantinePath } = validateRollbackRecord(parsed, home, profile, txnId)
    // The heartbeat runs in the background, but an explicit refresh turns a
    // prior ownership loss into a fail-closed result before filesystem moves.
    await globalLock.touch(clock())
    await profileLock.touch(clock())
    const discardedPath = livePath + '.doctor-discarded-' + txnId
    if (record.phase === 'rolled-back') {
      await fs.remove(discardedPath, { recursive: true }).catch(() => undefined)
      return { ok: true, phase: 'rolled-back', diagnostics: [], actions: [], manualActions: [], txnId, message: 'transaction ' + txnId + ' is already rolled back' }
    }
    if (record.phase !== 'promoted' && record.phase !== 'committed') {
      throw new Error('transaction ' + txnId + ' is ' + record.phase + '; only promoted or committed transactions roll back')
    }
    const quarantineExists = await fs.exists(quarantinePath)
    const liveExists = await fs.exists(livePath)
    const discardedExists = await fs.exists(discardedPath)
    if (!quarantineExists && liveExists && discardedExists) {
      // A previous rollback restored the quarantined original, then stopped
      // before its phase update became durable. This exact layout is
      // unambiguous: the canonical live path is already restored and the
      // displaced promoted candidate remains at this transaction's path.
      const rolledBackRecord = makeRolledBackRecord(record, quarantinePath, livePath)
      await writeTransactionRecord(fs, home, rolledBackRecord)
      await globalLock.touch(clock())
      await profileLock.touch(clock())
      await fs.remove(discardedPath, { recursive: true }).catch(() => undefined)
      await journal.append({ op: 'repair:rollback-finalize', ok: true, detail: { txn: txnId } }).catch(() => undefined)
      return { ok: true, phase: 'rolled-back', diagnostics: [], actions: [], manualActions: [], txnId, message: 'finalized interrupted rollback at ' + livePath }
    }
    if (!quarantineExists) {
      throw new Error('quarantine path missing at ' + quarantinePath + '; live profile left untouched')
    }
    let discarded: string | undefined
    if (liveExists) {
      discarded = discardedPath
      if (discardedExists) {
        throw new Error('discarded path already exists at ' + discardedPath + '; live profile left untouched')
      }
      await movePath(fs, livePath, discarded)
    } else if (discardedExists) {
      // Resume an earlier rollback that stopped after displacing the
      // promoted candidate but before restoring the quarantine.
      discarded = discardedPath
    }
    try {
      await movePath(fs, quarantinePath, livePath)
    } catch (error) {
      if (discarded !== undefined) {
        try {
          await movePath(fs, discarded, livePath)
        } catch (restoreError) {
          throw new Error('quarantine restore failed: ' + String(error) + '; restoring the live profile also failed: ' + String(restoreError))
        }
      }
      throw error
    }

    await globalLock.touch(clock())
    await profileLock.touch(clock())

    const rolledBackRecord = makeRolledBackRecord(record, quarantinePath, livePath)
    try {
      await writeTransactionRecord(fs, home, rolledBackRecord)
    } catch (error) {
      // Atomic record replacement can itself block long enough for a lease
      // failure. Never reverse the file moves unless both locks are still
      // owned by this rollback generation.
      await globalLock.touch(clock())
      await profileLock.touch(clock())
      try {
        await movePath(fs, livePath, quarantinePath)
        if (discarded !== undefined) await movePath(fs, discarded, livePath)
      } catch (restoreError) {
        throw new Error('transaction record persistence failed: ' + String(error) + '; restoring the promoted layout also failed: ' + String(restoreError))
      }
      throw new Error('transaction record persistence failed; rollback file moves were reverted: ' + String(error))
    }
    await globalLock.touch(clock())
    await profileLock.touch(clock())
    if (discarded !== undefined) await fs.remove(discarded, { recursive: true }).catch(() => undefined)
    await journal.append({ op: 'repair:rollback', ok: true, detail: { txn: txnId } })
    return { ok: true, phase: 'rolled-back', diagnostics: [], actions: [], manualActions: [], txnId, message: 'restored quarantine to ' + livePath }
  } catch (error) {
    await journal.append({ op: 'repair:rollback-error', ok: false, detail: { error: String(error) } }).catch(() => undefined)
    return rollbackFailure(txnId, error instanceof Error ? error.message : String(error))
  } finally {
    await profileLock?.release().catch(() => undefined)
    await globalLock?.release().catch(() => undefined)
  }
}

function makeRolledBackRecord(record: CandidateRecord, quarantinePath: string, livePath: string): CandidateRecord {
  const rolledBackRecord: CandidateRecord = {
    ...record,
    phase: 'rolled-back',
    steps: [...record.steps, { step: 'rollback-restore', from: quarantinePath, to: livePath }],
  }
  delete rolledBackRecord.error
  return rolledBackRecord
}

async function writeTransactionRecord(fs: FsLike, home: string, record: CandidateRecord): Promise<void> {
  validateSegment(record.txnId, 'transaction id')
  await writeJsonAtomicFs(fs, transactionRecordPath(home, record.txnId), record)
}

function transactionRecordPath(home: string, txnId: string): string {
  return join(doctorRoot(home), 'transactions', txnId + '.json')
}

/** Read and validate the profile identity needed by `rollback <txnId>`. */
export async function discoverRollbackProfile(home: string, txnId: string, fs: FsLike = nodeFs): Promise<string> {
  validateSegment(txnId, 'transaction id')
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readText(transactionRecordPath(home, txnId))) as unknown
  } catch (error) {
    throw new Error('no readable transaction record for ' + txnId + ': ' + String(error))
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('transaction ' + txnId + ' has a malformed record')
  }
  const record = parsed as { txnId?: unknown; profile?: unknown }
  if (record.txnId !== txnId) {
    throw new Error('transaction record id mismatch: expected ' + txnId + ', got ' + String(record.txnId))
  }
  if (typeof record.profile !== 'string') {
    throw new Error('transaction ' + txnId + ' has no valid profile')
  }
  const profile = validateSegment(record.profile, 'transaction profile')
  resolveProfileDir(home, profile)
  return profile
}

function validateRollbackRecord(value: unknown, home: string, profile: string, txnId: string): { record: CandidateRecord; livePath: string; quarantinePath: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('transaction ' + txnId + ' has a malformed record; live profile left untouched')
  }
  const record = value as Partial<CandidateRecord>
  if (record.txnId !== txnId) {
    throw new Error('transaction record id mismatch: expected ' + txnId + ', got ' + String(record.txnId))
  }
  if (typeof record.profile !== 'string') {
    throw new Error('transaction ' + txnId + ' has no valid profile; live profile left untouched')
  }
  validateSegment(record.profile, 'transaction profile')
  resolveProfileDir(home, record.profile)
  if (record.profile !== profile) {
    throw new Error('transaction ' + txnId + ' belongs to profile ' + record.profile + ', not ' + profile)
  }
  if (typeof record.phase !== 'string' || typeof record.livePath !== 'string' || typeof record.quarantinePath !== 'string' || typeof record.stagingPath !== 'string' || !Array.isArray(record.steps)) {
    throw new Error('transaction ' + txnId + ' has a malformed record; live profile left untouched')
  }

  const livePath = resolveProfileDir(home, profile)
  const quarantinePath = join(quarantineDir(home), profile, txnId, 'original')
  if (!samePath(record.livePath, livePath)) {
    throw new Error('transaction ' + txnId + ' live path does not match profile ' + profile + '; live profile left untouched')
  }
  if (!samePath(record.quarantinePath, quarantinePath)) {
    throw new Error('transaction ' + txnId + ' quarantine path does not match profile ' + profile + '; live profile left untouched')
  }
  return { record: record as CandidateRecord, livePath, quarantinePath }
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right)
}

function rollbackFailure(txnId: string, message: string): RecoveryOutcome {
  return { ok: false, phase: 'failed', diagnostics: [], actions: [], manualActions: [], txnId, message }
}

async function copyProfileFiles(fs: FsLike, fromDir: string, toDir: string): Promise<void> {
  await fs.mkdir(toDir, { recursive: true })
  const files = await listProfileFiles(fs, fromDir, ['node_modules', '.git', '.pnpm'])
  for (const file of files) {
    const target = toDir + '/' + file.rel
    await fs.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true })
    const data = await fs.readText(file.path).catch(() => '')
    await fs.writeText(target, data)
  }
}

function gateEnvironmentOf(request: RecoveryRequest, options: RealGateOptions, isolatedHome: string): Record<string, string | undefined> {
  return { ...(options.env ?? processEnviron()), DSH_HOME: isolatedHome, DSH_TELEMETRY_DISABLED: '1' }
}

function processEnviron(): Record<string, string | undefined> {
  return typeof process !== 'undefined' && typeof process.env === 'object' ? { ...process.env } : {}
}

async function runDumpDefaultGateSafe(gates: GateDepsAlias, dshPath: string, isolatedHome: string, profile: string, env: Record<string, string | undefined>, timeoutMs?: number): Promise<GateReport> {
  return await runDumpDefaultGate(gates, { dshPath, isolatedHome, profile, env, timeoutMs }, env)
}

async function runStartGateSafe(gates: GateDepsAlias, dshPath: string, isolatedHome: string, profile: string, env: Record<string, string | undefined>, timeoutMs?: number): Promise<GateReport> {
  return await runStartGate(gates, { dshPath, isolatedHome, profile, env, timeoutMs }, env)
}
