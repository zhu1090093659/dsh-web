/**
 * Root resolution: DSH_HOME precedence, the project-root git walk, and the
 * two install destinations.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findProjectRoot, resolveDshHome, resolveSkillRoots } from '../src/core/roots.ts'

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

describe('resolveDshHome', () => {
  it('prefers DSH_HOME', () => {
    expect(resolveDshHome({ DSH_HOME: '/data/dsh' }, '/home/user')).toBe(resolve('/data/dsh'))
  })

  it('ignores a blank DSH_HOME', () => {
    expect(resolveDshHome({ DSH_HOME: '  ' }, '/home/user')).toBe(resolve(join('/home/user', '.dsh')))
  })

  it('falls back to <home>/.dsh', () => {
    expect(resolveDshHome({}, '/home/user')).toBe(resolve(join('/home/user', '.dsh')))
  })
})

describe('findProjectRoot', () => {
  it('walks up to the nearest .git directory', async () => {
    const root = await tempDir('dsh-sm-roots-')
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    expect(await findProjectRoot(join(root, 'a', 'b'), pathExists)).toBe(root)
  })

  it('falls back to the cwd itself', async () => {
    const root = await tempDir('dsh-sm-roots-')
    expect(await findProjectRoot(root, pathExists)).toBe(root)
  })
})

describe('resolveSkillRoots', () => {
  it('resolves workspace and user roots', async () => {
    const root = await tempDir('dsh-sm-roots-')
    await mkdir(join(root, '.git'))
    const roots = await resolveSkillRoots(join(root, 'sub'), '/home/user/.dsh', pathExists)
    expect(roots.projectRoot).toBe(root)
    expect(roots.workspace).toBe(join(root, '.agents', 'skills'))
    expect(roots.user).toBe(join('/home/user/.dsh', 'skills'))
  })
})

async function pathExists(path: string): Promise<boolean> {
  const info = await import('node:fs/promises').then(m => m.stat(path).catch(() => undefined))
  return info !== undefined
}
