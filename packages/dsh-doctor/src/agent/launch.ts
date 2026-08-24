import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { delimiter, dirname, resolve } from 'node:path'
import { DOCTOR_PROTOCOL_VERSION, type ProfileIdentity, type SupervisorRequest } from '../core/protocol.ts'
import { profileIdentity, resolveDshHome } from '../core/profile.ts'
import { migrateLegacyAggregate } from './migrate.ts'
import { callSupervisor } from './ipc.ts'

/** Drop a leading program token (`dsh`, `dsh.cmd`, absolute executable path) so helpers work with or without it. */
export function normalizeArgv(argv: readonly string[]): readonly string[] {
  const first = argv[0]
  if (first !== undefined && /^dsh(\.(cmd|exe|ps1|sh))?$/.test(first)) return argv.slice(1)
  if (first !== undefined && first.includes('/') && first.includes('dsh')) return argv.slice(1)
  return argv
}

export function parseProfile(argv: readonly string[]): string | undefined {
  const args = normalizeArgv(argv)
  const index = args.indexOf('--profile')
  if (index >= 0) return args[index + 1]
  return args[0] === 'web' ? 'web' : undefined
}

export function classifyInvocation(argv: readonly string[]): 'profile' | 'plugin' | 'dump' | 'utility' {
  const args = normalizeArgv(argv)
  if (args.includes('--version') || args.includes('-V') || args.includes('--help') || args.includes('-h')) return 'utility'
  if (args[0] === 'plugin') return 'plugin'
  if (args.includes('--dump-config') || args.includes('--dump-default-config')) return 'dump'
  return 'profile'
}

export function findRealDsh(env: NodeJS.ProcessEnv = process.env, self = process.argv[1]): string {
  const explicit = env.DSH_DOCTOR_REAL_DSH?.trim()
  if (explicit) return realpathSync(explicit)
  const selfDir = self ? dirname(resolve(self)) : ''
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (!directory || resolve(directory) === selfDir) continue
    const candidate = resolve(directory, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    try { return realpathSync(candidate) } catch {}
  }
  throw new Error('doctor: cannot locate the real dsh executable; set DSH_DOCTOR_REAL_DSH')
}

export interface ManagedLaunchOptions {
  argv: string[]
  endpoint: string
  token: string
  realDsh?: string
  env?: NodeJS.ProcessEnv
  now?: () => string
  /** Run the deterministic legacy aggregate migration before starting DSH. */
  autoMigrate?: boolean
}

export async function managedLaunch(options: ManagedLaunchOptions): Promise<number> {
  const env = options.env ?? process.env
  const realDsh = options.realDsh ?? findRealDsh(env)
  const kind = classifyInvocation(options.argv)
  const profileName = parseProfile(options.argv)
  const identity: ProfileIdentity | undefined = profileName === undefined ? undefined : profileIdentity(resolveDshHome(env), profileName, realDsh)
  if (kind === 'profile' && profileName !== undefined && options.autoMigrate !== false) {
    try {
      const migration = await migrateLegacyAggregate(resolveDshHome(env), profileName, realDsh, { env })
      if (migration.kind === 'migrated') process.stderr.write(`[doctor] ${migration.message}\n`)
      if (migration.kind === 'error') process.stderr.write(`[doctor] ${migration.message}\n`)
    } catch (error) {
      process.stderr.write(`[doctor] legacy aggregate migration failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  const runId = randomUUID()
  const child = spawn(realDsh, options.argv, { stdio: ['inherit', 'inherit', 'pipe'], env: { ...env, DSH_DOCTOR_ENDPOINT: options.endpoint, DSH_DOCTOR_TOKEN: options.token, DSH_DOCTOR_RUN_ID: runId, ...(identity ? { DSH_DOCTOR_PROFILE_ID: identity.id } : {}) } })
  let tail = ''
  child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(chunk); tail = (tail + chunk.toString('utf8')).slice(-32_000) })
  if (kind === 'profile' && identity) {
    const request: SupervisorRequest = { protocol: DOCTOR_PROTOCOL_VERSION, type: 'launcher-start', profile: identity, runId, pid: child.pid ?? -1, argv: [...options.argv], at: (options.now ?? (() => new Date().toISOString()))() }
    await callSupervisor(options.endpoint, options.token, request).catch(() => undefined)
  }
  let interrupted = false
  const forward = (signal: NodeJS.Signals): void => { interrupted = true; child.kill(signal) }
  process.once('SIGINT', forward)
  process.once('SIGTERM', forward)
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  process.removeListener('SIGINT', forward)
  process.removeListener('SIGTERM', forward)
  if (kind === 'profile' && identity) {
    await callSupervisor(options.endpoint, options.token, { protocol: DOCTOR_PROTOCOL_VERSION, type: 'launcher-exit', profileId: identity.id, runId, exitCode: result.code, signal: result.signal, intentional: interrupted, started: tail.includes('dsh web:'), at: (options.now ?? (() => new Date().toISOString()))(), stderrTail: tail }).catch(() => undefined)
  }
  if (result.signal === 'SIGINT') return 130
  if (result.signal === 'SIGTERM') return 143
  return result.code ?? 1
}
