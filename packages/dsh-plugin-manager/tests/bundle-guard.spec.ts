/**
 * Unit tests for the duplicate-mount guard: the pure newly-added computation,
 * the before-state row-mount collection (including the disabled-override
 * nuance), and the strip decision. Job-level coverage lives in
 * gateway-jobs.spec.ts.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { duplicateMountBundles, newlyAddedBundles, rowMountedPackageNames, type GuardSnapshot } from '../src/host/bundle-guard.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A temp profile whose dependencies carry the given bundle patch texts. */
function profileWith(depPatches: Record<string, string>, patchText = '[]\n'): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-guard-'))
  const profileDir = join(dir, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  const patchPath = join(profileDir, 'cordis.patch.yml')
  writeFileSync(patchPath, patchText)
  for (const [name, text] of Object.entries(depPatches)) {
    const moduleDir = join(profileDir, 'node_modules', ...name.split('/'))
    mkdirSync(moduleDir, { recursive: true })
    writeFileSync(join(moduleDir, 'cordis.patch.yml'), text)
  }
  tempDirs.push(dir)
  return {
    facts: { profileName: 'web', profileDir, patchPath, packageJsonPath: join(profileDir, 'package.json') },
    dir,
  }
}

function snapshot(partial: Partial<GuardSnapshot>): GuardSnapshot {
  return { patchText: '[]\n', dependencies: [], rowEnabled: new Map(), ...partial }
}

describe('newlyAddedBundles', () => {
  it('reports entries present after and absent before, in after-state order', () => {
    expect(newlyAddedBundles(['a'], ['a', 'b', 'c'])).toEqual(['b', 'c'])
    expect(newlyAddedBundles(['a'], ['b', 'a'])).toEqual(['b'])
    expect(newlyAddedBundles(['a'], ['a'])).toEqual([])
  })
})

describe('rowMountedPackageNames', () => {
  it('collects insert-entry names from every before-state dependency patch', async () => {
    const { facts } = profileWith({
      '@linxin666/dsh-web-all': [
        '- insert:',
        "    - id: web-ui-task-board",
        "      name: '@linxin666/dsh-client-ui-task-board'",
        '- insert:',
        '    - id: better-sidebar',
        '      name: dsh-better-sidebar',
        '',
      ].join('\n'),
      'dsh-plain': '[]\n',
    })
    const mounted = await rowMountedPackageNames(facts, snapshot({
      dependencies: ['@linxin666/dsh-web-all', 'dsh-plain'],
    }))
    expect(mounted.has('@linxin666/dsh-client-ui-task-board')).toBe(true)
    expect(mounted.has('dsh-better-sidebar')).toBe(true)
    expect(mounted.has('dsh-plain')).toBe(false)
  })

  it('counts enabled profile patch rows and skips disabled ones', async () => {
    const patchText = [
      '- id: custom',
      '  name: dsh-custom',
      '- id: off',
      '  name: dsh-off',
      '  disabled: true',
      '',
    ].join('\n')
    const { facts } = profileWith({}, patchText)
    const mounted = await rowMountedPackageNames(facts, snapshot({
      patchText,
      rowEnabled: new Map([['custom', true], ['off', false]]),
    }))
    expect(mounted.has('dsh-custom')).toBe(true)
    expect(mounted.has('dsh-off')).toBe(false)
  })

  it('skips dependency insert entries the profile layer disables by id', async () => {
    const { facts } = profileWith({
      '@linxin666/dsh-web-all': '- insert:\n    - id: better-sidebar\n      name: dsh-better-sidebar\n',
    })
    const mounted = await rowMountedPackageNames(facts, snapshot({
      dependencies: ['@linxin666/dsh-web-all'],
      rowEnabled: new Map([['better-sidebar', false]]),
    }))
    expect(mounted.has('dsh-better-sidebar')).toBe(false)
  })
})

describe('duplicateMountBundles', () => {
  it('selects exactly the newly added, already row-mounted entries', async () => {
    const { facts } = profileWith({
      '@linxin666/dsh-web-all': '- insert:\n    - id: better-sidebar\n      name: dsh-better-sidebar\n',
    })
    const strip = await duplicateMountBundles(
      facts,
      snapshot({ dependencies: ['@linxin666/dsh-web-all'] }),
      ['@linxin666/dsh-web-all'],
      ['@linxin666/dsh-web-all', 'dsh-better-sidebar', 'dsh-memoir'],
    )
    expect(strip).toEqual(['dsh-better-sidebar'])
  })
})
