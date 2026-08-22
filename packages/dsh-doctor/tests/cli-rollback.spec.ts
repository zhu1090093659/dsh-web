import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli.ts'

describe('doctor rollback CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('discovers the profile from the transaction record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-cli-rollback-'))
    const txnId = 'txn-20260101000000'
    const livePath = join(home, 'profiles', 'web')
    const quarantinePath = join(home, '.dsh-doctor', 'quarantine', 'web', txnId, 'original')
    const recordPath = join(home, '.dsh-doctor', 'transactions', txnId + '.json')
    try {
      await mkdir(livePath, { recursive: true })
      await writeFile(join(livePath, 'package.json'), '{"name":"web","version":2}')
      await mkdir(quarantinePath, { recursive: true })
      await writeFile(join(quarantinePath, 'package.json'), '{"name":"web","version":1}')
      await mkdir(join(home, '.dsh-doctor', 'transactions'), { recursive: true })
      await writeFile(recordPath, JSON.stringify({
        txnId,
        profile: 'web',
        phase: 'promoted',
        livePath,
        stagingPath: join(home, 'staging', txnId),
        quarantinePath,
        steps: [],
      }) + '\n')
      vi.stubEnv('DSH_HOME', home)
      vi.stubEnv('DSH_DOCTOR_REAL_DSH', '')
      vi.stubEnv('PATH', '')
      const output: string[] = []
      vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)) })

      const code = await main(['rollback', txnId])

      expect(code).toBe(0)
      expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({ ok: true, phase: 'rolled-back', txnId })
      expect(await readFile(join(livePath, 'package.json'), 'utf8')).toBe('{"name":"web","version":1}')
      expect(JSON.parse(await readFile(recordPath, 'utf8'))).toMatchObject({ profile: 'web', phase: 'rolled-back' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('returns a failure exit code when the transaction record is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-cli-rollback-missing-'))
    try {
      vi.stubEnv('DSH_HOME', home)
      vi.stubEnv('DSH_DOCTOR_REAL_DSH', '')
      vi.stubEnv('PATH', '')
      const output: string[] = []
      vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)) })

      const code = await main(['rollback', 'txn-20260101000000'])

      expect(code).toBe(2)
      expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({
        ok: false,
        phase: 'failed',
        txnId: 'txn-20260101000000',
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('returns a failure exit code when the discovered rollback cannot complete', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-cli-rollback-failed-'))
    const txnId = 'txn-20260101000000'
    const livePath = join(home, 'profiles', 'web')
    const quarantinePath = join(home, '.dsh-doctor', 'quarantine', 'web', txnId, 'original')
    const recordPath = join(home, '.dsh-doctor', 'transactions', txnId + '.json')
    try {
      await mkdir(livePath, { recursive: true })
      await writeFile(join(livePath, 'package.json'), '{"name":"web","version":2}')
      await mkdir(join(home, '.dsh-doctor', 'transactions'), { recursive: true })
      await writeFile(recordPath, JSON.stringify({
        txnId,
        profile: 'web',
        phase: 'promoted',
        livePath,
        stagingPath: join(home, 'staging', txnId),
        quarantinePath,
        steps: [],
      }) + '\n')
      vi.stubEnv('DSH_HOME', home)
      vi.stubEnv('DSH_DOCTOR_REAL_DSH', '')
      vi.stubEnv('PATH', '')
      const output: string[] = []
      vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)) })

      const code = await main(['rollback', txnId])

      expect(code).toBe(2)
      expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({ ok: false, phase: 'failed', txnId })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
