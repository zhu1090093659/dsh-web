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
  /** Optional same-device assertion; when provided and false, promote refuses. */
  sameDevice?(a: string, b: string): Promise<boolean>
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
  const txnId = deps.txnId === undefined ? makeTxnId(profile, deps.now()) : deps.txnId(profile)
  validateSegment(txnId, 'txn id')

  const livePath = home + '/profiles/' + profile
  const stagingBase = stagingDir(home)
  const stagingPath = stagingBase + '/' + profile + '/' + txnId
  const quarantineBase = quarantineDir(home)
  const quarantinePath = quarantineBase + '/' + profile + '/' + txnId + '/original'

  let phase: CandidatePhase = 'created'
  const steps: CandidateRecord['steps'] = []
  const record: CandidateRecord = { txnId, profile, phase, livePath, stagingPath, quarantinePath, steps }

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
      const first = await movePath(fs, livePath, quarantinePath)
      steps.push({ step: 'promote-quarantine', from: livePath, to: quarantinePath, copied: first.copied })
      await journal('promote-quarantine', { from: livePath, to: quarantinePath, copied: first.copied })
      try {
        const second = await movePath(fs, stagingPath, livePath)
        steps.push({ step: 'promote-activate', from: stagingPath, to: livePath, copied: second.copied })
        await journal('promote-activate', { from: stagingPath, to: livePath, copied: second.copied })
        setPhase('promoted')
      } catch (error) {
        try {
          await movePath(fs, quarantinePath, livePath)
          steps.push({ step: 'promote-rollback', from: quarantinePath, to: livePath })
        } catch (rollbackError) {
          setPhase('failed')
          record.error = 'promote failed and rollback failed: ' + String(error) + ' / ' + String(rollbackError)
          throw txnError(txnId, 'failed', record.error)
        }
        setPhase('rolled-back')
        record.error = String(error)
        await journal('promote-failed', { error: String(error) })
        throw txnError(txnId, 'rolled-back', 'promote failed: ' + String(error))
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
      const discarded = stagingBase + '/' + profile + '/' + txnId + '.discarded'
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
          await movePath(fs, discarded, livePath)
        } catch (restoreError) {
          setPhase('failed')
          record.error = 'rollback failed and restoring the live profile failed: ' + String(error) + ' / ' + String(restoreError)
          throw txnError(txnId, phase, record.error)
        }
        record.error = String(error)
        await journal('rollback-failed', { error: String(error) })
        throw txnError(txnId, phase, 'rollback failed: ' + String(error))
      }
      setPhase('rolled-back')
      delete record.error
      steps.push({ step: 'rollback-restore', from: quarantinePath, to: livePath })
      await journal('rollback-restore')
      await fs.remove(discarded, { recursive: true }).catch(() => undefined)
    },
    async abort() {
      if (phase === 'created') return
      if (phase === 'promoted') {
        await this.rollback()
        return
      }
      if (phase === 'rolled-back' || phase === 'aborted') return
      await fs.remove(stagingBase + '/' + profile, { recursive: true })
      setPhase('aborted')
      await journal('abort-staging-discard')
    },
    async commit() {
      if (phase !== 'promoted') throw txnError(txnId, phase, 'commit requires state promoted')
      setPhase('committed')
      await journal('commit', { quarantinePath })
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
