/**
 * CliGateway mutation-path acceptance tests (B5-B8 + spec fencing): temp
 * profiles plus a scripted fake CLI. The fake stands in for the official
 * dsh plugin CLI — it mutates the temp profile exactly as the real CLI
 * would (dependencies + node_modules manifests) and reports exit codes.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CliGateway,
  nativeManagerFailure,
  nativeManagerRestartRequired,
  unsafeSpecReason,
  type GatewayJob,
} from '../src/host/gateway.ts'
import { CURRENT_AGGREGATE, LEGACY_AGGREGATE } from '../src/host/legacy-migration.ts'
import type { ProfileFacts } from '../src/host/profile.ts'
import { makeGatewayRoutes } from '../src/host/routes.ts'

interface FakeChild {
  stdout: { on: (event: string, handler: (chunk: Buffer) => void) => void }
  stderr: { on: () => void }
  kill: () => void
  on: (event: string, handler: (code?: number | null) => void) => void
}

type SpawnBehavior = (args: string[]) => { code: number; output?: string }

const BACKTICK = String.fromCharCode(96)

/** A scripted CLI double; records every argv and settles via close. */
function fakeSpawn(behavior: SpawnBehavior, calls: string[][]) {
  return (_binary: string, args: string[], _env: unknown): FakeChild => {
    calls.push([...args])
    const { code, output = '' } = behavior(args)
    return {
      stdout: { on: (event, handler) => { if (event === 'data' && output !== '') handler(Buffer.from(output)) } },
      stderr: { on: () => {} },
      kill: () => {},
      on: (event, handler) => { if (event === 'close') setTimeout(() => handler(code), 0) },
    }
  }
}

/** A temp profile; deps maps package name to its optional bundle patch text. */
function makeProfile(
  deps: Record<string, { patch?: string; version?: string; bundle?: boolean }>,
  options: { bundles?: string[] } = {},
): { facts: ProfileFacts; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-manager-jobs-'))
  const profileDir = join(dir, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  const dependencies: Record<string, string> = {}
  for (const name of Object.keys(deps)) dependencies[name] = '1.0.0'
  writePackageJson(profileDir, dependencies, options.bundles ?? Object.keys(deps))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# layer\n[]\n')
  for (const [name, dep] of Object.entries(deps)) installPackage(profileDir, name, dep)
  return {
    facts: {
      profileName: 'web',
      profileDir,
      patchPath: join(profileDir, 'cordis.patch.yml'),
      packageJsonPath: join(profileDir, 'package.json'),
    },
    dir,
  }
}

function writePackageJson(profileDir: string, dependencies: Record<string, string>, bundles: string[]): void {
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies, dsh: { profile: { bundles } },
  }))
}

function readManifest(profileDir: string): { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } } {
  return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as never
}

/** Write one installed package's own files: its manifest and optional bundle patch. */
function writePackageFiles(profileDir: string, name: string, dep: { patch?: string; version?: string; bundle?: boolean }): void {
  const moduleDir = join(profileDir, 'node_modules', ...name.split('/'))
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({
    name,
    version: dep.version ?? '1.0.0',
    ...(dep.bundle === true ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {}),
  }))
  if (dep.patch !== undefined) writeFileSync(join(moduleDir, 'cordis.patch.yml'), dep.patch)
}

/** Simulate the official CLI's successful add: package files, dependency line, bundles row. */
function installPackage(profileDir: string, name: string, dep: { patch?: string; version?: string; bundle?: boolean }): void {
  writePackageFiles(profileDir, name, dep)
  const manifest = readManifest(profileDir)
  if (manifest.dependencies[name] !== undefined) return
  writePackageJson(profileDir, { ...manifest.dependencies, [name]: '1.0.0' }, [...manifest.dsh.profile.bundles, name])
}

/**
 * Simulate the CLI's add when pnpm's build-script gate ends the run: the
 * dependency line lands in the profile manifest, and the reconcile that appends
 * the `dsh.profile.bundles` row never runs. Measured 2026-10-31 on DSH
 * 0.2.1-rc.5 with its bundled pnpm 11.9.0: `dsh plugin --profile web add` for a
 * 51-package aggregate exits 1 on ERR_PNPM_IGNORED_BUILDS with the dependency
 * written and the bundles row absent.
 */
function installPackageWithoutBundle(profileDir: string, name: string, dep: { patch?: string; version?: string; bundle?: boolean }): void {
  writePackageFiles(profileDir, name, dep)
  const manifest = readManifest(profileDir)
  if (manifest.dependencies[name] !== undefined) return
  writePackageJson(profileDir, { ...manifest.dependencies, [name]: '1.0.0' }, manifest.dsh.profile.bundles)
}

/** Simulate the official CLI's remove: drop the dependency line. */
function removePackage(profileDir: string, name: string): void {
  const manifest = readManifest(profileDir)
  delete manifest.dependencies[name]
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(bundle => bundle !== name)
  writePackageJson(profileDir, manifest.dependencies, manifest.dsh.profile.bundles)
}

/**
 * Mirror the official CLI's bundle reconciliation: after any mutation the
 * bundles array becomes exactly the set of dependencies that declare
 * `dsh.bundle` — including packages the composition already mounts through a
 * patch row (the duplicate-mount hazard the safeguard strips back out).
 */
function reconcileBundles(profileDir: string): void {
  const manifest = readManifest(profileDir)
  const declaring = Object.keys(manifest.dependencies).filter(name => {
    try {
      const pkg = JSON.parse(readFileSync(join(profileDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as {
        dsh?: { bundle?: unknown }
      }
      return pkg.dsh?.bundle !== undefined
    } catch {
      return false
    }
  })
  writePackageJson(profileDir, manifest.dependencies, declaring)
}

async function settle(gateway: CliGateway, jobId: string): Promise<GatewayJob> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = gateway.status(jobId)
    if (job !== undefined && job.phase !== 'running') return job
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('job did not settle')
}

function gatewayFor(facts: ProfileFacts, behavior: SpawnBehavior, calls: string[][]): CliGateway {
  return new CliGateway(facts, {} as NodeJS.ProcessEnv, {
    spawnImpl: fakeSpawn(behavior, calls) as never,
    findBinary: () => '/fake/dsh',
  })
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('unsafeSpecReason', () => {
  it('rejects cmd.exe chaining and quoting metacharacters', () => {
    const cases = ['pkg & echo x', 'pkg | cat', 'pkg > out', 'pkg < in', 'pkg "x"', "pkg 'x'", 'pkg ' + BACKTICK + 'x', 'pkg\nx']
    for (const spec of cases) {
      expect(unsafeSpecReason(spec), spec).toBeDefined()
    }
  })

  it('accepts registry, scoped, version-range, and git specs', () => {
    for (const spec of ['dsh-pet', '@linxin666/dsh-pet@^1.2.3', 'pkg@~2.0.0', 'git+https://github.com/a/b.git#main', 'github:a/b', 'link:../local-pkg']) {
      expect(unsafeSpecReason(spec), spec).toBeUndefined()
    }
  })
})

describe('nativeManagerRestartRequired', () => {
  it('operator: reads the landed-but-unloaded verdict as a restart fact, not a failure', () => {
    // Given the verdicts the official manager resolves with: an in-place apply,
    // an apply only a restart loads, a folded refusal, and a cancellation
    const applied = { stage: 'install', target: 'dsh-memoir@1.1.0', changed: true, application: 'applied' }
    const needsRestart = { stage: 'remove', target: 'dsh-memoir', changed: true, application: 'restart-required' }
    const refused = {
      stage: 'install',
      target: 'dsh-memoir@1.1.0',
      changed: false,
      application: 'failed',
      error: { code: 'bundle-in-use' },
    }
    const cancelled = { stage: 'install', changed: false, application: 'cancelled' }

    // When each resolved verdict is read for its restart fact
    const facts = [applied, needsRestart, refused, cancelled].map(verdict => nativeManagerRestartRequired(verdict))

    // Then only restart-required carries it, and it is not a failure: the
    // version landed, so reporting it as an error would undo an applied update
    expect(facts).toEqual([false, true, false, false])
    expect(nativeManagerRestartRequired(undefined)).toBe(false)
    expect(nativeManagerFailure(needsRestart)).toBeUndefined()
  })
})

describe('CliGateway spec fencing', () => {
  it('settles a metachar spec as an error job without spawning the CLI', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, () => ({ code: 0 }), calls)
    const { jobId } = gateway.install('dsh-nonexistent-pkg-zzz9 & echo marker')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('error')
    expect(job.error).toContain('shell')
    expect(calls).toHaveLength(0)
  })
})

describe('CliGateway install verification (B8)', () => {
  it('a success exit code without a landed dependency is an error, not done', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, () => ({ code: 0 }), calls)
    const { jobId } = gateway.install('link:/nonexistent/path')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('error')
    expect(job.error).toContain('未新增任何依赖')
  })

  it('a successful install lands the row and reports done', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, args[4] ?? '', { version: '0.4.3' })
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.install('dsh-memoir')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('done')
    expect(job.plugin?.id).toBe('dsh-memoir')
    expect(job.plugin?.version).toBe('0.4.3')
  })

  it('a remove exit 0 with the dependency still present is an error', async () => {
    const { facts, dir } = makeProfile({ 'dsh-memoir': {} })
    tempDirs.push(dir)
    const gateway = gatewayFor(facts, () => ({ code: 0 }), [])
    const { jobId } = gateway.remove('dsh-memoir')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('error')
    expect(job.error).toContain('卸载未生效')
  })
})

describe('CliGateway legacy aggregate migration', () => {
  it('removes legacy, installs current, preserves layer order, and verifies', async () => {
    const legacy = '@linxin666/dsh-web-ui-all'
    const current = '@linxin666/dsh-web-all'
    const { facts, dir } = makeProfile({ [legacy]: { version: '0.3.2', bundle: true } }, { bundles: [legacy, '@omdsh-dev/dsh-annotation'] })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add' && args[4] === `${current}@0.3.3`) {
        installPackage(facts.profileDir, current, { version: '0.3.3', bundle: true })
      }
      if (args[3] === 'remove' && args[4] === legacy) removePackage(facts.profileDir, legacy)
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.migrate(legacy, current, '0.3.3', `${current}@0.3.3`)
    const job = await settle(gateway, jobId)

    expect(job.phase).toBe('done')
    expect(job.plugin?.id).toBe(current)
    expect(job.plugin?.version).toBe('0.3.3')
    expect(readManifest(facts.profileDir).dependencies[legacy]).toBeUndefined()
    expect(readManifest(facts.profileDir).dependencies[current]).toBe('1.0.0')
    expect(readManifest(facts.profileDir).dsh.profile.bundles).toEqual([current, '@omdsh-dev/dsh-annotation'])
    expect(calls.some(args => args[3] === 'remove' && args[4] === legacy)).toBe(true)
    expect(calls.some(args => args[3] === 'add' && args[4] === `${current}@0.3.3`)).toBe(true)
  })

  it('does not recreate dual bundles when the current aggregate was already present and verify fails', async () => {
    const legacy = '@linxin666/dsh-web-ui-all'
    const current = '@linxin666/dsh-web-all'
    const { facts, dir } = makeProfile(
      {
        [legacy]: { version: '0.3.2', bundle: true },
        [current]: { version: '0.3.3', bundle: true },
      },
      { bundles: [legacy, current, '@omdsh-dev/dsh-annotation'] },
    )
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] === 'plugin' && args[3] === 'remove' && args[4] === legacy) {
        removePackage(facts.profileDir, legacy)
        return { code: 0 }
      }
      if (args[0] !== 'plugin') return { code: 1, output: 'dump gate failed' }
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.migrate(legacy, current, '0.3.3', `${current}@0.3.3`)
    const job = await settle(gateway, jobId)

    expect(job.phase).toBe('error')
    expect(job.error).toContain('迁移后的启动预检失败')
    const manifest = readManifest(facts.profileDir)
    expect(manifest.dependencies[legacy]).toBeUndefined()
    expect(manifest.dependencies[current]).toBe('1.0.0')
    expect(manifest.dsh.profile.bundles).toEqual([current, '@omdsh-dev/dsh-annotation'])
    expect(calls.some(args => args[3] === 'add' && args[4] === `${current}@0.3.3`)).toBe(true)
    expect(calls.some(args => args[3] === 'add' && args[4] === legacy)).toBe(false)
  })

  it('accepts a local repository link without requiring a registry version match', async () => {
    const legacy = '@linxin666/dsh-web-ui-all'
    const current = '@linxin666/dsh-web-all'
    const { facts, dir } = makeProfile({ [legacy]: { version: '0.3.2', bundle: true } }, { bundles: [legacy, '@omdsh-dev/dsh-annotation'] })
    tempDirs.push(dir)
    const targetSpec = 'link:/Users/zcl/code/dsh-web/packages/dsh-web-all'
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add' && args[4] === targetSpec) {
        installPackage(facts.profileDir, current, { version: '0.3.2', bundle: true })
        return { code: 0 }
      }
      if (args[3] === 'remove' && args[4] === legacy) {
        removePackage(facts.profileDir, legacy)
        return { code: 0 }
      }
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.migrate(legacy, current, '0.3.3', targetSpec)
    const job = await settle(gateway, jobId)

    expect(job.phase).toBe('done')
    expect(job.plugin?.version).toBe('0.3.2')
    expect(readManifest(facts.profileDir).dependencies[current]).toBe('1.0.0')
  })
})

describe('CliGateway legacy aggregate migration rollback', () => {
  it('operator: is told the rollback did not finish when taking the new aggregate back out fails', async () => {
    // Given a migration whose boot preflight fails after it installed the new
    // aggregate, on a profile whose rollback cannot remove that aggregate again
    const legacy = LEGACY_AGGREGATE
    const current = CURRENT_AGGREGATE
    const { facts, dir } = makeProfile({ [legacy]: { version: '0.3.2', bundle: true } }, { bundles: [legacy] })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 1, output: 'boot preflight: entry "ui-pet" failed to load' }
      if (args[3] === 'add' && args[4] === `${current}@0.3.3`) {
        installPackage(facts.profileDir, current, { version: '0.3.3', bundle: true })
        return { code: 0 }
      }
      if (args[3] === 'remove' && args[4] === legacy) {
        removePackage(facts.profileDir, legacy)
        return { code: 0 }
      }
      if (args[3] === 'remove' && args[4] === current) return { code: 1, output: 'ERR_PNPM cannot remove that dependency' }
      return { code: 0 }
    }, calls)

    // When the migration fails and its rollback cannot take the new aggregate out
    const job = await settle(gateway, gateway.migrate(legacy, current, '0.3.3', `${current}@0.3.3`).jobId)

    // Then the report says the rollback did not finish and names the command
    // that clears it, instead of claiming a rollback that never happened
    expect(job.phase).toBe('error')
    expect(job.error).toContain('回滚未完成')
    expect(job.error).toContain(`dsh plugin --profile web remove ${current}`)
    expect(job.error).not.toContain('已回滚到旧包')
    // ... and the legacy package was not re-added on top of the new one: the
    // profile keeps one aggregate, never both declaring the same row ids
    expect(calls.some(args => args[3] === 'add' && args[4]?.startsWith(legacy))).toBe(false)
    const manifest = readManifest(facts.profileDir)
    expect(manifest.dependencies[legacy]).toBeUndefined()
    expect(manifest.dependencies[current]).toBe('1.0.0')
  })
})

describe('CliGateway duplicate entry id rollback (B5)', () => {
  it('rolls the new package back and never writes a shared-id disabled row', async () => {
    const { facts, dir } = makeProfile({
      'dsh-memoir': { patch: '- insert:\n    - id: memoir\n      name: dsh-memoir\n' },
    })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'collision-pkg', { patch: '- insert:\n    - id: memoir\n      name: collision-pkg\n' })
        return { code: 0 }
      }
      if (args[3] === 'remove') removePackage(facts.profileDir, args[4] ?? '')
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.install('collision-pkg')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('error')
    expect(job.error).toContain('冲突')
    expect(job.error).toContain('已自动回滚')
    expect(calls.some(args => args[3] === 'remove' && args[4] === 'collision-pkg')).toBe(true)
    expect(readFileSync(facts.patchPath, 'utf8')).not.toContain('disabled')
    expect(readManifest(facts.profileDir).dependencies['dsh-memoir']).toBe('1.0.0')
    expect(readManifest(facts.profileDir).dependencies['collision-pkg']).toBeUndefined()
    expect(job.conflicts?.some(change => change.to === 'uninstalled')).toBe(true)
  })
})

describe('CliGateway unresolvable insert rollback (B6)', () => {
  it('rolls back a package whose insert entry names an unresolvable package', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'broken-pkg', { patch: "- insert:\n    - id: broken\n      name: '@nonexistent/dsh-bundle-missing'\n" })
        return { code: 0 }
      }
      if (args[3] === 'remove') removePackage(facts.profileDir, args[4] ?? '')
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.install('broken-pkg')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('error')
    expect(job.error).toContain('不可解析')
    expect(job.error).toContain('@nonexistent/dsh-bundle-missing')
    expect(calls.some(args => args[3] === 'remove' && args[4] === 'broken-pkg')).toBe(true)
    expect(readManifest(facts.profileDir).dependencies['broken-pkg']).toBeUndefined()
  })

  it('accepts insert entries naming official @deepseek-ai packages', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'official-ref-pkg', { patch: "- insert:\n    - id: official-ref\n      name: '@deepseek-ai/dsh-app-web'\n" })
        return { code: 0 }
      }
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.install('official-ref-pkg')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('done')
    expect(job.plugin?.id).toBe('official-ref-pkg')
  })
})

describe('CliGateway mutation queue (B7)', () => {
  it('uses the same queue for direct profile writes and CLI jobs', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, args[4] ?? '', {})
      return { code: 0 }
    }, calls)
    let release!: () => void
    const blocker = new Promise<void>(resolve => { release = resolve })
    const direct = gateway.withMutationLock(async () => {
      await blocker
    })
    const { jobId } = gateway.install('queued-after-toggle')
    await Promise.resolve()
    expect(calls).toEqual([])
    release()
    await direct
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('done')
    expect(calls.filter(args => args[3] === 'add').map(args => args[4])).toEqual(['queued-after-toggle'])
  })

  it('does not let a rejected direct mutation poison the queue', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const gateway = gatewayFor(facts, () => ({ code: 0 }), [])
    await expect(gateway.withMutationLock(async () => {
      throw new Error('write failed')
    })).rejects.toThrow('write failed')
    await expect(gateway.withMutationLock(async () => 'next mutation')).resolves.toBe('next mutation')
  })

  it('two concurrent installs stay serialized and attribute rows correctly', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, args[4] ?? '', {})
      return { code: 0 }
    }, calls)
    const first = gateway.install('conc-a')
    const second = gateway.install('conc-b')
    const [jobA, jobB] = await Promise.all([settle(gateway, first.jobId), settle(gateway, second.jobId)])
    expect(jobA.phase).toBe('done')
    expect(jobB.phase).toBe('done')
    expect(jobA.plugin?.id).toBe('conc-a')
    expect(jobB.plugin?.id).toBe('conc-b')
    const addCalls = calls.filter(args => args[3] === 'add').map(args => args[4])
    expect(addCalls).toEqual(['conc-a', 'conc-b'])
  })
})
/** An aggregate that mounts an external plugin through a patch row, not the bundles layer. */
const AGGREGATE_PATCH = [
  '- insert:',
  '    - id: web-ui-task-board',
  "      name: '@linxin666/dsh-client-ui-task-board'",
  '- insert:',
  '    - id: better-sidebar',
  '      name: dsh-better-sidebar',
  '',
].join('\n')

describe('CliGateway duplicate-mount safeguard (B9)', () => {
  it('strips a reconciliation-added bundles entry for an already row-mounted package', async () => {
    // The aggregate mounts the external plugin via a patch row while the
    // package also sits in dependencies (not in bundles); any CLI mutation
    // re-adds it to bundles and the next boot double-mounts.
    const { facts, dir } = makeProfile({
      '@linxin666/dsh-web-all': { bundle: true, patch: AGGREGATE_PATCH },
      'dsh-better-sidebar': { bundle: true },
    }, { bundles: ['@linxin666/dsh-web-all'] })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, args[4] ?? '', { version: '1.2.0', bundle: true })
        reconcileBundles(facts.profileDir)
      }
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.install('dsh-memoir')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('done')
    expect(job.plugin?.id).toBe('dsh-memoir')
    const manifest = readManifest(facts.profileDir)
    // The duplicate-mount entry is stripped; everything else is untouched.
    expect(manifest.dsh.profile.bundles).toEqual(['@linxin666/dsh-web-all', 'dsh-memoir'])
    expect(manifest.dependencies['dsh-better-sidebar']).toBe('1.0.0')
    // One notice per stripped entry, in the conflict-row shape.
    expect(job.notices).toEqual([{ id: 'dsh-better-sidebar', name: 'dsh-better-sidebar', from: 'enabled', to: 'uninstalled' }])
    // The strip never lands in the conflict ledger (the layer state round-trips).
    expect((job.conflicts ?? []).some(change => change.id === 'dsh-better-sidebar')).toBe(false)
    // The manifest write went through the safe path (backup + tmp + rename).
    expect(existsSync(join(facts.profileDir, 'package.json.bak-plugin-manager'))).toBe(true)
  })

  it('keeps the bundles entry of a normal install that no row mounts', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, args[4] ?? '', { version: '0.4.3', bundle: true })
        reconcileBundles(facts.profileDir)
      }
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.install('dsh-memoir')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('done')
    // The bundles entry is how a not-yet-mounted bundle loads: it stays.
    expect(readManifest(facts.profileDir).dsh.profile.bundles).toEqual(['dsh-memoir'])
    expect(job.notices).toBeUndefined()
  })

  it('ignores a non-bundle dependency (a plain library never enters bundles)', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, args[4] ?? '', { version: '1.3.0' })
        reconcileBundles(facts.profileDir)
      }
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.install('left-pad')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('done')
    const manifest = readManifest(facts.profileDir)
    expect(manifest.dependencies['left-pad']).toBe('1.0.0')
    expect(manifest.dsh.profile.bundles).toEqual([])
    expect(job.notices).toBeUndefined()
  })

  it('a remove job does not resurrect a previously stripped bundles entry', async () => {
    const { facts, dir } = makeProfile({
      '@linxin666/dsh-web-all': { bundle: true, patch: AGGREGATE_PATCH },
      'dsh-better-sidebar': { bundle: true },
      'dsh-memoir': { bundle: true },
    }, { bundles: ['@linxin666/dsh-web-all', 'dsh-memoir'] })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'remove') {
        removePackage(facts.profileDir, args[4] ?? '')
        reconcileBundles(facts.profileDir)
      }
      return { code: 0 }
    }, calls)
    const { jobId } = gateway.remove('dsh-memoir')
    const job = await settle(gateway, jobId)
    expect(job.phase).toBe('done')
    const manifest = readManifest(facts.profileDir)
    // Reconciliation re-added dsh-better-sidebar; the safeguard stripped it again.
    expect(manifest.dsh.profile.bundles).toEqual(['@linxin666/dsh-web-all'])
    expect(manifest.dependencies['dsh-better-sidebar']).toBe('1.0.0')
    expect(manifest.dependencies['dsh-memoir']).toBeUndefined()
    expect(job.notices).toEqual([{ id: 'dsh-better-sidebar', name: 'dsh-better-sidebar', from: 'enabled', to: 'uninstalled' }])
  })
})

describe('CliGateway update verification', () => {
  it('updates the existing package with an exact id@latest spec and returns the same row', async () => {
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] === 'plugin' && args[3] === 'add') {
        expect(args[4]).toBe('dsh-memoir@1.1.0')
        installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
      }
      return { code: 0 }
    }, calls)

    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: 'dsh-memoir', version: '1.1.0' })
    // An update is in-place: it must not create a second dependency entry.
    expect(Object.keys(readManifest(facts.profileDir).dependencies)).toEqual(['dsh-memoir'])
    expect(calls[0]).toEqual(['plugin', '--profile', 'web', 'add', 'dsh-memoir@1.1.0'])
  })

  it('rejects a green update command when the installed target version did not change', async () => {
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, () => ({ code: 0 }), calls)

    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    expect(job.phase).toBe('error')
    expect(job.error).toContain('更新未生效')
    expect(calls[0]).toEqual(['plugin', '--profile', 'web', 'add', 'dsh-memoir@1.1.0'])
  })
})

/**
 * One POST as the browser half sends it: a JSON body on a request that
 * satisfies the loopback fence (socket address, Host header, POST).
 * @param body - the JSON body to send.
 * @returns the request a route handler reads.
 */
function postJson(body: unknown): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  stream.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  stream.headers = { host: '127.0.0.1:3082' }
  stream.method = 'POST'
  return stream
}

/** The status and the decoded body one route answered with. */
function routeResponse(): { res: ServerResponse; status: () => number; body: () => unknown } {
  let code = 200
  let text = ''
  return {
    res: { writeHead(value: number) { code = value }, end(value: string) { text = value } } as unknown as ServerResponse,
    status: () => code,
    body: () => JSON.parse(text),
  }
}

/** The update route of one gateway, wired the way the host mounts it. */
function updateRoute(facts: ProfileFacts, gateway: CliGateway, latest: string) {
  return makeGatewayRoutes({
    facts,
    gateway,
    cliAvailable: () => true,
    fetchManifest: async () => ({ version: latest }),
  }).find(route => route.path === '/api/plugin-manager/update')!.handler
}

describe('CliGateway update retry after a failed boot preflight', () => {
  it('operator: has the failed preflight recorded as an unsettled update at the version it installed', async () => {
    // Given a plugin at 1.0.0 and an update to 1.1.0 whose boot preflight fails
    // without naming the plugin
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 1, output: 'boot preflight: entry "ui-pet" failed to load' }
      if (args[3] === 'add') writePackageFiles(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
      return { code: 0 }
    }, [])

    // When the update runs
    expect(gateway.lastUpdateFailed('dsh-memoir', '1.1.0')).toBe(false)
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the version landed while the run failed, and the record answers for
    // that plugin at that version alone — the fact the route needs to tell this
    // state from a plugin that is genuinely up to date
    expect(job.phase).toBe('error')
    expect(job.plugin?.version).toBe('1.1.0')
    expect(gateway.lastUpdateFailed('dsh-memoir', '1.1.0')).toBe(true)
    expect(gateway.lastUpdateFailed('dsh-memoir', '1.0.0')).toBe(false)
    expect(gateway.lastUpdateFailed('dsh-pet', '1.1.0')).toBe(false)
  })

  it('operator: stops being told the update failed once the reinstall of it settles', async () => {
    // Given the same failed update, with the preflight cause cleared afterwards
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    let preflightFails = true
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') {
        return preflightFails
          ? { code: 1, output: 'boot preflight: entry "ui-pet" failed to load' }
          : { code: 0, output: '- id: dsh-memoir\n  name: dsh-memoir\n' }
      }
      if (args[3] === 'add') writePackageFiles(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
      return { code: 0 }
    }, [])
    await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)
    expect(gateway.lastUpdateFailed('dsh-memoir', '1.1.0')).toBe(true)

    // When the reinstall of the same version runs and settles
    preflightFails = false
    const settled = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then nothing says the plugin's update failed any more, so the next update
    // click is answered as "already at latest" instead of installing again
    expect(settled.phase).toBe('done')
    expect(gateway.lastUpdateFailed('dsh-memoir', '1.1.0')).toBe(false)
  })

  it('operator: gets the retry through the update route, reinstall and preflight included', async () => {
    // Given an update that wrote the target version and then failed the boot
    // preflight without implicating the plugin, which leaves the profile at the
    // target version with the update unsettled
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    let preflightFails = true
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') {
        return preflightFails
          ? { code: 1, output: 'boot preflight: entry "ui-pet" failed to load' }
          : { code: 0, output: '- id: dsh-memoir\n  name: dsh-memoir\n' }
      }
      if (args[3] === 'add') writePackageFiles(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
      return { code: 0 }
    }, calls)
    const failed = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)
    expect(failed.phase).toBe('error')
    const handler = updateRoute(facts, gateway, '1.1.0')

    // When the cause is cleared and the user retries from the panel
    preflightFails = false
    const captured = routeResponse()
    await handler(postJson({ id: 'dsh-memoir' }), captured.res)

    // Then the retry starts a real reinstall instead of the dead-end 409, and it
    // settles at the target version on a preflight that now passes
    expect(captured.status()).toBe(200)
    const retried = await settle(gateway, (captured.body() as { jobId: string }).jobId)
    expect(retried.phase).toBe('done')
    expect(retried.plugin?.version).toBe('1.1.0')
    expect(calls.filter(args => args[3] === 'add')).toEqual([
      ['plugin', '--profile', 'web', 'add', 'dsh-memoir@1.1.0'],
      ['plugin', '--profile', 'web', 'add', 'dsh-memoir@1.1.0'],
    ])

    // ... and once it has settled, the same click is refused again: a plugin that
    // really is at the latest version is never reinstalled a second time
    const again = routeResponse()
    await handler(postJson({ id: 'dsh-memoir' }), again.res)
    expect(again.status()).toBe(409)
    expect(again.body()).toEqual({ error: expect.stringContaining('already at 1.1.0') })
    expect(calls.filter(args => args[3] === 'add')).toHaveLength(2)
  })
})

/**
 * pnpm 11's skipped-build-script exit, captured from the real CLI on 2026-10-31
 * (`dsh plugin --profile web add cpu-features`): the dependency is written to the
 * profile and the command still exits 1.
 */
const IGNORED_BUILDS_OUTPUT = [
  'dependencies:',
  '+ cpu-features ^0.0.10',
  '',
  'Packages: +3',
  '+++',
  'Progress: resolved 6, reused 3, downloaded 0, added 3, done',
  '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cpu-features@0.0.10',
  '',
  'Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.',
  'dsh: plugin command failed; diagnostics: /tmp/profiles/web/.plugin-manager/logs/operation-EXAMPLE/pnpm.log',
].join('\n')

/** The aggregate package the half mount was measured on (51 dependencies, 3 native builds). */
const AGGREGATE = '@linxin666/dsh-web-all'

/** A refusal pnpm reports for a run it did not carry out. */
const RELEASE_AGE_OUTPUT = [
  '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] cpu-features@0.0.10 is not older than 7 days on the registry',
].join('\n')

/** Whether one fake CLI call was the read-only composition probe. */
function isDumpConfig(args: string[]): boolean {
  return args[0] === '--profile' && args[2] === '--dump-config'
}

/**
 * The exit the CLI reports when the build-script gate fails a run it already
 * carried out. The profile mutation is the caller's, so each test says whether
 * the change landed.
 */
function ignoredBuildsExit(): { code: number; output: string } {
  return { code: 1, output: IGNORED_BUILDS_OUTPUT }
}

describe('CliGateway non-zero exit the profile overrules (pnpm build-script gate)', () => {
  it('operator: completes an install whose dependency landed although pnpm exited non-zero', async () => {
    // Given an install pnpm fails after writing the profile
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, args[4] ?? '', { version: '0.0.10' })
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the install runs to settlement
    const { jobId } = gateway.install('cpu-features')
    const job = await settle(gateway, jobId)

    // Then the landed install is done, carrying pnpm's own words, and the
    // post-check chain ran to its last gate (the composition preflight).
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: 'cpu-features', version: '0.0.10' })
    expect(job.warnings).toEqual([IGNORED_BUILDS_OUTPUT])
    expect(job.error).toBeUndefined()
    expect(calls.filter(isDumpConfig)).toHaveLength(1)
  })

  it('operator: keeps pnpm\'s reason when the tolerated exit landed nothing', async () => {
    // Given an install pnpm fails and the profile never gains the package
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, () => ignoredBuildsExit(), calls)

    // When the install runs to settlement
    const { jobId } = gateway.install('cpu-features')
    const job = await settle(gateway, jobId)

    // Then it stays an error with pnpm's output, and no post-check ran
    expect(job.phase).toBe('error')
    expect(job.error).toBe(IGNORED_BUILDS_OUTPUT)
    expect(job.warnings).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('operator: completes an update whose version landed although pnpm exited non-zero', async () => {
    // Given an update pnpm fails after the new version is on disk
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the update runs to settlement
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the version the route resolved is reported, and the preflight ran
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: 'dsh-memoir', version: '1.1.0' })
    expect(job.warnings).toEqual([IGNORED_BUILDS_OUTPUT])
    expect(calls.filter(isDumpConfig)).toHaveLength(1)
  })

  it('operator: keeps the failure when a tolerated exit left the old version in place', async () => {
    // Given an update pnpm fails and which moves nothing
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, () => ignoredBuildsExit(), calls)

    // When the update runs to settlement
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then it stays an error with pnpm's output, before any preflight
    expect(job.phase).toBe('error')
    expect(job.error).toBe(IGNORED_BUILDS_OUTPUT)
    expect(job.plugin).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('operator: keeps a different pnpm refusal a failure even when the version moved', async () => {
    // Given an update that lands while pnpm refuses for an unrelated reason
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
        return { code: 1, output: RELEASE_AGE_OUTPUT }
      }
      return { code: 0 }
    }, calls)

    // When the update runs to settlement
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then only the build-script condition is overruled: this stays an error
    expect(job.phase).toBe('error')
    expect(job.error).toBe(RELEASE_AGE_OUTPUT)
    expect(job.warnings).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('operator: still rolls back a tolerated install whose row names an unresolvable package', async () => {
    // Given an install pnpm fails and whose insert entry resolves nowhere
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'broken-pkg', {
          patch: "- insert:\n    - id: broken\n      name: '@nonexistent/dsh-bundle-missing'\n",
        })
        return ignoredBuildsExit()
      }
      if (args[3] === 'remove') removePackage(facts.profileDir, args[4] ?? '')
      return { code: 0 }
    }, calls)

    // When the tolerated install runs to settlement
    const { jobId } = gateway.install('broken-pkg')
    const job = await settle(gateway, jobId)

    // Then B6 decides against the package that did land: it is rolled back and
    // the preflight is never reached.
    expect(job.phase).toBe('error')
    expect(job.error).toContain('不可解析')
    expect(calls.some(args => args[3] === 'remove' && args[4] === 'broken-pkg')).toBe(true)
    expect(calls.some(isDumpConfig)).toBe(false)
    expect(readManifest(facts.profileDir).dependencies['broken-pkg']).toBeUndefined()
    expect(job.warnings).toBeUndefined()
  })

  it('operator: fails a tolerated run that the boot preflight rejects', async () => {
    // Given an update that lands while the composition cannot boot
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 1, output: 'error: cannot resolve plugin ui-pet' }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the update runs to settlement
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the preflight still runs after the tolerated exit and fails the job
    expect(job.phase).toBe('error')
    expect(job.error).toContain('cannot resolve plugin ui-pet')
    expect(calls.filter(isDumpConfig)).toHaveLength(1)
    expect(job.warnings).toBeUndefined()
  })

  it('operator: completes a removal whose dependency is gone although pnpm exited non-zero', async () => {
    // Given a removal pnpm fails after the dependency has left the profile
    const { facts, dir } = makeProfile({ 'dsh-memoir': {} })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'remove') {
        removePackage(facts.profileDir, args[4] ?? '')
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the removal runs to settlement
    const { jobId } = gateway.remove('dsh-memoir')
    const job = await settle(gateway, jobId)

    // Then the gone dependency settles the job instead of the exit code
    expect(job.phase).toBe('done')
    expect(readManifest(facts.profileDir).dependencies['dsh-memoir']).toBeUndefined()
    expect(job.warnings).toEqual([IGNORED_BUILDS_OUTPUT])
  })

  it('operator: completes a migration whose install step exited non-zero after landing', async () => {
    // Given a legacy aggregate whose replacement install pnpm fails after
    // writing it
    const legacy = '@linxin666/dsh-web-ui-all'
    const current = '@linxin666/dsh-web-all'
    const { facts, dir } = makeProfile(
      { [legacy]: { version: '0.3.2', bundle: true } },
      { bundles: [legacy, '@omdsh-dev/dsh-annotation'] },
    )
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'remove' && args[4] === legacy) {
        removePackage(facts.profileDir, legacy)
        return { code: 0 }
      }
      if (args[3] === 'add' && args[4] === `${current}@0.3.3`) {
        installPackage(facts.profileDir, current, { version: '0.3.3', bundle: true })
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the migration runs to settlement
    const { jobId } = gateway.migrate(legacy, current, '0.3.3', `${current}@0.3.3`)
    const job = await settle(gateway, jobId)

    // Then the migration is done on the version it landed, legacy removed
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: current, version: '0.3.3' })
    expect(job.warnings).toEqual([IGNORED_BUILDS_OUTPUT])
    expect(readManifest(facts.profileDir).dependencies[legacy]).toBeUndefined()
  })

  it('operator: keeps a tolerated install whose bundle row never landed a failure', async () => {
    // Given an install pnpm fails on the build-script gate after the CLI wrote
    // the dependency but before its reconcile appended the bundles row
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackageWithoutBundle(facts.profileDir, AGGREGATE, { version: '0.4.13', bundle: true })
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the tolerated install runs to settlement
    const { jobId } = gateway.install(`${AGGREGATE}@0.4.13`)
    const job = await settle(gateway, jobId)

    // Then the half mount is the verdict, not the dependency line: nothing is
    // reported as installed, pnpm's own words survive, and the composition
    // preflight is never reached
    expect(job.phase).toBe('error')
    expect(job.error).toContain('半挂载')
    expect(job.error).toContain(AGGREGATE)
    expect(job.error).toContain('[ERR_PNPM_IGNORED_BUILDS]')
    expect(job.plugin).toBeUndefined()
    expect(job.warnings).toBeUndefined()
    expect(calls.filter(isDumpConfig)).toHaveLength(0)
  })

  it('operator: completes a tolerated install of a bundle-declaring package the profile selected', async () => {
    // Given an install pnpm fails on the build-script gate whose packages
    // landed and whose bundles row the CLI's reconcile appended
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, AGGREGATE, { version: '0.4.13', bundle: true })
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the tolerated install runs to settlement
    const { jobId } = gateway.install(`${AGGREGATE}@0.4.13`)
    const job = await settle(gateway, jobId)

    // Then it is the success it is, with the selection the composition mounts
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: AGGREGATE, version: '0.4.13' })
    expect(job.warnings).toEqual([IGNORED_BUILDS_OUTPUT])
    expect(readManifest(facts.profileDir).dsh.profile.bundles).toContain(AGGREGATE)
    expect(calls.filter(isDumpConfig)).toHaveLength(1)
  })

  it('operator: fails a tolerated update that dropped a selection the profile had', async () => {
    // Given a selected bundle-declaring plugin whose replacement lands the new
    // version while the bundles row disappears with the run
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0', bundle: true } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0', bundle: true })
        const manifest = readManifest(facts.profileDir)
        writePackageJson(facts.profileDir, manifest.dependencies, manifest.dsh.profile.bundles.filter(name => name !== 'dsh-memoir'))
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the tolerated update runs to settlement
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the lost selection fails the job before any preflight reports a
    // version that nothing mounts
    expect(job.phase).toBe('error')
    expect(job.error).toContain('半挂载')
    expect(job.error).toContain('dsh-memoir')
    expect(job.plugin).toBeUndefined()
    expect(calls.filter(isDumpConfig)).toHaveLength(0)
  })

  it('operator: completes a tolerated update of a bundle-declaring package the profile never selected', async () => {
    // Given a plugin the profile mounts through a patch row instead of the
    // bundles layer, so its name was never in dsh.profile.bundles
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0', bundle: true } }, { bundles: [] })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'add') {
        installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0', bundle: true })
        return ignoredBuildsExit()
      }
      return { code: 0 }
    }, calls)

    // When the tolerated update runs to settlement
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then an absence the run found is not a loss it caused, so it completes
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: 'dsh-memoir', version: '1.1.0' })
    expect(job.warnings).toEqual([IGNORED_BUILDS_OUTPUT])
    expect(readManifest(facts.profileDir).dsh.profile.bundles).toEqual([])
    expect(calls.filter(isDumpConfig)).toHaveLength(1)
  })

  it('operator: rolls back a migration whose install step wrote no bundle row', async () => {
    // Given a legacy aggregate whose replacement lands as a dependency while
    // the bundles row its reconcile appends never arrives
    const legacy = '@linxin666/dsh-web-ui-all'
    const { facts, dir } = makeProfile({ [legacy]: { version: '0.3.2', bundle: true } }, { bundles: [legacy] })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'remove' && args[4] === legacy) {
        removePackage(facts.profileDir, legacy)
        return { code: 0 }
      }
      if (args[3] === 'add' && args[4] === `${AGGREGATE}@0.3.3`) {
        installPackageWithoutBundle(facts.profileDir, AGGREGATE, { version: '0.3.3', bundle: true })
        return ignoredBuildsExit()
      }
      if (args[3] === 'add' && (args[4] ?? '').startsWith(legacy)) {
        installPackage(facts.profileDir, legacy, { version: '0.3.2', bundle: true })
        return { code: 0 }
      }
      return { code: 0 }
    }, calls)

    // When the tolerated migration runs to settlement
    const { jobId } = gateway.migrate(legacy, AGGREGATE, '0.3.3', `${AGGREGATE}@0.3.3`)
    const job = await settle(gateway, jobId)

    // Then the half mount fails the migration, the legacy aggregate is put
    // back, and no composition probe reports the missing mount as healthy
    expect(job.phase).toBe('error')
    expect(job.error).toContain('半挂载')
    expect(job.error).toContain(AGGREGATE)
    expect(job.error).toContain('[ERR_PNPM_IGNORED_BUILDS]')
    const manifest = readManifest(facts.profileDir)
    expect(manifest.dependencies).toHaveProperty([legacy])
    expect(manifest.dsh.profile.bundles).toContain(legacy)
    expect(calls.filter(isDumpConfig)).toHaveLength(0)
  })
})

describe('CliGateway operations on an application-owned profile', () => {
  /** A profile fact set the packaged Desktop launcher produces. */
  function desktopFacts(facts: ProfileFacts): ProfileFacts {
    return { ...facts, profileName: 'desktop', desktop: true }
  }

  /** A gateway whose official in-process manager is scripted. */
  function nativeGatewayFor(
    facts: ProfileFacts,
    behavior: () => void,
    calls: string[][],
    removeBehavior: () => void = () => {},
  ): CliGateway {
    return new CliGateway(facts, {} as NodeJS.ProcessEnv, {
      spawnImpl: (() => { throw new Error('the CLI must not run for an application-owned profile') }) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({
        installBundle: async (spec: string) => { calls.push(['install', spec]); behavior() },
        removeBundle: async (name: string) => { calls.push(['remove', name]); removeBehavior() },
      }),
    })
  }

  /**
   * One official `updateBundle` answer for a run that replaced a bundle.
   *
   * The official manager owns the replacement itself since 0.2.2-rc.1, so this
   * is the whole shape our gateway reads: which phase ended the run, that
   * phase's own verdict, and the reinstallation when the target did not land.
   */
  function updateLanded(from: string, to: string, application = 'applied'): Record<string, unknown> {
    return { from, to, step: 'install', result: { stage: 'install', target: `${to}`, changed: true, application } }
  }

  /**
   * A gateway whose official manager answers one scripted `updateBundle`
   * sequence. The `installBundle` and `removeBundle` members it also carries
   * throw on purpose: an update must be one official call, and a test that
   * reaches for the old two-phase path fails instead of passing quietly.
   */
  function updateGatewayFor(
    facts: ProfileFacts,
    script: (name: string, version: string, requestId: string | undefined) => unknown | Promise<unknown>,
    calls: string[][] = [],
  ): CliGateway {
    return new CliGateway(desktopFacts(facts), {} as NodeJS.ProcessEnv, {
      spawnImpl: (() => { throw new Error('the CLI must not run for an application-owned profile') }) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({
        installBundle: async () => { throw new Error('an update must not call installBundle') },
        removeBundle: async () => { throw new Error('an update must not call removeBundle') },
        updateBundle: async (name: string, version: string, options?: { requestId?: string }) => {
          calls.push(['update', name, version, options?.requestId ?? ''])
          return script(name, version, options?.requestId)
        },
        setBundleEnabled: async (name: string, enabled: boolean) => {
          calls.push(['select', name, String(enabled)])
          return { stage: 'enable', target: name, enabled, changed: false, application: 'applied' }
        },
      }),
    })
  }

  /**
   * Mirror what the official manager does inside `updateBundle`: it removes the
   * installed version (which also drops the bundle from the layer order) and
   * installs the target, which appends that bundle at the end of
   * `dsh.profile.bundles`.
   */
  function managerReplaces(profileDir: string, name: string, version: string): void {
    removePackage(profileDir, name)
    installPackage(profileDir, name, { version, bundle: true })
    const manifest = readManifest(profileDir)
    // The reinstall appends the bundle behind every bundle that followed it, so
    // drop any entry the fake install left first: this is the order drift the
    // gateway has to correct.
    const bundles = [...manifest.dsh.profile.bundles.filter(bundle => bundle !== name), name]
    writePackageJson(profileDir, { ...manifest.dependencies, [name]: version }, bundles)
  }

  /** The verdict a real refused pnpm run carries (ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION). */
  const pnpmRefusal = {
    stage: 'install',
    target: 'dsh-better-sidebar@0.24.1',
    enabled: true,
    changed: false,
    application: 'failed',
    error: {
      code: 'operation-error',
      diagnostic: '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification',
    },
  }

  it('operator: is told the report needs a manager with an update primitive', async () => {
    // Given a runtime whose official manager has no update primitive (older than 0.2.2-rc.1)
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = new CliGateway(desktopFacts(facts), {} as NodeJS.ProcessEnv, {
      spawnImpl: (() => { throw new Error('the CLI must not run') }) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({ installBundle: async () => ({}), removeBundle: async () => ({}) }),
    })

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the failure names the missing primitive instead of pretending to update
    expect(job.phase).toBe('error')
    expect(job.error).toContain('updateBundle')
    expect(job.error).toContain('0.2.2-rc.1')
  })

  it('operator: updates through the official manager in one call instead of the refused CLI', async () => {
    // Given an application-owned desktop profile with an outdated package
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = updateGatewayFor(desktopFacts(facts), (name, version) => {
      managerReplaces(facts.profileDir, name, version)
      return updateLanded('1.0.0', version)
    }, calls)

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then exactly one official update ran, under the job's own request id, and
    // the resulting row is verified from the profile the host reads
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 3)).toEqual(['update', 'dsh-memoir', '1.1.0'])
    expect(calls[0]?.[3]).toMatch(/^job-/)
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: 'dsh-memoir', version: '1.1.0' })
    // An update this process serves needs no restart, so no such fact is claimed
    expect(job.restartRequired).toBeUndefined()
  })

  it('operator: sees a throwing manager call reported with its own message', async () => {
    // Given the official manager throws instead of resolving
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), () => { throw new Error('registry unreachable') })

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the failure is reported with the manager's own message
    expect(job.phase).toBe('error')
    expect(job.error).toContain('registry unreachable')
  })

  it('operator: sees the manager folded refusal with pnpm reason, naming the phase', async () => {
    // Given a manager that refused the install phase and resolved with its verdict
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), () => ({
      from: '1.0.0', to: '1.1.0', step: 'install', result: pnpmRefusal,
    }))

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the job reports the refusal, its pnpm diagnostic, and the phase that
    // ended the run, never claiming the manager succeeded with nothing moved
    expect(job.phase).toBe('error')
    expect(job.error).toContain('官方插件管理器更新失败')
    expect(job.error).toContain('安装新版本时失败')
    expect(job.error).toContain('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')
    expect(job.error).not.toContain('报告成功')
  })

  it('operator: sees a green manager run rejected when the version did not move', async () => {
    // Given the manager resolves without moving anything
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), () => updateLanded('1.0.0', '1.1.0'))

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then a no-op is still a failure, exactly like the CLI path
    expect(job.phase).toBe('error')
    expect(job.error).toContain('更新未生效')
  })

  it('operator: is told the version the manager put back when the target could not land', async () => {
    // Given the official manager failed the install phase and restored the
    // version it removed
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), () => ({
      from: '1.0.0',
      to: '1.1.0',
      step: 'install',
      result: pnpmRefusal,
      restore: { stage: 'install', target: 'dsh-memoir@1.0.0', changed: true, application: 'applied' },
    }))

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the report names the refusal and the version that is back on disk
    expect(job.phase).toBe('error')
    expect(job.error).toContain('已装回 1.0.0')
    expect(readManifest(facts.profileDir).dependencies['dsh-memoir']).toBe('1.0.0')
  })

  it('operator: is told when the manager could not even put the old version back', async () => {
    // Given the reinstallation the manager ran after the failure failed too
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), () => ({
      from: '1.0.0',
      to: '1.1.0',
      step: 'install',
      result: pnpmRefusal,
      restore: {
        stage: 'install',
        target: 'dsh-memoir@1.0.0',
        changed: false,
        application: 'failed',
        error: { code: 'operation-error', diagnostic: 'pnpm could not fetch it' },
      },
    }))

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the person is told to reinstall by hand instead of assuming a clean rollback
    expect(job.phase).toBe('error')
    expect(job.error).toContain('装回 1.0.0 也失败')
    expect(job.error).toContain('请手动重新安装')
  })

  it('operator: sees an update that landed but needs a restart named, not failed', async () => {
    // Given the manager applied the target while the replaced rows already left
    // the running process (issue #1905)
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), (name, version) => {
      managerReplaces(facts.profileDir, name, version)
      return updateLanded('1.0.0', version, 'restart-required')
    })

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the version landed, the job is done, and the fact that only a restart
    // loads it rides the job instead of an error that would roll it back
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: 'dsh-memoir', version: '1.1.0' })
    expect(job.error).toBeUndefined()
    expect(job.restartRequired).toEqual(['dsh-memoir'])
  })

  /** The verdict a removal the official guard refuses with a still-running row carries. */
  const bundleInUseRefusal = {
    stage: 'remove',
    target: 'dsh-memoir',
    changed: false,
    application: 'failed',
    error: { code: 'bundle-in-use' },
  }

  it('operator: retries the removal once against the state the guard left, so the update lands', async () => {
    // Given a manager whose first call is refused because the bundle's rows still
    // run, and whose second call sees the state that guard's own reload left
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    let attempts = 0
    const gateway = updateGatewayFor(desktopFacts(facts), (name, version) => {
      attempts += 1
      if (attempts === 1) return { from: '1.0.0', to: version, step: 'remove', result: bundleInUseRefusal }
      managerReplaces(facts.profileDir, name, version)
      return updateLanded('1.0.0', version)
    }, calls)

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then it was answered exactly once more and the target landed
    expect(attempts).toBe(2)
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: 'dsh-memoir', version: '1.1.0' })
  })

  it('operator: is told to restart, and keeps the plugin selected, when the rows really are still loaded', async () => {
    // Given a manager that refuses the removal both times and deselected the
    // bundle on the way (the official guard deselects before it judges)
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = updateGatewayFor(desktopFacts(facts), (_name, version) => {
      const manifest = readManifest(facts.profileDir)
      writePackageJson(
        facts.profileDir,
        manifest.dependencies,
        manifest.dsh.profile.bundles.filter(bundle => bundle !== 'dsh-memoir'),
      )
      return { from: '1.0.0', to: version, step: 'remove', result: bundleInUseRefusal }
    }, calls)

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the person is told to restart, the plugin is still installed, and the
    // selection the guard dropped was put back
    expect(job.phase).toBe('error')
    expect(job.error).toContain('移除已安装版本时被拒')
    expect(job.error).toContain('重启 DSH 后再执行本次更新即可')
    expect(calls.filter(call => call[0] === 'update')).toHaveLength(2)
    expect(calls).toContainEqual(['select', 'dsh-memoir', 'true'])
    expect(readManifest(facts.profileDir).dependencies['dsh-memoir']).toBe('1.0.0')
  })

  it('operator: learns a removal refusal that is not a running row without a pointless second call', async () => {
    // Given a management-owned bundle the guard refuses outright
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = updateGatewayFor(desktopFacts(facts), (_name, version) => ({
      from: '1.0.0',
      to: version,
      step: 'remove',
      result: {
        stage: 'remove',
        target: 'dsh-memoir',
        changed: false,
        application: 'failed',
        error: { code: 'management-required' },
      },
    }), calls)

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the refusal is final after one call, and it is named as a refusal
    expect(job.phase).toBe('error')
    expect(job.error).toContain('management-required')
    expect(calls.filter(call => call[0] === 'update')).toHaveLength(1)
  })

  it('operator: keeps the bundle where it sat in the layer order after an update', async () => {
    // Given a profile whose bundle order puts the updated plugin in the middle
    const { facts, dir } = makeProfile(
      { 'dsh-first': { version: '1.0.0' }, 'dsh-memoir': { version: '1.0.0' }, 'dsh-last': { version: '1.0.0' } },
      { bundles: ['dsh-first', 'dsh-memoir', 'dsh-last'] },
    )
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), (name, version) => {
      managerReplaces(facts.profileDir, name, version)
      return updateLanded('1.0.0', version)
    })

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the bundle is back where it was: that array is the layer order the
    // loader applies patches in, so moving it would change which rows override
    // which
    expect(job.phase).toBe('done')
    expect(readManifest(facts.profileDir).dsh.profile.bundles).toEqual(['dsh-first', 'dsh-memoir', 'dsh-last'])
  })

  it('operator: sees a cancelled manager run as a cancellation, not a no-op', async () => {
    // Given the manager reports the run was cancelled
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), (_name, version) => ({
      from: '1.0.0',
      to: version,
      step: 'install',
      result: { stage: 'install', changed: false, application: 'cancelled' },
    }))

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the cancellation is what the person reads
    expect(job.phase).toBe('error')
    expect(job.error).toContain('本次操作已取消')
  })

  it('operator: sees the packages an incompatible-version refusal names', async () => {
    // Given the manager refuses the target's declared DSH minimum
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const gateway = updateGatewayFor(desktopFacts(facts), (_name, version) => ({
      from: '1.0.0',
      to: version,
      step: 'check',
      result: {
        stage: 'install',
        changed: false,
        application: 'failed',
        error: {
          code: 'incompatible-version',
          incompatible: [{ name: 'dsh-memoir', version: '2.0.0', runtimeVersion: '0.2.1' }],
        },
      },
    }))

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '2.0.0').jobId)

    // Then the row-level refusal names the package, its version and the runtime
    expect(job.phase).toBe('error')
    expect(job.error).toContain('检查新版本时被拒')
    expect(job.error).toContain('dsh-memoir@2.0.0 与 dsh 0.2.1 不兼容')
  })
  it('operator: keeps the CLI as the writer on a non-desktop profile', async () => {
    // Given an ordinary CLI-booted profile with an official manager mounted
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const nativeCalls: string[][] = []
    const cliCalls: string[][] = []
    const gateway = new CliGateway(facts, {} as NodeJS.ProcessEnv, {
      spawnImpl: fakeSpawn((args) => {
        if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
        return { code: 0 }
      }, cliCalls) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({
        installBundle: async (spec: string) => { nativeCalls.push([spec]) },
        removeBundle: async (name: string) => { nativeCalls.push([name]) },
      }),
    })

    // When the update runs
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the CLI stayed the single writer and the manager was untouched
    expect(job.phase).toBe('done')
    expect(nativeCalls).toEqual([])
    expect(cliCalls[0]).toEqual(['plugin', '--profile', 'web', 'add', 'dsh-memoir@1.1.0'])
  })

  it('operator: installs through the official in-process manager instead of the refused CLI', async () => {
    // Given an application-owned desktop profile without the package
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = nativeGatewayFor(desktopFacts(facts), () => {
      installPackage(facts.profileDir, 'dsh-free-search', { version: '1.0.0' })
    }, calls)

    // When the install runs
    const { jobId } = gateway.install('dsh-free-search')
    const job = await settle(gateway, jobId)

    // Then the official manager performed it, the CLI was never spawned, and
    // the resulting row is verified from the profile the host reads
    expect(calls).toEqual([['install', 'dsh-free-search']])
    expect(job.phase).toBe('done')
    expect(job.plugin).toMatchObject({ id: 'dsh-free-search', version: '1.0.0' })
  })

  it('operator: sees a green manager install rejected when the profile gained no dependency', async () => {
    // Given the manager resolves without installing anything
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = nativeGatewayFor(desktopFacts(facts), () => {}, calls)

    // When the install runs
    const { jobId } = gateway.install('dsh-free-search')
    const job = await settle(gateway, jobId)

    // Then a no-op is still a failure, exactly like the CLI path
    expect(job.phase).toBe('error')
    expect(job.error).toContain('安装未生效')
  })

  it('operator: sees a failed manager install reported as an error job', async () => {
    // Given the official manager refuses the spec
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const gateway = new CliGateway(desktopFacts(facts), {} as NodeJS.ProcessEnv, {
      spawnImpl: (() => { throw new Error('the CLI must not run') }) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({
        installBundle: async () => { throw new Error('registry unreachable') },
        removeBundle: async () => {},
      }),
    })

    // When the install runs
    const { jobId } = gateway.install('dsh-free-search')
    const job = await settle(gateway, jobId)

    // Then the failure is reported with the manager's own message
    expect(job.phase).toBe('error')
    expect(job.error).toContain('官方插件管理器安装失败')
    expect(job.error).toContain('registry unreachable')
  })

  it('operator: removes through the official in-process manager instead of the refused CLI', async () => {
    // Given an application-owned desktop profile carrying the package
    const { facts, dir } = makeProfile({ 'dsh-free-search': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = nativeGatewayFor(desktopFacts(facts), () => {}, calls, () => {
      removePackage(facts.profileDir, 'dsh-free-search')
    })

    // When the removal runs
    const { jobId } = gateway.remove('dsh-free-search')
    const job = await settle(gateway, jobId)

    // Then the official manager performed it and the CLI was never spawned
    expect(calls).toEqual([['remove', 'dsh-free-search']])
    expect(job.phase).toBe('done')
    expect(readManifest(facts.profileDir).dependencies['dsh-free-search']).toBeUndefined()
  })

  it('operator: sees a green manager removal rejected when the dependency is still there', async () => {
    // Given the manager resolves without removing anything
    const { facts, dir } = makeProfile({ 'dsh-free-search': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = nativeGatewayFor(desktopFacts(facts), () => {}, calls)

    // When the removal runs
    const { jobId } = gateway.remove('dsh-free-search')
    const job = await settle(gateway, jobId)

    // Then a no-op is still a failure, exactly like the CLI path
    expect(job.phase).toBe('error')
    expect(job.error).toContain('卸载未生效')
  })

  it('operator: keeps the CLI as the install and removal writer on a non-desktop profile', async () => {
    // Given an ordinary CLI-booted profile with an official manager mounted
    const { facts, dir } = makeProfile({ 'dsh-free-search': { version: '1.0.0' } })
    tempDirs.push(dir)
    const nativeCalls: string[][] = []
    const cliCalls: string[][] = []
    const gateway = new CliGateway(facts, {} as NodeJS.ProcessEnv, {
      spawnImpl: fakeSpawn((args) => {
        if (args[0] === 'plugin' && args[3] === 'remove') removePackage(facts.profileDir, args[4] ?? '')
        return { code: 0 }
      }, cliCalls) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({
        installBundle: async (spec: string) => { nativeCalls.push([spec]) },
        removeBundle: async (name: string) => { nativeCalls.push([name]) },
      }),
    })

    // When the removal runs
    const { jobId } = gateway.remove('dsh-free-search')
    const job = await settle(gateway, jobId)

    // Then the CLI stayed the single writer and the manager was untouched
    expect(job.phase).toBe('done')
    expect(nativeCalls).toEqual([])
    expect(cliCalls[0]).toEqual(['plugin', '--profile', 'web', 'remove', 'dsh-free-search'])
  })
})
describe('CliGateway finished-job retention', () => {
  /** Fill the finished-job ring with `count` settled jobs of one repeated spec. */
  async function fillRing(gateway: CliGateway, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const { jobId } = gateway.install('dsh-retention')
      await settle(gateway, jobId)
    }
  }

  it('keeps only the newest 100 finished jobs and evicts the oldest settled one', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, args[4] ?? '', {})
      return { code: 0 }
    }, [])
    await fillRing(gateway, 101)
    // The first settled job is evicted as the 101st finishes; the ring keeps
    // job-2..job-101 and reads the evicted id as not-found.
    expect(gateway.status('job-1')).toBeUndefined()
    expect(gateway.status('job-2')).toMatchObject({ id: 'job-2', phase: 'error' })
    expect(gateway.status('job-101')).toMatchObject({ id: 'job-101', phase: 'error' })
  })

  it('never evicts in-progress jobs and keeps the ring on the newest finished ones', async () => {
    const { facts, dir } = makeProfile({})
    tempDirs.push(dir)
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, args[4] ?? '', {})
      return { code: 0 }
    }, [])
    await fillRing(gateway, 101)
    // Hold the mutation queue so two jobs are in flight while the ring is
    // already full: they must stay queryable while running.
    let release!: () => void
    const blocker = new Promise<void>(resolve => { release = resolve })
    const direct = gateway.withMutationLock(() => blocker)
    const hold = gateway.install('dsh-hold')
    const queued = gateway.install('dsh-queued')
    expect(gateway.status(hold.jobId)).toMatchObject({ id: hold.jobId, phase: 'running' })
    expect(gateway.status(queued.jobId)).toMatchObject({ id: queued.jobId, phase: 'running' })
    release()
    await direct
    const holdJob = await settle(gateway, hold.jobId)
    const queuedJob = await settle(gateway, queued.jobId)
    expect(holdJob.phase).toBe('done')
    expect(queuedJob.phase).toBe('done')
    // The two new finished jobs evict the two oldest finished ones; the jobs
    // that were in flight settle and stay queryable themselves.
    expect(gateway.status('job-1')).toBeUndefined()
    expect(gateway.status('job-2')).toBeUndefined()
    expect(gateway.status('job-3')).toBeUndefined()
    expect(gateway.status('job-4')).toBeDefined()
    expect(gateway.status(hold.jobId)).toMatchObject({ phase: 'done' })
    expect(gateway.status(queued.jobId)).toMatchObject({ phase: 'done' })
  })
})

/**
 * A 0.4.6 user layer: an override the plugin manager owns for a row the
 * aggregate has retired, an override for a row that still exists, and a
 * config row this manager never writes (its id survives only in the file).
 */
const USER_LAYER = [
  '# user overrides written by the plugin manager',
  '- id: web-ui-model-capabilities',
  '  name: "@linxin666/dsh-model-capabilities"',
  '  disabled: true',
  '- id: web-ui-pet',
  '  name: "@linxin666/dsh-web-all/pet"',
  '  disabled: false',
  '- id: web-ui-skin-center',
  '  name: "@linxin666/dsh-web-all/skin-center"',
  '  config:',
  '    theme: blue-fantasy',
  '',
].join('\n')

/** The same layer after the retired row's override is pruned. */
const PRUNED_LAYER = [
  '# user overrides written by the plugin manager',
  '- id: web-ui-pet',
  '  name: "@linxin666/dsh-web-all/pet"',
  '  disabled: false',
  '- id: web-ui-skin-center',
  '  name: "@linxin666/dsh-web-all/skin-center"',
  '  config:',
  '    theme: blue-fantasy',
  '',
].join('\n')

/**
 * The profile composition an updated 0.4.7 profile resolves to, in the CLI's
 * own `--dump-config` shape: one block per layer, composed entries as
 * column-0 `- id:` items. The retired row is gone; the pet row and the
 * manager's own dependency are still there.
 */
const COMPOSED_DUMP = [
  '# == dsh-memoir',
  '- id: dsh-memoir',
  '  name: dsh-memoir',
  '# == @linxin666/dsh-web-all',
  '- id: web-ui-pet',
  '  name: "@linxin666/dsh-web-all/pet"',
  '  disabled: false',
  '',
].join('\n')

describe('CliGateway orphan row-override pruning', () => {
  /** A gateway whose fake CLI installs the update and composes a dump. */
  function updateGateway(
    facts: ProfileFacts,
    dump: () => { code: number; output?: string },
    calls: string[][] = [],
  ): CliGateway {
    return gatewayFor(facts, (args) => {
      if (args.includes('--dump-config')) return dump()
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
      return { code: 0 }
    }, calls)
  }

  it('operator: drops the retired row override after an update and backs the file up first', async () => {
    // Given a profile carrying an override for a row the target composition
    // no longer declares, plus valid and unowned rows beside it
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    writeFileSync(facts.patchPath, USER_LAYER)
    const gateway = updateGateway(facts, () => ({ code: 0, output: COMPOSED_DUMP }))

    // When the update to the release that retired the row runs
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the update lands, the orphan entry is gone, every other byte of the
    // layer is untouched, and the pre-prune file survives as the backup
    expect(job.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(PRUNED_LAYER)
    expect(readFileSync(`${facts.patchPath}.bak-plugin-manager`, 'utf8')).toBe(USER_LAYER)
  })

  it('operator: sees no write and no second backup when the same update runs again', async () => {
    // Given a profile whose orphan override was already pruned by a first run
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    writeFileSync(facts.patchPath, USER_LAYER)
    const gateway = updateGateway(facts, () => ({ code: 0, output: COMPOSED_DUMP }))
    const first = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)
    expect(first.phase).toBe('done')

    // When the same update runs a second time over the pruned profile
    const second = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then nothing was written: the layer is unchanged and the backup still
    // holds the pre-prune text, so no second backup was taken
    expect(second.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(PRUNED_LAYER)
    expect(readFileSync(`${facts.patchPath}.bak-plugin-manager`, 'utf8')).toBe(USER_LAYER)
  })

  it('operator: keeps every override when the target composition still carries them', async () => {
    // Given a profile whose overrides all point at rows the composition keeps
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const layer = [
      '- id: web-ui-pet',
      '  name: "@linxin666/dsh-web-all/pet"',
      '  disabled: true',
      '',
    ].join('\n')
    writeFileSync(facts.patchPath, layer)
    const gateway = updateGateway(facts, () => ({ code: 0, output: COMPOSED_DUMP }))

    // When the update runs
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the layer is byte-identical and no backup was taken, exactly as
    // before this guard existed
    expect(job.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(layer)
    expect(existsSync(`${facts.patchPath}.bak-plugin-manager`)).toBe(false)
  })

  it('operator: fails the update when the pruned layer cannot be written, leaving the backup', async () => {
    // Given a profile whose layer cannot be rewritten (a directory occupies
    // the temporary path the atomic write needs)
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    writeFileSync(facts.patchPath, USER_LAYER)
    mkdirSync(`${facts.patchPath}.tmp`)
    const gateway = updateGateway(facts, () => ({ code: 0, output: COMPOSED_DUMP }))

    // When the update runs
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the failure is reported like every other post-mutation write in the
    // transaction, the layer is untouched, and the backup is recoverable
    expect(job.phase).toBe('error')
    expect(job.error).toContain('失效行覆盖清理写回失败')
    expect(job.error).toContain('.bak-plugin-manager')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(USER_LAYER)
    expect(readFileSync(`${facts.patchPath}.bak-plugin-manager`, 'utf8')).toBe(USER_LAYER)
  })

  it('operator: leaves an application-owned layer alone when no composition can be read', async () => {
    // Given a desktop-owned profile on a runtime with no usable CLI probe
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    writeFileSync(facts.patchPath, USER_LAYER)
    const gateway = new CliGateway({ ...facts, profileName: 'desktop', desktop: true }, {} as NodeJS.ProcessEnv, {
      spawnImpl: (() => { throw new Error('no CLI on this runtime') }) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({
        installBundle: async () => { throw new Error('an update must not call installBundle') },
        removeBundle: async () => { throw new Error('an update must not call removeBundle') },
        updateBundle: async (name: string, version: string) => {
          installPackage(facts.profileDir, name, { version })
          return { from: '1.0.0', to: version, step: 'install' as const, result: { application: 'applied' } }
        },
      }),
    })

    // When the update runs
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then no entry is guessed at: the update lands and the layer keeps every
    // override, pruned or not, because nothing could tell which ids exist
    expect(job.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(USER_LAYER)
    expect(existsSync(`${facts.patchPath}.bak-plugin-manager`)).toBe(false)
  })

  it('operator: prunes the retired override during a legacy aggregate migration', async () => {
    // Given a legacy aggregate profile carrying an override for a row the
    // current aggregate no longer declares
    const legacy = '@linxin666/dsh-web-ui-all'
    const current = '@linxin666/dsh-web-all'
    const { facts, dir } = makeProfile({ [legacy]: { version: '0.3.2', bundle: true } }, { bundles: [legacy] })
    tempDirs.push(dir)
    writeFileSync(facts.patchPath, USER_LAYER)
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0, output: COMPOSED_DUMP }
      if (args[3] === 'add' && args[4] === `${current}@0.3.3`) installPackage(facts.profileDir, current, { version: '0.3.3', bundle: true })
      if (args[3] === 'remove' && args[4] === legacy) removePackage(facts.profileDir, legacy)
      return { code: 0 }
    }, [])

    // When the migration runs
    const { jobId } = gateway.migrate(legacy, current, '0.3.3', `${current}@0.3.3`)
    const job = await settle(gateway, jobId)

    // Then the row the retired aggregate declared is pruned there as well
    expect(job.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(PRUNED_LAYER)
  })

  it('operator: also prunes an application-owned profile after its manager update', async () => {
    // Given a desktop-owned profile updated through the official manager, with
    // the CLI available for the read-only composition only
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    writeFileSync(facts.patchPath, USER_LAYER)
    const gateway = new CliGateway({ ...facts, profileName: 'desktop', desktop: true }, {} as NodeJS.ProcessEnv, {
      spawnImpl: fakeSpawn((args) => {
        if (args.includes('--dump-config')) return { code: 0, output: COMPOSED_DUMP }
        throw new Error('the CLI must never write an application-owned profile')
      }, []) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({
        installBundle: async () => { throw new Error('an update must not call installBundle') },
        removeBundle: async () => { throw new Error('an update must not call removeBundle') },
        updateBundle: async (name: string, version: string) => {
          installPackage(facts.profileDir, name, { version })
          return { from: '1.0.0', to: version, step: 'install' as const, result: { application: 'applied' } }
        },
      }),
    })

    // When the update runs
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the orphan is pruned there too, and no CLI write was attempted
    expect(job.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(PRUNED_LAYER)
  })
})

/**
 * The bundle layer of the aggregate family as the desktop profile carries it:
 * a row that mounts the remote-web-ui plugin with nothing but `plugin`, so
 * `autoTunnel` falls back to its `false` default, and a row the user turns on
 * through a bare override.
 */
const AGGREGATE_LAYER = [
  '- insert:',
  '    - id: web-ui-remote-web-ui',
  "      name: '@linxin666/dsh-web-all/remote-web-ui'",
  '      config:',
  "        plugin: '@linxin666/dsh-remote-web-ui'",
  '    - id: ui-schedule',
  "      name: '@deepseek-ai/dsh-client-ui-schedule'",
  '',
].join('\n')

/** The desktop user layer: the quick-tunnel switches beside a bare override. */
const DESKTOP_USER_LAYER = [
  '# --- remote-web-ui: quick tunnel + relay for the paired phone ---',
  '- id: web-ui-remote-web-ui',
  "  name: '@linxin666/dsh-web-all/remote-web-ui'",
  '  config:',
  "    plugin: '@linxin666/dsh-remote-web-ui'",
  '    autoTunnel: true',
  '    relay: true',
  '- id: ui-schedule',
  '  disabled: false',
  '',
].join('\n')

/**
 * The composition a host reports while the aggregate is being replaced: the
 * bundle's own rows are missing because its package is momentarily gone, which
 * is exactly the state the prune used to read as "these rows were retired".
 */
const STALE_DUMP = [
  '# == dsh-memoir',
  '- id: dsh-memoir',
  '  name: dsh-memoir',
  '',
].join('\n')

describe('CliGateway orphan pruning keeps overrides of rows that still exist', () => {
  /** A gateway whose fake CLI installs `target` and reports `dump` as the composition. */
  function updateGateway(
    facts: ProfileFacts,
    target: { name: string; version: string; patch?: string },
    dump: () => { code: number; output?: string },
  ): CliGateway {
    return gatewayFor(facts, (args) => {
      if (args.includes('--dump-config')) return dump()
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, target.name, { version: target.version, bundle: true, patch: target.patch })
      return { code: 0 }
    }, [])
  }

  it('operator: keeps the desktop quick-tunnel override when the composition lost the bundle rows', async () => {
    // Given a desktop-style profile whose aggregate bundle declares the
    // remote-web-ui and schedule rows, a user layer overriding both, and a
    // composition probe taken while that bundle was being replaced
    const { facts, dir } = makeProfile({ '@linxin666/dsh-web-all': { version: '0.4.6', bundle: true, patch: AGGREGATE_LAYER } })
    tempDirs.push(dir)
    writeFileSync(facts.patchPath, DESKTOP_USER_LAYER)
    const gateway = updateGateway(facts, { name: '@linxin666/dsh-web-all', version: '0.4.7', patch: AGGREGATE_LAYER }, () => ({ code: 0, output: STALE_DUMP }))

    // When the aggregate update runs
    const { jobId } = gateway.update('@linxin666/dsh-web-all', '0.4.7')
    const job = await settle(gateway, jobId)

    // Then the merged result is still the user's layer: both rows the bundle
    // layer declares survive byte for byte, so autoTunnel stays true, and
    // nothing was pruned so no backup was taken
    expect(job.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(DESKTOP_USER_LAYER)
    expect(existsSync(`${facts.patchPath}.bak-plugin-manager`)).toBe(false)
  })

  it('operator: prunes nothing while a declared bundle layer cannot be read', async () => {
    // Given a profile whose manifest still lists a bundle whose package is not
    // installed right now, beside an override the composition really lost
    const { facts, dir } = makeProfile({
      'dsh-memoir': { version: '1.0.0' },
      'dsh-mid-upgrade': { version: '1.0.0', bundle: true, patch: AGGREGATE_LAYER },
    })
    tempDirs.push(dir)
    rmSync(join(facts.profileDir, 'node_modules', 'dsh-mid-upgrade'), { recursive: true, force: true })
    writeFileSync(facts.patchPath, USER_LAYER)
    const gateway = updateGateway(facts, { name: 'dsh-memoir', version: '1.1.0' }, () => ({ code: 0, output: STALE_DUMP }))

    // When an update runs
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the layer is left exactly as it was: the missing package is one this
    // profile depends on, so its directory is unfinished work rather than an
    // installation-provided bundle, and an unreadable layer proves nothing about
    // which ids still exist — the guard writes nothing
    expect(job.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(USER_LAYER)
    expect(existsSync(`${facts.patchPath}.bak-plugin-manager`)).toBe(false)
  })
})

/**
 * The layer of the profile's one installed bundle: the row id the user layer
 * overrides, carried under the package that really mounts it.
 */
const INSTALLED_BUNDLE_LAYER = [
  '- insert:',
  '    - id: web-ui-pet',
  "      name: '@linxin666/dsh-client-ui-pet'",
  '',
].join('\n')

/**
 * A user layer naming that row by the package it used to be mounted from,
 * beside an override the target composition no longer carries at all.
 */
const STALE_NAME_LAYER = [
  '# user overrides written by the plugin manager',
  '- id: web-ui-pet',
  '  name: "@linxin666/dsh-web-all/pet"',
  '  disabled: false',
  '- id: web-ui-model-capabilities',
  '  name: "@linxin666/dsh-model-capabilities"',
  '  disabled: true',
  '',
].join('\n')

/** The same layer with the row pointed at the live package; the orphan stays. */
const REPAIRED_NAME_LAYER = [
  '# user overrides written by the plugin manager',
  '- id: web-ui-pet',
  '  name: "@linxin666/dsh-client-ui-pet"',
  '  disabled: false',
  '- id: web-ui-model-capabilities',
  '  name: "@linxin666/dsh-model-capabilities"',
  '  disabled: true',
  '',
].join('\n')

/**
 * A marker seeded into the backup between two runs: a write replaces the
 * backup with the current layer, so a surviving marker proves the run wrote
 * nothing at all.
 */
const BACKUP_SENTINEL = '# sentinel: no write may replace this file\n'

describe('CliGateway row-name repair on the update path', () => {
  it('operator: repairs a stale row name while a declared bundle is not installed, and prunes nothing', async () => {
    // Given a CLI-created profile whose bundle list names an official bundle
    // that is not installed under node_modules (the shape `dsh plugin` writes,
    // where `@deepseek-ai/dsh-base` resolves from the host installation), one
    // installed bundle declaring the row id, and a user layer naming that row
    // by the package it used to be mounted from, beside an orphan override
    const { facts, dir } = makeProfile(
      { 'dsh-memoir': { version: '1.0.0', bundle: true, patch: INSTALLED_BUNDLE_LAYER } },
      { bundles: ['dsh-memoir', '@deepseek-ai/dsh-base'] },
    )
    tempDirs.push(dir)
    writeFileSync(facts.patchPath, STALE_NAME_LAYER)
    const gateway = gatewayFor(facts, (args) => {
      if (args.includes('--dump-config')) return { code: 0, output: STALE_DUMP }
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
      return { code: 0 }
    }, [])

    // When the update runs
    const { jobId } = gateway.update('dsh-memoir', '1.1.0')
    const job = await settle(gateway, jobId)

    // Then the row names the live package and every other byte of the layer is
    // untouched, the pre-repair text survives as the single backup, and the
    // orphan override is still there: no readable copy of that bundle exists
    // here — the fake CLI points at no installation carrying it — so the live
    // ids stay unknown and nothing may be deleted
    expect(job.phase).toBe('done')
    const repaired = readFileSync(facts.patchPath, 'utf8')
    expect(repaired).toBe(REPAIRED_NAME_LAYER)
    expect(repaired).toContain('- id: web-ui-model-capabilities')
    expect(readFileSync(`${facts.patchPath}.bak-plugin-manager`, 'utf8')).toBe(STALE_NAME_LAYER)
    expect(existsSync(`${facts.patchPath}.tmp`)).toBe(false)

    // When the same update runs again over the repaired profile
    writeFileSync(`${facts.patchPath}.bak-plugin-manager`, BACKUP_SENTINEL)
    const second = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the run is a no-op: no duplicated row, no rewrite, and no new
    // backup, because the sentinel a write would have replaced is still there
    expect(second.phase).toBe('done')
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(REPAIRED_NAME_LAYER)
    expect(readFileSync(`${facts.patchPath}.bak-plugin-manager`, 'utf8')).toBe(BACKUP_SENTINEL)
  })
})

/**
 * The bundle layer of `@deepseek-ai/dsh-base` as a real installation carries
 * it: the host's own plugin-manager row, which no profile ever declares.
 */
const INSTALLATION_BASE_LAYER = [
  '- insert:',
  '    - id: plugin-manager',
  "      name: '@deepseek-ai/dsh-plugin-manager'",
  '',
].join('\n')

/** The bundle layer of `@deepseek-ai/dsh-web-app`: the schedule panel's row. */
const INSTALLATION_APP_LAYER = [
  '- insert:',
  '    - id: ui-schedule',
  "      name: '@deepseek-ai/dsh-client-ui-schedule'",
  '',
].join('\n')

/**
 * A layer left behind by the update that retired the aggregate's
 * `web-ui-update` row: its override still points at an id the current
 * composition and every current bundle layer dropped, beside overrides of rows
 * that still exist — one the composition lists, one only the installation's own
 * base layer declares, one the profile's installed bundle lists — and a config
 * row this manager never writes.
 */
const CLI_PROFILE_LAYER = [
  '# user overrides written by the plugin manager',
  '- id: web-ui-update',
  '  name: "@linxin666/dsh-plugin-manager-update"',
  '  disabled: true',
  '- id: ui-schedule',
  '  name: "@deepseek-ai/dsh-client-ui-schedule"',
  '  disabled: true',
  '- id: plugin-manager',
  '  name: "@deepseek-ai/dsh-plugin-manager"',
  '  disabled: true',
  '- id: dsh-memoir',
  '  name: dsh-memoir',
  '  disabled: true',
  '- id: web-ui-skin-center',
  '  name: "@linxin666/dsh-web-all/skin-center"',
  '  config:',
  '    theme: blue-fantasy',
  '',
].join('\n')

/**
 * The composition a CLI-created profile reports: the installation's web-app
 * layer and the profile's installed bundle, with the base layer's row missing —
 * the partial probe the bundle declarations exist to widen.
 */
const CLI_PROFILE_DUMP = [
  '# == @deepseek-ai/dsh-web-app',
  '- id: ui-schedule',
  '  name: "@deepseek-ai/dsh-client-ui-schedule"',
  '# == dsh-memoir',
  '- id: dsh-memoir',
  '  name: dsh-memoir',
  '',
].join('\n')

/**
 * The layer a profile-installed copy of `@deepseek-ai/dsh-web-app` declares:
 * the quick-tunnel row beside the schedule row the installation also carries.
 */
const PROFILE_COPY_LAYER = [
  '- insert:',
  '    - id: web-ui-remote-web-ui',
  "      name: '@linxin666/dsh-web-all/remote-web-ui'",
  '    - id: ui-schedule',
  "      name: '@deepseek-ai/dsh-client-ui-schedule'",
  '',
].join('\n')

/**
 * Overrides of both rows the profile's own copy declares, taken while that
 * copy is being replaced: the composition reports neither, which is the window
 * 0.4.7 read as a retirement.
 */
const REPLACEMENT_WINDOW_LAYER = [
  '- id: web-ui-remote-web-ui',
  "  name: '@linxin666/dsh-web-all/remote-web-ui'",
  '  disabled: true',
  '- id: ui-schedule',
  '  name: "@deepseek-ai/dsh-client-ui-schedule"',
  '  disabled: true',
  '',
].join('\n')

/**
 * A stand-in for the DSH installation a CLI-created profile mounts its official
 * bundles from: the CLI entry at `<root>/lib/bin.js` and one package per
 * bundle beside it, the npm-global layout {@link findDshBinary} resolves.
 * @param root - the installation root to create.
 * @param bundles - bundle package name -> the patch text it declares rows in.
 * @returns the CLI entry path.
 */
function fakeInstallation(root: string, bundles: Record<string, string>): string {
  const cli = join(root, 'lib', 'bin.js')
  mkdirSync(dirname(cli), { recursive: true })
  writeFileSync(cli, '// fake dsh CLI entry\n')
  for (const [name, patch] of Object.entries(bundles)) {
    const moduleDir = join(root, 'node_modules', ...name.split('/'))
    mkdirSync(moduleDir, { recursive: true })
    writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({
      name,
      version: '0.2.1-rc.5',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(moduleDir, 'cordis.patch.yml'), patch)
  }
  return cli
}

/** A gateway whose fake CLI is the given path, so the installation it walks is the test's own. */
function gatewayAt(facts: ProfileFacts, binary: string, behavior: SpawnBehavior): CliGateway {
  return new CliGateway(facts, {} as NodeJS.ProcessEnv, {
    spawnImpl: fakeSpawn(behavior, []) as never,
    findBinary: () => binary,
  })
}

describe('CliGateway orphan pruning on profiles whose bundles are not all installed', () => {
  it('operator: prunes a retired row override on a CLI-created profile and backs the layer up', async () => {
    // Given a CLI-created profile — the installation's own bundles listed in
    // dsh.profile.bundles while the plugin the update targets is the only one
    // really installed — whose layer still carries the override the retired
    // web-ui-update row left behind, beside overrides of rows that still exist
    const { facts, dir } = makeProfile(
      { 'dsh-memoir': { version: '1.0.0' } },
      { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-memoir'] },
    )
    tempDirs.push(dir)
    const cli = fakeInstallation(join(dir, 'dsh'), {
      '@deepseek-ai/dsh-base': INSTALLATION_BASE_LAYER,
      '@deepseek-ai/dsh-web-app': INSTALLATION_APP_LAYER,
    })
    writeFileSync(facts.patchPath, CLI_PROFILE_LAYER)
    const gateway = gatewayAt(facts, cli, (args) => {
      if (args.includes('--dump-config')) return { code: 0, output: CLI_PROFILE_DUMP }
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
      return { code: 0 }
    })

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then the retired row's override is gone, the layer was written, and the
    // pre-prune text survives as the single backup
    expect(job.phase).toBe('done')
    const pruned = readFileSync(facts.patchPath, 'utf8')
    expect(pruned).not.toContain('web-ui-update')
    expect(readFileSync(`${facts.patchPath}.bak-plugin-manager`, 'utf8')).toBe(CLI_PROFILE_LAYER)
    expect(existsSync(`${facts.patchPath}.tmp`)).toBe(false)

    // ... and no override of a row that still exists was lost: the installed
    // bundle's composed row, the installation's web-app row the probe lists,
    // the installation's base row the probe does not, and the unowned config row
    expect(pruned).toContain('- id: dsh-memoir')
    expect(pruned).toContain('- id: ui-schedule')
    expect(pruned).toContain('- id: plugin-manager')
    expect(pruned).toContain('- id: web-ui-skin-center')
    expect(pruned).toContain('theme: blue-fantasy')
  })

  it('operator: keeps every override while a profile-installed bundle is momentarily unreadable', async () => {
    // Given a profile that installs @deepseek-ai/dsh-web-app itself, whose
    // package directory is gone right now (the replace window), a layer
    // overriding both rows that copy declares, and a composition probe taken
    // while those rows were missing — while the installation, for its part,
    // does carry a package of that same name
    const { facts, dir } = makeProfile(
      {
        'dsh-memoir': { version: '1.0.0' },
        '@deepseek-ai/dsh-web-app': { version: '0.2.1-rc.4', bundle: true, patch: PROFILE_COPY_LAYER },
      },
      { bundles: ['@deepseek-ai/dsh-web-app', 'dsh-memoir'] },
    )
    tempDirs.push(dir)
    rmSync(join(facts.profileDir, 'node_modules', '@deepseek-ai', 'dsh-web-app'), { recursive: true, force: true })
    const cli = fakeInstallation(join(dir, 'dsh'), { '@deepseek-ai/dsh-web-app': INSTALLATION_APP_LAYER })
    writeFileSync(facts.patchPath, REPLACEMENT_WINDOW_LAYER)
    const gateway = gatewayAt(facts, cli, (args) => {
      if (args.includes('--dump-config')) return { code: 0, output: STALE_DUMP }
      if (args[0] === 'plugin' && args[3] === 'add') installPackage(facts.profileDir, 'dsh-memoir', { version: '1.1.0' })
      return { code: 0 }
    })

    // When the update runs
    const job = await settle(gateway, gateway.update('dsh-memoir', '1.1.0').jobId)

    // Then nothing is pruned: the missing directory belongs to a package this
    // profile installs itself, so its rows are unknown rather than retired —
    // the installation's same-named package is not the copy this profile
    // mounts, and reading it would have dropped web-ui-remote-web-ui
    expect(job.phase).toBe('done')
    expect(existsSync(join(dir, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'package.json'))).toBe(true)
    expect(readFileSync(facts.patchPath, 'utf8')).toBe(REPLACEMENT_WINDOW_LAYER)
    expect(existsSync(`${facts.patchPath}.bak-plugin-manager`)).toBe(false)
  })
})

describe('CliGateway batch updates', () => {
  it('operator: applies every row in order and reports each one beside the failure', async () => {
    // Given two outdated plugins, one of which pnpm refuses
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' }, 'dsh-weather': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] === 'plugin' && args[3] === 'add') {
        const spec = args[4] ?? ''
        if (spec === 'dsh-weather@1.1.0') return { code: 1, output: 'ERR_PNPM_NO_MATCHING_VERSION' }
        installPackage(facts.profileDir, spec.slice(0, spec.lastIndexOf('@')), { version: '1.1.0' })
      }
      return { code: 0 }
    }, calls)

    // When both rows are applied in one run
    const { jobId } = gateway.updateAll([
      { kind: 'apply', id: 'dsh-memoir', version: '1.1.0' },
      { kind: 'apply', id: 'dsh-weather', version: '1.1.0' },
    ])
    const job = await settle(gateway, jobId)

    // Then the run is one job, the first row landed, the second row carries
    // pnpm's own reason, and the batch is done rather than failed
    expect(job.phase).toBe('done')
    expect(job.current).toBeUndefined()
    expect(job.results?.map(row => row.phase)).toEqual(['done', 'error'])
    expect(job.results?.[0]).toMatchObject({ id: 'dsh-memoir', landed: '1.1.0' })
    expect(job.results?.[1]?.error).toContain('ERR_PNPM_NO_MATCHING_VERSION')
    // The refused row did not stop the run: both were asked for, in order
    expect(calls.filter(call => call[3] === 'add')).toEqual([
      ['plugin', '--profile', 'web', 'add', 'dsh-memoir@1.1.0'],
      ['plugin', '--profile', 'web', 'add', 'dsh-weather@1.1.0'],
    ])
  })

  it('operator: sees a row the route already refused carried into the run as that row', async () => {
    // Given one row the route refused before the job existed
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, () => ({ code: 0 }), calls)

    // When the batch runs
    const { jobId } = gateway.updateAll([
      { kind: 'refused', id: 'dsh-blocked', error: 'plugin-manager: dsh-blocked is already at 1.0.0' },
    ])
    const job = await settle(gateway, jobId)

    // Then the row states the refusal and nothing was written
    expect(job.phase).toBe('done')
    expect(job.results).toEqual([
      { id: 'dsh-blocked', phase: 'error', error: 'plugin-manager: dsh-blocked is already at 1.0.0' },
    ])
    expect(calls).toHaveLength(0)
  })

  it('operator: applies a legacy migration as one row of the batch', async () => {
    // Given a profile still carrying the legacy aggregate
    const legacy = LEGACY_AGGREGATE
    const { facts, dir } = makeProfile({ [legacy]: { version: '0.3.2', bundle: true } }, { bundles: [legacy] })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = gatewayFor(facts, (args) => {
      if (args[0] !== 'plugin') return { code: 0 }
      if (args[3] === 'remove' && args[4] === legacy) removePackage(facts.profileDir, legacy)
      if (args[3] === 'add' && args[4] === `${CURRENT_AGGREGATE}@0.3.3`) {
        installPackage(facts.profileDir, CURRENT_AGGREGATE, { version: '0.3.3', bundle: true })
      }
      return { code: 0 }
    }, calls)

    // When the batch runs the migration row
    const { jobId } = gateway.updateAll([{
      kind: 'migrate',
      id: legacy,
      targetId: CURRENT_AGGREGATE,
      targetVersion: '0.3.3',
      targetSpec: `${CURRENT_AGGREGATE}@0.3.3`,
    }])
    const job = await settle(gateway, jobId)

    // Then the row landed on the current aggregate and the profile carries it
    expect(job.phase).toBe('done')
    expect(job.results?.[0]).toMatchObject({ id: legacy, phase: 'done', landed: '0.3.3' })
    expect(readManifest(facts.profileDir).dependencies).toHaveProperty([CURRENT_AGGREGATE])
  })

  it('operator: gets a batch row applied through the official manager on an application-owned profile', async () => {
    // Given a desktop profile and two outdated bundles
    const { facts, dir } = makeProfile({ 'dsh-memoir': { version: '1.0.0' }, 'dsh-weather': { version: '1.0.0' } })
    tempDirs.push(dir)
    const calls: string[][] = []
    const gateway = new CliGateway({ ...facts, profileName: 'desktop', desktop: true }, {} as NodeJS.ProcessEnv, {
      spawnImpl: (() => { throw new Error('the CLI must not run for an application-owned profile') }) as never,
      findBinary: () => '/fake/dsh',
      nativeManager: () => ({
        installBundle: async () => { throw new Error('an update must not call installBundle') },
        removeBundle: async () => { throw new Error('an update must not call removeBundle') },
        updateBundle: async (name: string, version: string) => {
          calls.push(['update', name, version])
          installPackage(facts.profileDir, name, { version })
          return { from: '1.0.0', to: version, step: 'install' as const, result: { application: 'applied' } }
        },
      }),
    })

    // When the batch runs
    const { jobId } = gateway.updateAll([
      { kind: 'apply', id: 'dsh-memoir', version: '1.1.0' },
      { kind: 'apply', id: 'dsh-weather', version: '1.1.0' },
    ])
    const job = await settle(gateway, jobId)

    // Then each row was one official update, in order, and both landed
    expect(calls).toEqual([['update', 'dsh-memoir', '1.1.0'], ['update', 'dsh-weather', '1.1.0']])
    expect(job.results?.map(row => row.phase)).toEqual(['done', 'done'])
    expect(job.results?.[1]).toMatchObject({ id: 'dsh-weather', landed: '1.1.0' })
  })
})
