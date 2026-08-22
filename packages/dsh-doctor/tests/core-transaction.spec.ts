/**
 * Candidate transaction: stage, promote, rollback, abort.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMemoryFs, FsError, nodeFs, type FsLike } from '../src/core/fs.ts'
import { createCandidateTransaction } from '../src/core/transaction.ts'

const HOME = '/h'
const LIVE = HOME + '/profiles/web'

async function seedLive(fs: ReturnType<typeof createMemoryFs>): Promise<void> {
  await fs.mkdir(LIVE, { recursive: true })
  await fs.writeText(LIVE + '/package.json', '{"name":"web"}')
  await fs.writeText(LIVE + '/cordis.patch.yml', `[]
`)
  await fs.mkdir(LIVE + '/node_modules', { recursive: true })
  await fs.writeText(LIVE + '/node_modules/keep.txt', 'do-not-copy')
}

function makeTxn(fs: ReturnType<typeof createMemoryFs>, txnId = 'web-20260821230000') {
  const journalEntries: { op: string; ok: boolean }[] = []
  return {
    txn: createCandidateTransaction({
      fs,
      home: HOME,
      profile: 'web',
      now: () => '2026-08-21T23:00:00.000Z',
      txnId: () => txnId,
      journal: { append: async (entry) => { journalEntries.push(entry) } },
    }),
    journalEntries,
  }
}

describe('candidate transaction', () => {
  it('stages by copying files into the staging tree, leaving live intact', async () => {
    const fs = createMemoryFs()
    await seedLive(fs)
    const { txn } = makeTxn(fs)
    await txn.stage()
    expect(txn.phase()).toBe('staged')
    expect(await fs.readText('/h/profiles/.doctor-staging/web/web-20260821230000/package.json')).toBe('{"name":"web"}')
    expect(await fs.readText('/h/profiles/.doctor-staging/web/web-20260821230000/node_modules/keep.txt')).toBe('do-not-copy')
    expect(await fs.readText(LIVE + '/package.json')).toBe('{"name":"web"}')
  })

  it('promote swaps the candidate in and quarantines the original', async () => {
    const fs = createMemoryFs()
    await seedLive(fs)
    const { txn } = makeTxn(fs)
    await txn.stage()
    await fs.writeText('/h/profiles/.doctor-staging/web/web-20260821230000/package.json', '{"name":"web","version":2}')
    await txn.promote()
    expect(txn.phase()).toBe('promoted')
    expect(await fs.readText(LIVE + '/package.json')).toBe('{"name":"web","version":2}')
    expect(await fs.exists('/h/.dsh-doctor/quarantine/web/web-20260821230000/original/package.json')).toBe(true)
    expect(await fs.readText('/h/.dsh-doctor/quarantine/web/web-20260821230000/original/cordis.patch.yml')).toBe(`[]
`)
  })

  it.each(['promote-quarantine', 'promote-activate'] as const)('restores the original when %s journaling fails', async (failedStep) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-promote-journal-'))
    try {
      const live = join(home, 'profiles', 'web')
      await nodeFs.mkdir(live, { recursive: true })
      await nodeFs.writeText(join(live, 'package.json'), '{"name":"web"}')
      const txn = createCandidateTransaction({
        fs: nodeFs,
        home,
        profile: 'web',
        now: () => '2026-08-21T23:00:00.000Z',
        txnId: () => 'web-20260821230000',
        journal: {
          async append(entry) {
            if (entry.op.endsWith(':' + failedStep)) throw new Error('injected ' + failedStep + ' journal failure')
            return undefined
          },
        },
      })
      await txn.stage()
      await nodeFs.writeText(join(txn.record.stagingPath, 'package.json'), '{"name":"web","version":2}')

      await expect(txn.promote()).rejects.toThrow('injected ' + failedStep + ' journal failure')
      expect(txn.phase()).toBe('rolled-back')
      expect(await nodeFs.readText(join(live, 'package.json'))).toBe('{"name":"web"}')
      expect(await nodeFs.exists(txn.record.quarantinePath)).toBe(false)
      expect(await nodeFs.exists(txn.record.stagingPath)).toBe(false)
      expect(await nodeFs.exists(txn.record.stagingPath + '.discarded')).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it.each(['promote-quarantine', 'promote-activate'] as const)('does not compensate %s failure after ownership is lost', async (failedStep) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-promote-owner-'))
    try {
      const live = join(home, 'profiles', 'web')
      await nodeFs.mkdir(live, { recursive: true })
      await nodeFs.writeText(join(live, 'package.json'), '{"name":"web"}')
      let compensationChecks = 0
      const txn = createCandidateTransaction({
        fs: nodeFs,
        home,
        profile: 'web',
        now: () => '2026-08-21T23:00:00.000Z',
        txnId: () => 'web-20260821230000',
        beforeCompensation: async () => {
          compensationChecks += 1
          throw new Error('injected lost ownership')
        },
        journal: {
          async append(entry) {
            if (entry.op.endsWith(':' + failedStep)) throw new Error('injected ' + failedStep + ' journal failure')
            return undefined
          },
        },
      })
      await txn.stage()
      await nodeFs.writeText(join(txn.record.stagingPath, 'package.json'), '{"name":"web","version":2}')

      await expect(txn.promote()).rejects.toThrow('injected lost ownership')

      expect(compensationChecks).toBe(1)
      expect(await nodeFs.readText(join(txn.record.quarantinePath, 'package.json'))).toBe('{"name":"web"}')
      expect(await nodeFs.exists(txn.record.stagingPath + '.discarded')).toBe(false)
      if (failedStep === 'promote-quarantine') {
        expect(txn.phase()).toBe('failed')
        expect(await nodeFs.exists(live)).toBe(false)
        expect(await nodeFs.readText(join(txn.record.stagingPath, 'package.json'))).toBe('{"name":"web","version":2}')
      } else {
        expect(txn.phase()).toBe('promoted')
        expect(await nodeFs.readText(join(live, 'package.json'))).toBe('{"name":"web","version":2}')
        expect(await nodeFs.exists(txn.record.stagingPath)).toBe(false)
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('rollback restores the quarantined original', async () => {
    const fs = createMemoryFs()
    await seedLive(fs)
    const { txn } = makeTxn(fs)
    await txn.stage()
    await txn.promote()
    await txn.rollback()
    expect(txn.phase()).toBe('rolled-back')
    expect(await fs.readText(LIVE + '/package.json')).toBe('{"name":"web"}')
    expect(await fs.exists('/h/.dsh-doctor/quarantine/web/web-20260821230000/original')).toBe(false)
  })

  it('puts the promoted profile back when restoring quarantine fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-transaction-'))
    try {
      const live = join(home, 'profiles', 'web')
      await nodeFs.mkdir(live, { recursive: true })
      await nodeFs.writeText(join(live, 'package.json'), '{"name":"web"}')
      const originalRename = nodeFs.rename.bind(nodeFs)
      let failRestore = false
      let quarantine = ''
      let livePath = ''
      const failingFs: FsLike = {
        ...nodeFs,
        async rename(from, to) {
          if (failRestore && from === quarantine && to === livePath) throw new FsError('EBUSY', to, 'injected')
          await originalRename(from, to)
        },
      }
      const txn = createCandidateTransaction({ fs: failingFs, home, profile: 'web', now: () => '2026-08-21T23:00:00.000Z', txnId: () => 'web-20260821230000' })
      quarantine = txn.record.quarantinePath
      livePath = txn.record.livePath
      await txn.stage()
      await nodeFs.writeText(join(txn.record.stagingPath, 'package.json'), '{"name":"web","version":2}')
      await txn.promote()
      failRestore = true

      await expect(txn.rollback()).rejects.toThrow('injected')
      expect(txn.phase()).toBe('promoted')
      expect(await nodeFs.readText(join(live, 'package.json'))).toBe('{"name":"web","version":2}')
      expect(await nodeFs.exists(join(quarantine, 'package.json'))).toBe(true)
      expect(await nodeFs.exists(txn.record.stagingPath + '.discarded')).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('abort before promote discards staging and touches nothing else', async () => {
    const fs = createMemoryFs()
    await seedLive(fs)
    const { txn } = makeTxn(fs)
    await txn.stage()
    await txn.abort()
    expect(txn.phase()).toBe('aborted')
    expect(await fs.exists('/h/profiles/.doctor-staging/web')).toBe(false)
    expect(await fs.readText(LIVE + '/package.json')).toBe('{"name":"web"}')
  })

  it('refuses to promote before staging', async () => {
    const fs = createMemoryFs()
    await seedLive(fs)
    const { txn } = makeTxn(fs)
    await expect(txn.promote()).rejects.toMatchObject({ code: 'TXN_STATE' })
  })

  it('restores the original when the second rename fails', async () => {
    const fs = createMemoryFs()
    await seedLive(fs)
    const { txn } = makeTxn(fs)
    await txn.stage()
    const originalRename = fs.rename.bind(fs)
    let calls = 0
    const fsSabotaged = {
      ...fs,
      rename: (from: string, to: string) => {
        calls += 1
        if (calls === 2) throw new FsError('EBUSY', to, 'injected')
        return originalRename(from, to)
      },
    }
    const failed = createCandidateTransaction({ fs: fsSabotaged, home: HOME, profile: 'web', now: () => '2026-08-21T23:00:00.000Z', txnId: () => 'web-20260821230000' })
    await failed.stage()
    await expect(failed.promote()).rejects.toMatchObject({ code: 'TXN_STATE' })
    expect(await fs.exists(LIVE + '/package.json')).toBe(true)
    expect(await fs.readText(LIVE + '/package.json')).toBe('{"name":"web"}')
  })

  it('records each step in the candidate record and journals every step', async () => {
    const fs = createMemoryFs()
    await seedLive(fs)
    const { txn, journalEntries } = makeTxn(fs)
    await txn.stage()
    await txn.promote()
    await txn.commit()
    expect(txn.phase()).toBe('committed')
    expect(txn.record.steps.map((step) => step.step)).toEqual(['stage-copy', 'promote-quarantine', 'promote-activate'])
    expect(journalEntries.filter((e) => e.ok).length).toBe(4)
    expect(txn.record.quarantinePath).toContain('quarantine')
  })

  it('commit requires promoted state', async () => {
    const fs = createMemoryFs()
    await seedLive(fs)
    const { txn } = makeTxn(fs)
    await expect(txn.commit()).rejects.toMatchObject({ code: 'TXN_STATE' })
  })

  it('remains rollback-capable when commit journaling fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-commit-'))
    try {
      const live = join(home, 'profiles', 'web')
      await nodeFs.mkdir(live, { recursive: true })
      await nodeFs.writeText(join(live, 'package.json'), '{"name":"web"}')
      const txn = createCandidateTransaction({
        fs: nodeFs,
        home,
        profile: 'web',
        now: () => '2026-08-21T23:00:00.000Z',
        txnId: () => 'web-20260821230000',
        journal: {
          async append(entry) {
            if (entry.op.endsWith(':commit')) throw new Error('injected commit journal failure')
            return undefined
          },
        },
      })
      await txn.stage()
      await txn.promote()

      await expect(txn.commit()).rejects.toThrow('injected commit journal failure')
      expect(txn.phase()).toBe('promoted')
      await txn.rollback()
      expect(txn.phase()).toBe('rolled-back')
      expect(await nodeFs.readText(join(live, 'package.json'))).toBe('{"name":"web"}')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
