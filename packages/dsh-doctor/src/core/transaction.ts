/**
 * Candidate transaction: stage, promote, rollback, commit.
 *
 * Promotion moves the live profile aside into quarantine, then moves the
 * staged candidate into place. Both moves use the same-filesystem-friendly
 * movePath (rename, with EXDEV copy fallback), and every step is journaled
 * so a crash can be replayed: nothing is ever deleted without its evidence.
 */
import type { FsLike } from './fs.ts'
import { movePath, copyTree } from './fs.ts'
import { quarantineDir, stagingDir, validateSegment } from './paths.ts'
import type { CandidatePhase, CandidateRecord } from './types.ts'

export interface CandidateTransactionDeps {
  fs: FsLike
  home: string
  profile: string
  /** ISO timestamp provider for the record. */
  now(): string
  /** Closure for deterministic ids: txn = profile + '-' + nowCompact. */
  txnId?(profile: string): string
  /** Optional journal to record every step. */
  journal?: { append(entry: { op: string; ok: boolean; detail?: Record<string, unknown> }): Promise<unknown> }
  /** Restore a previously staged transaction for explicit confirmation. */
  initialRecord?: CandidateRecord
  /** Optional same-device assertion; when provided and false, promote refuses. */
  sameDevice?(a: string, b: string): Promise<boolean>
  /** Persist recovery intent while the candidate is still staged. */
  beforePromote?(record: CandidateRecord): Promise<void>
  /** Revalidate the caller's ownership before any compensating live move. */
  beforeCompensation?(): Promise<void>
}

export interface CandidateTransaction {
  readonly txnId: string
  readonly record: CandidateRecord
  phase(): CandidatePhase
  /** Copy the live profile files into staging (never touches live). */
  stage(): Promise<void>
  /** Swap staged candidate into the live location, quarantining the original. */
  promote(): Promise<void>
  /** Undo a promote, restoring the quarantined original. */
  rollback(): Promise<void>
  /** Abort a staged (not promoted) transaction, discarding staging. */
  abort(): Promise<void>
  /** Mark the promotion final and keep the quarantine as evidence. */
  commit(): Promise<void>
}

/** Create a candidate transaction for one profile. */
export function createCandidateTransaction(deps: CandidateTransactionDeps): CandidateTransaction {
  const fs = deps.fs
  const home = deps.home
  const profile = deps.profile
  validateSegment(profile, 'profile')
  const txnId = deps.initialRecord?.txnId ?? (deps.txnId === undefined ? makeTxnId(profile, deps.now()) : deps.txnId(profile))
  validateSegment(txnId, 'txn id')

  const livePath = home + '/profiles/' + profile
  const stagingBase = stagingDir(home)
  const stagingPath = stagingBase + '/' + profile + '/' + txnId
  const quarantineBase = quarantineDir(home)
  const quarantinePath = quarantineBase + '/' + profile + '/' + txnId + '/original'

  if (deps.initialRecord !== undefined && (deps.initialRecord.profile !== profile || deps.initialRecord.livePath !== livePath || deps.initialRecord.stagingPath !== stagingPath || deps.initialRecord.quarantinePath !== quarantinePath)) {
    throw new Error('txn ' + txnId + ': restored transaction paths do not match profile ' + profile)
  }
  let phase: CandidatePhase = deps.initialRecord?.phase ?? 'created'
  const steps: CandidateRecord['steps'] = deps.initialRecord?.steps ?? []
  const record: CandidateRecord = deps.initialRecord ?? { txnId, profile, phase, livePath, stagingPath, quarantinePath, steps }

  const setPhase = (next: CandidatePhase): void => {
    phase = next
    record.phase = next
  }

  const journal = async (op: string, detail?: Record<string, unknown>): Promise<void> => {
    if (deps.journal !== undefined) {
      await deps.journal.append({ op: 'txn:' + txnId + ':' + op, ok: true, detail })
    }
  }

  const sameDeviceGuard = async (): Promise<void> => {
    if (deps.sameDevice === undefined) return
    const same = await deps.sameDevice(stagingBase, home + '/profiles')
    if (!same) {
      throw new Error('txn ' + txnId + ': staging and profiles are on different devices; refuse rename-based promote')
    }
  }

  const rollbackPromoted = async (): Promise<void> => {
    await deps.beforeCompensation?.()
    // Keep one transaction-owned discard convention across in-process and
    // CLI rollback so a later invocation can finalize an interrupted restore.
    const discarded = livePath + '.doctor-discarded-' + txnId
    if (!(await fs.exists(quarantinePath))) {
      throw txnError(txnId, phase, 'quarantine path missing at ' + quarantinePath + '; live profile left untouched')
    }
    if (await fs.exists(discarded)) {
      throw txnError(txnId, phase, 'discarded path already exists at ' + discarded + '; live profile left untouched')
    }
    await movePath(fs, livePath, discarded)
    try {
      await movePath(fs, quarantinePath, livePath)
    } catch (error) {
      try {
        await deps.beforeCompensation?.()
        await movePath(fs, discarded, livePath)
      } catch (restoreError) {
        setPhase('failed')
        record.error = 'rollback failed and restoring the live profile failed: ' + String(error) + ' / ' + String(restoreError)
        throw txnError(txnId, phase, record.error)
      }
      record.error = String(error)
      await journal('rollback-failed', { error: String(error) }).catch(() => undefined)
      throw txnError(txnId, phase, 'rollback failed: ' + String(error))
    }
    setPhase('rolled-back')
    delete record.error
    steps.push({ step: 'rollback-restore', from: quarantinePath, to: livePath })
    await fs.remove(discarded, { recursive: true }).catch(() => undefined)
    await journal('rollback-restore')
  }

  return {
    txnId,
    record,
    phase: () => phase,
    async stage() {
      if (phase !== 'created') throw txnError(txnId, phase, 'stage requires state created')
      const exists = await fs.exists(livePath)
      if (!exists) throw txnError(txnId, phase, 'live profile missing at ' + livePath)
      await fs.mkdir(stagingPath, { recursive: true })
      await copyTree(fs, livePath, stagingPath)
      setPhase('staged')
      steps.push({ step: 'stage-copy', from: livePath, to: stagingPath })
      await journal('stage', { from: livePath, to: stagingPath })
    },
    async promote() {
      if (phase !== 'staged') throw txnError(txnId, phase, 'promote requires state staged')
      await sameDeviceGuard()
      if (await fs.exists(quarantinePath)) {
        throw txnError(txnId, phase, 'quarantine path already exists: ' + quarantinePath)
      }
      await fs.mkdir(quarantineBase + '/' + profile + '/' + txnId, { recursive: true })
      if (deps.beforePromote === undefined) {
        throw txnError(txnId, phase, 'promote requires a durable recovery-intent writer')
      }
      // This atomic record write is the crash-recovery boundary. It must land
      // before live is renamed so every partially promoted layout has durable
      // profile, staging and quarantine identities.
      await deps.beforePromote(record)
      let originalQuarantined = false
      let candidateActivated = false
      try {
        const first = await movePath(fs, livePath, quarantinePath)
        originalQuarantined = true
        steps.push({ step: 'promote-quarantine', from: livePath, to: quarantinePath, copied: first.copied })
        await journal('promote-quarantine', { from: livePath, to: quarantinePath, copied: first.copied })
        const second = await movePath(fs, stagingPath, livePath)
        candidateActivated = true
        steps.push({ step: 'promote-activate', from: stagingPath, to: livePath, copied: second.copied })
        setPhase('promoted')
        await journal('promote-activate', { from: stagingPath, to: livePath, copied: second.copied })
      } catch (error) {
        if (!originalQuarantined) {
          record.error = String(error)
          await journal('promote-failed', { error: record.error }).catch(() => undefined)
          throw txnError(txnId, phase, 'promote failed before quarantining live: ' + record.error)
        }
        let rollbackError: unknown
        try {
          if (candidateActivated) {
            await rollbackPromoted()
          } else if (originalQuarantined) {
            await deps.beforeCompensation?.()
            await movePath(fs, quarantinePath, livePath)
            steps.push({ step: 'promote-rollback', from: quarantinePath, to: livePath })
            await fs.remove(stagingPath, { recursive: true })
            setPhase('rolled-back')
          }
        } catch (caught) {
          rollbackError = caught
        }
        const phaseAfterRollback = record.phase
        if (phaseAfterRollback !== 'rolled-back') {
          if (phaseAfterRollback !== 'promoted' && phaseAfterRollback !== 'failed') setPhase('failed')
          record.error = 'promote failed and rollback failed: ' + String(error) + ' / ' + String(rollbackError)
          throw txnError(txnId, phase, record.error)
        }
        record.error = String(error) + (rollbackError === undefined ? '' : '; rollback warning: ' + String(rollbackError))
        await journal('promote-failed', { error: record.error }).catch(() => undefined)
        throw txnError(txnId, phase, 'promote failed: ' + record.error)
      }
    },
    async rollback() {
      if (phase === 'staged') {
        await fs.remove(stagingPath, { recursive: true })
        setPhase('aborted')
        await journal('rollback-staging-discard')
        return
      }
      if (phase !== 'promoted') throw txnError(txnId, phase, 'rollback requires state staged or promoted')
      await rollbackPromoted()
    },
    async abort() {
      if (phase === 'created') return
      if (phase === 'promoted') {
        await rollbackPromoted()
        return
      }
      if (phase === 'rolled-back' || phase === 'aborted') return
      await fs.remove(stagingBase + '/' + profile, { recursive: true })
      setPhase('aborted')
      await journal('abort-staging-discard')
    },
    async commit() {
      if (phase !== 'promoted') throw txnError(txnId, phase, 'commit requires state promoted')
      await journal('commit', { quarantinePath })
      setPhase('committed')
    },
  }
}

function makeTxnId(profile: string, now: string): string {
  const compact = now.replace(/[^0-9]/g, '').slice(0, 14)
  return profile + '-' + compact
}

function txnError(txnId: string, phase: CandidatePhase, detail: string): Error {
  const error = new Error('txn ' + txnId + ' (' + phase + '): ' + detail) as Error & { code: string; phase: CandidatePhase }
  error.code = 'TXN_STATE'
  error.phase = phase
  return error
}
