#!/usr/bin/env node
/**
 * Link every dsh-web family plugin into the dsh profile's global
 * @linxin666 namespace (~/.dsh/profiles/node_modules/@linxin666).
 *
 * The dsh loader resolves plugin rows (cordis.patch.yml `name:` entries) by
 * Node package resolution from the profile directory, which walks up through
 * ~/.dsh/profiles/node_modules — the layer where the official dsh packages
 * live. Plugins installed through `dsh plugin add` land in the profile's own
 * node_modules and resolve fine; the family links here make the same
 * resolution work for the aggregate bundles (web-ui-all / dsh-skins) whose
 * children are transitively resolved, and repair links left over from older
 * manual setups.
 *
 * Idempotent and safe to rerun: stale links pointing elsewhere are replaced,
 * new packages are added, unrelated entries are left untouched. Real files or
 * directories at a link path are never removed — they are reported and
 * skipped.
 *
 * Usage:
 *   node scripts/link-profile.mjs            # link/refresh the family
 *   node scripts/link-profile.mjs --dry-run  # report without changing
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { walkFamilyPackages } from './lib/family-packages.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(SCRIPT_DIR, '..')
const require = createRequire(import.meta.url)

/**
 * Pure decision logic for one link path: what should the caller do with the
 * entry currently sitting at the link path? No filesystem access, so it can
 * be unit-tested directly (see scripts/link-profile.test.mjs).
 *
 * @param {'missing'|'symlink'|'file'|'dir'} existing kind of entry at the link path
 * @param {string} target desired relative symlink target
 * @param {string|null} currentTarget current readlink() value, or null when
 *   the entry is not a symlink (or its link target could not be read)
 * @returns {'create'|'keep'|'replace'|'skip-report'}
 */
export function decideLinkAction(existing, target, currentTarget) {
  if (existing === 'missing') return 'create'
  if (existing === 'symlink') {
    return currentTarget === target ? 'keep' : 'replace'
  }
  // Real file or directory: never unlink it, just report and leave it alone.
  return 'skip-report'
}

function report(msg) {
  console.log(`[link-profile] ${msg}`)
}

/** Family packages publish under this scope; everything else under packages/ is not ours to link. */
const FAMILY_SCOPE = '@linxin666/'

/** Every family package: packages/* and packages/skins/* that has a package.json with a name. */
function familyPackages() {
  const found = []
  for (const { dir, pkgPath } of walkFamilyPackages(REPO_ROOT)) {
    let name
    try { name = JSON.parse(readFileSync(pkgPath, 'utf8')).name } catch { continue }
    if (name && name.startsWith(FAMILY_SCOPE)) {
      found.push({ name: name.slice(FAMILY_SCOPE.length), dir })
    }
  }
  return found
}

/** External non-family dependencies required by aggregate packages (e.g. dsh-better-sidebar, @mlgbnb/dsh-archive-manager). */
function externalPackages() {
  const dshWebUiAllDir = join(REPO_ROOT, 'packages', 'dsh-web-all')
  const pkgJsonPath = join(dshWebUiAllDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return []
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  const deps = pkgJson.dependencies || {}
  const externals = []
  for (const name of Object.keys(deps)) {
    if (name.startsWith(FAMILY_SCOPE)) continue
    try {
      const entryPkg = resolvePath(dirname(require.resolve(`${name}/package.json`, { paths: [dshWebUiAllDir] })))
      const realDir = realpathSync(entryPkg)
      externals.push({ fullName: name, dir: realDir })
      // Aggregate patch rows can come from a bundle's cordis.patch.yml. A
      // bundle-only package (dsh.bundle.patch, no importable entry) cannot be
      // loaded by the loader itself, but the rows it inserts name its child
      // packages, so those children must also resolve from the profile root.
      const bundleManifest = JSON.parse(readFileSync(join(realDir, 'package.json'), 'utf8'))
      const bundlePatch = bundleManifest.dsh?.bundle?.patch
      if (typeof bundlePatch !== 'string') continue
      const patchPath = join(realDir, bundlePatch)
      if (!existsSync(patchPath)) continue
      for (const line of readFileSync(patchPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*name:\s*['"]([^'"]+)['"]\s*$/) || line.match(/^\s*name:\s*(\S+)\s*$/)
        if (!match) continue
        const childName = match[1]
        if (childName.startsWith(FAMILY_SCOPE) || externals.some((e) => e.fullName === childName)) continue
        try {
          const childPkg = resolvePath(dirname(require.resolve(`${childName}/package.json`, { paths: [realDir] })))
          externals.push({ fullName: childName, dir: realpathSync(childPkg) })
        } catch {}
      }
    } catch {}
  }
  return externals
}

/** Parse package names referenced by an external bundle's patch rows. */
export function bundlePatchChildNames(patchText) {
  const names = []
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\s*name:\s*['"]([^'"]+)['"]\s*$/) || line.match(/^\s*name:\s*(\S+)\s*$/)
    if (match) names.push(match[1])
  }
  return names
}

function main() {
  const DRY = process.argv.includes('--dry-run')

  const HOME = process.env.HOME || homedir()
  if (!HOME) {
    report('cannot determine home directory (HOME is unset and os.homedir() is empty)')
    process.exit(1)
  }
  const PROFILES_NM = join(HOME, '.dsh', 'profiles', 'node_modules')
  const LINK_DIR = join(PROFILES_NM, FAMILY_SCOPE)

  const packages = familyPackages()
  report(`found ${packages.length} family package(s) under packages/`)
  if (DRY) report('--dry-run: no changes will be made')

  if (!existsSync(LINK_DIR)) {
    if (DRY) {
      report(`would create link dir: ${LINK_DIR}`)
      process.exit(0)
    }
    mkdirSync(LINK_DIR, { recursive: true })
    report(`created link dir: ${LINK_DIR}`)
  }

  let changed = 0
  for (const { name, dir } of packages) {
    const linkPath = join(LINK_DIR, name)
    // Windows without Developer Mode cannot create symlinks (EPERM), so this
    // machine uses directory junctions instead. Junctions require absolute
    // targets and readlink reports the absolute target, so the keep-check
    // compares against that same absolute value on win32.
    const WIN32 = process.platform === 'win32'
    const target = WIN32 ? dir : relative(LINK_DIR, dir) // keep links relative, like the official ones
    let existing = 'missing'
    let linkIsJunctionDir = false
    try {
      const st = lstatSync(linkPath)
      existing = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file'
      // Windows junctions report as both a symlink and a directory under lstat.
      if (existing === 'symlink' && st.isDirectory()) linkIsJunctionDir = true
    } catch {}
    let current = null
    if (existing === 'symlink') {
      try { current = readlinkSync(linkPath) } catch {}
    }
    const action = decideLinkAction(existing, target, current)
    if (action === 'keep') continue // already correct
    if (action === 'skip-report') {
      if (DRY) {
        report(`would skip ${name} (not a symlink)`)
      } else {
        report(`skipped (not a symlink, untouched): ${linkPath}`)
      }
      continue
    }
    if (action === 'create') {
      if (DRY) { report(`would link ${name} -> ${target}`); changed++; continue }
      symlinkSync(target, linkPath, WIN32 ? 'junction' : undefined)
      report(`linked ${name} -> ${target}`)
    } else {
      if (DRY) { report(`would replace ${name} -> ${current ?? '(broken)'}`); changed++; continue }
      // Windows junctions are directory reparse points; unlink EPERMs, so rmdir.
      if (linkIsJunctionDir) rmdirSync(linkPath)
      else unlinkSync(linkPath)
      symlinkSync(target, linkPath, WIN32 ? 'junction' : undefined)
      report(`replaced ${name} -> ${target} (was ${current ?? '(broken)'})`)
    }
    changed++
  }

  // Report stale family links (pointing outside this repo) so the user can
  // clean them by hand if needed.
  const stale = []
  for (const entry of readdirSync(LINK_DIR)) {
    const linkPath = join(LINK_DIR, entry)
    let target
    try { target = readlinkSync(linkPath) } catch { continue }
    const abs = resolvePath(LINK_DIR, target)
    const known = packages.some((p) => p.name === entry)
    if (known) continue
    if (abs.startsWith(REPO_ROOT)) continue
    stale.push({ entry, target })
  }
  if (stale.length) {
    for (const s of stale) report(`stale (untouched): ${s.entry} -> ${s.target}`)
  }

  report(changed === 0 ? 'nothing to do' : `${changed} link(s) ${DRY ? 'would be ' : ''}updated`)

  // Also link external dependencies required by dsh-web-all (e.g. @mlgbnb/dsh-archive-manager, dsh-better-sidebar)
  const extPkgs = externalPackages()
  if (extPkgs.length) {
    report(`found ${extPkgs.length} external package(s) from dsh-web-all`)
    let extChanged = 0
    for (const { fullName, dir } of extPkgs) {
      const linkPath = join(PROFILES_NM, fullName)
      const parentDir = dirname(linkPath)
      if (!existsSync(parentDir)) {
        if (!DRY) mkdirSync(parentDir, { recursive: true })
      }
      const WIN32 = process.platform === 'win32'
      const target = WIN32 ? dir : relative(parentDir, dir)
      let existing = 'missing'
      let linkIsJunctionDir = false
      try {
        const st = lstatSync(linkPath)
        existing = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file'
        if (existing === 'symlink' && st.isDirectory()) linkIsJunctionDir = true
      } catch {}
      let current = null
      if (existing === 'symlink') {
        try { current = readlinkSync(linkPath) } catch {}
      }
      const action = decideLinkAction(existing, target, current)
      if (action === 'keep') continue
      if (action === 'skip-report') {
        report(`skipped external (not a symlink, untouched): ${linkPath}`)
        continue
      }
      if (action === 'create') {
        if (DRY) { report(`would link external ${fullName} -> ${target}`); extChanged++; continue }
        symlinkSync(target, linkPath, WIN32 ? 'junction' : undefined)
        report(`linked external ${fullName} -> ${target}`)
      } else {
        if (DRY) { report(`would replace external ${fullName} -> ${current ?? '(broken)'}`); extChanged++; continue }
        if (linkIsJunctionDir) rmdirSync(linkPath)
        else unlinkSync(linkPath)
        symlinkSync(target, linkPath, WIN32 ? 'junction' : undefined)
        report(`replaced external ${fullName} -> ${target} (was ${current ?? '(broken)'})`)
      }
      extChanged++
    }
    if (extChanged > 0) {
      report(`${extChanged} external link(s) ${DRY ? 'would be ' : ''}updated`)
    }
  }
}

// Run only when invoked as the entry script, so the module can be imported
// (e.g. by the unit tests) without touching the real profile.
if (resolvePath(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main()
}
