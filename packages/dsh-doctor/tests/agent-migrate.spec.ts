import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyAggregate } from '../src/agent/migrate.ts'

const homeDirs: string[] = []
afterEach(() => { for (const dir of homeDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const LEGACY = '@linxin666/dsh-web-ui-all'
const CURRENT = '@linxin666/dsh-web-all'

function makeProfile(oldSpec = '0.3.2'): { home: string; profileDir: string; packagePath: string; lockPath: string } {
  const home = mkdtempSync(join(tmpdir(), 'doctor-migrate-'))
  homeDirs.push(home)
  const profileDir = join(home, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  const packagePath = join(profileDir, 'package.json')
  writeFileSync(packagePath, JSON.stringify({
    name: 'dsh-profile-web', private: true,
    dependencies: { [LEGACY]: oldSpec },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', LEGACY, '@omdsh-dev/dsh-annotation'] } },
  }, null, 2))
  return { home, profileDir, packagePath, lockPath: join(profileDir, 'pnpm-lock.yaml') }
}

function readRaw(packagePath: string): { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } } {
  return JSON.parse(require('node:fs').readFileSync(packagePath, 'utf8'))
}
function readModel(packagePath: string): { dependencies: Record<string, string>; bundles: string[] } {
  const pkg = readRaw(packagePath)
  return { dependencies: pkg.dependencies, bundles: pkg.dsh.profile.bundles }
}
function writeRaw(packagePath: string, value: { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }): void {
  require('node:fs').writeFileSync(packagePath, JSON.stringify(value, null, 2))
}

describe('Doctor legacy aggregate migration', () => {
  it('migrates a local repository link and preserves bundle order', async () => {
    const { home, profileDir, packagePath, lockPath } = makeProfile()
    const oldDir = join(home, 'repo', 'packages', 'dsh-web-ui-all')
    const targetDir = join(home, 'repo', 'packages', 'dsh-web-all')
    mkdirSync(oldDir, { recursive: true })
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify({ name: CURRENT, version: '0.3.3' }))
    const before = readRaw(packagePath)
    before.dependencies[LEGACY] = `link:${oldDir}`
    writeRaw(packagePath, before)
    const calls: string[][] = []
    const run = async (args: string[]) => {
      calls.push(args)
      if (args[0] !== 'plugin') return { code: 0, output: '' }
      if (args[3] === 'add' && args[4] === `link:${targetDir}`) {
        const raw = readRaw(packagePath)
        raw.dependencies[CURRENT] = `link:${targetDir}`
        raw.dsh.profile.bundles.push(CURRENT)
        writeRaw(packagePath, raw)
        return { code: 0, output: '' }
      }
      if (args[3] === 'remove' && args[4] === LEGACY) {
        const raw = readRaw(packagePath)
        delete raw.dependencies[LEGACY]
        raw.dsh.profile.bundles = raw.dsh.profile.bundles.filter(value => value !== LEGACY)
        writeRaw(packagePath, raw)
        return { code: 0, output: '' }
      }
      return { code: 0, output: '' }
    }
    const result = await migrateLegacyAggregate(home, 'web', '/fake/dsh', {
      env: {},
      run,
      exists: () => true,
      targetVersion: '0.3.3',
    })
    const after = readModel(packagePath)
    expect(result.kind).toBe('migrated')
    expect(after.dependencies[LEGACY]).toBeUndefined()
    expect(after.dependencies[CURRENT]).toBe(`link:${targetDir}`)
    expect(after.bundles).toEqual(['@deepseek-ai/dsh-base', CURRENT, '@omdsh-dev/dsh-annotation'])
    expect(calls.some(args => args[3] === 'remove' && args[4] === LEGACY)).toBe(true)
    expect(calls.some(args => args[3] === 'add' && args[4] === `link:${targetDir}`)).toBe(true)
    expect(require('node:fs').existsSync(lockPath)).toBe(false)
  }, 10_000)

  it('rewrites and resolves a relative local link against the profile directory', async () => {
    const { home, profileDir, packagePath, lockPath } = makeProfile()
    const before = readRaw(packagePath)
    before.dependencies[LEGACY] = 'link:../repo/dsh-web-ui-all'
    writeRaw(packagePath, before)
    const targetDir = join(profileDir, '..', 'repo', 'dsh-web-all')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify({ name: CURRENT, version: '0.3.3' }))
    const seen: string[] = []
    const result = await migrateLegacyAggregate(home, 'web', '/fake/dsh', {
      env: {},
      exists: path => { seen.push(path); return path.endsWith(join('dsh-web-all', 'package.json')) },
      run: async () => ({ code: 0, output: '' }),
      targetVersion: '0.3.3',
    })
    expect(result.kind).toBe('migrated')
    expect(result.targetSpec).toBe('link:../repo/dsh-web-all')
    expect(seen.some(path => path.endsWith(join('dsh-web-all', 'package.json')))).toBe(true)
    expect(require('node:fs').existsSync(lockPath)).toBe(false)
  }, 10_000)

  it('keeps only the current aggregate when it already existed and verify fails', async () => {
    const { home, profileDir, packagePath, lockPath } = makeProfile()
    const oldDir = join(home, 'repo', 'packages', 'dsh-web-ui-all')
    const targetDir = join(home, 'repo', 'packages', 'dsh-web-all')
    mkdirSync(oldDir, { recursive: true })
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify({ name: CURRENT, version: '0.3.3' }))
    const before = readRaw(packagePath)
    before.dependencies[LEGACY] = `link:${oldDir}`
    before.dependencies[CURRENT] = `link:${targetDir}`
    before.dsh.profile.bundles = ['@deepseek-ai/dsh-base', LEGACY, CURRENT, '@omdsh-dev/dsh-annotation']
    writeRaw(packagePath, before)
    const calls: string[][] = []
    const run = async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'plugin' && args[3] === 'remove' && args[4] === LEGACY) {
        const raw = readRaw(packagePath)
        delete raw.dependencies[LEGACY]
        raw.dsh.profile.bundles = raw.dsh.profile.bundles.filter(value => value !== LEGACY)
        writeRaw(packagePath, raw)
        return { code: 0, output: '' }
      }
      if (args[0] !== 'plugin') return { code: 1, output: 'dump gate failed' }
      return { code: 0, output: '' }
    }
    const result = await migrateLegacyAggregate(home, 'web', '/fake/dsh', {
      env: {},
      run,
      exists: () => true,
      targetVersion: '0.3.3',
    })
    const after = readModel(packagePath)
    expect(result.kind).toBe('error')
    expect(after.dependencies[LEGACY]).toBeUndefined()
    expect(after.dependencies[CURRENT]).toBe(`link:${targetDir}`)
    expect(after.bundles).toEqual(['@deepseek-ai/dsh-base', CURRENT, '@omdsh-dev/dsh-annotation'])
    expect(calls.some(args => args[3] === 'add' && args[4] === `link:${oldDir}`)).toBe(false)
    expect(require('node:fs').existsSync(lockPath)).toBe(false)
  }, 10_000)

  it('leaves the profile untouched when the current package is unavailable', async () => {
    const { home, packagePath } = makeProfile()
    const calls: string[][] = []
    const result = await migrateLegacyAggregate(home, 'web', '/fake/dsh', {
      env: {},
      run: async args => { calls.push(args); return { code: 0, output: '' } },
      exists: () => false,
      targetVersion: '0.3.3',
    })
    expect(result.kind).toBe('noop')
    expect(calls).toHaveLength(0)
    expect(readModel(packagePath).dependencies[LEGACY]).toBe('0.3.2')
  })
})
