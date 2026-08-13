/**
 * Perception unit tests: recent-file walk (ordering, skips, depth, missing
 * roots) and process snapshot (shape + self-exclusion).
 */

import { mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listProcesses, listRecentFiles, perceive } from '../src/perceive.ts'

describe('listRecentFiles', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-perceive-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('returns files newest-first, bounded by max, and reports scanned roots', async () => {
    const dir = join(base, 'root')
    await mkdir(dir)
    await writeFile(join(dir, 'old.txt'), 'old')
    await utimes(join(dir, 'old.txt'), new Date(2000, 0, 1), new Date(2000, 0, 1))
    await writeFile(join(dir, 'new.txt'), 'new')
    await utimes(join(dir, 'new.txt'), new Date(2020, 0, 1), new Date(2020, 0, 1))
    const sub = join(dir, 'sub')
    await mkdir(sub)
    await writeFile(join(sub, 'deep.txt'), 'deep')
    await utimes(join(sub, 'deep.txt'), new Date(2025, 0, 1), new Date(2025, 0, 1))
    // Writing deep.txt bumped sub's mtime — pin it after the write.
    await utimes(sub, new Date(2019, 0, 1), new Date(2019, 0, 1))

    const { entries, scannedRoots, warnings } = await listRecentFiles([dir], 2)
    expect(scannedRoots).toEqual([dir])
    expect(warnings).toHaveLength(0)
    expect(entries).toHaveLength(2)
    // Tool output schema declares mtime as integer — stat.mtimeMs is a float.
    for (const entry of entries) expect(Number.isInteger(entry.mtime)).toBe(true)
    expect(entries[0].name).toBe('deep.txt') // newest mtime wins
    expect(entries[0].kind).toBe('file')
    expect(entries[1].name).toBe('new.txt')
    expect(entries[1].mtime).toBeGreaterThan(0)
  })

  it('skips hidden entries and heavy directories', async () => {
    const dir = join(base, 'root')
    await mkdir(dir)
    await writeFile(join(dir, '.hidden'), 'x')
    await mkdir(join(dir, 'node_modules'))
    await writeFile(join(dir, 'node_modules', 'inner.js'), 'x')
    await mkdir(join(dir, '.git'))
    await writeFile(join(dir, 'visible.txt'), 'x')

    const { entries } = await listRecentFiles([dir], 100)
    const names = entries.map(entry => entry.name)
    expect(names).toContain('visible.txt')
    expect(names).not.toContain('.hidden')
    expect(names).not.toContain('inner.js')
    expect(names).not.toContain('.git')
  })

  it('marks directories containing .git as projects', async () => {
    const dir = join(base, 'root')
    const project = join(dir, 'my-repo')
    await mkdir(project, { recursive: true })
    await mkdir(join(project, '.git'))
    await utimes(project, new Date(2025, 0, 1), new Date(2025, 0, 1))
    const plain = join(dir, 'plain-dir')
    await mkdir(plain)
    await utimes(plain, new Date(2024, 0, 1), new Date(2024, 0, 1))

    const { entries } = await listRecentFiles([dir], 100)
    const byName = new Map(entries.map(entry => [entry.name, entry.kind]))
    expect(byName.get('my-repo')).toBe('project')
    expect(byName.get('plain-dir')).toBe('dir')
  })

  it('skips missing and non-directory roots with warnings', async () => {
    const file = join(base, 'a-file')
    await writeFile(file, 'x')
    const { entries, warnings, scannedRoots } = await listRecentFiles([join(base, 'nope'), file], 10)
    expect(warnings.length).toBe(2)
    expect(scannedRoots).toHaveLength(0)
    expect(entries).toHaveLength(0)
  })

  it('bounds depth', async () => {
    const dir = join(base, 'root')
    await mkdir(join(dir, 'a', 'b', 'c'), { recursive: true })
    await writeFile(join(dir, 'a', 'b', 'c', 'deep.txt'), 'x')
    await writeFile(join(dir, 'a', 'top.txt'), 'x')

    const shallow = await listRecentFiles([dir], 100, { depth: 1 })
    const shallowNames = shallow.entries.map(entry => entry.name)
    expect(shallowNames).toContain('top.txt')
    expect(shallowNames).not.toContain('deep.txt')

    const deep = await listRecentFiles([dir], 100, { depth: 4 })
    expect(deep.entries.some(entry => entry.name === 'deep.txt')).toBe(true)
  })

  it('perceive() assembles a full untrusted report', async () => {
    const dir = join(base, 'root')
    await mkdir(dir)
    await writeFile(join(dir, 'doc.xlsx'), 'x')

    const report = await perceive([dir], 10, 10)
    expect(report.sourceTrust).toBe('untrusted')
    expect(report.roots).toEqual([dir])
    expect(report.recentFiles.length).toBeGreaterThan(0)
    expect(report.processes.length).toBeGreaterThan(0)
    expect(report.scannedAt).toBeTruthy()
  })
})

describe('listProcesses', () => {
  it('returns well-shaped entries and never our own pid', async () => {
    const { entries, warnings } = await listProcesses(50)
    expect(warnings).toHaveLength(0)
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(typeof entry.pid).toBe('number')
      expect(entry.pid).toBeGreaterThan(0)
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.pid).not.toBe(process.pid)
    }
  })

  it('honors the max bound', async () => {
    const { entries } = await listProcesses(3)
    expect(entries.length).toBeLessThanOrEqual(3)
  })
})
