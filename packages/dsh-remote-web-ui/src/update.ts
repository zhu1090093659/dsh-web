/**
 * Remote update support for the dsh-web-ui family — host half. Detects the
 * installed aggregate package (@linxin666/dsh-web-ui-all) and its family
 * children, probes the npm registry for newer releases, and runs the actual
 * update as `pnpm update` inside the owning dsh profile directory.
 *
 * Pure logic with injected seams (manifest reading, registry fetches, process
 * spawning) so the whole surface is unit-testable without touching disk,
 * network, or a real profile.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

/** npm registry base used for version probes. */
export const NPM_REGISTRY = 'https://registry.npmjs.org'

/** The family scope every dsh-web-ui package is published under. */
export const FAMILY_SCOPE = '@linxin666/'

/** The aggregate package that is the canonical update entry point. */
export const AGGREGATE_PACKAGE = '@linxin666/dsh-web-ui-all'

/** Fallback anchor: this plugin's own package when the aggregate is absent. */
export const SELF_PACKAGE = '@linxin666/dsh-remote-web-ui'

/** A profile manifest `name` prefix (e.g. `dsh-profile-web`). */
const PROFILE_NAME_PREFIX = 'dsh-profile-'

/** How many ancestor directories a profile search walks before giving up. */
const PROFILE_WALK_DEPTH = 12

/** A parsed semantic version (prerelease identifiers kept as strings). */
export interface SemverParts {
  major: number
  minor: number
  patch: number
  /** Dot-split prerelease identifiers; empty when absent. */
  prerelease: string[]
}

/**
 * Parse a semantic version string (leading `v` tolerated, build metadata
 * ignored). Returns undefined for unparseable input.
 * @param value - the version string, e.g. `0.1.10` or `0.1.11-rc.1`.
 * @returns the parsed parts, or undefined.
 */
export function parseSemver(value: string): SemverParts | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Compare two semantic versions per the semver precedence rules (a release
 * outranks any of its prereleases; numeric prerelease identifiers compare
 * numerically and sort below alphanumeric ones). An unparseable version sorts
 * below every parseable one; two unparseable versions compare equal.
 * @param a - first version.
 * @param b - second version.
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa === undefined && pb === undefined) return 0
  if (pa === undefined) return -1
  if (pb === undefined) return 1
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0
  if (pa.prerelease.length === 0) return 1
  if (pb.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(pa.prerelease.length, pb.prerelease.length); index++) {
    const ra = pa.prerelease[index]
    const rb = pb.prerelease[index]
    if (ra === undefined) return -1
    if (rb === undefined) return 1
    if (ra === rb) continue
    const numericA = /^\d+$/.test(ra)
    const numericB = /^\d+$/.test(rb)
    if (numericA && numericB) return Number(ra) < Number(rb) ? -1 : 1
    // Numeric identifiers always sort below alphanumeric ones.
    if (numericA) return -1
    if (numericB) return 1
    return ra < rb ? -1 : 1
  }
  return 0
}

/** Read a package.json at a path, tolerating any parse/IO failure. */
function readManifest(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** The found dsh profile owning an installed package. */
export interface FoundProfile {
  /** Profile name (e.g. `web`). */
  name: string
  /** Absolute profile directory. */
  dir: string
}

/**
 * Locate the owning dsh profile by walking up from an installed package's
 * manifest until a manifest named `dsh-profile-*` appears (the profile
 * directory is the first ancestor whose package.json carries that name).
 * @param anchorManifestPath - absolute path of the anchor package.json.
 * @returns the profile name/dir, or undefined when not profile-installed.
 */
export function findProfile(anchorManifestPath: string): FoundProfile | undefined {
  let dir = dirname(anchorManifestPath)
  for (let depth = 0; depth < PROFILE_WALK_DEPTH; depth++) {
    const manifest = readManifest(join(dir, 'package.json'))
    const name = manifest?.name
    if (typeof name === 'string' && name.startsWith(PROFILE_NAME_PREFIX)) {
      return { name: name.slice(PROFILE_NAME_PREFIX.length), dir }
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/** A package version spec in a manifest dependencies map. */
type DependencySpec = string | { version: string } | undefined

/** Whether a dependency spec is a local link/file/dev-mode install. */
export function isLinkedSpec(spec: DependencySpec): boolean {
  if (typeof spec !== 'string') return false
  return /^(?:link|file):|^\.{1,2}(?:[/\\]|$)/.test(spec)
}

/** One package's current-vs-latest comparison. */
export interface UpdatePackageStatus {
  /** Package name. */
  name: string
  /** Locally installed version. */
  current: string
  /** Latest npm release — undefined when the registry probe failed. */
  latest?: string
  /** Whether npm carries a strictly newer release. */
  outdated: boolean
}

/** The full update-status snapshot served to the browser half. */
export interface UpdateStatus {
  /** npm = registry-managed (updatable); link = local dev install; missing = no anchor package. */
  mode: 'npm' | 'link' | 'missing'
  /** Owning profile name (npm mode). */
  profileName?: string
  /** The anchor package the update targets. */
  anchor?: string
  /** Per-package version comparison (anchor first). */
  packages: UpdatePackageStatus[]
  /** True when any package has a newer npm release. */
  outdated: boolean
  /** Whole-check failure (e.g. registry unreachable). */
  error?: string
}

/** Dependency-injection seam for checkUpdates (testable without network). */
export interface UpdateCheckDeps {
  /** Absolute path of the anchor package manifest, when resolvable. */
  anchorManifestPath?: string
  /** Resolve a package.json specifier to its absolute path (host require). */
  resolve(specifier: string): string | undefined
  /** Probe one package's latest npm version; undefined on failure. */
  fetchLatest(name: string): Promise<string | undefined>
}

/**
 * Resolve the anchor package's manifest path. The aggregate package is the
 * canonical entry point; this plugin's own package is the fallback.
 * @param resolve - a Node resolve implementation scoped to the host process.
 * @returns the absolute manifest path, or undefined when neither is installed.
 */
export function resolveAnchorManifest(
  resolve: (specifier: string) => string,
): string | undefined {
  for (const name of [AGGREGATE_PACKAGE, SELF_PACKAGE]) {
    try {
      return resolve(name + '/package.json')
    } catch {
      // Not installed — try the next candidate.
    }
  }
  return undefined
}

/** The resolved update target: the profile pnpm runs in plus the package list. */
export interface UpdateTarget {
  /** Owning profile name. */
  profileName: string
  /** Absolute profile directory pnpm runs in. */
  profileDir: string
  /** The package names pnpm updates (anchor first). */
  packages: string[]
}

/**
 * Resolve what an update would touch: the owning profile directory and the
 * family package list. Fails with an error code when the anchor is missing
 * ('not-found') or is a local dev install ('link').
 * @param deps - the anchor manifest path (resolveAnchorManifest output).
 * @returns the target, or the failure code.
 */
export function resolveUpdateTarget(
  deps: { anchorManifestPath?: string },
): UpdateTarget | { error: 'not-found' | 'link' } {
  const manifestPath = deps.anchorManifestPath
  if (manifestPath === undefined) return { error: 'not-found' }
  const manifest = readManifest(manifestPath)
  if (manifest === undefined) return { error: 'not-found' }
  const anchor = typeof manifest.name === 'string' ? manifest.name : undefined
  if (anchor === undefined) return { error: 'not-found' }
  const profile = findProfile(manifestPath)
  if (profile === undefined) return { error: 'link' }
  const profileManifest = readManifest(join(profile.dir, 'package.json'))
  const spec = (profileManifest?.dependencies as Record<string, DependencySpec> | undefined)?.[anchor]
  if (isLinkedSpec(spec)) return { error: 'link' }
  return {
    profileName: profile.name,
    profileDir: profile.dir,
    packages: [anchor, ...familyChildren(manifest)],
  }
}

/** Family children of the anchor: its dependencies under the family scope. */
export function familyChildren(anchorManifest: Record<string, unknown>): string[] {
  const dependencies = anchorManifest.dependencies
  if (typeof dependencies !== 'object' || dependencies === null) return []
  const names: string[] = []
  for (const [name, spec] of Object.entries(dependencies)) {
    if (name.startsWith(FAMILY_SCOPE) && typeof spec === 'string') names.push(name)
  }
  return names
}

/**
 * Probe the npm registry for one package's latest release.
 * @param name - the package name (scope slash URL-encoded).
 * @param fetchImpl - the fetch implementation (global fetch in the host).
 * @param timeoutMs - probe timeout.
 * @returns the latest version string, or undefined on any failure.
 */
export async function fetchLatestVersion(
  name: string,
  fetchImpl: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  timeoutMs = 10_000,
): Promise<string | undefined> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)
    try {
      const response = await fetchImpl(NPM_REGISTRY + '/' + name.replace('/', '%2F') + '/latest')
      if (!response.ok) return undefined
      const body = await response.json()
      if (typeof body !== 'object' || body === null) return undefined
      const version = (body as Record<string, unknown>).version
      return typeof version === 'string' ? version : undefined
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return undefined
  }
}

/** The resolved current version of one family package (probe failure tolerated). */
function readInstalledVersion(resolve: (specifier: string) => string | undefined, name: string): string {
  try {
    const path = resolve(name + '/package.json')
    const version = path === undefined ? undefined : readManifest(path)?.version
    return typeof version === 'string' ? version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Build the update status: locate the anchor, detect the install mode, and
 * compare every family package against the npm registry.
 * @param deps - manifest resolution + registry probe seams.
 * @returns the status snapshot.
 */
export async function checkUpdates(deps: UpdateCheckDeps): Promise<UpdateStatus> {
  const manifestPath = deps.anchorManifestPath
  if (manifestPath === undefined) {
    return { mode: 'missing', packages: [], outdated: false }
  }
  const manifest = readManifest(manifestPath)
  if (manifest === undefined) {
    return { mode: 'missing', packages: [], outdated: false }
  }
  const anchor = typeof manifest.name === 'string' ? manifest.name : undefined
  if (anchor === undefined) {
    return { mode: 'missing', packages: [], outdated: false }
  }
  // A package inside a dsh profile directory is a registry install; one that
  // lives outside every profile (e.g. a repo checkout wired through
  // link-profile.mjs) is a local dev install pnpm cannot update.
  const profile = findProfile(manifestPath)
  const profileManifest = profile === undefined ? undefined : readManifest(join(profile.dir, "package.json"))
  const linked = profile === undefined
    || isLinkedSpec((profileManifest?.dependencies as Record<string, DependencySpec> | undefined)?.[anchor])
  if (profile === undefined) {
    return { mode: 'link', packages: [], outdated: false }
  }
  const names = [anchor, ...familyChildren(manifest)]
  const packages: UpdatePackageStatus[] = []
  let probeFailures = 0
  for (const name of names) {
    const latest = await deps.fetchLatest(name)
    if (latest === undefined) probeFailures++
    const current = readInstalledVersion(deps.resolve, name)
    packages.push({
      name,
      current,
      latest,
      outdated: latest !== undefined && latest !== current && compareVersions(latest, current) > 0,
    })
  }
  // Registry unreachable: every probe failed — report the outage distinctly
  // instead of a misleading "all up to date" (the panel needs the reason).
  const error = probeFailures === names.length && names.length > 0 ? 'registry-unreachable' : undefined
  return {
    mode: linked ? 'link' : 'npm',
    profileName: profile.name,
    anchor,
    packages,
    outdated: packages.some(packageStatus => packageStatus.outdated),
    ...(error !== undefined ? { error } : {}),
  }
}

/** Structured failure codes the browser half translates. */
export type UpdateErrorCode =
  /** pnpm is not on PATH. */
  | 'pnpm-missing'
  /** The install exceeded the hard timeout. */
  | 'timeout'
  /** The anchor package is not installed. */
  | 'not-found'
  /** The anchor is a local link/dev install pnpm cannot update. */
  | 'link'
  /** pnpm exited non-zero. */
  | 'pnpm-failed'

/** Result of one update run. */
export interface UpdateRunResult {
  ok: boolean
  /** pnpm exit code (null when the process never started or was killed). */
  exitCode: number | null
  /** Captured pnpm output tail (diagnostics for the panel). */
  output: string
  /** Human-readable failure description (fallback copy). */
  error?: string
  /** Structured failure code (translated by the browser half). */
  errorCode?: UpdateErrorCode
}

/** Dependency-injection seam for runUpdate. */
export interface UpdateRunDeps {
  /** The profile directory pnpm runs in. */
  profileDir: string
  /** The package names pnpm updates. */
  packages: readonly string[]
  /** Spawn seam (defaults to child_process.spawn). */
  spawnImpl?: typeof spawn
  /** Hard timeout; the child is killed on expiry. */
  timeoutMs?: number
}

/** Cap on captured pnpm output (keeps error payloads bounded). */
const OUTPUT_CAP = 16 * 1024

/**
 * Run the update: `pnpm update <packages>` inside the profile directory.
 * @param deps - profile dir, package list, and spawn/timeout seams.
 * @returns the outcome with captured output.
 */
export function runUpdate(deps: UpdateRunDeps): Promise<UpdateRunResult> {
  return new Promise((resolve) => {
    const child = (deps.spawnImpl ?? spawn)('pnpm', ['update', ...deps.packages], {
      cwd: deps.profileDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const append = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (output.length > OUTPUT_CAP) output = output.slice(output.length - OUTPUT_CAP)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, exitCode: null, output, error: 'update timed out; install process killed', errorCode: 'timeout' })
    }, deps.timeoutMs ?? 10 * 60_000)
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      resolve({
        ok: false,
        exitCode: null,
        output,
        error: missing ? 'pnpm not found on PATH' : error.message,
        errorCode: missing ? 'pnpm-missing' : undefined,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        exitCode: code,
        output,
        error: code === 0 ? undefined : 'pnpm exited with code ' + String(code),
        ...(code === 0 ? {} : { errorCode: 'pnpm-failed' as const }),
      })
    })
  })
}
