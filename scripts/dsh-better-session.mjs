#!/usr/bin/env node
/**
 * dsh-better-session — maintenance CLI for the inactive-by-default
 * @morlay/better-session aggregate integration. Thin shell over the
 * better-session-manager package's core runner (decode/projection/store
 * semantics live there and are shared with the settings card).
 *
 * Usage:
 *   node scripts/dsh-better-session.mjs status [--profile web] [--json]
 *   node scripts/dsh-better-session.mjs migrate [--apply] [--yes] [--create-store]
 *        [--project <key>] [--limit N] [--include-empty] [--no-backup] [--json]
 *   node scripts/dsh-better-session.mjs enable  [--profile web] [--yes] [--dry-run]
 *   node scripts/dsh-better-session.mjs disable [--profile web] [--dry-run]
 *
 * The GUI equivalent lives in the better-session-manager card under
 * Settings → Web Plugins → Better Session. Default posture ships inactive;
 * the stock jsonl backend keeps serving sessions until you opt in.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// The runner lives next to the node half of the manager package and is
// produced by its tsdown companion config; scripts load the built artifact
// directly so resolution never depends on how pnpm arranged root symlinks.
const RUNNER_URL = new URL('../packages/dsh-perf/lib/better-session-import.mjs', import.meta.url)
let cachedCore
async function loadCore() {
  if (!existsSync(RUNNER_URL)) {
    throw new Error(`${TAG}packages/dsh-perf/lib/better-session-import.mjs is missing; it is a build artifact of the dsh-perf package — run \`pnpm build\` first`)
  }
  cachedCore ??= await import(RUNNER_URL.href)
  return cachedCore
}

const TAG = '[dsh-better-session] '
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const AGGREGATE_PATCH = join(REPO_ROOT, 'packages', 'dsh-web-all', 'cordis.patch.yml')

function report(message) {
  console.log(TAG + message)
}

function fatal(message) {
  console.error(TAG + 'ERROR ' + message)
  process.exitCode = process.exitCode || 1
}

/** Parse argv into `{ command, flags }`; valueful flags consume one argument. */
export function parseArgv(argv) {
  const [command = '', ...rest] = argv
  const flags = { _: [] }
  const valueful = ['project', 'limit', 'profile', 'sessions-dir', 'db']
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith('--')) {
      flags._.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (valueful.includes(key)) {
      const value = rest[i + 1]
      if (value === undefined) throw new Error(`flag ${key} expects a value`)
      flags[key] = value
      i++
      continue
    }
    flags[key] = true
  }
  return { command, flags }
}

function usage() {
  report('usage: node scripts/dsh-better-session.mjs <status|migrate|enable|disable> [flags]')
  return process.argv[2] === undefined ? 0 : 1
}

function defaultSessionsDir() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
}

function defaultDbPath() {
  return join(defaultSessionsDir(), 'sessions.sqlite')
}

function profilePatchPath(profile) {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', profile, 'cordis.patch.yml')
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** Copy the sqlite files aside before any mutating pass. */
function backupStore(dbPath) {
  if (!existsSync(dbPath)) return null
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const now = new Date()
  const pad = (v) => String(v).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const backupDir = join(home, 'backups', `better-session-migrate-${stamp}`)
  mkdirSync(backupDir, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, join(backupDir, 'sessions.sqlite' + suffix))
  }
  report(`backed up store to ${backupDir}`)
  return backupDir
}

async function statusCommand(flags) {
  const { deriveMountState, discoverLegacySessions } = await loadCore()
  const sessionsDir = flags['sessions-dir'] ?? defaultSessionsDir()
  const dbPath = flags.db ?? defaultDbPath()
  const profile = flags.profile ?? 'web'
  const mount = deriveMountState(readText(AGGREGATE_PATCH), readText(profilePatchPath(profile)))
  const buckets = new Map()
  for (const session of discoverLegacySessions(sessionsDir)) {
    const bucket = buckets.get(session.projectKey) ?? { key: session.projectKey, sessions: 0, bytes: 0 }
    bucket.sessions += 1
    bucket.bytes += session.sizeBytes
    buckets.set(session.projectKey, bucket)
  }
  const payload = {
    mountState: mount.state,
    repoOverridden: mount.repoOverridden,
    profileEnabledBlock: mount.profileEnabledBlock,
    legacyRoot: sessionsDir,
    legacyTotalSessions: [...buckets.values()].reduce((sum, b) => sum + b.sessions, 0),
    legacyProjects: Object.fromEntries([...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map((b) => [b.key, b.sessions])),
    storeExists: existsSync(dbPath),
  }
  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2))
    return 0
  }
  report(`opt-in state: ${payload.mountState} (repo overrides ${mount.repoOverridden ? 'present' : 'MISSING'}, profile ${profile} block ${mount.profileEnabledBlock ? 'present' : 'absent'})`)
  report(`legacy store ${sessionsDir}: ${payload.legacyTotalSessions} session(s) across ${buckets.size} project(s)`)
  for (const bucket of [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    report(`  ${bucket.key}: ${bucket.sessions} session(s), ${(bucket.bytes / 1024 / 1024).toFixed(1)} MB`)
  }
  report(payload.storeExists ? `rdb store ${dbPath}: present` : `rdb store ${dbPath}: absent (created on first apply with --create-store or through the settings card)`)
  if (payload.mountState === 'inactive-by-default') {
    report('next steps: `migrate --apply` (dsh stopped) then `enable --yes`; restart dsh afterwards — or use the Better Session card under Settings → Web Plugins.')
  }
  return 0
}

async function migrateCommand(flags) {
  const { runImport } = await loadCore()
  const applyMode = flags.apply === true
  const dbPath = flags.db ?? defaultDbPath()

  if (applyMode && !flags.yes) {
    for (const suffix of ['', '-wal']) {
      try {
        if (Date.now() - statSync(dbPath + suffix).mtimeMs < 120_000) {
          fatal('the sqlite store was modified within the last two minutes — stop dsh, then rerun with --apply --yes')
          return 1
        }
      } catch { /* absent */ }
    }
  }

  // Back the store aside BEFORE any mutating pass so a mid-import failure
  // leaves the previous contents recoverable.
  if (applyMode && existsSync(dbPath)) backupStore(dbPath)

  let summary
  try {
    summary = runImport({
      sessionsDir: flags['sessions-dir'] ?? defaultSessionsDir(),
      dbPath,
      apply: applyMode,
      createStore: flags['create-store'] === true,
      includeEmpty: flags['include-empty'] === true,
      projectFilter: flags.project,
      limit: flags.limit !== undefined ? Number(flags.limit) : undefined,
    })
  } catch (error) {
    fatal(error.message)
    return 1
  }

  if (applyMode) backupStore(dbPath)

  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    for (const item of summary.details) {
      const tail = [
        item.events !== undefined ? `${item.events} evts` : '',
        item.dropped !== undefined ? `${item.dropped} dropped` : '',
        item.torn === true ? 'TORN TAIL' : '',
        item.error !== undefined ? `ERROR ${item.error}` : '',
      ].filter(Boolean).join(', ')
      report(`${String(item.status).padEnd(17)} ${item.projectKey}/${item.sessionId}${tail !== '' ? ` (${tail})` : ''}`)
    }
    report(summary.totalScanned === 0
      ? 'no legacy sessions matched'
      : `scanned ${summary.totalScanned}: would-import/imported ${summary.imported}, skipped-existing ${summary.skippedExisting}, skipped-empty ${summary.skippedEmpty}, failed ${summary.failed}`)
  }

  if (!applyMode) {
    if (!flags.json) report(`dry-run: nothing written. Pass --apply --create-store --yes (with dsh stopped) to migrate into ${dbPath}`)
  }
  return summary.failed > 0 ? 1 : 0
}

function writePatchAtomic(patchPath, text) {
  if (existsSync(patchPath)) copyFileSync(patchPath, `${patchPath}.bak-dsh-better-session`)
  mkdirSync(dirname(patchPath), { recursive: true })
  const tmp = `${patchPath}.tmp-dsh-better-session`
  writeFileSync(tmp, text)
  renameSync(tmp, patchPath)
}

async function enableDisableCommand(command, flags) {
  const { applyManagedBlock } = await loadCore()
  const profile = flags.profile ?? 'web'
  const patchPath = profilePatchPath(profile)
  if (!existsSync(patchPath)) {
    fatal(`profile patch not found: ${patchPath} (create the profile first)`)
    return 1
  }
  const original = readFileSync(patchPath, 'utf8')
  const updated = applyManagedBlock(original, command === 'enable' ? 'insert' : 'remove')
  if (updated === original) {
    report(`${command}: no changes needed (${patchPath})`)
    return 0
  }
  if (flags['dry-run']) {
    report(`dry-run: would update ${patchPath}`)
    const before = new Set(original.split('\n'))
    for (const line of updated.split('\n')) {
      if (!before.has(line)) report('  + ' + line)
    }
    return 0
  }
  if (command === 'enable' && !flags.yes) {
    report('reminder: run `migrate --apply` first unless you accept an empty conversation list under the new backend.')
    report('pass --yes to skip this reminder check.')
    return 1
  }
  writePatchAtomic(patchPath, updated)
  report(`${command}: wrote ${patchPath} (hot-reloaded on long-lived hosts; otherwise takes effect at next start)`)
  return 0
}

/* ── main ─────────────────────────────────────────────────────────────────── */

export async function main(argv) {
  let parsed
  try {
    parsed = parseArgv(argv)
  } catch (error) {
    fatal(error.message)
    return 1
  }
  switch (parsed.command) {
    case 'status':
      return await statusCommand(parsed.flags)
    case 'migrate':
      return await migrateCommand(parsed.flags)
    case 'enable':
    case 'disable':
      return await enableDisableCommand(parsed.command, parsed.flags)
    default:
      return usage()
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const code = await main(process.argv.slice(2))
  process.exit(code)
}
