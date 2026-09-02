#!/usr/bin/env node
/**
 * Dual-publish the legacy aggregate package.
 *
 * The product rename publishes the current `@linxin666/dsh-web-all` package
 * and, for the transition window, a final `@linxin666/dsh-web-ui-all` package
 * carrying the same runtime with the old npm identity. This script builds the
 * legacy tarball from the current aggregate's `pnpm pack` output, rewrites
 * only the npm identity and its client loader id, adds the deterministic
 * migration metadata, verifies the current package is readable, and publishes
 * the legacy package through the authenticated npm registry.
 *
 * Usage:
 *   node scripts/publish-legacy-aggregate.mjs [vX.Y.Z]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const AGGREGATE_DIR = join(REPO_ROOT, 'packages', 'dsh-web-all')
export const LEGACY_NAME = '@linxin666/dsh-web-ui-all'
export const CURRENT_NAME = '@linxin666/dsh-web-all'
const LEGACY_VERSION_PREFIX = 'v'
/**
 * Whether new legacy dual-publishes are still accepted.
 *
 * The v0.3.6 release exposed that the release-count heuristic below can
 * never fire under current npm: npm view name --json abbreviates
 * multi-version documents into an array of version strings, so the counted
 * migration metadata silently read zero and legacy 0.3.6 got published
 * after the declared v0.3.5 window end. The window is therefore hard-closed;
 * flip this constant back only through a new release-policy note that also
 * repairs the registry-shape handling in legacyDualPublishedCount.
 */
export const LEGACY_DUAL_PUBLISH_WINDOW_OPEN = false
const DUAL_PUBLISH_RELEASES = 2

/** Rewrite the package manifest for the legacy npm identity. */
export function rewriteLegacyPackageJson(text, version) {
  const pkg = JSON.parse(text)
  pkg.name = LEGACY_NAME
  if (typeof pkg.description === 'string') pkg.description = pkg.description.replace(/@linxin666\/dsh-web-all/g, LEGACY_NAME)
  pkg.dsh = {
    ...(pkg.dsh ?? {}),
    migrate: {
      to: CURRENT_NAME,
      since: version,
    },
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
}

/** Rewrite the bundle self row (and its per-family subpath rows) in the generated aggregate patch. */
export function rewriteLegacyPatch(text) {
  return text
    .split('\n')
    .map(line => line.includes(`name: '${CURRENT_NAME}'`) || line.includes(`name: '${CURRENT_NAME}/`)
      ? line.replace(CURRENT_NAME, LEGACY_NAME)
      : line)
    .join('\n')
}

/** Rewrite the browser loader id inside the generated client bundle. */
export function rewriteLegacyClient(text) {
  return text.split(String(CURRENT_NAME)).join(String(LEGACY_NAME))
}

/** Count legacy versions already carrying the rename migration metadata. */
export function legacyDualPublishedCount({ view = (name) => execFileSync('npm', ['view', name, '--json'], { encoding: 'utf8' }) } = {}) {
  try {
    const packageData = JSON.parse(view(LEGACY_NAME))
    const versions = packageData.versions ?? {}
    const entries = Object.values(versions)
    if (entries.some(entry => typeof entry !== 'object' || entry === null || Array.isArray(entry))) {
      throw new Error(`legacy-aggregate-publish: registry returned an abbreviated document for ${LEGACY_NAME}; per-version dsh.migrate metadata is not readable`)
    }
    return entries.filter(versionData =>
      versionData?.dsh?.migrate?.to === CURRENT_NAME
    ).length
  } catch (error) {
    throw new Error(`legacy-aggregate-publish: cannot read ${LEGACY_NAME} metadata before dual-publish: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Wait until the current package version is readable from npm. */
export function waitForCurrentPublished(version, { attempts = 30, delayMs = 10000, view = (name, v) => execFileSync('npm', ['view', `${name}@${v}`, 'version'], { encoding: 'utf8' }) } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const output = view(CURRENT_NAME, version).trim()
      if (output === version) return
    } catch {
      // Registry propagation is eventually consistent; retry.
    }
    if (attempt < attempts) {
      const started = Date.now()
      while (Date.now() - started < delayMs) {
        // Busy wait keeps the script self-contained without extra imports.
      }
    }
  }
  throw new Error(`legacy-aggregate-publish: ${CURRENT_NAME}@${version} not readable after ${attempts} attempts`)
}

function main() {
  const requested = process.argv[2] ?? ''
  const manifestText = readFileSync(join(AGGREGATE_DIR, 'package.json'), 'utf8')
  const manifest = JSON.parse(manifestText)
  const version = requested === '' ? manifest.version : requested.replace(/^v/, '')
  if (manifest.name !== CURRENT_NAME || manifest.version !== version) {
    throw new Error(`legacy-aggregate-publish: ${AGGREGATE_DIR} package ${manifest.name}@${manifest.version} does not match ${CURRENT_NAME}@${version}`)
  }
  if (!LEGACY_DUAL_PUBLISH_WINDOW_OPEN || legacyDualPublishedCount() >= DUAL_PUBLISH_RELEASES) {
    console.log(`[legacy-aggregate-publish] skip ${LEGACY_NAME} dual-publish: transition window complete`)
    return
  }
  waitForCurrentPublished(version)

  const scratch = mkdtempSync(join(tmpdir(), 'dsh-legacy-publish-'))
  const packOutput = execFileSync('pnpm', ['pack', '--pack-destination', scratch, '--silent'], { cwd: AGGREGATE_DIR, encoding: 'utf8' })
  const candidates = readdirSync(scratch).filter(name => name.endsWith('.tgz')).map(name => join(scratch, name))
  const outputName = packOutput.trim().split(/\r?\n/).at(-1) ?? ''
  const outputPath = outputName === '' ? '' : join(scratch, outputName)
  const tarball = candidates.length === 1 ? candidates[0] : outputPath
  if (tarball === '' || !existsSync(tarball)) throw new Error(`legacy-aggregate-publish: pnpm pack produced no unambiguous tarball in ${scratch}`)
  const rewriteDir = join(scratch, 'rewrite')
  execFileSync('tar', ['-xzf', tarball, '-C', scratch])
  execFileSync('mv', [join(scratch, 'package'), rewriteDir])
  const packageDir = join(rewriteDir, 'package.json')
  writeFileSync(packageDir, rewriteLegacyPackageJson(readFileSync(packageDir, 'utf8'), version))
  const patchPath = join(rewriteDir, 'cordis.patch.yml')
  writeFileSync(patchPath, rewriteLegacyPatch(readFileSync(patchPath, 'utf8')))
  const clientPath = join(rewriteDir, 'lib', 'client.js')
  if (existsSync(clientPath)) writeFileSync(clientPath, rewriteLegacyClient(readFileSync(clientPath, 'utf8')))
  const clientMapPath = join(rewriteDir, 'lib', 'client.js.map')
  if (existsSync(clientMapPath)) writeFileSync(clientMapPath, rewriteLegacyClient(readFileSync(clientMapPath, 'utf8')))
  const legacyTarball = join(scratch, `${LEGACY_NAME.replace(/^@/, '').replace('/', '-')}-${version}.tgz`)
  execFileSync('tar', ['-czf', legacyTarball, '-C', scratch, 'rewrite'])
  execFileSync('npm', ['publish', legacyTarball, '--access', 'public', '--tag', 'latest'], { stdio: 'inherit' })
  console.log(`[legacy-aggregate-publish] published ${LEGACY_NAME}@${version}`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
