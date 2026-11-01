#!/usr/bin/env node
/**
 * Install the workspace dependencies with the host SDK pin intact.
 *
 * This repository shares its @deepseek-ai tree with the dsh installation that
 * runs it (see scripts/host-sdk-link.mjs for the contract and for why a second
 * copy of the SDK breaks the running host). pnpm cannot be allowed to link
 * against that pin while it writes:
 *
 * - root node_modules/@deepseek-ai is a symlink into the root-owned host tree,
 *   and pnpm reaches through it, so an install that must place a
 *   @deepseek-ai/<name> entry there dies with EACCES halfway through;
 * - a dev install also creates packages/<pkg>/node_modules/@deepseek-ai entries
 *   that outrank the root pin for that package's own imports.
 *
 * So this script is the install entry point: it detaches the root pin, runs the
 * install, and pins it back (root link plus every workspace entry the host
 * supplies). The restore runs even when the install fails, so a broken install
 * never leaves the running host resolving a registry copy.
 *
 * --ignore-scripts is deliberate: cloudflared, ssh2 and cpu-features postinstall
 * hooks fetch platform binaries from hosts this machine cannot reach, and the
 * workspace prepare hooks rebuild packages that are not part of a dependency
 * install. Everything else here is plain linking.
 *
 * --frozen-lockfile is deliberate as well: the lockfile covers devDependencies
 * for all 25 importers, so resolution is a no-op and an install never rewrites
 * the lockfile.
 *
 * Usage:
 *   node scripts/install-deps.mjs                        # canonical install
 *   node scripts/install-deps.mjs --no-frozen-lockfile   # after editing a manifest
 *   node scripts/install-deps.mjs --help
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, rmSync, unlinkSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT, resolveHostSdk, runLink } from './host-sdk-link.mjs'

const ROOT_SCOPE = join(REPO_ROOT, 'node_modules/@deepseek-ai')

const BASE_ARGS = [
  'install',
  '--ignore-scripts',
  '--frozen-lockfile',
  // Belt and braces for the discard described in installShapeMismatch(): pnpm
  // refuses to remove node_modules on its own without a terminal to confirm it.
  '--config.confirmModulesPurge=false',
]

function log(line) {
  console.log('[deps:install] ' + line)
}

function usage() {
  console.log('usage: node scripts/install-deps.mjs [pnpm install flags...]')
  console.log('')
  console.log('Runs: pnpm ' + BASE_ARGS.join(' ') + ' <flags>')
  console.log('Then restores the @deepseek-ai pin: the root symlink to the host DSH')
  console.log('tree plus every host core entry in the workspace projects.')
}

/**
 * Move the root pin aside so pnpm never reaches through it. A symlink is only
 * unlinked; the host tree behind it is never touched.
 *
 * @returns {string|null} the detached link target, or null when there was none
 */
function detachRootPin() {
  try {
    if (!lstatSync(ROOT_SCOPE).isSymbolicLink()) {
      log('root pin is not a symlink; leaving it to pnpm')
      return null
    }
  } catch {
    return null
  }
  const target = readlinkSync(ROOT_SCOPE)
  unlinkSync(ROOT_SCOPE)
  log('detached root pin (' + target + ') for the duration of the install')
  return target
}

/**
 * Whether the installed tree was produced by a different install shape than the
 * one this run needs. A --prod install records included.devDependencies: false,
 * the first dev install afterwards needs a tree pnpm will not discard without a
 * terminal to confirm it (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY), and this
 * script has none, so it discards the tree itself.
 *
 * @returns {boolean}
 */
function installShapeMismatch() {
  const modulesDir = join(REPO_ROOT, 'node_modules')
  if (!existsSync(modulesDir)) return false
  const recorded = join(modulesDir, '.modules.yaml')
  if (!existsSync(recorded)) return true
  try {
    return /devDependencies:\s*false/.test(readFileSync(recorded, 'utf8'))
  } catch {
    return false
  }
}

/** Every node_modules tree pnpm links into, root first. */
function modulesDirs() {
  const dirs = [join(REPO_ROOT, 'node_modules')]
  const sharedDir = join(REPO_ROOT, 'shared/node_modules')
  if (existsSync(sharedDir)) dirs.push(sharedDir)
  const packagesDir = join(REPO_ROOT, 'packages')
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir).sort()) {
      const dir = join(packagesDir, entry, 'node_modules')
      if (existsSync(dir)) dirs.push(dir)
    }
  }
  return dirs
}

function discardModulesDirs() {
  for (const dir of modulesDirs()) {
    rmSync(dir, { recursive: true })
    log('discarded ' + dir)
  }
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage()
    return 0
  }

  const host = resolveHostSdk()
  if (host) {
    log('host sdk: ' + host.dir + ' (' + (host.version ?? 'unknown version') + ', ' + host.packages.length + ' packages)')
  } else {
    log('no host DSH installation found; this machine installs registry copies')
  }

  // A resolution change (new override, edited manifest) needs pnpm to rewrite
  // pnpm-lock.yaml, which frozen-lockfile refuses and CI=true makes the default,
  // so the frozen half of BASE_ARGS is dropped when the caller asks to re-resolve.
  const noFrozen = argv.includes('--no-frozen-lockfile') || argv.includes('--update')
  const forwarded = (noFrozen ? BASE_ARGS.filter((flag) => flag !== '--frozen-lockfile') : BASE_ARGS).concat(argv)
  log('running: pnpm ' + forwarded.join(' '))

  const startedAt = Date.now()
  let installCode = 1
  let linkCode = 1
  detachRootPin()
  try {
    if (installShapeMismatch()) {
      log('installed tree has a different install shape (see ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY)')
      discardModulesDirs()
    }
    const result = spawnSync('pnpm', forwarded, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      // No terminal: nothing here can answer an interactive prompt. A
      // re-resolve stays out of CI mode so pnpm is allowed to write the lockfile.
      env: noFrozen ? { ...process.env } : { ...process.env, CI: 'true' },
    })
    if (result.error) {
      log('could not run pnpm: ' + result.error.message)
      installCode = 1
    } else if (result.signal) {
      log('pnpm terminated by signal ' + result.signal)
      installCode = 1
    } else {
      installCode = result.status ?? 1
    }
  } finally {
    log('restoring the @deepseek-ai pin')
    linkCode = runLink({ log: (line) => console.log('[host-sdk] ' + line) })
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  log('install exit: ' + installCode + ' (' + seconds + 's)')
  log('pin exit: ' + linkCode)
  if (installCode !== 0 || linkCode !== 0) {
    log('FAILED; the pin is restored, but the install did not complete cleanly')
    return installCode !== 0 ? installCode : linkCode
  }
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2))
}
