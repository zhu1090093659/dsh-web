import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMemoryFs, nodeFs, type FsLike } from '../src/core/fs.ts'
import { createYamlEngine } from '../src/core/yaml.ts'
import { createJournal } from '../src/core/journal.ts'
import { redactText } from '../src/core/redact.ts'
import { repairProfile, diagnoseAndPlan, rollbackTransaction, type RecoveryRequest } from '../src/core/recover.ts'
import type { GateDeps, ProcessClient, HttpClient, SpawnHandle } from '../src/core/gates.ts'

function fakeGates(script: { dumpStdout?: string; startStdout?: string; httpBody?: string; exit?: number; exits?: number[] }): { gates: GateDeps; spawned: string[][] } {
  const spawned: string[][] = []
  let pid = 1000
  const client: ProcessClient = {
    spawn(command: string[], opts: { cwd?: string; env?: Record<string, string | undefined> }): SpawnHandle {
      const call = spawned.length
      spawned.push([command.join(' '), (opts.env as any)?.DSH_HOME ?? '', (opts.env as any)?.DSH_TELEMETRY_DISABLED ?? ''])
      const isDump = command.includes('--dump-default-config')
      const stdout = isDump ? (script.dumpStdout ?? '[]\n') : (script.startStdout ?? 'dsh web: http://127.0.0.1:4567\n')
      const handle: SpawnHandle = {
        onStdout(cb) { queueMicrotask(() => cb(stdout)) },
        onStderr(cb) { queueMicrotask(() => cb('')) },
        onExit(cb) { queueMicrotask(() => cb(script.exits?.[call] ?? script.exit ?? 0, null)) },
        kill() {},
      }
      pid += 1
      void pid
      return handle
    },
  }
  const http: HttpClient = { async get() { return { status: 200, body: script.httpBody ?? '<html>window.__DSH_BOOT__</html>' } } }
  const gates = { client, http, engine: createYamlEngine(), redactText: (t: string) => redactText(t), clock: () => Date.now() }
  return { gates, spawned }
}

function request(fs: FsLike, home: string, extra: Partial<RecoveryRequest> = {}): RecoveryRequest {
  return { home, profile: 'web', dshPath: '/fake/dsh', fs, allowLive: true, now: () => '2026-01-01T00:00:00Z', clock: () => 1_700_000_000_000, pidAlive: () => true, ...extra }
}

async function withRealHome(run: (fs: FsLike, home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-rollback-'))
  try {
    await run(nodeFs, home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

async function seedPromotedTransaction(fs: FsLike, home: string, txnId = 'web-20260101000000'): Promise<{ livePath: string; quarantinePath: string; recordPath: string }> {
  const livePath = join(home, 'profiles', 'web')
  const quarantinePath = join(home, '.dsh-doctor', 'quarantine', 'web', txnId, 'original')
  const recordPath = join(home, '.dsh-doctor', 'transactions', txnId + '.json')
  await fs.mkdir(livePath, { recursive: true })
  await fs.writeText(join(livePath, 'package.json'), JSON.stringify({ name: 'web', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  await fs.writeText(join(livePath, 'cordis.patch.yml'), '# repaired candidate\n')
  await fs.mkdir(quarantinePath, { recursive: true })
  await fs.writeText(join(quarantinePath, 'package.json'), JSON.stringify({ name: 'web', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  await fs.writeText(join(quarantinePath, 'cordis.patch.yml'), 'bad: [unclosed\n')
  await fs.mkdir(join(home, '.dsh-doctor', 'transactions'), { recursive: true })
  await fs.writeText(recordPath, JSON.stringify({ txnId, profile: 'web', phase: 'promoted', livePath, stagingPath: join(home, 'staging', txnId), quarantinePath, steps: [] }, null, 2) + '\n')
  return { livePath, quarantinePath, recordPath }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitForSignal(signal: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      signal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timed out waiting for ' + label)), 1_000)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe('recovery orchestration', () => {
  it('heals a broken profile patch through stage, gates, promote, and commit', async () => {
    const fs = createMemoryFs()
    const home = '/h'
    await fs.mkdir(home + '/profiles/web', { recursive: true })
    await fs.writeText(home + '/profiles/web/package.json', JSON.stringify({ name: 'web', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    await fs.writeText(home + '/profiles/web/cordis.patch.yml', 'bad: [unclosed\n')
    const { gates, spawned } = fakeGates({})
    const outcome = await repairProfile({ ...request(fs, home), gate: gates }, { env: { HOME: '/u' } })
    expect(outcome.ok).toBe(true)
    expect(outcome.phase).toBe('promoted')
    expect(outcome.actions.length).toBeGreaterThan(0)
    expect(spawned.length).toBeGreaterThanOrEqual(2)
    const healed = await fs.readText(home + '/profiles/web/cordis.patch.yml')
    expect(healed).toContain('quarantined a broken patch')
    const journal = createJournal({ fs, file: home + '/.dsh-doctor/journal.jsonl', now: () => '2026-01-01T00:00:00Z' })
    const replay = await journal.replay()
    expect(replay.corrupted).toBe(0)
    expect(replay.entries.some(e => e.op === 'repair:commit')).toBe(true)
    const quarantineFile = fs.readdir(home + '/.dsh-doctor/quarantine/web').catch(() => [])
    expect(await quarantineFile.then(list => list.length)).toBeGreaterThan(0)
  })

  it('aborts and leaves the live profile untouched when the candidate fails gates', async () => {
    const fs = createMemoryFs()
    const home = '/h'
    await fs.mkdir(home + '/profiles/web', { recursive: true })
    await fs.writeText(home + '/profiles/web/package.json', JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }, name: 'web' }))
    await fs.writeText(home + '/profiles/web/cordis.patch.yml', 'bad: [unclosed\n')
    const { gates } = fakeGates({ exit: 1 })
    const outcome = await repairProfile({ ...request(fs, home), gate: gates })
    expect(outcome.ok).toBe(false)
    expect(outcome.phase).toBe('aborted')
    expect(await fs.readText(home + '/profiles/web/cordis.patch.yml')).toBe('bad: [unclosed\n')
    expect(await fs.exists(home + '/.dsh-doctor/quarantine/web')).toBe(false)
  })

  it('surfaces home-level repairs as manual actions without promoting', async () => {
    const fs = createMemoryFs()
    const home = '/h'
    await fs.mkdir(home + '/profiles/web', { recursive: true })
    await fs.writeText(home + '/profiles/web/package.json', JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }, name: 'web' }))
    await fs.writeText(home + '/profiles/web/cordis.patch.yml', '[]\n')
    await fs.writeText(home + '/cordis.patch.yml', 'bad: [unclosed\n')
    const outcome = await repairProfile({ ...request(fs, home), gate: fakeGates({}).gates })
    expect(outcome.ok).toBe(false)
    expect(outcome.phase).toBe('planned')
    expect(outcome.manualActions.length).toBeGreaterThan(0)
    expect(await fs.readText(home + '/cordis.patch.yml')).toBe('bad: [unclosed\n')
  })

  it('blocks when the caller does not assert the profile is stopped', async () => {
    const fs = createMemoryFs()
    const home = '/h'
    await fs.mkdir(home + '/profiles/web', { recursive: true })
    await fs.writeText(home + '/profiles/web/package.json', '{}')
    const outcome = await repairProfile({ ...request(fs, home), allowLive: false, gate: fakeGates({}).gates })
    expect(outcome.ok).toBe(false)
    expect(outcome.phase).toBe('blocked')
  })

  it('diagnoses without promoting a healthy profile', async () => {
    const fs = createMemoryFs()
    const home = '/h'
    await fs.mkdir(home + '/profiles/web', { recursive: true })
    await fs.writeText(home + '/profiles/web/package.json', JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }, name: 'web' }))
    await fs.writeText(home + '/profiles/web/cordis.patch.yml', '[]\n')
    const outcome = await diagnoseAndPlan(request(fs, home))
    expect(outcome.phase).toBe('noop')
    expect(outcome.ok).toBe(true)
  })

  it('persists a rollback and treats a repeated request as a no-op', async () => {
    await withRealHome(async (fs, home) => {
      const txnId = 'web-20260101000000'
      const { livePath, recordPath } = await seedPromotedTransaction(fs, home, txnId)
      const rolled = await rollbackTransaction({ ...request(fs, home) }, txnId)
      expect(rolled.ok).toBe(true)
      expect(await fs.readText(join(livePath, 'cordis.patch.yml'))).toBe('bad: [unclosed\n')
      expect(JSON.parse(await fs.readText(recordPath))).toMatchObject({ phase: 'rolled-back' })

      const repeated = await rollbackTransaction({ ...request(fs, home) }, txnId)
      expect(repeated).toMatchObject({ ok: true, phase: 'rolled-back' })
      expect(await fs.readText(join(livePath, 'cordis.patch.yml'))).toBe('bad: [unclosed\n')
    })
  })

  it('serializes concurrent rollbacks and rereads the record after locking', async () => {
    await withRealHome(async (fs, home) => {
      const txnId = 'web-20260101000000'
      const { livePath } = await seedPromotedTransaction(fs, home, txnId)
      const discardedPath = livePath + '.doctor-discarded-' + txnId
      const globalLockPath = join(home, '.dsh-doctor', 'locks', 'global')
      const firstMoveStarted = deferred()
      const releaseFirstMove = deferred()
      const secondSawLock = deferred()
      const originalExists = fs.exists.bind(fs)
      const originalRename = fs.rename.bind(fs)
      let firstMoveBlocked = false
      let liveMoveCalls = 0
      const racingFs: FsLike = {
        ...fs,
        async exists(path) {
          const exists = await originalExists(path)
          if (firstMoveBlocked && path === globalLockPath && exists) secondSawLock.resolve()
          return exists
        },
        async rename(from, to) {
          if (from === livePath && to === discardedPath) {
            liveMoveCalls += 1
            if (liveMoveCalls === 1) {
              firstMoveBlocked = true
              firstMoveStarted.resolve()
              await releaseFirstMove.promise
            }
          }
          await originalRename(from, to)
        },
      }

      const first = rollbackTransaction({ ...request(racingFs, home), pid: 301, clock: Date.now }, txnId)
      await waitForSignal(firstMoveStarted.promise, 'the first rollback move')
      let secondSettled = false
      const second = rollbackTransaction({ ...request(racingFs, home), pid: 302, clock: Date.now }, txnId).then((outcome) => {
        secondSettled = true
        return outcome
      })

      let observationError: unknown
      let observed: { liveMoveCalls: number; secondSettled: boolean } | undefined
      try {
        await waitForSignal(secondSawLock.promise, 'the second rollback lock check')
        observed = { liveMoveCalls, secondSettled }
      } catch (error) {
        observationError = error
      } finally {
        releaseFirstMove.resolve()
      }
      const outcomes = await Promise.all([first, second])
      if (observationError !== undefined) throw observationError

      expect(observed).toEqual({ liveMoveCalls: 1, secondSettled: false })
      expect(outcomes).toEqual([
        expect.objectContaining({ ok: true, phase: 'rolled-back' }),
        expect.objectContaining({ ok: true, phase: 'rolled-back' }),
      ])
      expect(liveMoveCalls).toBe(1)
      expect(await fs.readText(join(livePath, 'cordis.patch.yml'))).toBe('bad: [unclosed\n')
    })
  })

  it('serializes rollback against repair for the same profile', async () => {
    await withRealHome(async (fs, home) => {
      const txnId = 'web-20260101000000'
      const { livePath, quarantinePath } = await seedPromotedTransaction(fs, home, txnId)
      await fs.writeText(join(quarantinePath, 'cordis.patch.yml'), '[]\n')
      const discardedPath = livePath + '.doctor-discarded-' + txnId
      const livePatchPath = join(livePath, 'cordis.patch.yml')
      const globalLockPath = join(home, '.dsh-doctor', 'locks', 'global')
      const firstMoveStarted = deferred()
      const releaseFirstMove = deferred()
      const repairSawLock = deferred()
      const originalExists = fs.exists.bind(fs)
      const originalReadText = fs.readText.bind(fs)
      const originalRename = fs.rename.bind(fs)
      let firstMoveBlocked = false
      let observeRepair = false
      let liveReads = 0
      const racingFs: FsLike = {
        ...fs,
        async exists(path) {
          const exists = await originalExists(path)
          if (firstMoveBlocked && path === globalLockPath && exists) repairSawLock.resolve()
          return exists
        },
        async readText(path) {
          if (observeRepair && path === livePatchPath) liveReads += 1
          return await originalReadText(path)
        },
        async rename(from, to) {
          if (!firstMoveBlocked && from === livePath && to === discardedPath) {
            firstMoveBlocked = true
            firstMoveStarted.resolve()
            await releaseFirstMove.promise
          }
          await originalRename(from, to)
        },
      }

      const rollback = rollbackTransaction({ ...request(racingFs, home), pid: 401, clock: Date.now }, txnId)
      await waitForSignal(firstMoveStarted.promise, 'the rollback move')
      observeRepair = true
      let repairSettled = false
      const repair = repairProfile({
        ...request(racingFs, home),
        pid: 402,
        clock: Date.now,
        now: () => '2026-01-02T00:00:00Z',
        gate: fakeGates({}).gates,
      }).then((outcome) => {
        repairSettled = true
        return outcome
      })

      let observationError: unknown
      let observed: { liveReads: number; repairSettled: boolean } | undefined
      try {
        await waitForSignal(repairSawLock.promise, 'the repair lock check')
        observed = { liveReads, repairSettled }
      } catch (error) {
        observationError = error
      } finally {
        releaseFirstMove.resolve()
      }
      const [rollbackOutcome, repairOutcome] = await Promise.all([rollback, repair])
      if (observationError !== undefined) throw observationError

      expect(observed).toEqual({ liveReads: 0, repairSettled: false })
      expect(rollbackOutcome).toMatchObject({ ok: true, phase: 'rolled-back' })
      expect(repairSettled).toBe(true)
      if (process.platform === 'win32') {
        expect(repairOutcome).toMatchObject({ ok: false, phase: 'failed' })
        expect(repairOutcome.message).toContain('mkdir')
      } else {
        expect(repairOutcome, repairOutcome.message).toMatchObject({ ok: true, phase: 'noop' })
      }
    })
  })

  it('reverts file moves when atomic transaction replacement is interrupted', async () => {
    await withRealHome(async (fs, home) => {
      const txnId = 'web-20260101000000'
      const { livePath, quarantinePath, recordPath } = await seedPromotedTransaction(fs, home, txnId)
      const originalRename = fs.rename.bind(fs)
      let interrupted = false
      const interruptedFs: FsLike = {
        ...fs,
        async rename(from, to) {
          if (!interrupted && to === recordPath && from.startsWith(recordPath + '.tmp-')) {
            interrupted = true
            throw new Error('injected atomic replacement interruption')
          }
          await originalRename(from, to)
        },
      }

      const failed = await rollbackTransaction({ ...request(interruptedFs, home) }, txnId)
      expect(failed).toMatchObject({ ok: false, phase: 'failed' })
      expect(failed.message).toContain('rollback file moves were reverted')
      expect(JSON.parse(await fs.readText(recordPath))).toMatchObject({ phase: 'promoted' })
      expect(await fs.readText(join(livePath, 'cordis.patch.yml'))).toBe('# repaired candidate\n')
      expect(await fs.readText(join(quarantinePath, 'cordis.patch.yml'))).toBe('bad: [unclosed\n')
      expect(await fs.exists(livePath + '.doctor-discarded-' + txnId)).toBe(false)
      expect((await fs.readdir(join(home, '.dsh-doctor', 'transactions'))).some((entry) => entry.name.includes('.tmp-'))).toBe(false)

      const retried = await rollbackTransaction({ ...request(fs, home) }, txnId)
      expect(retried).toMatchObject({ ok: true, phase: 'rolled-back' })
      expect(JSON.parse(await fs.readText(recordPath))).toMatchObject({ phase: 'rolled-back' })
    })
  })

  it('rejects unsafe transaction ids before resolving a record path', async () => {
    await withRealHome(async (fs, home) => {
      const marker = join(home, 'outside.json')
      await fs.writeText(marker, 'keep')

      const outcome = await rollbackTransaction({ ...request(fs, home) }, '../outside')

      expect(outcome).toMatchObject({ ok: false, phase: 'failed' })
      expect(outcome.message).toContain('safe segment')
      expect(await fs.readText(marker)).toBe('keep')
      expect(await fs.exists(join(home, '.dsh-doctor', 'locks'))).toBe(false)
    })
  })

  it('rejects a transaction record belonging to another profile', async () => {
    await withRealHome(async (fs, home) => {
      const txnId = 'web-20260101000000'
      const { livePath, quarantinePath, recordPath } = await seedPromotedTransaction(fs, home, txnId)
      const record = JSON.parse(await fs.readText(recordPath)) as Record<string, unknown>
      record.profile = 'other'
      await fs.writeText(recordPath, JSON.stringify(record) + '\n')

      const outcome = await rollbackTransaction({ ...request(fs, home) }, txnId)

      expect(outcome).toMatchObject({ ok: false, phase: 'failed' })
      expect(outcome.message).toContain('belongs to profile other')
      expect(await fs.readText(join(livePath, 'cordis.patch.yml'))).toBe('# repaired candidate\n')
      expect(await fs.readText(join(quarantinePath, 'cordis.patch.yml'))).toBe('bad: [unclosed\n')
    })
  })

  it.each([
    ['livePath', 'profiles/other', 'live path does not match profile'],
    ['quarantinePath', 'outside/original', 'quarantine path does not match profile'],
  ] as const)('rejects an unexpected %s in the transaction record', async (field, replacement, expectedMessage) => {
    await withRealHome(async (fs, home) => {
      const txnId = 'web-20260101000000'
      const { livePath, quarantinePath, recordPath } = await seedPromotedTransaction(fs, home, txnId)
      const record = JSON.parse(await fs.readText(recordPath)) as Record<string, unknown>
      record[field] = join(home, ...replacement.split('/'))
      await fs.writeText(recordPath, JSON.stringify(record) + '\n')

      const outcome = await rollbackTransaction({ ...request(fs, home) }, txnId)

      expect(outcome).toMatchObject({ ok: false, phase: 'failed' })
      expect(outcome.message).toContain(expectedMessage)
      expect(await fs.readText(join(livePath, 'cordis.patch.yml'))).toBe('# repaired candidate\n')
      expect(await fs.readText(join(quarantinePath, 'cordis.patch.yml'))).toBe('bad: [unclosed\n')
    })
  })

  it('leaves the live profile untouched when the quarantine is missing', async () => {
    await withRealHome(async (fs, home) => {
      const txnId = 'web-20260101000000'
      const { livePath, quarantinePath } = await seedPromotedTransaction(fs, home, txnId)
      const liveBefore = await fs.readText(join(livePath, 'cordis.patch.yml'))
      await fs.remove(quarantinePath, { recursive: true })

      const rolled = await rollbackTransaction({ ...request(fs, home) }, txnId)
      expect(rolled).toMatchObject({ ok: false, phase: 'failed' })
      expect(rolled.message).toContain('quarantine path missing')
      expect(await fs.readText(join(livePath, 'cordis.patch.yml'))).toBe(liveBefore)
      expect(await fs.exists(livePath + '.doctor-discarded-' + txnId)).toBe(false)
    })
  })

  it('restores the live profile when moving the quarantine back fails', async () => {
    await withRealHome(async (fs, home) => {
      const txnId = 'web-20260101000000'
      const { livePath, quarantinePath } = await seedPromotedTransaction(fs, home, txnId)
      const liveBefore = await fs.readText(join(livePath, 'cordis.patch.yml'))
      const originalRename = fs.rename.bind(fs)
      const failingFs: FsLike = {
        ...fs,
        async rename(from, to) {
          if (from === quarantinePath && to === livePath) throw new Error('injected quarantine restore failure')
          await originalRename(from, to)
        },
      }

      const rolled = await rollbackTransaction({ ...request(failingFs, home) }, txnId)
      expect(rolled).toMatchObject({ ok: false, phase: 'failed' })
      expect(await fs.readText(join(livePath, 'cordis.patch.yml'))).toBe(liveBefore)
      expect(await fs.exists(quarantinePath)).toBe(true)
      expect(await fs.exists(livePath + '.doctor-discarded-' + txnId)).toBe(false)
    })
  })

  it('persists the rolled-back phase after live verification fails', async () => {
    const fs = createMemoryFs()
    const home = '/h'
    await fs.mkdir(home + '/profiles/web', { recursive: true })
    await fs.writeText(home + '/profiles/web/package.json', JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }, name: 'web' }))
    await fs.writeText(home + '/profiles/web/cordis.patch.yml', 'bad: [unclosed\n')

    const outcome = await repairProfile({ ...request(fs, home), gate: fakeGates({ exits: [0, 0, 1] }).gates })
    expect(outcome).toMatchObject({ ok: false, phase: 'rolled-back' })
    const recordPath = home + '/.dsh-doctor/transactions/' + outcome.txnId + '.json'
    expect(JSON.parse(await fs.readText(recordPath))).toMatchObject({ phase: 'rolled-back' })
    expect(await fs.readText(home + '/profiles/web/cordis.patch.yml')).toBe('bad: [unclosed\n')
  })
})

describe('recovery filesystem isolation', () => {
  it('uses real nodeFs against a temp directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-recover-'))
    try {
      const fs = nodeFs as FsLike
      await fs.mkdir(dir + '/profiles/web', { recursive: true })
      await fs.writeText(dir + '/profiles/web/package.json', JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }, name: 'web' }))
      await fs.writeText(dir + '/profiles/web/cordis.patch.yml', '[]\n')
      const outcome = await diagnoseAndPlan(request(fs, dir))
      expect(outcome.phase).toBe('noop')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
