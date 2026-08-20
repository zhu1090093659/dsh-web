/**
 * CliGateway mutation-path acceptance tests (B5-B8 + spec fencing): temp
 * profiles plus a scripted fake CLI. The fake stands in for the official
 * dsh plugin CLI — it mutates the temp profile exactly as the real CLI
 * would (dependencies + node_modules manifests) and reports exit codes.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CliGateway, unsafeSpecReason, type GatewayJob } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'

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

/** Simulate the official CLI's add: dependency line + package files. */
function installPackage(profileDir: string, name: string, dep: { patch?: string; version?: string; bundle?: boolean }): void {
  const moduleDir = join(profileDir, 'node_modules', ...name.split('/'))
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({
    name,
    version: dep.version ?? '1.0.0',
    ...(dep.bundle === true ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {}),
  }))
  if (dep.patch !== undefined) writeFileSync(join(moduleDir, 'cordis.patch.yml'), dep.patch)
  const manifest = readManifest(profileDir)
  if (manifest.dependencies[name] === undefined) {
    manifest.dependencies[name] = '1.0.0'
    manifest.dsh.profile.bundles.push(name)
    writePackageJson(profileDir, manifest.dependencies, manifest.dsh.profile.bundles)
  }
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
/** The family aggregate's rows section: dsh-better-sidebar mounts through a row, not the bundles layer. */
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
    // The aggregate mounts dsh-better-sidebar via a patch row while the
    // package also sits in dependencies (not in bundles); any CLI mutation
    // re-adds it to bundles and the next boot double-mounts.
    const { facts, dir } = makeProfile({
      '@linxin666/dsh-web-ui-all': { bundle: true, patch: AGGREGATE_PATCH },
      'dsh-better-sidebar': { bundle: true },
    }, { bundles: ['@linxin666/dsh-web-ui-all'] })
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
    expect(manifest.dsh.profile.bundles).toEqual(['@linxin666/dsh-web-ui-all', 'dsh-memoir'])
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
      '@linxin666/dsh-web-ui-all': { bundle: true, patch: AGGREGATE_PATCH },
      'dsh-better-sidebar': { bundle: true },
      'dsh-memoir': { bundle: true },
    }, { bundles: ['@linxin666/dsh-web-ui-all', 'dsh-memoir'] })
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
    expect(manifest.dsh.profile.bundles).toEqual(['@linxin666/dsh-web-ui-all'])
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
