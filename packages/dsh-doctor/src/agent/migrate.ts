/**
 * Doctor launch-time migration for the legacy aggregate package.
 *
 * The Doctor Launcher runs before the real DSH process so a stale
 * `@linxin666/dsh-web-ui-all` profile can be migrated to
 * `@linxin666/dsh-web-all` without user interaction. Every mutation goes
 * through the official `dsh plugin` CLI and is backed up before it starts.
 * The legacy package stays in place until the current aggregate is installed
 * and verified; a failed migration restores the original manifest when
 * possible and never leaves both aggregates mounted as boot layers.
 */
import { existsSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { parseProfileManifest } from '../core/manifest.ts'
import { writeJsonAtomic } from '../core/store.ts'
import { isLegacyAggregate, targetSpecForLegacy } from './legacy-migration.ts'
import { currentPackageVersion } from './version.ts'

export interface LegacyMigrationResult {
  kind: 'noop' | 'migrated' | 'error'
  message?: string
  targetSpec?: string
  targetVersion?: string
}

export interface LegacyMigrationDeps {
  env?: NodeJS.ProcessEnv
  /** Run one command array without a shell. */
  run?: (args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number | null; output: string }>
  exists?: (path: string) => boolean
  fetch?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>
  targetVersion?: string
  now?: () => string
}

const REGISTRY_TIMEOUT_MS = 10_000
const CLI_TIMEOUT_MS = 6 * 60_000

/** Build the full old package spec from the profile's recorded dependency spec. */
export function fullLegacySpec(name: string, spec: string): string {
  if (/^(?:link:|file:|git:|git\+|github:|https?:\/\/|npm:)/.test(spec)) return spec
  if (spec === '') return name
  return `${name}@${spec}`
}

/** Read the current manifest bundle position for one package. */
function bundleIndexOf(manifestText: string, name: string): number {
  const parsed = parseProfileManifest(manifestText, '<profile>')
  if (parsed.error !== undefined) return -1
  return parsed.facts.bundles.indexOf(name)
}

/** Move the current aggregate into the legacy package's old layer position. */
async function moveBundle(packageJsonPath: string, oldIndex: number, target: string): Promise<void> {
  const text = await readFile(packageJsonPath, 'utf8')
  const parsed = JSON.parse(text) as { dsh?: { profile?: { bundles?: unknown } } }
  const profile = parsed.dsh?.profile
  if (profile === undefined || !Array.isArray(profile.bundles)) return
  const bundles = profile.bundles.filter((entry): entry is string => typeof entry === 'string')
  const current = bundles.indexOf(target)
  if (current >= 0) bundles.splice(current, 1)
  bundles.splice(Math.max(0, Math.min(oldIndex, bundles.length)), 0, target)
  profile.bundles = bundles
  await writeJsonAtomic(packageJsonPath, parsed, 0o600)
}

/** Copy a backup for the manifest and lockfile before migration. */
async function backupProfile(packageJsonPath: string, lockfilePath: string, stamp: string): Promise<void> {
  await copyFile(packageJsonPath, `${packageJsonPath}.bak-doctor-migrate-${stamp}`).catch(() => undefined)
  await copyFile(lockfilePath, `${lockfilePath}.bak-doctor-migrate-${stamp}`).catch(() => undefined)
}

/** Restore the manifest/lockfile backup after a failed migration. */
async function restoreBackup(packageJsonPath: string, lockfilePath: string, stamp: string): Promise<void> {
  await copyFile(`${packageJsonPath}.bak-doctor-migrate-${stamp}`, packageJsonPath).catch(() => undefined)
  await copyFile(`${lockfilePath}.bak-doctor-migrate-${stamp}`, lockfilePath).catch(() => undefined)
}

/** Ensure the current package can be installed before touching the profile. */
async function targetAvailable(targetSpec: string, profileDir: string, deps: LegacyMigrationDeps): Promise<boolean> {
  if (targetSpec.startsWith('link:') || targetSpec.startsWith('file:')) {
    const rawPath = targetSpec.slice(targetSpec.indexOf(':') + 1)
    const path = isAbsolute(rawPath) ? rawPath : resolve(profileDir, rawPath)
    const exists = deps.exists ?? existsSync
    return exists(join(path, 'package.json'))
  }
  const targetVersion = deps.targetVersion ?? currentPackageVersion()
  const encoded = '@linxin666%2Fdsh-web-all'
  const fetchImpl = deps.fetch ?? (async (url: string) => await fetch(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) }))
  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${encoded}/${targetVersion}`)
    if (!response.ok) return false
    const body = await response.json() as { version?: unknown }
    return body.version === targetVersion
  } catch {
    return false
  }
}

/**
 * Run the deterministic legacy aggregate migration through the official CLI.
 * Returns noop when there is nothing to migrate or the current package is not
 * yet available; returns error with a diagnostic message otherwise.
 */
export async function migrateLegacyAggregate(
  home: string,
  profile: string,
  dshPath: string,
  options: LegacyMigrationDeps = {},
): Promise<LegacyMigrationResult> {
  const env = options.env ?? process.env
  const profileDir = join(home, 'profiles', profile)
  const packageJsonPath = join(profileDir, 'package.json')
  const lockfilePath = join(profileDir, 'pnpm-lock.yaml')
  let manifestText: string
  try {
    manifestText = await readFile(packageJsonPath, 'utf8')
  } catch {
    return { kind: 'noop', message: 'profile package.json not found' }
  }
  const parsed = parseProfileManifest(manifestText, packageJsonPath)
  if (parsed.error !== undefined) return { kind: 'error', message: parsed.error }
  const legacyName = '@linxin666/dsh-web-ui-all'
  const currentName = '@linxin666/dsh-web-all'
  const oldSpec = parsed.facts.dependencies[legacyName]
  if (oldSpec === undefined || !isLegacyAggregate(legacyName)) return { kind: 'noop', message: 'legacy aggregate is not installed' }
  const targetVersion = options.targetVersion ?? currentPackageVersion()
  const targetSpec = targetSpecForLegacy(oldSpec, targetVersion)
  if (targetSpec === undefined || !(await targetAvailable(targetSpec, profileDir, options))) {
    return { kind: 'noop', message: 'current aggregate is not available yet' }
  }
  const oldIndex = parsed.facts.bundles.indexOf(legacyName)
  const targetPreviouslyInstalled = parsed.facts.dependencies[currentName] !== undefined
  const stamp = (options.now ?? (() => new Date().toISOString().replace(/[^0-9]/g, '')))().slice(0, 14)
  await backupProfile(packageJsonPath, lockfilePath, stamp)

  try {
  const run = options.run ?? (async (args: string[], runEnv: NodeJS.ProcessEnv) => {
    const { spawn } = await import('node:child_process')
    return await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(dshPath, args, { env: runEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32_000) })
      child.stderr?.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32_000) })
      const timer = setTimeout(() => { child.kill() }, CLI_TIMEOUT_MS)
      child.once('error', reject)
      child.once('close', code => { clearTimeout(timer); resolve({ code, output } ) })
    })
  })

  const cliEnv = { ...env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
  const addTarget = async (): Promise<{ code: number | null; output: string }> => run(
    ['plugin', '--profile', profile, 'add', targetSpec], cliEnv,
  )
  const removeLegacy = async (): Promise<{ code: number | null; output: string }> => run(
    ['plugin', '--profile', profile, 'remove', legacyName], cliEnv,
  )
  const addLegacy = async (): Promise<{ code: number | null; output: string }> => run(
    ['plugin', '--profile', profile, 'add', fullLegacySpec(legacyName, oldSpec)], cliEnv,
  )

  let addedTarget = false
  const targetIsLocal = /^(?:link:|file:)/.test(targetSpec)
  if (!targetPreviouslyInstalled) {
    const add = await addTarget()
    if (add.code !== 0) {
      await restoreBackup(packageJsonPath, lockfilePath, stamp)
      return { kind: 'error', message: `doctor: install ${targetSpec} failed${add.output === '' ? '' : `: ${add.output}`}` }
    }
    addedTarget = true
  } else if (!targetIsLocal) {
    // A registry target may already be listed by a partial upgrade; install
    // the exact release anyway so the final profile cannot keep a stale
    // current aggregate after the legacy removal.
    const add = await addTarget()
    if (add.code !== 0) {
      await restoreBackup(packageJsonPath, lockfilePath, stamp)
      return { kind: 'error', message: `doctor: update ${targetSpec} failed${add.output === '' ? '' : `: ${add.output}`}` }
    }
  }
  const remove = await removeLegacy()
  if (remove.code !== 0) {
    if (addedTarget) await run(['plugin', '--profile', profile, 'remove', currentName], cliEnv)
    await restoreBackup(packageJsonPath, lockfilePath, stamp)
    return { kind: 'error', message: `doctor: remove ${legacyName} failed${remove.output === '' ? '' : `: ${remove.output}`}` }
  }
  await moveBundle(packageJsonPath, oldIndex, currentName)

  const verify = await run(['--profile', profile, '--dump-config'], cliEnv)
  if (verify.code !== 0) {
    if (addedTarget) await run(['plugin', '--profile', profile, 'remove', currentName], cliEnv)
    // If the current aggregate already existed before this migration, both
    // packages were mounted and the profile was already unusable. Never
    // re-add the legacy bundle; keep the single current aggregate instead of
    // recreating the duplicate web-ui-* layer pair during rollback.
    if (!targetPreviouslyInstalled) {
      const restore = await addLegacy()
      if (restore.code !== 0) {
        await restoreBackup(packageJsonPath, lockfilePath, stamp)
      } else if (oldIndex >= 0) {
        await moveBundle(packageJsonPath, oldIndex, legacyName)
      }
    }
    return { kind: 'error', message: `doctor: migrated profile failed the dump gate${verify.output === '' ? '' : `: ${verify.output}`}` }
  }
  return { kind: 'migrated', message: `migrated ${legacyName} to ${targetSpec}`, targetSpec, targetVersion }
  } catch (error) {
    await restoreBackup(packageJsonPath, lockfilePath, stamp).catch(() => undefined)
    return { kind: 'error', message: `doctor: legacy migration failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
