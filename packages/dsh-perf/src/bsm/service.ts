/**
 * Host-side orchestration for the card actions: profile resolution, atomic
 * patch writes with backup, child-process migration runs and status assembly.
 * All filesystem work happens here in the node half; the browser talks to
 * this surface through the plugin's /api routes.
 * @module better-session-manager/host
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  applyManagedBlock,
  deriveMountState,
  type MountState,
} from './profile-blocks.ts'
import { backupStore, discoverLegacySessions, runImport } from './migration-run.ts'
import { openStore } from './migration-core.ts'

export interface ResolvedPaths {
  dshHome: string
  sessionsDir: string
  dbPath: string
  profilePatchPath: string
}

/** Resolve the boot profile name: explicit --profile wins, then DSH_PROFILE, then `web`. */
export function resolveProfileName(argv: readonly string[] = process.argv): string {
  const flag = argv.indexOf('--profile')
  if (flag >= 0 && argv[flag + 1] !== undefined) return String(argv[flag + 1])
  if (process.env.DSH_PROFILE?.trim()) return process.env.DSH_PROFILE.trim()
  return 'web'
}

/** Default base directories following the DSH harness conventions. */
export function resolvePaths(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): ResolvedPaths {
  const dshHome = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const profile = resolveProfileName(argv)
  return {
    dshHome,
    sessionsDir: join(dshHome, 'sessions'),
    dbPath: join(dshHome, 'sessions', 'sessions.sqlite'),
    profilePatchPath: join(dshHome, 'profiles', profile, 'cordis.patch.yml'),
  }
}

/** Locate the family aggregate artifact relative to a starting directory. */
export function findUpMarker(fromDir: string, marker: string): string | undefined {
  let dir = resolve(fromDir)
  for (;;) {
    const candidate = join(dir, marker)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

const AGGREGATE_MARKER = join('packages', 'dsh-web-all', 'cordis.patch.yml')

/** The aggregate artifact text when it is reachable from the boot cwd; else undefined. */
function aggregateArtifactText(): string | undefined {
  const envPath = process.env.DSH_WEB_AGGREGATE_PATCH
  if (envPath !== undefined && envPath !== '' && existsSync(envPath)) return readFileSync(envPath, 'utf8')
  const found = findUpMarker(process.cwd(), AGGREGATE_MARKER)
  return found !== undefined ? readFileSync(found, 'utf8') : undefined
}

export interface StatusPayload {
  mountState: MountState['state']
  repoOverridden: boolean
  profileEnabledBlock: boolean
  aggregateArtifactSeen: boolean
  legacyRoot: string
  legacyTotalSessions: number
  legacyProjects: Array<{ key: string; sessions: number; bytes: number }>
  storeExists: boolean
  storeSessions?: number
  storeEvents?: number
}

/** Compose the status payload the GET route serves. */
export function buildStatus(paths = resolvePaths()): StatusPayload {
  const profileText = existsSync(paths.profilePatchPath) ? readFileSync(paths.profilePatchPath, 'utf8') : undefined
  const state = deriveMountState(aggregateArtifactText(), profileText)
  const byProject = new Map<string, { key: string; sessions: number; bytes: number }>()
  for (const session of discoverLegacySessions(paths.sessionsDir)) {
    const bucket = byProject.get(session.projectKey) ?? { key: session.projectKey, sessions: 0, bytes: 0 }
    bucket.sessions++
    bucket.bytes += session.sizeBytes
    byProject.set(session.projectKey, bucket)
  }
  let storeSessions: number | undefined
  let storeEvents: number | undefined
  const storeExists = existsSync(paths.dbPath)
  if (storeExists && state.state === 'enabled-via-profile') {
    // Read-only counts against an rdb-owned store (WAL-safe single reader).
    try {
      const db = openStore(paths.dbPath)
      storeSessions = Number((db.prepare('SELECT COUNT(*) AS n FROM t_sessions').get() as { n: number }).n)
      storeEvents = Number((db.prepare('SELECT COUNT(*) AS n FROM t_events').get() as { n: number }).n)
      db.close()
    } catch { /* unreadable or foreign store surfaces through migrate errors */ }
  }
  return {
    mountState: state.state,
    repoOverridden: state.repoOverridden,
    profileEnabledBlock: state.profileEnabledBlock,
    aggregateArtifactSeen: aggregateArtifactText() !== undefined,
    legacyRoot: paths.sessionsDir,
    legacyTotalSessions: [...byProject.values()].reduce((sum, b) => sum + b.sessions, 0),
    legacyProjects: [...byProject.values()].sort((a, b) => a.key.localeCompare(b.key)),
    storeExists,
    storeSessions,
    storeEvents,
  }
}

/* ── migration run + atomic patch write ───────────────────────────────────── */

/**
 * Run the importer in a CHILD node process so the host event loop stays
 * responsive while hundreds of logs decode. The standalone runner is built to
 * lib/better-session-import.js next to this half by tsdown; spawning node
 * keeps the runtime path identical to the maintenance CLI. Falls back to an
 * in-process run when the built artifact is absent (development checkouts).
 */
export async function runMigration(options: { sessionsDir?: string; dbPath?: string }): Promise<{ summaryJson: string; durationMs: number }> {
  const paths = resolvePaths()
  const effective = { sessionsDir: options.sessionsDir ?? paths.sessionsDir, dbPath: options.dbPath ?? paths.dbPath }
  const startedAt = Date.now()
  const moduleUrl = new URL('./better-session-import.mjs', import.meta.url)
  if (!existsSync(moduleUrl)) {
    const summary = runImport({ ...effective, apply: true, createStore: true })
    return { summaryJson: JSON.stringify(summary), durationMs: Date.now() - startedAt }
  }
  return await new Promise((resolvePromise, rejectPromise) => {
    const started = Date.now()
    const scriptPath = fileURLToPath(moduleUrl)
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_IMPORT_OPTIONS: JSON.stringify({ ...effective, apply: true, createStore: true }) },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise({ summaryJson: stdout.slice(stdout.indexOf('{')), durationMs: Date.now() - started })
      else rejectPromise(new Error(stderr.trim() !== '' ? stderr.trim() : `importer exited ${code}`))
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })
  })
}

/** Write the profile patch atomically: `.bak` of previous content, temp file, rename over. */
export function writePatchAtomicSync(patchPath: string, text: string): void {
  if (existsSync(patchPath)) copyFileSync(patchPath, `${patchPath}.bak-better-session-manager`)
  mkdirSync(dirname(patchPath), { recursive: true })
  const tmp = `${patchPath}.tmp-better-session-manager`
  writeFileSync(tmp, text)
  renameSync(tmp, patchPath)
}

export interface EnableOutcome {
  imported: number
  failed: number
  summary: unknown
  durationMs: number
}

/**
 * Full enable flow: migrate first (the store bootstraps when absent), then
 * flip the managed block. When the migration throws the profile stays
 * untouched.
 */
export async function performEnable(paths = resolvePaths()): Promise<EnableOutcome> {
  const backupDir = backupStore(paths.dbPath, paths.dshHome)
  if (backupDir !== null) console.log(`[better-session-manager] backed up store to ${backupDir}`)
  const run = await runMigration({ sessionsDir: paths.sessionsDir, dbPath: paths.dbPath })
  let summary: unknown
  try {
    summary = JSON.parse(run.summaryJson)
  } catch {
    summary = { raw: run.summaryJson.slice(0, 4000) }
  }
  if (!existsSync(paths.dbPath)) throw new Error('migration did not produce a store')
  const original = existsSync(paths.profilePatchPath) ? readFileSync(paths.profilePatchPath, 'utf8') : ''
  const updated = applyManagedBlock(original, 'insert')
  if (updated !== original) writePatchAtomicSync(paths.profilePatchPath, updated)
  const parsed = summary as { imported?: number; failed?: number }
  return { imported: Number(parsed.imported ?? 0), failed: Number(parsed.failed ?? 0), summary, durationMs: run.durationMs }
}

/** Flip the managed block off; profile-only operation, no store changes. */
export function performDisable(paths = resolvePaths()): void {
  const original = existsSync(paths.profilePatchPath) ? readFileSync(paths.profilePatchPath, 'utf8') : ''
  const updated = applyManagedBlock(original, 'remove')
  if (updated !== original) writePatchAtomicSync(paths.profilePatchPath, updated)
}
