/**
 * Perception unit tests: recent-file walk (ordering, skips, depth, missing
 * roots) and process snapshot (shape + self-exclusion).
 */

import { mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultScanRoots } from '../src/index.ts'
import {
  isNoise, listProcesses, listRecentFiles, parsePsOutput, parseTasklistOutput,
  perceive, rankProcesses,
} from '../src/perceive.ts'

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

describe('defaultScanRoots', () => {
  it('prefers the existing English XDG dirs over Chinese ones', async () => {
    const home = join(await mkdtemp(join(tmpdir(), 'workscope-root-')), 'home')
    await mkdir(join(home, 'Desktop'), { recursive: true })
    await mkdir(join(home, '桌面'), { recursive: true })
    const roots = defaultScanRoots(home)
    expect(roots).toContain(join(home, 'Desktop'))
    expect(roots).not.toContain(join(home, '桌面'))
  })

  it('falls back to the Chinese dirs when the English ones are missing', async () => {
    const home = join(await mkdtemp(join(tmpdir(), 'workscope-root-')), 'home')
    await mkdir(join(home, '文档'), { recursive: true })
    await mkdir(join(home, '下载'), { recursive: true })
    const roots = defaultScanRoots(home)
    expect(roots).toContain(join(home, '文档'))
    expect(roots).toContain(join(home, '下载'))
    // Desktop has neither variant — the English default remains so the
    // perception pass reports a visible missing-root warning.
    expect(roots).toContain(join(home, 'Desktop'))
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
      // Kernel threads (bracket names) must never reach the report.
      expect(isNoise({ pid: entry.pid, name: entry.name, args: entry.args, rss: 0 })).toBe(false)
    }
  })

  it('honors the max bound', async () => {
    const { entries } = await listProcesses(3)
    expect(entries.length).toBeLessThanOrEqual(3)
  })
})

describe('process parsing and ranking', () => {
  it('parses ps rows with a trailing rss column and handles args ending in digits', () => {
    const sample = [
      '  2   0 kthreadd         [kthreadd] 0',
      '  1   0 systemd          /sbin/init splash 7 123',
      ' 42   1 chrome           /usr/bin/chrome --pid 99 4096',
    ].join('\n')
    const parsed = parsePsOutput(sample)
    expect(parsed).toEqual([
      { pid: 2, name: 'kthreadd', args: '[kthreadd]', rss: 0 },
      { pid: 1, name: 'systemd', args: '/sbin/init splash 7', rss: 123 },
      { pid: 42, name: 'chrome', args: '/usr/bin/chrome --pid 99', rss: 4096 },
    ])
  })

  it('parses tasklist CSV with thousand-separated Mem Usage', () => {
    const sample = [
      '"System Idle Process","0","Services","0","8 K"',
      '"chrome.exe","1234","Console","1","1,234,567 K"',
      '"foo","4321","Console","2","9,999 K"',
    ].join('\n')
    const parsed = parseTasklistOutput(sample)
    expect(parsed).toEqual([
      { pid: 0, name: 'System Idle Process', args: 'System Idle Process', rss: 8 },
      { pid: 1234, name: 'chrome.exe', args: 'chrome.exe', rss: 1234567 },
      { pid: 4321, name: 'foo', args: 'foo', rss: 9999 },
    ])
  })

  it('drops kernel threads and Windows pseudo-processes, then ranks by memory', () => {
    const sample = [
      { pid: 2, name: 'kthreadd', args: '[kthreadd]', rss: 0 },
      { pid: 3, name: 'pool_workqueue', args: '[pool_workqueue_release]', rss: 0 },
      { pid: 4, name: 'System Idle Process', args: 'System Idle Process', rss: 8 },
      { pid: 42, name: 'small', args: 'small', rss: 100 },
      { pid: 43, name: 'big', args: 'big', rss: 9_000 },
      { pid: 44, name: 'mid', args: 'mid', rss: 500 },
    ]
    const ranked = rankProcesses(sample)
    expect(ranked.map(p => p.name)).toEqual(['big', 'mid', 'small'])
  })
})
