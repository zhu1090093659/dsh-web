import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { DoctorPaths } from './paths.ts'

export interface CapsuleManifest {
  schemaVersion: 1
  createdAt: string
  dshExecutable: string
  dshVersion: string
  doctorPackage: string
  doctorVersion?: string
  /** Relative paths of mirrored credential/config files inside rescue-home. */
  credentialsMirror?: string[]
  /** Sha256 over the mirrored source files; also drives capsule staleness. */
  credentialsFingerprint?: string
  credentialsAt?: string
  rescueHome: string
  status: 'staging' | 'verified' | 'failed'
}

export interface CapsuleOptions {
  paths: DoctorPaths
  dshExecutable: string
  doctorSpec: string
  doctorPackageDir?: string
  doctorVersion?: string
  /** Real DSH home whose provider/credential config is mirrored into the capsule. */
  sourceHome?: string
  /** Profile name under the source home (default web). */
  sourceProfile?: string
  /** Mirror known credential files into the capsule (default true). */
  mirrorCredentials?: boolean
  now?: () => string
  run?: typeof run
}

/**
 * Known credential-bearing file names mirrored into the rescue profile so the
 * isolated environment can actually run providers after a crash. Only the
 * canonical names are mirrored; backup variants (name.bak-*) are never copied.
 */
export const CREDENTIAL_BASENAMES = ['settings.yaml', '.credentials.yaml', 'credentials.yaml', 'credentials.yml', '.env'] as const

/** Candidate mirror paths relative to the DSH home. */
export function credentialRelPaths(sourceProfile: string): string[] {
  const profileLevel = CREDENTIAL_BASENAMES.map(name => join('profiles', sourceProfile, name))
  return [...CREDENTIAL_BASENAMES, ...profileLevel]
}

async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true } catch { return false }
}

/** Copy every existing credential-bearing file into the rescue home (0600). */
export async function mirrorCredentialFiles(options: { sourceHome: string; sourceProfile: string; targetHome: string }): Promise<string[]> {
  const mirrored: string[] = []
  for (const rel of credentialRelPaths(options.sourceProfile)) {
    const from = join(options.sourceHome, rel)
    if (!(await exists(from))) continue
    const to = join(options.targetHome, rel)
    await mkdir(resolve(to, '..'), { recursive: true, mode: 0o700 })
    await cp(from, to)
    await chmod(to, 0o600)
    mirrored.push(rel)
  }
  return mirrored
}

/** Sha256 fingerprint of the credential-bearing source files (sorted by path). */
export async function credentialsFingerprint(sourceHome: string, sourceProfile: string): Promise<string> {
  const hash = createHash('sha256')
  for (const rel of credentialRelPaths(sourceProfile)) {
    try {
      hash.update(rel)
      hash.update(Buffer.from([0]))
      hash.update(await readFile(join(sourceHome, rel)))
    } catch {
      // Absent files contribute nothing.
    }
  }
  return hash.digest('hex')
}

/** Remove the mirrored credential files recorded in the capsule manifest (best effort). */
export async function removeCapsuleCredentialFiles(paths: DoctorPaths): Promise<{ removed: number }> {
  let manifest: CapsuleManifest | undefined
  try {
    manifest = JSON.parse(await readFile(join(paths.capsule, 'current', 'manifest.json'), 'utf8')) as CapsuleManifest
  } catch {
    return { removed: 0 }
  }
  const rescueHome = manifest.rescueHome
  if (typeof rescueHome !== 'string' || rescueHome === '') return { removed: 0 }
  let removed = 0
  for (const rel of manifest.credentialsMirror ?? []) {
    try {
      await rm(join(rescueHome, rel), { force: true })
      removed += 1
    } catch {
      // Best effort per file.
    }
  }
  return { removed }
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 6 * 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', b => { stdout += b })
    child.stderr.on('data', b => { stderr += b })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.once('error', reject)
    child.once('close', code => { clearTimeout(timer); resolvePromise({ code: code ?? 1, stdout, stderr }) })
  })
}

export async function provisionCapsule(options: CapsuleOptions): Promise<CapsuleManifest> {
  const current = join(options.paths.capsule, 'current')
  const staging = join(options.paths.capsule, 'staging-' + process.pid + '-' + Date.now())
  const previous = join(options.paths.capsule, 'previous')
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true, mode: 0o700 })
  const rescueHome = join(staging, 'rescue-home')
  const env = { ...process.env, DSH_HOME: rescueHome, DSH_TELEMETRY_DISABLED: '1' }
  const executor = options.run ?? run
  const version = await executor(options.dshExecutable, ['--version'], env)
  if (version.code !== 0) throw new Error('doctor: cannot probe dsh: ' + version.stderr)
  const doctorSpec = options.doctorPackageDir ? 'link:' + resolve(options.doctorPackageDir) : options.doctorSpec
  const install = await executor(options.dshExecutable, ['plugin', '--profile', 'web', 'add', doctorSpec], env)
  if (install.code !== 0) throw new Error('doctor: rescue Doctor install failed: ' + install.stderr)
  const dump = await executor(options.dshExecutable, ['--profile', 'web', '--dump-config'], env)
  if (dump.code !== 0 || !dump.stdout.includes('doctor')) throw new Error('doctor: rescue profile verification failed: ' + dump.stderr)
  // Mirror the user's provider/credential config so the rescue profile can run.
  let credentialsMirror: string[] | undefined
  let fingerprint: string | undefined
  if (options.mirrorCredentials !== false && options.sourceHome !== undefined && options.sourceHome !== '') {
    credentialsMirror = await mirrorCredentialFiles({ sourceHome: options.sourceHome, sourceProfile: options.sourceProfile ?? 'web', targetHome: rescueHome })
    if (credentialsMirror.length > 0) fingerprint = await credentialsFingerprint(options.sourceHome, options.sourceProfile ?? 'web')
  }
  const now = (options.now ?? (() => new Date().toISOString()))()
  const manifest: CapsuleManifest = {
    schemaVersion: 1,
    createdAt: now,
    dshExecutable: resolve(options.dshExecutable),
    dshVersion: version.stdout.trim(),
    doctorPackage: doctorSpec,
    ...(options.doctorVersion !== undefined ? { doctorVersion: options.doctorVersion } : {}),
    ...(credentialsMirror !== undefined && credentialsMirror.length > 0
      ? { credentialsMirror, credentialsFingerprint: fingerprint, credentialsAt: now }
      : {}),
    rescueHome,
    status: 'verified',
  }
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
  await rm(previous, { recursive: true, force: true })
  try { await cp(current, previous, { recursive: true, dereference: true }) } catch {}
  await rm(current, { recursive: true, force: true })
  await cp(staging, current, { recursive: true, dereference: true })
  await rm(staging, { recursive: true, force: true })
  manifest.rescueHome = join(current, 'rescue-home')
  await writeFile(join(current, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
  return manifest
}

export async function capsuleFingerprint(paths: DoctorPaths): Promise<string> {
  return createHash('sha256').update(await readFile(join(paths.capsule, 'current', 'manifest.json'))).digest('hex')
}
