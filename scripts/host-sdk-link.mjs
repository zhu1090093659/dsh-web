#!/usr/bin/env node
/**
 * Pin the repository's @deepseek-ai resolution to the host DSH installation.
 *
 * The packages here are loaded by the running host through the profile's
 * "link:" entries (~/.dsh/profiles/<profile>/package.json -> this checkout), so
 * Node resolves their @deepseek-ai imports by walking up from the plugin
 * directory into this repository's node_modules. Two paths decide whether that
 * resolution reaches the host's SDK cohort (0.2.1-rc.5) or a registry copy
 * (0.2.1-rc.3), and a second copy of any SDK package beside the host's does not
 * fail loudly: a second cordis makes service registration miss, and a split
 * cohort splits type identity too, so a package that consumes a host core type
 * and augments cordis sees two unrelated Context declarations
 * (packages/dsh-i18n failed exactly that way on tsgo before this pin covered
 * libraries as well). Both paths are pinned here.
 *
 * 1. Root node_modules/@deepseek-ai is a symlink to the host tree
 *    (/usr/local/lib/nodejs/current/.../dsh/node_modules/@deepseek-ai, 306
 *    packages). pnpm does not manage it; it reaches through the link and writes
 *    scope members inside the target, which is root-owned there, so a plain
 *    install against the pinned tree fails with EACCES instead of silently
 *    replacing the pin. That fuse is not enough on its own, because the install
 *    this repository needs has to move the link aside first
 *    (scripts/install-deps.mjs) and this script puts it back.
 * 2. A dev install creates packages/<pkg>/node_modules/@deepseek-ai/<name> for
 *    every declared SDK devDependency. That path outranks the root pin for the
 *    package's own imports, so every entry the host supplies is repointed at the
 *    host copy. The few the host does not ship (client-only build inputs such as
 *    dsh-client-ui-primitives) keep the registry copy: they are bundled at build
 *    time and never resolve in the running host.
 *
 * Idempotent and safe to rerun. Packages the host does not supply are never
 * removed.
 *
 * Usage:
 *   node scripts/host-sdk-link.mjs            # repair the pin
 *   node scripts/host-sdk-link.mjs --check    # verify only, exit 1 on drift
 *   DSH_HOST_SDK_DIR=/path/to/@deepseek-ai node scripts/host-sdk-link.mjs
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = resolvePath(fileURLToPath(new URL('.', import.meta.url)))
export const REPO_ROOT = resolvePath(SCRIPT_DIR, '..')

/** Where the running dsh installs its SDK cohort on this host. */
const HOST_SDK_DEFAULT =
  '/usr/local/lib/nodejs/current/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

/** A host tree this small is a partial install, not the cohort we pin to. */
const MIN_HOST_PACKAGES = 100

/**
 * Candidate host SDK trees, most specific first. Versioned node builds next to
 * "current" are a fallback for the window where "current" is being swapped.
 *
 * @returns {string[]}
 */
export function hostSdkCandidates() {
  const candidates = []
  if (process.env.DSH_HOST_SDK_DIR) candidates.push(resolvePath(process.env.DSH_HOST_SDK_DIR))
  candidates.push(HOST_SDK_DEFAULT)
  const nodeRoot = '/usr/local/lib/nodejs'
  try {
    for (const name of readdirSync(nodeRoot).sort()) {
      if (name === 'current') continue
      candidates.push(
        join(nodeRoot, name, 'lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'),
      )
    }
  } catch {
    // Not the layout this host uses; the explicit candidates still apply.
  }
  return [...new Set(candidates)]
}

/**
 * @param {string} dir
 * @returns {{dir: string, linkText: string, version: string|null, packages: string[]} | null}
 */
export function inspectHostSdk(dir) {
  try {
    if (!statSync(dir).isDirectory()) return null
    const packages = readdirSync(dir)
    if (packages.length < MIN_HOST_PACKAGES) return null
    const marker = join(dir, 'dsh-session', 'package.json')
    if (!existsSync(marker)) return null
    const version = JSON.parse(readFileSync(marker, 'utf8')).version ?? null
    return { dir, linkText: dir, version, packages }
  } catch {
    return null
  }
}

/**
 * The host SDK tree, or null on a machine that has no host install to pin to.
 *
 * @returns {{dir: string, linkText: string, version: string|null, packages: string[]} | null}
 */
export function resolveHostSdk() {
  for (const candidate of hostSdkCandidates()) {
    const host = inspectHostSdk(candidate)
    if (host) return host
  }
  return null
}

/**
 * @param {string} path
 * @returns {'missing'|'symlink'|'dir'|'file'}
 */
function entryKind(path) {
  try {
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) return 'symlink'
    if (stats.isDirectory()) return 'dir'
    return 'file'
  } catch {
    return 'missing'
  }
}

/**
 * @param {string} path
 * @returns {string|null} realpath, or null when the path does not resolve
 */
function realpathOrNull(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Replace whatever sits at a path with a symlink. A symlink is unlinked, never
 * traversed, so a pinned host tree can never be deleted through one.
 *
 * @param {string} path
 * @param {string} target absolute link target
 */
function forceSymlink(path, target) {
  const kind = entryKind(path)
  if (kind === 'symlink' || kind === 'file') unlinkSync(path)
  else if (kind === 'dir') rmSync(path, { recursive: true })
  mkdirSync(resolvePath(path, '..'), { recursive: true })
  symlinkSync(target, path)
}

/**
 * Pin a whole scope directory (the repository root) to the host tree.
 *
 * @param {string} scopeDir "node_modules/@deepseek-ai" of a project
 * @param {{dir: string, linkText: string, packages: string[]}} host
 * @param {(line: string) => void} log
 * @returns {'created'|'kept'|'replaced'}
 */
export function pinScopeDir(scopeDir, host, log) {
  const kind = entryKind(scopeDir)
  if (kind === 'symlink') {
    if (realpathOrNull(scopeDir) === realpathOrNull(host.dir)) return 'kept'
    log('replacing scope link ' + scopeDir + ' (was -> ' + readlinkSync(scopeDir) + ')')
    forceSymlink(scopeDir, host.linkText)
    return 'replaced'
  }
  if (kind === 'missing') {
    forceSymlink(scopeDir, host.linkText)
    return 'created'
  }
  log('replacing scope ' + kind + ' ' + scopeDir + ' with the host link')
  forceSymlink(scopeDir, host.linkText)
  return 'replaced'
}

/**
 * Repoint the SDK entries of one workspace project at the host copies. Entries
 * the host does not ship keep the registry copy pnpm installed.
 *
 * @param {string} scopeDir "packages/<pkg>/node_modules/@deepseek-ai"
 * @param {{dir: string, packages: string[]}} host
 * @param {(line: string) => void} log
 * @returns {{kept: number, repointed: number, foreign: string[]}}
 */
export function pinWorkspaceScopeEntries(scopeDir, host, log) {
  const summary = { kept: 0, repointed: 0, foreign: [] }
  if (entryKind(scopeDir) !== 'dir') return summary
  for (const name of readdirSync(scopeDir).sort()) {
    const target = join(host.dir, name)
    if (!existsSync(target)) {
      summary.foreign.push(name)
      continue
    }
    const entry = join(scopeDir, name)
    if (entryKind(entry) === 'symlink' && realpathOrNull(entry) === realpathOrNull(target)) {
      summary.kept += 1
      continue
    }
    forceSymlink(entry, target)
    summary.repointed += 1
  }
  if (summary.repointed > 0) {
    log('repointed ' + summary.repointed + ' entries in ' + scopeDir)
  }
  return summary
}

/**
 * Workspace projects (root, shared, packages/*).
 *
 * @param {string} [repoRoot]
 * @returns {{name: string, dir: string, root: boolean}[]}
 */
export function workspaceProjects(repoRoot = REPO_ROOT) {
  const projects = [{ name: '.', dir: repoRoot, root: true }]
  const sharedDir = join(repoRoot, 'shared')
  if (existsSync(join(sharedDir, 'package.json'))) {
    projects.push({ name: 'shared', dir: sharedDir, root: false })
  }
  const packagesDir = join(repoRoot, 'packages')
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir).sort()) {
      const dir = join(packagesDir, entry)
      if (existsSync(join(dir, 'package.json'))) {
        projects.push({ name: 'packages/' + entry, dir, root: false })
      }
    }
  }
  return projects
}

/**
 * Verify the pin without changing anything.
 *
 * @param {{dir: string, packages: string[]}} host
 * @param {string} [repoRoot]
 * @returns {{ok: boolean, problems: string[], summary: {roots: number, entries: number, kept: number, foreign: number}}}
 */
export function verifyHostSdk(host, repoRoot = REPO_ROOT) {
  const problems = []
  const summary = { roots: 0, entries: 0, kept: 0, foreign: 0 }
  const hostReal = realpathOrNull(host.dir)

  const rootScope = join(repoRoot, 'node_modules/@deepseek-ai')
  const rootKind = entryKind(rootScope)
  if (rootKind !== 'symlink') {
    problems.push(
      'node_modules/@deepseek-ai is ' + (rootKind === 'missing' ? 'missing' : 'a real ' + rootKind) +
        ', expected a symlink to ' + host.dir,
    )
  } else if (realpathOrNull(rootScope) !== hostReal) {
    problems.push(
      'node_modules/@deepseek-ai resolves to ' + realpathOrNull(rootScope) + ', expected ' + hostReal,
    )
  } else {
    summary.roots = readdirSync(rootScope).length
    if (summary.roots !== host.packages.length) {
      problems.push(
        'node_modules/@deepseek-ai exposes ' + summary.roots + ' packages, host has ' + host.packages.length,
      )
    }
  }

  for (const project of workspaceProjects(repoRoot)) {
    if (project.root) continue
    const scopeDir = join(project.dir, 'node_modules/@deepseek-ai')
    if (entryKind(scopeDir) !== 'dir') continue
    for (const name of readdirSync(scopeDir).sort()) {
      const target = join(host.dir, name)
      if (!existsSync(target)) {
        summary.foreign += 1
        continue
      }
      summary.entries += 1
      const resolved = realpathOrNull(join(scopeDir, name))
      if (resolved === realpathOrNull(target)) summary.kept += 1
      else problems.push(project.name + ': @deepseek-ai/' + name + ' resolves to ' + resolved)
    }
  }

  return { ok: problems.length === 0, problems, summary }
}

/**
 * @param {{checkOnly?: boolean, log?: (line: string) => void}} [options]
 * @returns {number} process exit code
 */
export function runLink(options = {}) {
  const log = options.log ?? ((line) => console.log('[host-sdk] ' + line))
  const host = resolveHostSdk()
  if (!host) {
    log('no host DSH installation found; nothing to pin on this machine')
    return 0
  }
  log('host sdk: ' + host.dir + ' (' + (host.version ?? 'unknown version') + ', ' + host.packages.length + ' packages)')

  if (options.checkOnly) {
    const verdict = verifyHostSdk(host)
    log('check: ' + (verdict.ok ? 'ok' : 'DRIFT') +
      ' (root exposes ' + verdict.summary.roots + ' packages, ' +
      verdict.summary.kept + '/' + verdict.summary.entries + ' workspace entries pinned, ' +
      verdict.summary.foreign + ' host-absent left to pnpm)')
    for (const problem of verdict.problems) log('drift: ' + problem)
    if (!verdict.ok) log('repair with: pnpm run deps:install')
    return verdict.ok ? 0 : 1
  }

  for (const project of workspaceProjects()) {
    const scopeDir = join(project.dir, 'node_modules/@deepseek-ai')
    if (project.root) {
      log('root pin: ' + pinScopeDir(scopeDir, host, log))
      continue
    }
    const result = pinWorkspaceScopeEntries(scopeDir, host, log)
    if (result.foreign.length > 0) {
      log(project.name + ': left ' + result.foreign.length + ' host-absent package(s) as installed (' +
        result.foreign.join(', ') + ')')
    }
  }

  const verdict = verifyHostSdk(host)
  log('verify: ' + (verdict.ok ? 'ok' : 'FAILED') +
    ' (root exposes ' + verdict.summary.roots + ' packages, ' +
    verdict.summary.kept + '/' + verdict.summary.entries + ' workspace entries pinned, ' +
    verdict.summary.foreign + ' host-absent left to pnpm)')
  for (const problem of verdict.problems) log('drift: ' + problem)
  return verdict.ok ? 0 : 1
}

const invokedDirectly =
  process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  process.exitCode = runLink({ checkOnly: process.argv.slice(2).includes('--check') })
}
