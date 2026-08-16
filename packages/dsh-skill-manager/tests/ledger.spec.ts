/**
 * Ledger behavior: parsing, absent/corrupt fallback, record/remove, and the
 * atomic file write.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseLedgerDocument, SkillLedger } from '../src/core/ledger.ts'

const dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('parseLedgerDocument', () => {
  it('parses a valid document', () => {
    const text = JSON.stringify({ version: 1, installed: [{ name: 'a', path: '/x/a', installedAt: 1 }] })
    expect(parseLedgerDocument(text)).toEqual({ version: 1, installed: [{ name: 'a', path: resolve('/x/a'), installedAt: 1 }] })
  })

  it('rejects invalid shapes', () => {
    expect(parseLedgerDocument('not json')).toBeUndefined()
    expect(parseLedgerDocument(JSON.stringify({ version: 2, installed: [] }))).toBeUndefined()
    expect(parseLedgerDocument(JSON.stringify({ version: 1 }))).toBeUndefined()
    expect(parseLedgerDocument(JSON.stringify({ version: 1, installed: [{ name: 'a' }] }))).toBeUndefined()
  })
})

describe('SkillLedger', () => {
  it('starts empty when the file is absent', async () => {
    const dir = await tempDir('dsh-sm-ledger-')
    const ledger = new SkillLedger(join(dir, 'skill-manager.json'))
    expect(await ledger.load()).toEqual({ version: 1, installed: [] })
    expect(await ledger.has(join(dir, 'x'))).toBe(false)
  })

  it('records, replaces, and removes entries', async () => {
    const dir = await tempDir('dsh-sm-ledger-')
    const file = join(dir, 'skill-manager.json')
    const ledger = new SkillLedger(file)
    await ledger.record({ name: 'a', path: join(dir, 'a'), installedAt: 1 })
    expect(await ledger.has(join(dir, 'a'))).toBe(true)
    await ledger.record({ name: 'a', path: join(dir, 'a'), installedAt: 2 })
    const doc = await ledger.load()
    expect(doc.installed).toHaveLength(1)
    expect(doc.installed[0]?.installedAt).toBe(2)
    await ledger.remove(join(dir, 'a'))
    expect(await ledger.has(join(dir, 'a'))).toBe(false)
  })

  it('finds records by exact path and by ancestor directory', async () => {
    const dir = await tempDir('dsh-sm-ledger-')
    const ledger = new SkillLedger(join(dir, 'skill-manager.json'))
    const skillDir = join(dir, 'skills', 'alpha')
    await ledger.record({ name: 'alpha', path: skillDir, installedAt: 1 })
    expect((await ledger.find(join(skillDir, 'SKILL.md')))?.path).toBe(skillDir)
    expect((await ledger.find(skillDir))?.name).toBe('alpha')
    expect(await ledger.find(join(dir, 'other'))).toBeUndefined()
  })

  it('repairs a corrupt file on the next write', async () => {
    const dir = await tempDir('dsh-sm-ledger-')
    const file = join(dir, 'skill-manager.json')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'corrupt', 'utf8')
    const ledger = new SkillLedger(file)
    expect(await ledger.load()).toEqual({ version: 1, installed: [] })
    await ledger.record({ name: 'a', path: join(dir, 'a'), installedAt: 1 })
    const text = await readFile(file, 'utf8')
    expect(parseLedgerDocument(text)?.installed).toHaveLength(1)
  })

  it('persists through the atomic write path', async () => {
    const dir = await tempDir('dsh-sm-ledger-')
    const file = join(dir, 'nested', 'skill-manager.json')
    const ledger = new SkillLedger(file)
    await ledger.record({ name: 'a', path: join(dir, 'a'), installedAt: 1 })
    const text = await readFile(file, 'utf8')
    expect(JSON.parse(text)).toMatchObject({ version: 1 })
  })
})