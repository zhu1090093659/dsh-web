/**
 * Payload resolution and load-time integrity verification for the vendored
 * bash runtime.
 *
 * The package ships its own Git for Windows MinGit extraction under
 * runtime/win32-x64/: the tool must NEVER fall back to a bash found on PATH
 * (a host Git for Windows install, WSL, or a stray MSYS), because the whole
 * point of vendoring is a shell whose version and bytes are pinned. Three
 * invariants implement that:
 *
 * 1. the binary is addressed by absolute path, never by name,
 * 2. every vendored byte is checked against the SHA256 manifest generated at
 *    packaging time before it is used at all, and
 * 3. the tree that RUNS is a published copy under the DSH home, not the tree
 *    inside the package.
 *
 * The third invariant is why this module publishes a cache: Windows refuses to
 * rename a directory whose executable is running, and pnpm imports a package by
 * renaming a staging directory over it, so a shell spawned from inside
 * node_modules makes every later update or uninstall of this package fail with
 * ERR_PNPM_EPERM until the host stops. A persistent shell is this package's
 * whole point, so the payload moves out of the package instead of the process
 * moving out of the payload. The copy is content-addressed by the shipped
 * manifest: the directory name is a digest of the payload's file identities, so
 * a release that changes only JavaScript reuses the copy already published, and
 * a copy whose bytes or manifest disagree with the shipped identity is never
 * used.
 *
 * A mismatch refuses the mount with a specific message. The alternative —
 * mounting and hoping — would let a tampered or half-installed payload run
 * model-authored commands, which is the one outcome the manifest exists to
 * prevent.
 * @module @linxin666/dsh-win-bash/runtime
 */

import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from './dsh-home.ts'

/** Directory holding the shipped payload, relative to the package root. */
export const RUNTIME_DIR = 'runtime/win32-x64'

/** Manifest file name inside {@link RUNTIME_DIR}. */
export const CHECKSUM_FILE = 'checksums.sha256'

/** The one platform this payload supports. */
export const RUNTIME_PLATFORM = 'win32'

/** The one architecture this payload supports. */
export const RUNTIME_ARCH = 'x64'

/**
 * Payload cache directories under the DSH home, in order.
 *
 * The cache lives OUTSIDE the package on purpose: a running shell holds its own
 * executable open, Windows refuses to rename a directory that holds a running
 * executable, and pnpm imports a package by renaming over it. A copy here is
 * also why a release that only changes JavaScript never has to move 16 MiB.
 */
export const CACHE_DIR_PARTS = ['win-bash', 'runtime'] as const

/**
 * Name prefix of the staging directory one cache copy is built in. The rest of
 * the name is the payload key, this process's id and a random suffix, so a
 * half-written directory is never mistaken for a published payload.
 */
export const CACHE_STAGING_PREFIX = '.staging-'

/** Absolute package root (the directory holding package.json). */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Absolute payload root inside one package root. */
export function runtimeRoot(packageRoot: string = PACKAGE_ROOT): string {
  return join(packageRoot, RUNTIME_DIR)
}

/** Absolute path of the vendored shell inside one payload root. */
export function bashIn(root: string): string {
  return join(root, 'usr', 'bin', 'bash.exe')
}

/** Absolute path of the vendored POSIX-shell alias inside one payload root. */
export function shIn(root: string): string {
  return join(root, 'usr', 'bin', 'sh.exe')
}

/** Absolute path of one payload root's usr/bin directory. */
export function binIn(root: string): string {
  return join(root, 'usr', 'bin')
}

/** Absolute path of the packaged payload's shell. */
export function bashPath(packageRoot: string = PACKAGE_ROOT): string {
  return bashIn(runtimeRoot(packageRoot))
}

/** Absolute path of the packaged payload's POSIX-shell alias. */
export function shPath(packageRoot: string = PACKAGE_ROOT): string {
  return shIn(runtimeRoot(packageRoot))
}

/** Absolute path of the packaged payload's usr/bin directory. */
export function binDir(packageRoot: string = PACKAGE_ROOT): string {
  return binIn(runtimeRoot(packageRoot))
}

/**
 * Absolute root of the per-user payload cache.
 *
 * It follows the DSH home rather than the package, so an isolated
 * `DSH_HOME` (a probe instance, a test run) gets its own cache, and an update or
 * uninstall of this package never touches a byte the cache holds.
 * @param env - environment to read DSH_HOME from; the live one by default.
 * @returns the directory payload copies are published under.
 */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), ...CACHE_DIR_PARTS)
}

/** One manifest row: a payload-relative path and its digest. */
export interface ChecksumEntry {
  /** Payload-relative path, using forward slashes. */
  readonly path: string
  /** Lowercase hex SHA256 of the file's bytes. */
  readonly sha256: string
}

/**
 * Parse a sha256sum-style manifest: '<64 hex>  <path>' per line. Blank lines
 * and '#' comments are skipped, so the file stays a valid 'sha256sum -c'
 * input while carrying a human-readable header.
 * @param text - the manifest's contents.
 * @returns parsed entries in file order.
 * @throws when a non-comment line does not match the two-column shape.
 */
export function parseChecksums(text: string): ChecksumEntry[] {
  const entries: ChecksumEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([0-9a-f]{64})\s+(\S.*)$/.exec(line)
    if (match === null) throw new Error('malformed checksum line: ' + line)
    entries.push({ sha256: match[1], path: match[2] })
  }
  return entries
}

/** One payload file whose bytes did not match the manifest. */
export interface ChecksumMismatch {
  /** Payload-relative path. */
  readonly path: string
  /** What the manifest records. */
  readonly expected: string
  /** What is on disk, or 'missing' when the file is absent. */
  readonly actual: string
}

/** Outcome of a full payload verification pass. */
export interface ChecksumReport {
  /** Registered payload files that hashed correctly. */
  readonly verified: number
  /** Every file whose bytes or presence disagreed with the manifest. */
  readonly mismatches: readonly ChecksumMismatch[]
}

/** SHA256 of a buffer or string, lowercase hex. */
export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The content key of one payload: a digest over its manifest's file identities.
 *
 * Manifest formatting and row order do not move it, and any change to a
 * payload file does. That is what makes a cache directory name a statement
 * about the bytes inside it rather than about the release that shipped them.
 * @param entries - the parsed manifest rows.
 * @returns the 16-character key that names the cache directory.
 */
export function payloadKey(entries: readonly ChecksumEntry[]): string {
  return sha256(entries.map(entry => entry.path + ' ' + entry.sha256).sort().join('\n')).slice(0, 16)
}

/**
 * Verify every registered payload file against the shipped manifest.
 *
 * Reads and hashes the whole payload (about 16 MiB after the curated
 * extraction), which is why callers do it once at mount time rather than per
 * command.
 * @param packageRoot - package root holding runtime/win32-x64.
 * @returns the count of verified files and every mismatch found.
 * @throws when the manifest itself is unreadable or malformed.
 */
export function verifyPayload(packageRoot: string = PACKAGE_ROOT): ChecksumReport {
  return verifyPayloadRoot(runtimeRoot(packageRoot))
}

/**
 * Verify every payload file of one payload root against that root's manifest.
 *
 * The root is the directory holding `usr/` and `checksums.sha256`, which is
 * either the packaged payload or a published cache copy, so both go through the
 * same pass.
 * @param root - the payload root to verify.
 * @returns the count of verified files and every mismatch found.
 * @throws when the manifest itself is unreadable or malformed.
 */
export function verifyPayloadRoot(root: string): ChecksumReport {
  const manifest = parseChecksums(readFileSync(join(root, CHECKSUM_FILE), 'utf8'))
  const mismatches: ChecksumMismatch[] = []
  let verified = 0
  for (const entry of manifest) {
    const file = join(root, ...entry.path.split('/'))
    let actual: string
    try {
      // A directory named like a manifest row must read as a mismatch, not
      // crash the mount: statSync rejects directories before any read.
      if (!statSync(file).isFile()) throw new Error('not a regular file')
      actual = sha256(readFileSync(file))
    } catch {
      actual = 'missing'
    }
    if (actual === entry.sha256) verified += 1
    else mismatches.push({ path: entry.path, expected: entry.sha256, actual })
  }
  return { verified, mismatches }
}

/** Why this deployment cannot serve the vendored shell. */
export interface RuntimeRejection {
  /** Machine-readable reason. */
  readonly code:
    | 'unsupported-platform'
    | 'unsupported-arch'
    | 'missing-binary'
    | 'checksum-mismatch'
    | 'manifest-unreadable'
  /** One-sentence, operator-facing explanation. */
  readonly message: string
}

/** Successful payload resolution. */
export interface RuntimeReady {
  /** Absolute path of the vendored bash.exe that will be spawned. */
  readonly bash: string
  /** Absolute path of the payload's usr/bin. */
  readonly bin: string
  /** Absolute payload root both paths above live in. */
  readonly payloadRoot: string
  /** Whether that root is the published cache copy or the packaged tree. */
  readonly source: 'cache' | 'package'
}

/** Whether the running host can serve this payload at all. */
export interface HostPlatform {
  /** process.platform. */
  readonly platform: string
  /** process.arch. */
  readonly arch: string
}

/**
 * Refuse a host that cannot run this payload at all.
 * @param host - the running host's platform facts.
 * @returns the rejection, or undefined when the host could serve the payload.
 */
function rejectHost(host: HostPlatform): RuntimeRejection | undefined {
  if (host.platform !== RUNTIME_PLATFORM) {
    return {
      code: 'unsupported-platform',
      message:
        'win_bash requires Windows: the vendored payload is a Git for Windows MinGit build for '
        + RUNTIME_PLATFORM
        + ' and there is no PATH fallback.',
    }
  }
  if (host.arch !== RUNTIME_ARCH) {
    return {
      code: 'unsupported-arch',
      message: 'win_bash currently ships only the ' + RUNTIME_ARCH + ' payload; this host is ' + host.arch + '.',
    }
  }
  return undefined
}

/** The three paths one payload root provides, tagged with where it came from. */
function readyFrom(root: string, source: RuntimeReady['source']): RuntimeReady {
  return { bash: bashIn(root), bin: binIn(root), payloadRoot: root, source }
}

/**
 * Resolve the PACKAGED shell for one host, or refuse the mount.
 *
 * The order is deliberate: platform, then architecture, then presence, then
 * integrity. A checksum failure names the first mismatching path so an
 * operator can act on it, and no path here ever consults PATH.
 *
 * This is the packaged tree, not the cache: callers that intend to RUN the
 * shell want {@link prepareRuntime}, which publishes a copy first.
 * @param host - the running host's platform facts.
 * @param packageRoot - package root holding the payload.
 * @returns the resolved shell paths, or the rejection reason.
 */
export function resolveRuntime(
  host: HostPlatform,
  packageRoot: string = PACKAGE_ROOT,
): RuntimeReady | RuntimeRejection {
  const refused = rejectHost(host)
  if (refused !== undefined) return refused
  const bash = bashPath(packageRoot)
  try {
    if (!statSync(bash).isFile()) throw new Error('not a file')
  } catch {
    return {
      code: 'missing-binary',
      message: 'the vendored payload is incomplete: ' + bash + ' is missing.',
    }
  }
  let report: ChecksumReport
  try {
    report = verifyPayload(packageRoot)
  } catch (error) {
    return {
      code: 'manifest-unreadable',
      message:
        'the payload checksum manifest could not be read: '
        + (error instanceof Error ? error.message : String(error)),
    }
  }
  if (report.mismatches.length > 0) {
    const first = report.mismatches[0]
    return {
      code: 'checksum-mismatch',
      message:
        'the vendored payload failed its SHA256 manifest: '
        + report.mismatches.length.toString()
        + ' file(s) differ, first '
        + first.path
        + ' (expected '
        + first.expected.slice(0, 12)
        + ', found '
        + first.actual.slice(0, 12)
        + '). Reinstall the package; win_bash will not run an unverified payload.',
    }
  }
  return readyFrom(runtimeRoot(packageRoot), 'package')
}

/** One tree copy: the source payload root, the directory to fill. */
export type CopyTree = (source: string, target: string) => void

/** Where payload publication can be redirected, and what it reports. */
export interface PrepareRuntimeOptions {
  /** The running host's platform facts; this process's by default. */
  readonly host?: HostPlatform
  /** Package root holding runtime/win32-x64; this package's own by default. */
  readonly packageRoot?: string
  /** Cache root to publish into; the DSH home's own by default. */
  readonly cacheRoot?: string
  /** Environment the default cache root resolves from; process.env by default. */
  readonly env?: NodeJS.ProcessEnv
  /** Operator-facing notes; a copy that could not be published is reported here. */
  readonly warn?: (message: string) => void
  /** The copy itself; a real recursive copy by default. */
  readonly copy?: CopyTree
}

/** The recursive copy one published payload is built with. */
function copyTree(source: string, target: string): void {
  cpSync(source, target, { recursive: true, force: true, preserveTimestamps: true })
}

/** One error's message, for an operator-facing line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Delete a staging directory, never letting a failed reclaim escape. */
function removeStaging(staging: string): void {
  try {
    rmSync(staging, { recursive: true, force: true })
  } catch {
    // An unreclaimed staging directory is inert: its name is not a payload key,
    // so no mount can mistake it for a published copy.
  }
}

/**
 * Whether one directory is a complete copy of the payload the key names.
 *
 * The copy's own manifest must reproduce the expected key before any byte is
 * executed, so a directory whose manifest was rewritten alongside its files is
 * a miss rather than a match.
 * @param root - the candidate payload root.
 * @param key - the key the shipped manifest produced.
 * @returns whether that directory can be spawned from.
 */
function cacheReady(root: string, key: string): boolean {
  try {
    if (payloadKey(parseChecksums(readFileSync(join(root, CHECKSUM_FILE), 'utf8'))) !== key) return false
    if (!statSync(bashIn(root)).isFile()) return false
    const report = verifyPayloadRoot(root)
    return report.verified > 0 && report.mismatches.length === 0
  } catch {
    return false
  }
}

/**
 * Publish one payload copy under its key.
 *
 * The copy is built in a staging directory beside the target and renamed into
 * place, so the published name only ever refers to a complete tree. A rename
 * that loses a race against another host publishing the same key is not a
 * failure: both hosts copy the same bytes by construction.
 * @param source - the packaged payload root to copy.
 * @param target - the cache directory the key names.
 * @param key - the payload key, carried into the staging name.
 * @param copy - the copy itself.
 */
function publishPayload(source: string, target: string, key: string, copy: CopyTree): void {
  mkdirSync(dirname(target), { recursive: true })
  // A directory already sitting at the key has failed its verification (the
  // caller only publishes on a miss), so it is unusable and has to go before a
  // rename can land. A copy a live shell still holds open refuses the delete on
  // Windows, and that refusal reaches the caller as an honest fallback.
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  const staging = join(
    dirname(target),
    CACHE_STAGING_PREFIX + key + '-' + process.pid.toString() + '-' + randomUUID().slice(0, 8),
  )
  try {
    copy(source, staging)
    renameSync(staging, target)
  } catch (error) {
    removeStaging(staging)
    if (cacheReady(target, key)) return
    throw error
  }
}

/**
 * Resolve the shell one host runs, publishing the payload outside the package.
 *
 * The verification order is the whole point: the shipped manifest identifies
 * the payload, a published copy of that identity is reused when it verifies,
 * and otherwise the packaged tree is verified first and only then copied. What
 * gets spawned is therefore always a tree whose bytes match the shipped
 * manifest, and it lives under the DSH home where an update or uninstall of
 * this package cannot be blocked by a running shell.
 *
 * A cache that cannot be written is not a reason to withhold the tool: the
 * verified packaged tree runs instead and the caller is told, through
 * {@link PrepareRuntimeOptions.warn}, that updates will need this host stopped.
 * A payload that fails its manifest is still a refusal — running unverified
 * bytes is the outcome the manifest exists to prevent, cache or no cache.
 * @param options - host facts, roots, and the seams tests drive.
 * @returns the shell paths to run, or the rejection reason.
 */
export function prepareRuntime(options: PrepareRuntimeOptions = {}): RuntimeReady | RuntimeRejection {
  const host = options.host ?? { platform: process.platform, arch: process.arch }
  const refused = rejectHost(host)
  if (refused !== undefined) return refused
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT
  const source = runtimeRoot(packageRoot)
  const cacheDir = options.cacheRoot ?? cacheRoot(options.env)
  const warn = options.warn ?? ((): void => {})

  let key: string
  try {
    key = payloadKey(parseChecksums(readFileSync(join(source, CHECKSUM_FILE), 'utf8')))
  } catch (error) {
    return {
      code: 'manifest-unreadable',
      message: 'the payload checksum manifest could not be read: ' + describe(error),
    }
  }

  const published = join(cacheDir, key)
  if (cacheReady(published, key)) return readyFrom(published, 'cache')

  const shipped = resolveRuntime(host, packageRoot)
  if ('code' in shipped) return shipped

  try {
    publishPayload(source, published, key, options.copy ?? copyTree)
  } catch (error) {
    warn('the verified payload could not be published to ' + published + ' (' + describe(error)
      + '), so this host runs the shell from ' + source + '; while it runs, updating or uninstalling'
      + ' this package can fail with ERR_PNPM_EPERM')
    return shipped
  }
  if (!cacheReady(published, key)) {
    warn('the payload copy at ' + published + ' did not verify against the shipped manifest, so this host'
      + ' runs the shell from ' + source + '; while it runs, updating or uninstalling this package can fail'
      + ' with ERR_PNPM_EPERM')
    return shipped
  }
  return readyFrom(published, 'cache')
}
