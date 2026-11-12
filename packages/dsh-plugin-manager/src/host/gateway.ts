/**
 * The CLI gateway: installs and removals executed by spawning the official
 * `dsh plugin --profile <name> add|remove` CLI — the single writer for the
 * profile — with a bounded job table the HTTP layer polls. Every run captures
 * a layer snapshot before and after so the caller can render exactly what the
 * CLI changed (the conflict ledger). The npm web runtime has no installer
 * service, so this gateway is its write path; on runtimes with official
 * channels the browser half never calls it.
 *
 * One exception: an application-owned profile (a packaged Desktop launch)
 * cannot be written by the CLI at all — the official launcher refuses it — so
 * installs, updates and removals there run through the official in-process
 * plugin manager instead (see {@link NativePluginManager}).
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, posix, win32 } from 'node:path'
import type { InstalledPluginItem } from '../core/protocol.ts'
import type { ControlChange } from '../core/conflict.ts'
import { diffLayer, overlappingIds, significantChanges, type LayerChange, type LayerSnapshot } from '../core/patch-diff.ts'
import { declaresBundle, duplicateMountBundles } from './bundle-guard.ts'
import { readProfileManifest, reorderProfileBundle, stripProfileBundles, type ProfileFacts } from './profile.ts'
import { declaredRowIds, insertRowsOf, parsePatch, bareRowEnabled, bareRowId, pruneOrphanRowOverrides, repairStaleRowNames, writePatchAtomic, type PrunedOverrides, type RepairedRowNames } from './rows.ts'
import { buildPluginRow, claimedEntryIdsOf } from './state.ts'
import { createOutputCapture, type OutputCapture } from './console-output.ts'

/** Hard deadline for one CLI add (git clones can take minutes). */
const ADD_TIMEOUT_MS = 6 * 60_000
/** Hard deadline for one CLI remove. */
const REMOVE_TIMEOUT_MS = 2 * 60_000
/** Bounded capture of the CLI output (the tail survives), counted in bytes. */
const MAX_OUTPUT_BYTES = 32_000
/** Ring cap on finished jobs: the newest 100 settled jobs stay queryable; the oldest finished job is evicted beyond the cap so the job table cannot grow without bound. In-progress jobs are never evicted. */
const MAX_FINISHED_JOBS = 100

/**
 * Shell command-chaining metacharacters that must never reach a spawned CLI
 * argument. The gateway spawns shell-free, but the official CLI forwards to
 * pnpm with a cmd.exe shell on Windows, so a spec carrying these can still be
 * re-parsed one layer down (a failed install reported as success, or worse).
 */
const UNSAFE_SPEC_CHARS = /[&|<>"'`%!\n\r\0]/

/**
 * Validate an install spec or package id against shell metacharacters.
 * @param spec - the user-supplied spec or id.
 * @returns the rejection message, or undefined when the spec is safe.
 */
export function unsafeSpecReason(spec: string): string | undefined {
  return UNSAFE_SPEC_CHARS.test(spec)
    ? 'plugin-manager: spec 含有危险的 shell 元字符或控制字符，已拒绝'
    : undefined
}

/**
 * The pnpm diagnostic for a dependency whose build script it skipped, as it
 * appears in the CLI's captured output:
 *
 *     [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cpu-features@0.0.10
 *
 * The code is bracketed and the package list is comma separated, so the bracket
 * is part of the match, and it stops at the end of that line, so the \r a
 * Windows console writes before the newline neither hides nor extends it.
 */
const IGNORED_BUILDS_PATTERN = /\[ERR_PNPM_IGNORED_BUILDS\][ \t]*Ignored build scripts:[^\n\r]*/

/**
 * Whether one CLI run's captured output carries the skipped-build-script
 * condition.
 *
 * `dsh plugin` forwards to pnpm, so a non-zero exit is pnpm's own verdict —
 * except this one, which pnpm prints *after* it has written the profile: a
 * dependency that declares a build script is not built until it is approved, and
 * the unapproved one fails the command while the package is already on disk and
 * the profile already carries it. Measured 2026-10-31 against the CLI's bundled
 * pnpm 11.9.0 and against pnpm 11.24.0: `dsh plugin --profile web add
 * cpu-features` exits 1 with its dependency landed, and the family aggregate
 * exits the same way naming cloudflared, cpu-features and ssh2.
 *
 * The condition is necessary and not sufficient: only the profile can say
 * whether the change the caller asked for really landed. The job runner reads it
 * and keeps the exit a failure when it did not.
 * @param output - the captured stdout and stderr of one CLI run.
 * @returns true when pnpm named the build scripts it skipped.
 */
export function reportsIgnoredBuilds(output: string): boolean {
  return IGNORED_BUILDS_PATTERN.test(output)
}

/** One row of a batch update, as this gateway holds it. */
export interface GatewayUpdateOutcome {
  /** Package name this row applies. */
  id: string
  /** The exact version the route resolved for this row; absent when it was refused up front. */
  targetVersion?: string
  /** What has happened to this row so far. */
  phase: 'pending' | 'running' | 'done' | 'error'
  /** The version that landed, present on a `done` row. */
  landed?: string
  /** Why this row could not be applied, present on an `error` row. */
  error?: string
  /** Whether the landed version is on disk but not loaded in this process. */
  restartRequired?: boolean
}

/**
 * One row a batch update was asked to apply: a target the route resolved, or the
 * refusal it produced instead. Refused rows are answers the run must not retry —
 * already at the newest version, not a direct registry plugin, a DSH minimum this
 * host does not satisfy — and carrying them in the same list means the caller
 * reads one ledger for the whole batch.
 */
export type GatewayUpdateEntry =
  | { kind: 'apply', id: string, version: string }
  | { kind: 'migrate', id: string, targetId: string, targetVersion: string, targetSpec: string }
  | { kind: 'refused', id: string, error: string }

/** One CLI-backed operation in flight or settled. */
export interface GatewayJob {
  id: string
  action: 'install' | 'update' | 'update-all' | 'migrate' | 'remove'
  spec: string
  /** Installed package ID for an in-place npm update. */
  targetId?: string
  /** Exact registry version the update must land on. */
  targetVersion?: string
  /** Legacy package being migrated away from. */
  sourceId?: string
  /** Exact install spec for the target package. */
  targetSpec?: string
  phase: 'running' | 'done' | 'error'
  /** The installed row on success (install) or the removed row (remove). */
  plugin?: InstalledPluginItem
  /** Layer changes the CLI applied, normalized for the conflict panel. */
  conflicts?: ControlChange[]
  /**
   * Duplicate-mount safeguard notices: bundles entries the CLI's
   * reconciliation added but the composition already mounted through a patch
   * row, stripped back out so the next boot cannot double-mount. Each notice
   * carries the conflict-row shape (the entry left the bundles layer:
   * enabled -> uninstalled) so the tab can render it with the existing rows;
   * the package itself stays installed and row-mounted.
   */
  notices?: ControlChange[]
  /**
   * Bundles whose new version is on disk but not loaded in this process: the
   * official manager answered `application: 'restart-required'` for the run
   * that applied it, so the plugin is installed and its rows are gone until the
   * host restarts (issue #1905). Absent on an update that took effect in place.
   * The job is still `done` either way — the version landed — and this fact
   * rides the same job wire as `plugin`, so the caller can say so instead of
   * reporting a clean in-place update.
   */
  restartRequired?: string[]
  /**
   * The rows a batch update (`update-all`) works through, in the order it was
   * asked to apply them: the version the route resolved for each plugin, the
   * phase it is in, and the reason it could not be applied. The batch job itself
   * settles `done` once the last row is answered — the rows carry the failures,
   * because one plugin that cannot move must not throw away the ones behind it.
   */
  results?: GatewayUpdateOutcome[]
  /** The batch row in flight, present only while a batch job runs. */
  current?: string
  /**
   * Conditions a settled run reported while still carrying its change out:
   * pnpm's own words about a non-zero exit the gateway accepted because the
   * profile really moved ({@link reportsIgnoredBuilds}). The job is `done` —
   * the packages are installed — and this rides the same optional string-list
   * fact channel as {@link GatewayJob.restartRequired}, because the `notices`
   * ledger records row-state moves in the conflict-row shape and a build-script
   * diagnostic is neither a row nor a state.
   */
  warnings?: string[]
  error?: string
}

/**
 * The Electron resource roots a packaged Desktop install may carry, as
 * absolute directories. Two independent launcher facts name them, and either
 * alone is enough:
 *
 * - `process.resourcesPath` is Electron's own answer for the directory holding
 *   `app.asar` and the bundled runtime (the Desktop host runs as an Electron
 *   Node-mode child, so it always has one);
 * - the running host entry script sits INSIDE that tree
 *   (`<resources>/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js`),
 *   so the first ancestor directory named `resources` is the same location even
 *   when the process is not Electron.
 *
 * A root is only ever used to build a candidate path that must then exist, so
 * an unrelated `resources` directory elsewhere in the tree resolves to nothing.
 * @param hostEntryPath - the running host's entry script.
 * @param resourcesPath - Electron's resource directory, when the host has one.
 * @param pathApi - platform path semantics.
 * @returns candidate resource roots, in probe order.
 */
function desktopResourceRoots(
  hostEntryPath: string | undefined,
  resourcesPath: string | undefined,
  pathApi: typeof win32,
): string[] {
  const roots: string[] = []
  if (resourcesPath !== undefined && resourcesPath !== '') roots.push(resourcesPath)
  if (hostEntryPath !== undefined && hostEntryPath !== '') {
    let current = pathApi.dirname(hostEntryPath)
    for (let depth = 0; depth < 12; depth += 1) {
      const parent = pathApi.dirname(current)
      if (parent === current) break
      current = parent
      // macOS spells the directory `Resources`; the match is case-insensitive
      // because a false positive only ever yields a candidate that must exist.
      if (pathApi.basename(current).toLowerCase() === 'resources') {
        roots.push(current)
        break
      }
    }
  }
  return roots
}

/**
 * Electron's resource directory when this process is an Electron child, read
 * defensively: the type is not in `@types/node`, and a plain Node host has no
 * such property at all.
 */
function processResourcesPath(): string | undefined {
  const value = (process as unknown as { resourcesPath?: unknown }).resourcesPath
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The binary search roots for the dsh CLI. */
export function findDshBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  exists: (path: string) => boolean = existsSync,
  hostEntryPath: string | undefined = process.argv[1],
  resourcesPath: string | undefined = processResourcesPath(),
): string | null {
  const candidates: string[] = []
  const separator = platform === 'win32' ? ';' : ':'
  const pathApi = platform === 'win32' ? win32 : posix
  for (const dir of (env.PATH ?? '').split(separator)) {
    if (dir === '') continue
    if (platform === 'win32') {
      candidates.push(`${dir}\\dsh.cmd`, `${dir}\\dsh.exe`)
    } else {
      candidates.push(`${dir}/dsh`)
    }
  }
  // A local wrapper or npx launch may omit its node_modules/.bin directory
  // from PATH. Walk up from the actual host entry script and probe each npm
  // project root without guessing from the DSH_HOME profile location.
  if (hostEntryPath !== undefined && hostEntryPath !== '') {
    let current = pathApi.dirname(hostEntryPath)
    for (let depth = 0; depth < 10; depth += 1) {
      const binDir = pathApi.join(current, 'node_modules', '.bin')
      if (platform === 'win32') candidates.push(pathApi.join(binDir, 'dsh.cmd'), pathApi.join(binDir, 'dsh.exe'))
      else candidates.push(pathApi.join(binDir, 'dsh'))
      const parent = pathApi.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  if (platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/dsh', '/usr/local/bin/dsh')
  }
  // Packages and the desktop app put the CLI in reach of their own files, not
  // on PATH, so also probe the siblings of the running host's entry script:
  //   <runtime>/node_modules/@deepseek-ai/dsh/lib/bin.js
  //   <runtime>/node_modules/@deepseek-ai/dsh/lib/../../.bin/dsh.cmd
  // The npm-published desktop runtime strips every node_modules/.bin directory
  // (symlinked shims cannot survive an installer), so the package's own lib/bin.js
  // is the only launchable form there (issue #1588).
  if (hostEntryPath !== undefined && hostEntryPath !== '') {
    const entryDir = pathApi.dirname(hostEntryPath)
    const packageRoot = pathApi.dirname(entryDir)
    candidates.push(pathApi.join(packageRoot, 'lib', 'bin.js'))
  }
  // The packaged Desktop installer puts the CLI nowhere near the running host:
  // the private host package ships only lib/index.js and lib/cli.js (no
  // lib/bin.js), every node_modules/.bin directory is stripped, and the CLI
  // launcher lives in a sibling resource tree
  // (<resources>/runtime/cli/bin/dsh.cmd on Windows, .../dsh elsewhere) that
  // the launcher never adds to the host's PATH — it prepends only
  // <resources>/runtime/bin, which carries node alone. Without this candidate
  // the packaged Desktop has no CLI at all, and every version probe and
  // CLI-backed write fails closed (#1819, following #1588).
  for (const root of desktopResourceRoots(hostEntryPath, resourcesPath, pathApi)) {
    const cliBin = pathApi.join(root, 'runtime', 'cli', 'bin')
    if (platform === 'win32') {
      candidates.push(pathApi.join(cliBin, 'dsh.cmd'), pathApi.join(cliBin, 'dsh.exe'))
    } else {
      candidates.push(pathApi.join(cliBin, 'dsh'))
    }
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

/** Ancestor directories {@link hostBundleDir} probes for an installation copy. */
const HOST_PROBE_DEPTH = 16

/**
 * Resolve one path through its symlinks, or undefined when it cannot be read.
 * @param path - the path to resolve.
 * @returns the real path, or undefined.
 */
function realpathOf(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * The installation copy of one bundle package, when the DSH installation this
 * runtime runs out of carries it.
 *
 * A CLI-created profile names the official bundles in `dsh.profile.bundles`
 * without ever installing them: `@deepseek-ai/dsh-base` and
 * `@deepseek-ai/dsh-web-app` are mounted from the DSH installation the loader
 * runs out of, so no profile copy exists and their rows are declared by the
 * installation's own package. That copy is the one whose rows mount, so a
 * missing profile copy is not proof of an unknown declaration set (see
 * {@link CliGateway.liveOverrideIds}).
 *
 * Resolution follows Node's own lookup from the CLI entry: every ancestor
 * directory contributes `node_modules/<name>`, plus the npm-global and
 * homebrew `<ancestor>/lib/node_modules/<name>`. The entry is resolved through
 * its symlinks first, because npm-global and homebrew install the `dsh` shim
 * as a link into the package tree while the shim's own directory carries no
 * packages.
 * @param binary - the resolved dsh CLI path, or null when this runtime has none.
 * @param name - the bundle package name from `dsh.profile.bundles`.
 * @param exists - existence probe (test seam).
 * @param resolveReal - symlink resolver (test seam).
 * @returns the installation package directory, or undefined when it has none.
 */
export function hostBundleDir(
  binary: string | null,
  name: string,
  exists: (path: string) => boolean = existsSync,
  resolveReal: (path: string) => string | undefined = realpathOf,
): string | undefined {
  if (binary === null || binary === '') return undefined
  const segments = name.split('/')
  let current = dirname(resolveReal(binary) ?? binary)
  for (let depth = 0; depth < HOST_PROBE_DEPTH; depth += 1) {
    for (const modules of [join(current, 'node_modules'), join(current, 'lib', 'node_modules')]) {
      const dir = join(modules, ...segments)
      if (exists(join(dir, 'package.json'))) return dir
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

/**
 * Append bounded CLI output (stdout + stderr interleaved is not preserved;
 * tail wins). Bytes are accumulated and decoded once at read time: a Windows
 * console writes its OEM code page (CP936/GBK on zh-CN), so per-chunk
 * `toString()` both mis-decodes the encoding and splits characters that
 * straddle two reads into replacement characters (issue #1600).
 */
function capture(chunk: Buffer, buffer: OutputCapture): void {
  buffer.push(chunk)
}

/** Bytes read for the shebang probe (a Node script names its interpreter on line 1). */
const SHEBANG_PROBE_BYTES = 256

/**
 * Read a file's leading bytes for the shebang probe. Every failure — a missing
 * file, a directory, a permission error, an unreadable asar entry — reads as
 * "no head", so the caller falls back to spawning the path directly.
 * @param path - file to probe.
 * @returns the leading text, or undefined.
 */
export function readFileHead(path: string): string | undefined {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(SHEBANG_PROBE_BYTES)
    const read = readSync(fd, buffer, 0, SHEBANG_PROBE_BYTES, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // Already closed or never opened: nothing to release.
      }
    }
  }
}

/**
 * Whether a resolved CLI path is a Node script: a `.js` module, or a file whose
 * shebang names node. A Node script cannot be spawned as an executable on its
 * own: the kernel hands the shebang to the interpreter it names, and
 * `#!/usr/bin/env node` resolves node through PATH — which a GUI-launched host
 * (the packaged Desktop app) does not carry, so the child dies before the CLI
 * starts with `env: node: No such file or directory` (exit 127).
 * @param path - the resolved CLI path.
 * @param readHead - head probe (test seam).
 * @returns true when the path needs a Node interpreter.
 */
export function isNodeScript(path: string, readHead: (path: string) => string | undefined = readFileHead): boolean {
  if (/\.(?:c|m)?js$/i.test(path)) return true
  const head = readHead(path)
  if (head === undefined) return false
  const firstLine = head.split('\n', 1)[0] ?? ''
  return /^#!.*\bnode\b/.test(firstLine)
}

/**
 * The spawn command for the dsh CLI on this platform. A Node script (the
 * npm/homebrew `dsh` shim, a `.bin` symlink, a packaged `lib/bin.js`) is run
 * by an interpreter that exists regardless of PATH: a `node` sitting beside the
 * CLI when the installation ships one (npm-global and homebrew layouts), else
 * the host's own interpreter — `process.execPath`, which the ELECTRON_RUN_AS_NODE
 * branch in {@link spawnDsh} covers for an Electron host. Windows additionally
 * resolves the npm-generated shim into node plus bin.js and spawns them
 * directly: going through cmd.exe splits unquoted paths with spaces
 * (`'D:\Program' is not recognized`).
 * @param binary - the dsh CLI path found by {@link findDshBinary}.
 * @param platform - process platform (test seam).
 * @param localNodeExists - existence probe (test seam).
 * @param binJsExists - existence probe for the resolved bin script (test seam).
 * @param readHead - shebang probe (test seam).
 * @returns the executable and the argument prefix to run the dsh bin script.
 */
export function dshSpawnCommand(
  binary: string,
  platform: string = process.platform,
  localNodeExists: (path: string) => boolean = existsSync,
  binJsExists: (path: string) => boolean = existsSync,
  readHead: (path: string) => string | undefined = readFileHead,
): { command: string; argsPrefix: string[] } {
  if (platform !== 'win32') {
    // A native executable (or a shell wrapper naming its own interpreter)
    // spawns as-is; only a Node script needs the interpreter resolved here.
    if (!isNodeScript(binary, readHead)) return { command: binary, argsPrefix: [] }
    const sibling = posix.join(posix.dirname(binary), 'node')
    return { command: localNodeExists(sibling) ? sibling : process.execPath, argsPrefix: [binary] }
  }
  // Windows paths must be parsed with win32 semantics even when the probing
  // host is POSIX (unit tests, and any future cross-platform probing).
  const dir = win32.dirname(binary)
  const localNode = win32.join(dir, 'node.exe')
  // A script path has no launcher on Windows, so the resolved lib/bin.js is run
  // by the host's own interpreter: the desktop host is spawned as
  // <runtime>/node/node.exe, so process.execPath is the bundled Node (and an
  // Electron host is covered by the ELECTRON_RUN_AS_NODE branch in spawnDsh).
  if (win32.basename(binary).toLowerCase() === 'bin.js') {
    return { command: process.execPath, argsPrefix: [binary] }
  }
  // The npm-global layout keeps the package next to the dsh.cmd shim
  // (node_modules/@deepseek-ai/dsh); the npx layout puts shims in
  // node_modules/.bin with the package one level above (issue #683). Probe
  // both and fall back to the npm-global shape when neither exists yet.
  const binJsCandidates = [
    win32.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    win32.join(dir, '..', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  const binJs = binJsCandidates.find((candidate) => binJsExists(candidate))
  if (binJs === undefined) return { command: binary, argsPrefix: [] }
  return { command: localNodeExists(localNode) ? localNode : process.execPath, argsPrefix: [binJs] }
}

/** The Windows directory used when the environment names no system root at all. */
const WINDOWS_ROOT_FALLBACK = 'C:\\Windows'

/**
 * Read one environment variable by name, case-insensitively, ignoring blank
 * values. Windows spells the same variable `ComSpec` and `comspec` depending on
 * who wrote it (a launcher, a service, the user's own shell), and a plain
 * object seam carries whatever spelling the caller built.
 * @param env - the environment to read.
 * @param name - the variable name, matched without regard to case.
 * @returns the first non-blank value, or undefined.
 */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const wanted = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value.trim() === '') continue
    if (key.toUpperCase() === wanted) return value
  }
  return undefined
}

/**
 * Absolute path of the Windows command processor, resolved from an environment
 * rather than from PATH.
 *
 * Every `.cmd` shim still has to be executed through cmd.exe, and a bare
 * `cmd.exe` spawn resolves through the host PATH: a GUI-launched host whose PATH
 * carries no `%SystemRoot%\system32` (a packaged Desktop launch, a service, a
 * stripped environment) gets ENOENT for a name that is present on disk, and the
 * whole feature fails with it (issue #1857). ComSpec is the variable Windows
 * itself uses for this and names the real binary, so it is preferred; otherwise
 * the system root is read from `SystemRoot` or `windir`, with the conventional
 * `C:\Windows` as the last resort.
 *
 * Only the Windows branch needs it — a POSIX host spawns the CLI directly.
 * @param env - the environment to resolve from.
 * @returns the absolute cmd.exe path.
 */
export function windowsCmdPath(env: NodeJS.ProcessEnv = process.env): string {
  const comSpec = envValue(env, 'ComSpec')
  if (comSpec !== undefined) return comSpec
  const root = envValue(env, 'SystemRoot') ?? envValue(env, 'windir') ?? WINDOWS_ROOT_FALLBACK
  return win32.join(root, 'System32', 'cmd.exe')
}

/** Build the exact cmd.exe command line required to execute a trusted .cmd shim. */
export function windowsCmdShimArgs(binary: string, args: readonly string[]): string[] {
  const unsafe = /[&|<>"'`%!\n\r\0]/
  if (/["%\n\r\0]/.test(binary) || args.some(arg => unsafe.test(arg))) {
    throw new Error('plugin-manager: unsafe Windows command argument')
  }
  const commandLine = `""${binary}" ${args.map(arg => `"${arg}"`).join(' ')}"`
  return ['/d', '/s', '/c', commandLine]
}

/**
 * Prepend one directory to a child environment's PATH, collapsing every case
 * variant of the key into one `PATH`. Windows exposes the variable as `Path`,
 * and spreading `process.env` into a plain object preserves that spelling:
 * assigning `env.PATH` beside it would leave two keys whose serialization
 * drops the system directories (the desktop childEnv defect).
 * @param env - the environment to copy.
 * @param dir - directory to put first.
 * @param platform - process platform (test seam).
 * @returns a new environment with one normalized, prepended PATH.
 */
export function withPrependedPath(
  env: NodeJS.ProcessEnv,
  dir: string,
  platform: string = process.platform,
): NodeJS.ProcessEnv {
  const separator = platform === 'win32' ? ';' : ':'
  const pathKeys = Object.keys(env).filter(key => key.toUpperCase() === 'PATH')
  const current = pathKeys.map(key => env[key]).find(value => value !== undefined && value !== '') ?? ''
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() !== 'PATH') next[key] = value
  }
  next.PATH = current === '' ? dir : `${dir}${separator}${current}`
  return next
}

/**
 * Exit code reported for a child that never became a process. Node delivers a
 * failed spawn as an `error` event whose `close` may never follow, and every
 * consumer of a spawned child waits for `close` alone.
 */
export const SPAWN_FAILURE_EXIT_CODE = -1

/** The spawn failure recorded on a guarded child, read by {@link awaitChildExit}. */
const SPAWN_FAILURE = new WeakMap<ChildProcess, string>()

/**
 * Whether an emitted error is a spawn failure rather than a later lifecycle
 * failure (a kill that did not land, a closed stdio pipe). Only a spawn failure
 * means the child will never close on its own.
 * @param error - the emitted error.
 * @returns true when no process was ever created.
 */
function isSpawnFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const syscall = (error as { syscall?: unknown }).syscall
  return typeof syscall === 'string' && syscall.startsWith('spawn')
}

/**
 * The operator-facing text of one spawn failure.
 * @param error - the emitted error.
 * @returns a readable one-line reason.
 */
function spawnFailureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return 'plugin-manager: 无法启动子进程（' + message + '）'
}

/**
 * Attach the error fallback every spawn outlet needs.
 *
 * A ChildProcess without an `error` listener turns a spawn failure into an
 * unhandled `error` event, which is an uncaught exception: the failure of one
 * CLI call took the whole dsh host process down with it. This records the
 * reason and, when the child never closed, settles it as a failed exit so a
 * caller that only waits for `close` neither hangs nor crashes (issue #1857).
 * @param child - the spawned child.
 * @returns the same child, guarded.
 */
export function guardSpawnFailure(child: ChildProcess): ChildProcess {
  let closed = false
  child.on('close', () => { closed = true })
  child.on('error', (error: unknown) => {
    if (!isSpawnFailure(error)) return
    SPAWN_FAILURE.set(child, spawnFailureText(error))
    if (closed) return
    closed = true
    child.emit('close', SPAWN_FAILURE_EXIT_CODE, null)
  })
  return child
}

/** One spawned child's exit verdict. */
export interface ChildExit {
  /** The process exit code, or {@link SPAWN_FAILURE_EXIT_CODE} when it never started. */
  code: number | null
  /** The spawn failure reason, present only when no process was created. */
  spawnError?: string
}

/**
 * Wait for a spawned child to close, settling on a spawn failure as well.
 *
 * The listener pair is attached to every child this package waits on, so the
 * wait is safe for a child that arrived through a seam ({@link guardSpawnFailure}
 * guards the real spawn outlets, an injected one may skip it).
 * @param child - the spawned child.
 * @returns the exit verdict.
 */
export async function awaitChildExit(child: ChildProcess): Promise<ChildExit> {
  return new Promise<ChildExit>(resolve => {
    let settled = false
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      const spawnError = SPAWN_FAILURE.get(child)
      resolve(spawnError === undefined ? { code } : { code, spawnError })
    }
    child.on('close', (code: number | null) => { finish(code) })
    child.on('error', () => { finish(SPAWN_FAILURE_EXIT_CODE) })
  })
}

/**
 * Wait for one spawned CLI child, folding a spawn failure into its output.
 *
 * Every caller already reports a non-zero exit through the captured output, so
 * a process that never started is reported the same readable way instead of as
 * a silent failure or a hang.
 * @param child - the spawned child.
 * @param output - the bounded capture the failure text is appended to.
 * @param timeoutMs - kill the child after this long; omitted for no deadline.
 * @returns the exit code, or null when a signal ended the child.
 */
export async function awaitCliExit(
  child: ChildProcess,
  output: OutputCapture,
  timeoutMs?: number,
): Promise<number | null> {
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => { child.kill() }, timeoutMs)
  try {
    const exit = await awaitChildExit(child)
    if (exit.spawnError !== undefined) capture(Buffer.from(exit.spawnError + '\n'), output)
    return exit.code
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Spawn the dsh CLI with piped stdio and no shell parsing (see
 * {@link dshSpawnCommand}).
 *
 * The CLI's own directory goes first on the child PATH: npm-global, homebrew and
 * packaged layouts keep `node`, `pnpm` and `npx` beside the `dsh` shim, and a
 * GUI-launched host carries none of them on its own PATH — the CLI forwards
 * `dsh plugin` to pnpm, so without this the update would start and then fail on
 * a missing pnpm instead. This mirrors the packaged Desktop launcher, which
 * prepends its bundled runtime bin to the host it spawns.
 *
 * Every child leaves here guarded ({@link guardSpawnFailure}), so a spawn that
 * fails settles as a non-zero exit instead of raising an unhandled error.
 * @param binary - the resolved dsh CLI path.
 * @param args - arguments after the interpreter/script prefix.
 * @param env - the host environment.
 * @returns the spawned child process.
 */
export function spawnDsh(binary: string, args: string[], env: NodeJS.ProcessEnv) {
  const { command, argsPrefix } = dshSpawnCommand(binary)
  const pathApi = process.platform === 'win32' ? win32 : posix
  const childEnv = withPrependedPath(env, pathApi.dirname(binary))
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    // cmd.exe by bare name resolves through the host PATH, which a GUI-launched
    // host need not carry the system directories in (issue #1857).
    return guardSpawnFailure(spawn(windowsCmdPath(env), windowsCmdShimArgs(command, args), {
      env: childEnv,
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }))
  }
  return guardSpawnFailure(spawn(command, [...argsPrefix, ...args], {
    env: command === process.execPath ? { ...childEnv, ELECTRON_RUN_AS_NODE: '1' } : childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
}

/**
 * Entry-id line of the official installer channels in the boot dump. A plain
 * substring probe false-positives on any unrelated entry whose id, name, or
 * config mentions the mark, so only a real `id:` row counts.
 */
const OFFICIAL_INSTALLER_PATTERN = /^\s*-?\s*id:\s*['"]?plugin-(?:installer|control)['"]?\s*$/m

/**
 * The entry ids of a composed profile dump (`dsh --profile <name>
 * --dump-config`). The dump prints one YAML block per patch layer under a
 * `# ==` header, with the composed entries as column-0 `- id:` items — an
 * entry a profile patch overrides appears once, carrying the override's keys,
 * so those lines are exactly the loader's own entry set. Nested config keeps
 * its own `id` keys indented and is never mistaken for an entry.
 * @param dump - the dump's captured text.
 * @returns the composed entry ids, or undefined when the dump carried none.
 */
export function composedEntryIdsOf(dump: string): Set<string> | undefined {
  const ids = new Set<string>()
  for (const rawLine of dump.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const match = /^-[ \t]+id:[ \t]*(.+?)[ \t]*$/.exec(line)
    if (match === null) continue
    const value = match[1]
    const unquoted = /^'(.*)'$/.exec(value)?.[1] ?? /^"(.*)"$/.exec(value)?.[1] ?? value
    if (unquoted !== '') ids.add(unquoted)
  }
  return ids.size === 0 ? undefined : ids
}

/**
 * Detect whether the official installer channels exist on this runtime by
 * dumping the boot composition once: the npm-published web never contains
 * `plugin-installer` entries, DSHCode and the checkout web do. The browser
 * half reads the verdict from the `/mode` route so its channel probe never
 * has to hit the missing official route (which 405s into the console).
 * @param binary - dsh CLI path.
 * @param profileName - boot profile name.
 * @param env - process environment.
 * @param spawnImpl - spawn seam (test seam).
 * @returns true when the dump names the official installer channels.
 */
export async function detectOfficialChannels(
  binary: string,
  profileName: string,
  env: NodeJS.ProcessEnv = process.env,
  spawnImpl: typeof spawnDsh = spawnDsh,
): Promise<boolean> {
  const output = createOutputCapture(MAX_OUTPUT_BYTES)
  const child = spawnImpl(binary, ['--profile', profileName, '--dump-config'], env)
  child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, output) })
  child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, output) })
  const code = await awaitCliExit(child, output)
  if (code !== 0) return false
  return OFFICIAL_INSTALLER_PATTERN.test(output.read())
}

/**
 * The official in-process plugin manager (`@deepseek-ai/dsh-plugin-manager`),
 * read from the host context as a contract observation — not an import, exactly
 * like the profile facts and the installer wire shapes this package already
 * mirrors. It is the same writer the official Plugins page drives, and on an
 * application-owned profile it is the ONLY writer: `dsh plugin --profile desktop
 * …` is refused before pnpm starts ("profile \"desktop\" is managed
 * exclusively by the Electron application"), and the launcher hands that
 * manager its bundled package-manager invocation through launcher facts.
 */
export interface NativePluginManager {
  /**
   * Install one package spec through the official manager. Since 0.2.1-rc.2 it
   * refuses a package the profile already carries while the host mounts the `hmr`
   * service (`already-installed`), which is every profile host, so an in-place
   * update cannot be one call there.
   * @param spec - package spec (e.g. `@scope/pkg@1.2.3`).
   * @param options - activation choice and the request id the run is tracked under.
   * @returns the manager's own verdict ({@link NativeManagerOutcome}); the caller
   * re-reads the profile as well, but must read this first — a refusal resolves.
   */
  installBundle(spec: string, options?: { enabled?: boolean; requestId?: string }): Promise<unknown>
  /**
   * Replace an installed bundle with a published version through the official
   * manager (0.2.2-rc.1 and later). The manager checks the target on the
   * registry first, removes the installed version when the host mounts `hmr`,
   * installs the target with the same selection, and reinstalls the removed
   * version when that installation fails or is cancelled — so an update is one
   * official call, not a sequence this gateway assembles.
   * Optional: the manager that ships with an older cohort has no update
   * primitive, and this gateway names that instead of guessing.
   * @param name - installed profile dependency name.
   * @param version - exact published version newer than the installed one.
   * @param options - the request id the run's progress and logs are tracked under.
   * @returns the manager's own update verdict ({@link NativeUpdateOutcome}).
   */
  updateBundle?(name: string, version: string, options?: { requestId?: string }): Promise<unknown>
  /**
   * Remove one profile-owned bundle through the official manager.
   * @param name - installed dependency (bundle) name.
   * @returns the manager's own verdict ({@link NativeManagerOutcome}); the caller
   * re-reads the profile as well, but must read this first — a refusal resolves.
   */
  removeBundle(name: string): Promise<unknown>
  /**
   * Select or deselect a bundle layer while keeping the installed dependency.
   * Present on every published manager (the official Plugins page drives it),
   * and read here only to undo the deselection a refused removal leaves behind.
   * Optional because the undo is best-effort: a manager without it still
   * refuses the removal, and the report says what to do instead.
   * @param name - installed bundle name.
   * @param enabled - whether the bundle contributes its patch layer.
   * @returns the manager's own verdict ({@link NativeManagerOutcome}).
   */
  setBundleEnabled?(name: string, enabled: boolean): Promise<unknown>
}

/**
 * The verdict the official in-process manager returns for one mutation. Its
 * internal `change()` wrapper never rejects a failed operation: it folds the
 * failure into this resolved value (`application: 'failed'` plus `error`), so a
 * resolved promise is not proof the profile moved. Reading only whether the
 * call threw reported a refused pnpm run as "the manager succeeded but nothing
 * changed" and hid the real reason (2026-09-29: `dsh-better-sidebar` update
 * blocked by `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). Contract observation,
 * shape mirrored from `@deepseek-ai/dsh-plugin-manager`.
 */
export interface NativeManagerOutcome {
  /** `applied` or `restart-required` on success, `cancelled`, or `failed`. */
  application?: string
  /** Whether the profile files differ from before the run. */
  changed?: boolean
  /** Present when `application` is `failed`. */
  error?: {
    /** The manager's own failure code (`operation-error`, `incompatible-version`, …). */
    code?: string
    /** Raw failure text for `operation-error` (the pnpm output tail). */
    diagnostic?: string
    /** Packages an `incompatible-version` refusal names. */
    incompatible?: readonly { name?: string; version?: string; runtimeVersion?: string }[]
  }
}

/**
 * The official manager's own failure text for one run, or undefined when its
 * verdict is not a failure. The manager resolves a failed run instead of
 * rejecting it, so this is the only place its refusal can be read — the profile
 * re-read afterwards can only say that nothing moved, never why.
 * @param outcome - the resolved value of `installBundle` / `removeBundle`.
 * @returns the failure text to report, or undefined for a run that did not fail.
 */
export function nativeManagerFailure(outcome: unknown): string | undefined {
  if (typeof outcome !== 'object' || outcome === null) return undefined
  const verdict = outcome as NativeManagerOutcome
  if (verdict.application === 'cancelled') return '本次操作已取消（profile 未改动）'
  if (verdict.application !== 'failed') return undefined
  const failure = verdict.error
  const diagnostic = typeof failure?.diagnostic === 'string' ? failure.diagnostic.trim() : ''
  if (diagnostic !== '') return diagnostic
  const incompatible = failure?.incompatible
  if (Array.isArray(incompatible) && incompatible.length > 0) {
    return incompatible
      .map(item => `${item.name ?? '未知包'}@${item.version ?? '未知版本'} 与 dsh ${item.runtimeVersion ?? '当前版本'} 不兼容`)
      .join('；')
  }
  const code = failure?.code
  return typeof code === 'string' && code !== '' ? `官方插件管理器拒绝执行（${code}）` : '官方插件管理器报告失败'
}

/**
 * The official manager's own refusal code for one run, or undefined when its
 * verdict is not a failure. {@link nativeManagerFailure} renders the code for the
 * person; this is the same verdict read for a decision, which is how the update
 * path recognises the `already-installed` refusal it has to answer with a
 * two-phase replacement.
 * @param outcome - the resolved value of `installBundle` / `removeBundle`.
 * @returns the manager's failure code, or undefined for a run that did not fail.
 */
export function nativeManagerRefusalCode(outcome: unknown): string | undefined {
  if (typeof outcome !== 'object' || outcome === null) return undefined
  const verdict = outcome as NativeManagerOutcome
  if (verdict.application !== 'failed') return undefined
  const code = verdict.error?.code
  return typeof code === 'string' && code !== '' ? code : undefined
}

/**
 * Whether the official manager's verdict says the run landed but this process
 * does not hold it yet. The manager answers `application: 'restart-required'`
 * when the profile moved while the running host still carries the old state;
 * on a two-phase replacement the removal alone can produce it, because the
 * replaced bundle's rows are already gone from the running fiber tree by the
 * time the guard reports the removal applied (issue #1905).
 *
 * Read as a success that carries a fact, never as a failure: the version did
 * land on disk, so turning it into an error would send the caller into a
 * rollback the profile does not need and stop a batch update on its first item.
 * @param outcome - the resolved value of `installBundle` / `removeBundle`.
 * @returns true when the run landed and a restart is what loads it.
 */
export function nativeManagerRestartRequired(outcome: unknown): boolean {
  if (typeof outcome !== 'object' || outcome === null) return false
  const verdict = outcome as NativeManagerOutcome
  return verdict.application === 'restart-required'
}

/**
 * The resolved value of the official manager's `updateBundle`
 * (`PluginUpdateResult` in `@deepseek-ai/dsh-plugin-manager` 0.2.2-rc.1): the
 * phase that ended the run, that phase's own verdict, and the reinstallation of
 * the removed version when the target could not be installed.
 */
export interface NativeUpdateOutcome {
  /** Version the profile carried before the run. */
  from?: string
  /** The version the run targeted. */
  to?: string
  /** The phase that ended the run. */
  step?: 'check' | 'remove' | 'install'
  /** That phase's verdict ({@link NativeManagerOutcome}); the run failed when it says so. */
  result?: unknown
  /** The reinstallation of `from`; present only when the target did not land. */
  restore?: unknown
}

/** The phase an update ended on, named for the person reading the failure. */
const NATIVE_UPDATE_STEP_LABELS: Record<string, string> = {
  check: '检查新版本时被拒',
  remove: '移除已安装版本时被拒',
  install: '安装新版本时失败',
}

/**
 * What one official `updateBundle` run reported as its failure, or undefined
 * when the target landed.
 *
 * The verdict of the phase that ended the run is the only place the reason
 * lives — the manager folds a refused run into the resolved value instead of
 * rejecting it — so the phase is named beside the manager's own words: a
 * refusal to remove is a different fact from a refusal to install.
 * @param outcome - the resolved value of `updateBundle`.
 * @returns the failure text to report, or undefined for a run that landed.
 */
export function nativeUpdateFailure(outcome: unknown): string | undefined {
  if (typeof outcome !== 'object' || outcome === null) return undefined
  const value = outcome as NativeUpdateOutcome
  const failure = nativeManagerFailure(value.result)
  if (failure === undefined) return undefined
  const label = NATIVE_UPDATE_STEP_LABELS[value.step ?? ''] ?? '更新未完成'
  return `${label}（${failure}）`
}

/**
 * The official manager's refusal code for one update, or undefined when the
 * target landed. {@link nativeUpdateFailure} renders that verdict for the
 * person; this is the same verdict read for a decision, which is how the update
 * path recognises a `bundle-in-use` removal it answers with one retry.
 * @param outcome - the resolved value of `updateBundle`.
 */
export function nativeUpdateRefusalCode(outcome: unknown): string | undefined {
  if (typeof outcome !== 'object' || outcome === null) return undefined
  return nativeManagerRefusalCode((outcome as NativeUpdateOutcome).result)
}

/**
 * Whether one update landed on disk but is not loaded in this process: the
 * phase that ended it answered `application: 'restart-required'`.
 * @param outcome - the resolved value of `updateBundle`.
 */
export function nativeUpdateRestartRequired(outcome: unknown): boolean {
  if (typeof outcome !== 'object' || outcome === null) return false
  return nativeManagerRestartRequired((outcome as NativeUpdateOutcome).result)
}

/**
 * How a failed update left the version it removed, as a clause appended to the
 * failure: the official manager reinstalls that version itself, so the report
 * says whether the plugin is back or the person has to reinstall it by hand.
 * @param outcome - the resolved value of `updateBundle`.
 * @returns the clause, or an empty string when no reinstallation ran.
 */
export function nativeUpdateRestoreNote(outcome: unknown): string {
  if (typeof outcome !== 'object' || outcome === null) return ''
  const value = outcome as NativeUpdateOutcome
  if (value.restore === undefined) return ''
  const from = typeof value.from === 'string' && value.from !== '' ? value.from : '更新前的版本'
  const failure = nativeManagerFailure(value.restore)
  return failure === undefined
    ? `；已装回 ${from}`
    : `；装回 ${from} 也失败：${failure}，请手动重新安装`
}

/** One layer snapshot plus the profile patch text and dependency list. */
interface CapturedState {
  layer: LayerSnapshot
  bundles: string[]
  /** Raw profile patch text (the duplicate-mount guard reads row names from it). */
  patchText: string
  dependencies: string[]
}

/**
 * A non-zero CLI exit the gateway may re-read from the profile instead of
 * reporting outright: pnpm's skipped-build-script condition
 * ({@link reportsIgnoredBuilds}), which it prints after the profile has been
 * written. Both facts travel, because the warning a landed run records names the
 * code as well as pnpm's text.
 */
interface TolerableExit {
  /** The exit code the run ended on. */
  code: number | null
  /** The run's captured output: pnpm's reason plus the CLI's own trailer. */
  output: string
}

/** The gateway: serializes CLI operations through one job table and one mutation queue. */
export class CliGateway {
  private readonly jobs = new Map<string, GatewayJob>()
  /** Settlement order of finished jobs: the eviction ring keeps the newest {@link MAX_FINISHED_JOBS}. */
  private readonly finishedOrder: string[] = []
  private counter = 0
  /** Mutation queue: two CLI runs must never interleave their before/after captures. */
  private queue: Promise<void> = Promise.resolve()

  /**
   * @param facts - resolved profile locations.
   * @param env - process environment.
   * @param deps - spawn/binary seams (tests only; production uses the real CLI).
   */
  constructor(
    private readonly facts: ProfileFacts,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly deps: {
      spawnImpl?: typeof spawnDsh
      findBinary?: (env: NodeJS.ProcessEnv) => string | null
      /** The official in-process manager, when the runtime publishes one. */
      nativeManager?: () => NativePluginManager | undefined
    } = {},
  ) {}

  /**
   * Run one profile mutation after every mutation already queued. The returned
   * promise keeps the task's own result or rejection, while the queue tail is
   * always recovered so one failed write cannot block later work. Routes that
   * edit profile files directly must use this seam so they cannot overlap the
   * CLI install/remove writer.
   */
  withMutationLock<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  /** Chain one fire-and-forget CLI mutation onto the shared queue. */
  private enqueue(task: () => Promise<void>): void {
    void this.withMutationLock(task).catch(() => {})
  }

  /** Register a settled job and evict the oldest finished one beyond the ring cap. */
  private retainFinished(jobId: string): void {
    this.finishedOrder.push(jobId)
    while (this.finishedOrder.length > MAX_FINISHED_JOBS) {
      const evicted = this.finishedOrder.shift()
      if (evicted !== undefined) this.jobs.delete(evicted)
    }
  }

  /** The dsh CLI path, through the test seam when present. */
  private binary(): string | null {
    return this.deps.findBinary !== undefined ? this.deps.findBinary(this.env) : findDshBinary(this.env)
  }

  /**
   * The official in-process manager to write through, or undefined when the CLI
   * is the writer. Only an application-owned profile (a packaged Desktop launch)
   * takes this path: there the CLI refuses the profile outright, while the
   * official manager — which the launcher configures with its bundled
   * package-manager invocation — owns the same files this gateway reads. On
   * every other runtime the CLI stays the single writer, exactly as before.
   * @returns the manager, or undefined when the CLI should run.
   */
  private nativeManager(): NativePluginManager | undefined {
    if (this.facts.desktop !== true) return undefined
    return this.deps.nativeManager?.()
  }

  /**
   * Whether this gateway will write through the official in-process manager
   * instead of the CLI (an application-owned profile, see
   * {@link nativeManager}). The HTTP layer reads it so its CLI-availability
   * guard never rejects a job the CLI is not going to run.
   * @returns true when the native writer serves installs, updates and removals.
   */
  usesNativeWriter(): boolean {
    return this.nativeManager() !== undefined
  }

  /** Run one CLI command to completion and return the bounded output. */
  private async runCli(binary: string, args: string[], timeoutMs: number): Promise<{ code: number | null; output: string }> {
    const output = createOutputCapture(MAX_OUTPUT_BYTES)
    const child = this.spawnCli(binary, args)
    child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, output) })
    child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, output) })
    const code = await awaitCliExit(child, output, timeoutMs)
    return { code, output: output.read().trim() }
  }

  /** Full package spec used when restoring a legacy dependency. */
  private restoreSpec(name: string, spec: string): string {
    if (/^(?:link:|file:|git:|git\+|github:|https?:\/\/|npm:)/.test(spec)) return spec
    if (spec === '') return name
    return `${name}@${spec}`
  }

  /** Execute the legacy aggregate migration and settle the job. */
  private async runMigration(job: GatewayJob): Promise<void> {
    const binary = this.binary()
    if (binary === null) {
      job.phase = 'error'
      job.error = 'plugin-manager: dsh CLI not found on PATH'
      return
    }
    const sourceId = job.sourceId
    const targetId = job.targetId
    const targetVersion = job.targetVersion
    const targetSpec = job.targetSpec
    if (sourceId === undefined || targetId === undefined || targetVersion === undefined || targetSpec === undefined) {
      job.phase = 'error'
      job.error = 'plugin-manager: migration job is missing source/target identity'
      return
    }
    const before = await this.capture()
    if (!before.dependencies.includes(sourceId)) {
      job.phase = 'error'
      job.error = `plugin-manager: legacy aggregate ${sourceId} is not installed`
      return
    }
    const beforeManifest = await readProfileManifest(this.facts.packageJsonPath)
    const oldSpec = beforeManifest.dependencies[sourceId] ?? ''
    const oldIndex = before.bundles.indexOf(sourceId)
    const targetPreviouslyInstalled = before.dependencies.includes(targetId)

    const remove = await this.runCli(
      binary,
      ['plugin', '--profile', this.facts.profileName, 'remove', sourceId],
      REMOVE_TIMEOUT_MS,
    )
    if (remove.code !== 0) {
      job.phase = 'error'
      job.error = remove.output === ''
        ? `plugin-manager: dsh plugin remove ${sourceId} failed with code ${String(remove.code)}`
        : remove.output
      return
    }
    let after = await this.capture()
    if (after.dependencies.includes(sourceId)) {
      job.phase = 'error'
      job.error = `plugin-manager: dsh plugin remove 报告成功，但 ${sourceId} 仍在 profile 中`
      return
    }
    const targetIsLocal = /^(?:link:|file:)/.test(targetSpec)
    const shouldAddTarget = targetPreviouslyInstalled
      ? !targetIsLocal
      : !after.dependencies.includes(targetId)
    // The migration's install step is the same pnpm call an install makes, so it
    // carries the same skipped-build-script exit (see {@link reportsIgnoredBuilds});
    // here too only the profile decides whether that run landed.
    let tolerated: TolerableExit | undefined
    if (shouldAddTarget) {
      const add = await this.runCli(
        binary,
        ['plugin', '--profile', this.facts.profileName, 'add', targetSpec],
        ADD_TIMEOUT_MS,
      )
      if (add.code !== 0 && reportsIgnoredBuilds(add.output)) tolerated = { code: add.code, output: add.output }
      if (add.code !== 0 && tolerated === undefined) {
        if (await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)) {
          job.error = `plugin-manager: 迁移安装 ${targetSpec} 失败${add.output === '' ? '' : `：\n${add.output}`}`
        }
        return
      }
      after = await this.capture()
    }
    if (!after.dependencies.includes(targetId)) {
      const rolledBack = await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      if (rolledBack) {
        job.error = tolerated === undefined
          ? `plugin-manager: dsh plugin add 报告成功，但 ${targetId} 未出现在 profile 中`
          : `plugin-manager: 迁移安装 ${targetSpec} 失败${tolerated.output === '' ? '' : `：\n${tolerated.output}`}`
      }
      return
    }
    // The migration's install step is the same pnpm call and the same
    // reconcile, so a target it wrote without selecting mounts nothing.
    if (shouldAddTarget && await this.bundleSelectionMissing(
      targetId,
      after.bundles,
      !targetPreviouslyInstalled || before.bundles.includes(targetId),
    )) {
      if (await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)) {
        job.error = this.halfMountError(targetId, '迁移安装只写入了依赖，', tolerated)
      }
      return
    }
    const stripped = await this.stripDuplicateMounts(job, before, after)
    if (stripped === undefined) {
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      return
    }
    if (stripped.length > 0) {
      job.notices = stripped.map(name => ({ id: name, name, from: 'enabled', to: 'uninstalled' }))
      after = await this.capture()
    }
    if (oldIndex >= 0) await reorderProfileBundle(this.facts.packageJsonPath, targetId, oldIndex)
    after = await this.capture()

    const verify = await this.runCli(
      binary,
      ['--profile', this.facts.profileName, '--dump-config'],
      90_000,
    )
    if (verify.code !== 0) {
      if (await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)) {
        job.error = `plugin-manager: 迁移后的启动预检失败${verify.output === '' ? '' : `：\n${verify.output}`}`
      }
      return
    }
    // The migration replaces the row-id universe the same way an update does:
    // an override for a row only the retired aggregate declared is an orphan
    // from here on.
    if (await this.pruneOrphanOverrides(job, verify.output) === undefined) return
    const manifest = await readProfileManifest(this.facts.packageJsonPath)
    const updated = await buildPluginRow(
      this.facts,
      targetId,
      manifest.dependencies[targetId] ?? targetSpec,
      after.layer.rows,
    )
    // A local repository link is the developer checkout source: its version is
    // whatever the checked-out tree contains, not the registry release, so the
    // exact-version gate applies only to npm registry migrations.
    if (!/^(?:link:|file:)/.test(targetSpec) && updated.version !== targetVersion) {
      if (await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)) {
        job.error = `plugin-manager: 迁移后 ${targetId} 版本为 ${updated.version}，预期 ${targetVersion}`
      }
      return
    }
    job.plugin = updated
    job.conflicts = significantChanges(diffLayer(before.layer, after.layer)).map(change => ({
      id: change.id,
      name: change.id,
      from: change.from,
      to: change.to,
    }))
    if (tolerated !== undefined) this.recordToleratedExit(job, tolerated)
    job.phase = 'done'
  }

  /**
   * Restore the original legacy package after a failed migration.
   *
   * The forward migration removed the legacy package first, so the way back is
   * a remove-then-add in the other direction — and each half has to be read, not
   * assumed. A removal that does not take the new aggregate back out leaves the
   * profile carrying it with the legacy package gone, and re-adding the legacy
   * package on top of it is exactly the dual-mount shape this path exists to
   * avoid: both bundles declare the same row ids, the loader mounts one of them
   * without a word, and the next update resolves against a profile that no
   * longer describes itself. Such a rollback is reported as incomplete
   * ({@link incompleteRollback}) instead of claimed as done.
   * @returns true when the rollback finished — the legacy package is back, or
   *   the profile deliberately keeps the single current aggregate — and false
   *   when it could not run or could not finish, in which case `job.error`
   *   already carries the report and the caller must not replace it with its
   *   own reason.
   */
  private async rollbackMigration(
    job: GatewayJob,
    sourceId: string,
    targetId: string,
    oldSpec: string,
    oldIndex: number,
    targetPreviouslyInstalled: boolean,
  ): Promise<boolean> {
    const binary = this.binary()
    if (binary === null) {
      job.phase = 'error'
      job.error = 'plugin-manager: 迁移失败且无法回滚：dsh CLI not found on PATH'
      return false
    }
    const current = await this.capture()
    // Built here rather than at the re-add below: an incomplete rollback has to
    // name the command that restores the legacy package.
    const restoreOld = this.restoreSpec(sourceId, oldSpec)
    if (!targetPreviouslyInstalled && current.dependencies.includes(targetId)) {
      const removed = await this.runCli(binary, ['plugin', '--profile', this.facts.profileName, 'remove', targetId], REMOVE_TIMEOUT_MS)
      if (removed.code !== 0) {
        job.phase = 'error'
        job.error = this.incompleteRollback(
          targetId,
          restoreOld,
          `dsh plugin remove ${targetId} 失败（退出码 ${String(removed.code)}）${removed.output === '' ? '' : `：\n${removed.output}`}`,
        )
        return false
      }
    }
    // If the current aggregate already existed before this migration, the
    // profile already had both bundles and was unusable. Keep the single
    // current aggregate on rollback instead of re-adding the legacy duplicate.
    if (targetPreviouslyInstalled) {
      job.phase = 'error'
      job.error = 'plugin-manager: 聚合包迁移失败，已保留当前聚合包并移除旧包'
      return true
    }
    const restored = await this.runCli(
      binary,
      ['plugin', '--profile', this.facts.profileName, 'add', restoreOld],
      ADD_TIMEOUT_MS,
    )
    if (restored.code !== 0) {
      job.phase = 'error'
      job.error = `plugin-manager: 迁移失败且回滚到 ${restoreOld} 失败${restored.output === '' ? '' : `：\n${restored.output}`}`
      return false
    }
    if (oldIndex >= 0) {
      await reorderProfileBundle(this.facts.packageJsonPath, sourceId, oldIndex).catch(() => undefined)
    }
    job.phase = 'error'
    job.error = 'plugin-manager: 聚合包迁移失败，已回滚到旧包'
    return true
  }

  /**
   * The report for a rollback that could not take the new aggregate back out.
   *
   * The profile is left carrying the new package with the legacy one gone,
   * which is neither the migration nor a rollback, and it is not a state the
   * legacy package may be re-added into: both bundles declare the same row ids,
   * so keeping one of them is the only safe outcome. The message therefore says
   * what actually happened, never claims a rollback that did not run, and names
   * the two commands that carry it out by hand.
   * @param targetId - the new aggregate this migration installed.
   * @param restoreOld - the exact spec that reinstalls the legacy package.
   * @param reason - the CLI's own words, or the exit it reported.
   * @returns the job error text.
   */
  private incompleteRollback(targetId: string, restoreOld: string, reason: string): string {
    return [
      `plugin-manager: 迁移失败且回滚未完成：需手工 remove ${targetId}`,
      `请执行：dsh plugin --profile ${this.facts.profileName} remove ${targetId}`,
      `如需恢复旧包，再执行：dsh plugin --profile ${this.facts.profileName} add ${restoreOld}`,
      `原因：${reason}`,
    ].join('\n')
  }

  /** Spawn the CLI, through the test seam when present. */
  private spawnCli(binary: string, args: string[]) {
    return (this.deps.spawnImpl ?? spawnDsh)(binary, args, this.env)
  }

  /**
   * Start an install; the caller polls {@link status}. An application-owned
   * profile runs it through the official in-process manager instead of the CLI
   * (see {@link nativeManager}), exactly like {@link update}; the job table,
   * polling contract and profile verification are identical either way.
   */
  install(spec: string): { jobId: string } {
    const job: GatewayJob = { id: `job-${++this.counter}`, action: 'install', spec, phase: 'running' }
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(spec)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    // An application-owned profile takes the official writer; everything else
    // keeps the CLI, whose reconciliation guards this gateway compensates for.
    const native = this.nativeManager()
    if (native !== undefined) {
      this.enqueueNativeInstall(job, native)
      return { jobId: job.id }
    }
    this.enqueue(() => this.run(job, ['plugin', '--profile', this.facts.profileName, 'add', spec], ADD_TIMEOUT_MS))
    return { jobId: job.id }
  }

  /**
   * Start an in-place npm update; the caller polls {@link status}. An
   * application-owned profile runs it through the official in-process manager
   * instead of the CLI (see {@link nativeManager}), and the job/status/polling
   * contract the browser half drives is identical either way.
   */
  update(id: string, version: string): { jobId: string } {
    const job = this.newUpdateJob(id, version)
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(job.spec)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    this.enqueue(() => this.settleUpdateJob(job))
    return { jobId: job.id }
  }

  /**
   * One update job, registered but not yet queued.
   *
   * Both the single-plugin update and the batch runner settle this same shape,
   * so a batch row is applied by exactly the code an update from the plugin's
   * own page runs: the official in-process manager on an application-owned
   * profile, the CLI everywhere else.
   * @param id - installed package name.
   * @param version - the exact version the update must land on.
   */
  private newUpdateJob(id: string, version: string): GatewayJob {
    return {
      id: `job-${++this.counter}`,
      action: 'update',
      spec: `${id}@${version}`,
      targetId: id,
      targetVersion: version,
      phase: 'running',
    }
  }

  /**
   * Apply a whole batch of updates in one run.
   *
   * The official manager only replaces one bundle at a time (`updateBundle`), and
   * the CLI only adds one spec at a time, so a batch is this host's sequence over
   * that single-plugin primitive rather than a second writer: one job, one
   * mutation-lock slot, one poll. Rows are applied in the order given, and a row
   * that cannot be applied — refused by the route's own gate before the run, or
   * by the writer during it — is recorded and skipped instead of ending the run,
   * because every managed writer below is atomic per plugin.
   *
   * The batch job settles `done` once the last row is answered: the rows carry
   * the failures, and a run that failed every row is not a failed job but a job
   * whose every row failed, which is what the caller renders.
   * @param entries - the rows to apply, in order, each already resolved to the
   * version it must land on or to the reason it was refused.
   */
  updateAll(entries: readonly GatewayUpdateEntry[]): { jobId: string } {
    const job: GatewayJob = {
      id: `job-${++this.counter}`,
      action: 'update-all',
      spec: '',
      phase: 'running',
      results: entries.map(entry => {
        if (entry.kind === 'refused') return { id: entry.id, phase: 'error', error: entry.error }
        const unsafe = entry.kind === 'migrate'
          ? unsafeSpecReason(entry.id) ?? unsafeSpecReason(entry.targetId) ?? unsafeSpecReason(entry.targetSpec)
          : unsafeSpecReason(`${entry.id}@${entry.version}`)
        if (unsafe !== undefined) return { id: entry.id, phase: 'error', error: unsafe }
        const targetVersion = entry.kind === 'migrate' ? entry.targetVersion : entry.version
        return { id: entry.id, targetVersion, phase: 'pending' }
      }),
    }
    this.jobs.set(job.id, job)
    this.enqueue(async () => {
      const native = this.nativeManager()
      const results = job.results ?? []
      for (const [index, entry] of entries.entries()) {
        const row = results[index]
        if (row === undefined || row.phase === 'error' || entry.kind === 'refused') continue
        job.current = entry.id
        row.phase = 'running'
        const child = entry.kind === 'migrate'
          ? this.newMigrationJob(entry.id, entry.targetId, entry.targetVersion, entry.targetSpec)
          : this.newUpdateJob(entry.id, entry.version)
        this.jobs.set(child.id, child)
        if (entry.kind === 'migrate') await this.settleMigrationJob(child)
        else await this.settleUpdateJob(child, native)
        if (child.phase === 'done') {
          row.phase = 'done'
          row.landed = child.plugin?.version ?? (entry.kind === 'migrate' ? entry.targetVersion : entry.version)
          if (child.restartRequired !== undefined && child.restartRequired.length > 0) row.restartRequired = true
        } else {
          row.phase = 'error'
          row.error = child.error ?? 'plugin-manager: 更新失败'
        }
      }
      job.current = undefined
      job.phase = 'done'
      this.retainFinished(job.id)
    })
    return { jobId: job.id }
  }

  /**
   * Run one update job to settlement through whichever writer owns this profile.
   *
   * An application-owned profile takes the official in-process manager, which is
   * the only writer the CLI accepts there; every other runtime keeps the CLI,
   * whose reconciliation guards this gateway compensates for (see {@link runInner}).
   * @param job - the update job being settled.
   * @param native - the official manager, or undefined when the CLI is the writer.
   */
  private async settleUpdateJob(job: GatewayJob, native: NativePluginManager | undefined = this.nativeManager()): Promise<void> {
    try {
      if (native !== undefined) {
        await this.runNativeUpdate(job, native)
      } else {
        await this.runInner(job, ['plugin', '--profile', this.facts.profileName, 'add', job.spec], ADD_TIMEOUT_MS)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      job.phase = 'error'
      job.error = native !== undefined
        ? `plugin-manager: 官方插件管理器更新失败：${reason}`
        : `plugin-manager: unexpected gateway failure: ${reason}`
    }
    this.retainFinished(job.id)
  }

  /** Start an install through the official in-process manager. */
  private enqueueNativeInstall(job: GatewayJob, native: NativePluginManager): void {
    this.enqueue(async () => {
      try {
        await this.runNativeInstall(job, native)
      } catch (error) {
        job.phase = 'error'
        job.error = `plugin-manager: 官方插件管理器安装失败：${error instanceof Error ? error.message : String(error)}`
      }
      this.retainFinished(job.id)
    })
  }

  /**
   * Run one install through the official in-process manager (an
   * application-owned profile, where the CLI refuses to write). The manager
   * resolves the registry, runs pnpm with the launcher's bundled toolchain and
   * applies the bundle, then this reads the profile the same way the CLI path
   * does: the install is only `done` once the profile carries a dependency it
   * did not carry before, so a green manager call that added nothing is still
   * reported as a failure. Its resolved verdict is read first
   * ({@link nativeManagerFailure}): the manager folds a refused run into that
   * value instead of rejecting, and only the verdict names the reason. The
   * CLI-specific guards are deliberately absent — the official manager
   * validates and applies the bundle itself, exactly as it does for the
   * official Plugins page.
   * @param job - the install job being settled.
   * @param native - the official manager.
   */
  private async runNativeInstall(job: GatewayJob, native: NativePluginManager): Promise<void> {
    const before = await this.capture()
    const verdict = await native.installBundle(job.spec, { enabled: true, requestId: job.id })
    const refusal = nativeManagerFailure(verdict)
    if (refusal !== undefined) {
      job.phase = 'error'
      job.error = `plugin-manager: 官方插件管理器安装失败：${refusal}`
      return
    }
    const after = await this.capture()
    const name = this.newDependency(before, after)
    if (name === undefined) {
      job.phase = 'error'
      job.error = 'plugin-manager: 官方插件管理器报告成功，但 profile 未新增任何依赖（安装未生效）'
      return
    }
    const manifest = await readProfileManifest(this.facts.packageJsonPath)
    job.plugin = await buildPluginRow(this.facts, name, manifest.dependencies[name] ?? job.spec, after.layer.rows)
    job.conflicts = significantChanges(diffLayer(before.layer, after.layer)).map(change => ({
      id: change.id,
      name: change.id,
      from: change.from,
      to: change.to,
    }))
    job.phase = 'done'
  }

  /**
   * Run one update through the official in-process manager (an application-owned
   * profile, where the CLI refuses to write).
   *
   * Since 0.2.2-rc.1 the manager owns the whole replacement: `updateBundle` checks
   * the target on the registry first (it must exist, declare a bundle and accept
   * the running DSH version), removes the installed version while the host mounts
   * `hmr`, installs the target with the selection it found, and reinstalls the
   * version it removed when that installation fails or is cancelled. This path
   * therefore no longer sequences those phases itself, and no longer has to
   * recognise the `already-installed` guard that made an in-place install
   * impossible. It adds only the two facts the official call does not cover:
   *
   * - **The bundle keeps its layer index.** The official removal drops the name
   *   from `dsh.profile.bundles` and the reinstall appends it, and that array is
   *   the layer order the loader applies patches in, so a batch would drift every
   *   row's inheritance ({@link restoreBundleIndex} puts the name back).
   * - **A `bundle-in-use` refusal is answered once, not repeated** (issue #1905):
   *   the official guard deselects the bundle and reloads before it judges whether
   *   the rows still run, so the retry reads the state that reload left on disk
   *   ({@link applyNativeUpdate}). A second refusal is final and names the restart.
   *
   * The verdict is read first ({@link nativeUpdateFailure}): a refused run
   * resolves instead of rejecting, and only that verdict carries the reason — the
   * profile re-read can only show that the version did not move. The version
   * verification below is unchanged, so a green run that landed nothing is still
   * reported as 更新未生效.
   * @param job - the update job being settled.
   * @param native - the official manager.
   */
  private async runNativeUpdate(job: GatewayJob, native: NativePluginManager): Promise<void> {
    const targetId = job.targetId
    const targetVersion = job.targetVersion
    if (targetId === undefined || targetVersion === undefined) {
      job.phase = 'error'
      job.error = 'plugin-manager: update job is missing the target id or version'
      return
    }
    const updateBundle = native.updateBundle?.bind(native)
    if (updateBundle === undefined) {
      job.phase = 'error'
      job.error = `plugin-manager: 官方插件管理器没有提供 updateBundle（需要 DSH >= 0.2.2-rc.1），无法在该 profile 上更新 ${targetId}`
      return
    }
    const before = await this.capture()
    const carried = await readProfileManifest(this.facts.packageJsonPath)
    const previousSpec = carried.dependencies[targetId]
    // Read while the bundle is still listed: the official removal is what drops it.
    const index = await this.bundleIndexOf(targetId)
    const attempt = await this.applyNativeUpdate(updateBundle, targetId, targetVersion, job.id)
    const refusal = nativeUpdateFailure(attempt.outcome)
    if (refusal !== undefined) {
      // A refused removal can leave the bundle deselected on disk; put the
      // profile back the way it was found before reporting the refusal.
      if (await this.bundleSelectionLost(targetId)) await this.restoreBundleSelection(native, targetId)
      job.phase = 'error'
      job.error = `plugin-manager: 官方插件管理器更新失败：${refusal}${attempt.remedy}${nativeUpdateRestoreNote(attempt.outcome)}`
      return
    }
    const after = await this.capture()
    if (!after.dependencies.includes(targetId)) {
      job.phase = 'error'
      job.error = 'plugin-manager: 官方插件管理器报告成功，但目标插件未保留在 profile 中（更新未生效）'
      return
    }
    const manifest = await readProfileManifest(this.facts.packageJsonPath)
    const updated = await buildPluginRow(this.facts, targetId, manifest.dependencies[targetId] ?? job.spec, after.layer.rows)
    if (updated.version !== targetVersion) {
      job.phase = 'error'
      job.error = `plugin-manager: 官方插件管理器报告成功，但 ${targetId} 仍为 ${updated.version}，预期 ${targetVersion}（更新未生效）`
      return
    }
    // Landing is not the same as being loadable in this process: the official
    // manager answers `restart-required` when its removal applied while the rows
    // were already gone, and that is a fact to carry, never a failure.
    if (nativeUpdateRestartRequired(attempt.outcome)) job.restartRequired = [targetId]
    if (previousSpec !== undefined) await this.restoreBundleIndex(targetId, previousSpec, index)
    // An application-owned profile composes through the same read-only probe,
    // so orphaned overrides are pruned here too; a runtime that cannot compose
    // leaves the patch file exactly as it is (see {@link pruneOrphanOverrides}).
    if (await this.pruneOrphanOverrides(job) === undefined) return
    job.plugin = updated
    job.conflicts = significantChanges(diffLayer(before.layer, after.layer)).map(change => ({
      id: change.id,
      name: change.id,
      from: change.from,
      to: change.to,
    }))
    job.phase = 'done'
  }

  /**
   * Run one official update, answering its `bundle-in-use` removal refusal once.
   *
   * The official guard deselects the bundle, reloads the profile and only then
   * checks whether the bundle's rows still hold a running fiber. A refusal is
   * therefore answered against the state that reload left on disk, which covers a
   * real occupant the reload cleared. It does not cover a reload that rebuilds
   * the very rows it just unloaded — the fresh fiber matches the guard again — so
   * the retry is worth exactly one call and never a loop, and a second refusal is
   * returned with the restart the person has to do.
   * @param updateBundle - the official manager's update primitive.
   * @param targetId - the installed bundle being replaced.
   * @param targetVersion - the exact version the update must land on.
   * @param requestId - the job id the run's progress and logs are tracked under.
   * @returns the manager's verdict for the run that decided the outcome, plus the
   * remedy text a refusal a retry could not clear needs.
   */
  private async applyNativeUpdate(
    updateBundle: NonNullable<NativePluginManager['updateBundle']>,
    targetId: string,
    targetVersion: string,
    requestId: string,
  ): Promise<{ outcome: unknown, remedy: string }> {
    const first = await updateBundle(targetId, targetVersion, { requestId })
    if (nativeUpdateRefusalCode(first) !== 'bundle-in-use') return { outcome: first, remedy: '' }
    const second = await updateBundle(targetId, targetVersion, { requestId })
    if (nativeUpdateRefusalCode(second) !== 'bundle-in-use') return { outcome: second, remedy: '' }
    return {
      outcome: second,
      remedy: '；该插件仍由当前 DSH 进程加载，重启 DSH 后再执行本次更新即可',
    }
  }

  /**
   * Where a bundle sits in the layer order, read before the removal drops it.
   * @param name - the installed bundle name.
   * @returns the index in `dsh.profile.bundles`, or undefined when the profile
   * does not list it (nothing to restore in that case).
   */
  private async bundleIndexOf(name: string): Promise<number | undefined> {
    try {
      const manifest = await readProfileManifest(this.facts.packageJsonPath)
      const index = manifest.bundles.indexOf(name)
      return index < 0 ? undefined : index
    } catch {
      return undefined
    }
  }

  /**
   * Put a replaced bundle back at the layer index it had before the removal.
   *
   * The loader applies one patch layer per entry of `dsh.profile.bundles`, in
   * that order, so the index is behavior: a bundle that is removed and
   * reinstalled without this lands behind every bundle that followed it, and
   * whole rows start inheriting from a layer that used to come first. The write
   * is the manifest's own backup + tmp + rename path, and nothing is written
   * when the profile already lists the bundle where it belongs.
   * @param name - the reinstalled bundle.
   * @param spec - the dependency spec the reinstall recorded (unused when the bundle is absent).
   * @param index - the position captured before the removal.
   */
  private async restoreBundleIndex(name: string, spec: string, index: number | undefined): Promise<void> {
    if (index === undefined) return
    try {
      const manifest = await readProfileManifest(this.facts.packageJsonPath)
      if (!Object.hasOwn(manifest.dependencies, name)) return
      if (manifest.bundles.indexOf(name) === index) return
      await reorderProfileBundle(this.facts.packageJsonPath, name, index)
    } catch (error) {
      // The plugin did land; a layer order this write could not correct is
      // reported rather than turned into a failed update.
      console.warn(`[plugin-manager] 未能恢复 ${name} 的 bundle 顺序（${spec}）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Whether a bundle is still an installed dependency but no longer selected. */
  private async bundleSelectionLost(name: string): Promise<boolean> {
    try {
      const manifest = await readProfileManifest(this.facts.packageJsonPath)
      return Object.hasOwn(manifest.dependencies, name) && !manifest.bundles.includes(name)
    } catch {
      return false
    }
  }

  /** Put a selection back after a refused removal, so the profile is as it was found. */
  private async restoreBundleSelection(native: NativePluginManager, name: string): Promise<void> {
    if (native.setBundleEnabled === undefined) return
    try {
      await native.setBundleEnabled(name, true)
    } catch (error) {
      console.warn(`[plugin-manager] 未能恢复 ${name} 的 bundle 启用状态：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Start a deterministic legacy aggregate migration. */
  migrate(sourceId: string, targetId: string, targetVersion: string, targetSpec: string): { jobId: string } {
    const job = this.newMigrationJob(sourceId, targetId, targetVersion, targetSpec)
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(sourceId) ?? unsafeSpecReason(targetId) ?? unsafeSpecReason(targetSpec)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    this.enqueue(() => this.settleMigrationJob(job))
    return { jobId: job.id }
  }

  /** One legacy aggregate migration job, registered but not yet queued. */
  private newMigrationJob(sourceId: string, targetId: string, targetVersion: string, targetSpec: string): GatewayJob {
    return {
      id: `job-${++this.counter}`,
      action: 'migrate',
      spec: targetSpec,
      sourceId,
      targetId,
      targetVersion,
      targetSpec,
      phase: 'running',
    }
  }

  /**
   * Run one migration job to settlement; an unexpected failure settles the job
   * as an error without overwriting a verdict the run already recorded.
   * @param job - the migration job being settled.
   */
  private async settleMigrationJob(job: GatewayJob): Promise<void> {
    try {
      await this.runMigration(job)
    } catch (error) {
      if (job.phase !== 'error') {
        job.phase = 'error'
        job.error = `plugin-manager: unexpected migration failure: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    this.retainFinished(job.id)
  }

  /**
   * Start a removal; the caller polls {@link status}. An application-owned
   * profile removes through the official in-process manager, the same writer
   * the install and update paths use there (the CLI refuses that profile).
   */
  remove(id: string): { jobId: string } {
    const job: GatewayJob = { id: `job-${++this.counter}`, action: 'remove', spec: id, phase: 'running' }
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(id)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    const native = this.nativeManager()
    if (native !== undefined) {
      this.enqueueNativeRemove(job, native)
      return { jobId: job.id }
    }
    this.enqueue(() => this.run(job, ['plugin', '--profile', this.facts.profileName, 'remove', id], REMOVE_TIMEOUT_MS))
    return { jobId: job.id }
  }

  /** Start a removal through the official in-process manager. */
  private enqueueNativeRemove(job: GatewayJob, native: NativePluginManager): void {
    this.enqueue(async () => {
      try {
        await this.runNativeRemove(job, native)
      } catch (error) {
        job.phase = 'error'
        job.error = `plugin-manager: 官方插件管理器卸载失败：${error instanceof Error ? error.message : String(error)}`
      }
      this.retainFinished(job.id)
    })
  }

  /**
   * Run one removal through the official in-process manager (an
   * application-owned profile, where the CLI refuses to write). The removal is
   * only `done` once a dependency the profile carried before is gone, exactly
   * the verification the CLI path performs. Its resolved verdict is read first
   * ({@link nativeManagerFailure}): a refused removal resolves with
   * `application: 'failed'` rather than rejecting.
   * @param job - the removal job being settled.
   * @param native - the official manager.
   */
  private async runNativeRemove(job: GatewayJob, native: NativePluginManager): Promise<void> {
    const before = await this.capture()
    const verdict = await native.removeBundle(job.spec)
    const refusal = nativeManagerFailure(verdict)
    if (refusal !== undefined) {
      job.phase = 'error'
      job.error = `plugin-manager: 官方插件管理器卸载失败：${refusal}`
      return
    }
    const after = await this.capture()
    const name = before.dependencies.find(candidate => !after.dependencies.includes(candidate))
    if (name === undefined) {
      job.phase = 'error'
      job.error = 'plugin-manager: 官方插件管理器报告成功，但依赖仍在 profile 中（卸载未生效）'
      return
    }
    job.plugin = await this.rowFor('remove', job.spec, before, after)
    job.conflicts = significantChanges(diffLayer(before.layer, after.layer)).map(change => ({
      id: change.id,
      name: change.id,
      from: change.from,
      to: change.to,
    }))
    job.phase = 'done'
  }

  /**
   * Read one job's current state (a shallow copy). Finished jobs beyond the
   * ring cap are evicted and read as not-found, the same as an id that never
   * existed.
   */
  status(jobId: string): GatewayJob | undefined {
    const job = this.jobs.get(jobId)
    if (job === undefined) return undefined
    return {
      ...job,
      conflicts: job.conflicts === undefined ? undefined : [...job.conflicts],
      notices: job.notices === undefined ? undefined : [...job.notices],
      restartRequired: job.restartRequired === undefined ? undefined : [...job.restartRequired],
      warnings: job.warnings === undefined ? undefined : [...job.warnings],
      results: job.results === undefined ? undefined : job.results.map(row => ({ ...row })),
    }
  }

  /**
   * Whether this gateway's own record says the last in-place update of one
   * plugin at one version never settled.
   *
   * The update path writes the profile before it verifies it: the CLI puts the
   * target version on disk, and the boot preflight (`--dump-config`, see
   * {@link verifyBoot}) then decides whether the run is reported as landed. A
   * preflight failure the plugin is not implicated in settles the job as an
   * error with the new version already installed, which leaves the profile at
   * the target version while the update itself failed. That state cannot be
   * reached again through the update action — the row already carries the
   * latest version, so the route answers 409 "already at <version>" and the
   * only way out is a reinstall run by hand. This is the fact that lets that
   * route tell the state apart from a plugin that is genuinely up to date,
   * which must keep its 409.
   *
   * Only the most recent update of the plugin counts. A settled run — a later
   * success, or a run that landed nothing and rolled back — is the plugin's
   * current standing, whatever an older failed attempt said, so the scan starts
   * at the newest settled job and stops at the first one that is this plugin's
   * update. Jobs this gateway no longer holds (the ring cap, a restart) are
   * unknown rather than failed, and answer false.
   * @param id - the installed package name.
   * @param version - the version the profile currently carries.
   * @returns true when the newest recorded update of `id` failed at `version`.
   */
  lastUpdateFailed(id: string, version: string): boolean {
    for (let index = this.finishedOrder.length - 1; index >= 0; index -= 1) {
      const jobId = this.finishedOrder[index]
      if (jobId === undefined) continue
      const job = this.jobs.get(jobId)
      if (job === undefined || job.action !== 'update' || job.targetId !== id) continue
      return job.phase === 'error' && job.targetVersion === version
    }
    return false
  }

  /** Capture the layer snapshot and the dependency names (tolerant parse). */
  private async capture(): Promise<CapturedState> {
    const rows = new Map<string, boolean>()
    let patchText = '[]\n'
    try {
      patchText = await readFile(this.facts.patchPath, 'utf8')
    } catch {
      patchText = '[]\n'
    }
    try {
      const { root } = parsePatch(patchText, this.facts.patchPath)
      for (const item of root.items) {
        const id = bareRowId(item)
        if (id !== undefined) rows.set(id, bareRowEnabled(item))
      }
    } catch {
      // A broken patch file must not block an install: the CLI owns the write
      // and the error surfaces through its output.
    }
    let bundles: string[] = []
    let dependencies: string[] = []
    try {
      const manifest = await readProfileManifest(this.facts.packageJsonPath)
      bundles = manifest.bundles
      dependencies = Object.keys(manifest.dependencies)
    } catch {
      bundles = []
      dependencies = []
    }
    return { layer: { rows, bundles }, bundles, patchText, dependencies }
  }

  /** The plugin row a finished operation produced (installed or removed). */
  private async rowFor(action: 'install' | 'remove', spec: string, before: CapturedState, after: CapturedState): Promise<InstalledPluginItem | undefined> {
    let targetName: string | undefined
    if (action === 'install') {
      targetName = after.dependencies.find(name => !before.dependencies.includes(name))
    } else {
      targetName = before.dependencies.find(name => !after.dependencies.includes(name)) ?? spec
    }
    if (targetName === undefined) return undefined
    const specValue = await readProfileManifest(this.facts.packageJsonPath)
      .then(manifest => manifest.dependencies[targetName as string] ?? spec)
      .catch(() => spec)
    return buildPluginRow(this.facts, targetName, specValue, after.layer.rows)
  }

  /** Run one CLI operation to settlement; an unexpected failure settles the job as error. */
  private async run(job: GatewayJob, args: string[], timeoutMs: number): Promise<void> {
    try {
      await this.runInner(job, args, timeoutMs)
    } catch (error) {
      job.phase = 'error'
      job.error = `plugin-manager: unexpected gateway failure: ${error instanceof Error ? error.message : String(error)}`
    }
    this.retainFinished(job.id)
  }

  /** The mutation body of {@link run}. */
  private async runInner(job: GatewayJob, args: string[], timeoutMs: number): Promise<void> {
    const binary = this.binary()
    if (binary === null) {
      job.phase = 'error'
      job.error = 'plugin-manager: dsh CLI not found on PATH'
      return
    }
    const before = await this.capture()
    const output = createOutputCapture(MAX_OUTPUT_BYTES)
    const child = this.spawnCli(binary, args)
    child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, output) })
    child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, output) })
    const code = await awaitCliExit(child, output, timeoutMs)
    const tail = output.read().trim()
    // A non-zero exit is normally the whole verdict, and every other pnpm
    // condition keeps that meaning. The skipped-build-script exit is the one
    // exception: pnpm prints it after the profile has been written, so the
    // exit is re-read from the profile instead of being trusted — and only the
    // profile can say whether this run landed. The post-checks below are those
    // reads, so a tolerated exit that landed nothing still fails, with pnpm's
    // own tail as the reason.
    const tolerated: TolerableExit | undefined =
      code !== 0 && reportsIgnoredBuilds(tail) ? { code, output: tail } : undefined
    if (code !== 0 && tolerated === undefined) {
      job.phase = 'error'
      job.error = tail === '' ? `plugin-manager: dsh plugin ${job.action} exited with code ${String(code)}` : tail
      return
    }
    let after = await this.capture()
    // The selection the CLI's own run left behind. Read here, before the
    // duplicate-mount strip below removes any of its entries back out: that
    // strip is this gateway's correction, not evidence of what the run landed.
    const reconciledBundles = after.bundles
    // B9: the CLI's bundle reconciliation re-adds every bundle-declaring
    // dependency to dsh.profile.bundles — including packages the composition
    // already mounts through a patch row (the aggregate's better-sidebar
    // row), which double-mounts and kills the next boot. Strip exactly the
    // newly added, already-row-mounted entries back out before anything else
    // validates or preflights the result.
    const stripped = await this.stripDuplicateMounts(job, before, after)
    if (stripped === undefined) return
    if (stripped.length > 0) {
      job.notices = stripped.map(name => ({ id: name, name, from: 'enabled', to: 'uninstalled' }))
      after = await this.capture()
    }
    const conflicts = significantChanges(diffLayer(before.layer, after.layer))
    if (job.action === 'install') {
      const name = this.newDependency(before, after)
      if (name === undefined) {
        // B8: neither a success exit code nor a tolerated one is proof the
        // install landed.
        job.phase = 'error'
        job.error = tolerated?.output ?? 'plugin-manager: dsh plugin add 报告成功，但 profile 未新增任何依赖（安装未生效）'
        return
      }
      // B10: a dependency written without its bundle selection is a half mount,
      // and the tolerance for pnpm's exit changes nothing about that.
      if (await this.bundleSelectionMissing(name, reconciledBundles)) {
        job.phase = 'error'
        job.error = this.halfMountError(name, 'dsh plugin add 只写入了依赖，', tolerated)
        return
      }
      // B5: a duplicate entry id is boot-blocking. Never write disabled rows
      // for a shared id (they cannot stop the loader's duplicate check and
      // they flag the existing owner) — roll the NEW package back instead.
      const duplicate = await this.detectDuplicateClaims(before, after)
      if (duplicate !== undefined) {
        await this.rollbackInstall(job, name, `与现有插件的入口 id 冲突（${duplicate.ids.join(', ')}）`, conflicts)
        return
      }
      // B6 (static part): an insert entry naming an unresolvable package fails
      // the next boot's import; --dump-config cannot see it (composition only).
      const missing = await this.unresolvableInsertNames(name)
      if (missing.length > 0) {
        await this.rollbackInstall(job, name, `入口引用了不可解析的包（${missing.join(', ')}）`, conflicts)
        return
      }
      await this.verifyBoot(job, before, after, conflicts)
      if (job.phase === 'error') return
    } else if (job.action === 'update') {
      const targetId = job.targetId
      const targetVersion = job.targetVersion
      if (targetId === undefined || targetVersion === undefined || !after.dependencies.includes(targetId)) {
        job.phase = 'error'
        job.error = tolerated?.output ?? 'plugin-manager: dsh plugin add 报告成功，但目标插件未保留在 profile 中（更新未生效）'
        return
      }
      const manifest = await readProfileManifest(this.facts.packageJsonPath)
      const updated = await buildPluginRow(this.facts, targetId, manifest.dependencies[targetId] ?? job.spec, after.layer.rows)
      if (updated.version !== targetVersion) {
        job.phase = 'error'
        job.error = tolerated?.output ?? `plugin-manager: dsh plugin add 报告成功，但 ${targetId} 仍为 ${updated.version}，预期 ${targetVersion}（更新未生效）`
        return
      }
      // B10 (update): the replacement must not drop the selection it found. A
      // package the profile mounts through a patch row was never selected, so
      // its absence is the state the run found, not a loss.
      if (await this.bundleSelectionMissing(targetId, reconciledBundles, before.bundles.includes(targetId))) {
        job.phase = 'error'
        job.error = this.halfMountError(targetId, 'dsh plugin add 更新了版本，但 ', tolerated)
        return
      }
      job.plugin = updated
      const dump = await this.verifyBoot(job, before, after, conflicts)
      if (job.phase === 'error') return
      // The composed target profile — not the profile patch and not the
      // source profile — is the authority for which row ids still exist: an
      // update that retires a row leaves the user's old override pointing at
      // nothing, which the loader warns about on every boot.
      if (await this.pruneOrphanOverrides(job, dump) === undefined) return
    } else {
      // B8 (remove): an exit code — success or tolerated — must mean the
      // dependency is gone.
      const removed = before.dependencies.find(candidate => !after.dependencies.includes(candidate))
      if (removed === undefined) {
        job.phase = 'error'
        job.error = tolerated?.output ?? 'plugin-manager: dsh plugin remove 报告成功，但依赖仍在 profile 中（卸载未生效）'
        return
      }
    }
    job.conflicts = conflicts.map(change => ({
      id: change.id,
      name: change.id,
      from: change.from,
      to: change.to,
    }))
    if (job.action === 'install' || job.action === 'remove') {
      job.plugin = await this.rowFor(job.action, job.spec, before, after)
    }
    if (tolerated !== undefined) this.recordToleratedExit(job, tolerated)
    job.phase = 'done'
  }

  /**
   * Carry an accepted non-zero exit to the caller and to the host log.
   *
   * Every post-check passed, so the change landed and the job settles `done`;
   * the pnpm output is kept anyway, because it is the only record that a
   * dependency was installed without its build script — a fact the next boot
   * reports as a missing native module, with nothing left to attribute it to.
   * @param job - the job the run settles.
   * @param tolerated - the exit the profile overruled.
   */
  private recordToleratedExit(job: GatewayJob, tolerated: TolerableExit): void {
    job.warnings = [...(job.warnings ?? []), tolerated.output]
    console.warn(
      `[plugin-manager] 退出码 ${String(tolerated.code)} 已按完成处理：profile 变更已落地，pnpm 只是跳过了构建脚本（可用 pnpm approve-builds 复核）：\n${tolerated.output}`,
    )
  }

  /**
   * Post-mutation duplicate-mount safeguard (B9): remove the bundles entries
   * the CLI's reconciliation newly added for packages the before-state
   * composition already mounted through a patch row. The write goes through
   * the manifest's safe path (backup + tmp + atomic rename); entries the
   * user had before and entries with no row mount are never touched. A
   * failure of the guard itself settles the job as an error — a boot-breaking
   * bundles state is never left silently.
   * @param job - the settling job (error target on guard failure).
   * @param before - state captured before the CLI run.
   * @param after - state captured after the CLI run.
   * @returns the stripped entries, or undefined when the job failed.
   */
  private async stripDuplicateMounts(job: GatewayJob, before: CapturedState, after: CapturedState): Promise<string[] | undefined> {
    try {
      const strip = await duplicateMountBundles(
        this.facts,
        { patchText: before.patchText, dependencies: before.dependencies, rowEnabled: before.layer.rows },
        before.layer.bundles,
        after.layer.bundles,
      )
      if (strip.length === 0) return []
      await stripProfileBundles(this.facts.packageJsonPath, strip)
      return strip
    } catch (error) {
      job.phase = 'error'
      job.error = `plugin-manager: 重复挂载保护写回失败：${error instanceof Error ? error.message : String(error)}（profile 的 dsh.profile.bundles 可能仍处于重复挂载状态，下次启动前请手动检查 ${this.facts.packageJsonPath}）`
      return undefined
    }
  }

  /**
   * Compose the profile with the CLI's read-only `--dump-config` probe and
   * return the dump text. Composition writes nothing and binds no port, so it
   * is safe on every runtime — including an application-owned profile whose
   * *writes* the CLI refuses. A run that cannot compose (no CLI on this
   * runtime, a non-zero exit, a spawn failure) reports undefined, and the
   * caller must then leave the profile alone instead of guessing at the entry
   * set.
   * @returns the composed dump text, or undefined when it is unavailable.
   */
  private async compositionOf(): Promise<string | undefined> {
    const binary = this.binary()
    if (binary === null) return undefined
    try {
      const output = createOutputCapture(MAX_OUTPUT_BYTES)
      const child = this.spawnCli(binary, ['--profile', this.facts.profileName, '--dump-config'])
      child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, output) })
      child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, output) })
      const code = await awaitCliExit(child, output, 90_000)
      return code === 0 ? output.read() : undefined
    } catch {
      return undefined
    }
  }

  /**
   * The entry ids a user-layer override may still point at: the composed ids
   * plus every id the bundles the profile lists still declare.
   *
   * The composition alone does not prove a row is retired. A host that
   * composes while a bundle is being replaced — the remove-then-install half of
   * an application-owned update, or an upgrade whose packages are half
   * installed — composes *without* the rows of the bundle that is momentarily
   * gone, and pruning on that probe deletes the user's override for a row that
   * still exists (0.4.7 lost `web-ui-remote-web-ui` and `ui-schedule` this
   * way). Declarations live in the bundle layers, so they survive that window.
   *
   * Every listed bundle therefore has to answer with the declarations the
   * loader will actually mount, which for an installation-provided bundle is
   * the installation's copy rather than a profile copy that never existed
   * ({@link bundleLayerDir}).
   * @param composed - the entry ids of the composition probe.
   * @returns the ids to keep, or undefined when a declared layer cannot be
   * read, which proves nothing either way and must leave the file alone.
   */
  private async liveOverrideIds(composed: ReadonlySet<string>): Promise<Set<string> | undefined> {
    const live = new Set(composed)
    let manifest
    try {
      manifest = await readProfileManifest(this.facts.packageJsonPath)
    } catch {
      return undefined
    }
    const binary = this.binary()
    for (const name of manifest.bundles) {
      const dir = await this.bundleLayerDir(name, manifest.dependencies, binary)
      if (dir === undefined) return undefined
      let text: string
      try {
        text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
      } catch (error) {
        // A plain plugin bundle declares no rows of its own; any other read
        // failure leaves its declarations unknown.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        return undefined
      }
      try {
        for (const id of declaredRowIds(text, join(dir, 'cordis.patch.yml'))) live.add(id)
      } catch {
        return undefined
      }
    }
    return live
  }

  /**
   * The directory whose `cordis.patch.yml` declares one listed bundle's rows,
   * or undefined when those declarations cannot be known.
   *
   * The profile's own copy answers whenever it is installed. A profile that
   * lists a bundle its own `node_modules` does not carry is normally a
   * CLI-created profile naming the installation's bundles — it never installs
   * `@deepseek-ai/dsh-base` or `@deepseek-ai/dsh-web-app`, the loader mounts
   * them out of the DSH installation, and {@link hostBundleDir} names that copy,
   * whose rows are by construction the ones this boot carries.
   *
   * Everything else that reads as missing is a package this profile installs
   * itself, caught mid-install or mid-replace. Its rows can be declared by the
   * copy that is gone and by no other, so they are unknown, never empty:
   * pruning on that guess is how 0.4.7 lost the user's `web-ui-remote-web-ui`
   * and `ui-schedule` overrides. The profile's own dependency list separates
   * the two cases, because it is written by the same pnpm call that creates the
   * directory: a dependency is this profile's package, so a missing directory
   * there is unfinished work rather than an installation-provided bundle.
   * @param name - one entry of `dsh.profile.bundles`.
   * @param dependencies - the profile manifest's dependency map.
   * @param binary - the dsh CLI path, or null when this runtime has none.
   * @returns the declaring package directory, or undefined when unknown.
   */
  private async bundleLayerDir(name: string, dependencies: Record<string, string>, binary: string | null): Promise<string | undefined> {
    const dir = join(this.facts.profileDir, 'node_modules', ...name.split('/'))
    try {
      await readFile(join(dir, 'package.json'), 'utf8')
      return dir
    } catch {
      // Not installed here: an installation-provided bundle, or this profile's
      // own package being replaced. Only the dependency list tells them apart.
    }
    if (Object.hasOwn(dependencies, name)) return undefined
    return hostBundleDir(binary, name)
  }

  /**
   * The entry names the installed bundles' own rows carry, by entry id.
   *
   * The loader inserts one row per id and takes that row's name from the
   * bundle's own patch file, so this map is the very fact the loader composes:
   * a profile row naming something else is a row the loader skips.
   *
   * @returns the live names, or undefined when a bundle's patch cannot be read
   *   (which proves nothing either way and must leave the profile alone).
   */
  private async liveEntryNames(): Promise<Map<string, string> | undefined> {
    const names = new Map<string, string>()
    let manifest
    try {
      manifest = await readProfileManifest(this.facts.packageJsonPath)
    } catch {
      return undefined
    }
    for (const name of manifest.bundles) {
      const dir = join(this.facts.profileDir, 'node_modules', ...name.split('/'))
      let text: string
      try {
        text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
      } catch (error) {
        // A plain plugin bundle declares no rows of its own; any other read
        // failure leaves its declarations unknown.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        return undefined
      }
      for (const row of insertRowsOf(text)) {
        if (row.id === undefined || row.name === undefined) continue
        names.set(row.id, row.name)
      }
    }
    return names
  }

  /**
   * Point the profile's own rows at the packages that now carry those entry ids.
   *
   * A bundle that renames a row's package leaves every profile row that named
   * the old one dead: the include patch semantics skip a row whose name does
   * not match the inserted row, and the skip takes the whole row with it — a
   * config row stops configuring and a `disabled` override stops disabling,
   * both without a word in the browser. Issue #1901 moved the aggregate's
   * family rows from the `@linxin666/dsh-web-all/<family>` subpath to the
   * real package, so every profile row written before that upgrade went dead
   * with it.
   *
   * The repair is idempotent and writes only when a row actually changed, so a
   * healthy profile is never rewritten.
   *
   * @returns the repaired rows, in file order.
   */
  async repairProfileRowNames(): Promise<Array<{ id: string; from: string; to: string }>> {
    const names = await this.liveEntryNames()
    if (names === undefined || names.size === 0) return []
    let text: string
    try {
      text = await readFile(this.facts.patchPath, 'utf8')
    } catch {
      return []
    }
    let repaired: RepairedRowNames
    try {
      repaired = repairStaleRowNames(text, this.facts.patchPath, names)
    } catch {
      // A patch file this gateway cannot parse is not its to repair: the CLI
      // owns that file and reports its own parse error.
      return []
    }
    if (repaired.repaired.length === 0) return []
    await writePatchAtomic(this.facts.patchPath, repaired.text)
    return repaired.repaired
  }

  /**
   * Post-update orphan guard: drop this package's own enablement overrides
   * whose entry id neither the composed *target* profile nor any bundle layer
   * still declares. The composition is the loader's own after the update
   * ({@link composedEntryIdsOf}), widened by the bundle layers' declarations
   * ({@link liveOverrideIds}) because a composition taken mid-upgrade omits
   * rows that still exist. A retired row would otherwise leave a stale
   * override that the loader reports on every boot as
   * `patch: entry "<id>" not found`.
   *
   * The stale-row-name repair ({@link repairProfileRowNames}) runs first and
   * on its own authority, so a profile whose bundle declarations cannot be
   * resolved is repaired even though the prune then writes nothing.
   *
   * Nothing is written when nothing is orphaned — a second run over a pruned
   * profile returns the input text untouched, so no write and no second backup
   * happen — and an unobtainable composition leaves the file as it is instead
   * of emptying it. A write that does fail settles the job as an error the way
   * every other post-mutation patch write in this transaction does, with the
   * backup the write helper takes first left in place.
   * @param job - the settling job (error target on write failure).
   * @param dumpText - an already captured composition, when the caller has one.
   * @returns the pruned entry ids, or undefined when the job failed.
   */
  private async pruneOrphanOverrides(job: GatewayJob, dumpText?: string): Promise<string[] | undefined> {
    // A row whose package was renamed is dead until its name follows the
    // rename, so the names are repaired before the orphan pass decides what to
    // drop: a row that names a live package again is not an orphan. The repair
    // answers to its own authority — the names the bundles it can read declare
    // ({@link liveEntryNames}) — and runs before the guards below rather than
    // inside them: a profile that still lists a bundle whose package cannot be
    // read anywhere (a package this profile installs itself, caught mid-install
    // or mid-replace) leaves {@link liveOverrideIds} unknown, and a repair gated
    // behind that would never run, while the boot repair does it anyway.
    try {
      const repaired = await this.repairProfileRowNames()
      if (repaired.length > 0) {
        console.warn('[plugin-manager] 已修复 profile 中失效的行名：' + repaired.map(row => `${row.id}（${row.from} → ${row.to}）`).join('、'))
      }
    } catch (error) {
      console.warn('[plugin-manager] profile 行名修复失败：' + (error instanceof Error ? error.message : String(error)))
    }
    const dump = dumpText ?? await this.compositionOf()
    if (dump === undefined) return []
    const composed = composedEntryIdsOf(dump)
    if (composed === undefined) return []
    const live = await this.liveOverrideIds(composed)
    if (live === undefined) return []
    let text: string
    try {
      text = await readFile(this.facts.patchPath, 'utf8')
    } catch {
      return []
    }
    let pruned: PrunedOverrides
    try {
      pruned = pruneOrphanRowOverrides(text, this.facts.patchPath, live)
    } catch {
      // A patch file this gateway cannot parse is not its to repair: the CLI
      // owns that file and reports its own parse error.
      return []
    }
    if (pruned.pruned.length === 0) return []
    try {
      await writePatchAtomic(this.facts.patchPath, pruned.text)
      return pruned.pruned
    } catch (error) {
      job.phase = 'error'
      job.error = `plugin-manager: 失效行覆盖清理写回失败：${error instanceof Error ? error.message : String(error)}（备份在 ${this.facts.patchPath}.bak-plugin-manager，下次启动前请手动检查 ${this.facts.patchPath}）`
      return undefined
    }
  }

  /**
   * Roll back a freshly installed dependency through the official remove
   * path (which also drops its bundle), then settle the job as an error.
   * This is the owner-aware conflict resolution: the existing plugin keeps
   * its entry ids and enablement untouched.
   */
  private async rollbackInstall(job: GatewayJob, name: string, reason: string, conflicts: LayerChange[]): Promise<void> {
    let rolledBack = false
    let tail = ''
    const binary = this.binary()
    if (binary !== null) {
      const output = createOutputCapture(MAX_OUTPUT_BYTES)
      const child = this.spawnCli(binary, ['plugin', '--profile', this.facts.profileName, 'remove', name])
      child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, output) })
      child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, output) })
      const code = await awaitCliExit(child, output, REMOVE_TIMEOUT_MS)
      rolledBack = code === 0
      tail = output.read().trim()
    }
    job.phase = 'error'
    job.error = rolledBack
      ? `plugin-manager: ${reason}，已自动回滚 ${name}`
      : `plugin-manager: ${reason}；自动回滚失败，请手动执行 dsh plugin --profile ${this.facts.profileName} remove ${name}${tail === '' ? '' : `：\n${tail}`}`
    conflicts.push({ id: name, from: 'enabled', to: 'uninstalled' })
    job.conflicts = conflicts.map(change => ({ id: change.id, name: change.id, from: change.from, to: change.to }))
  }

  /**
   * Insert-entry package names of one installed dependency that resolve
   * nowhere: not the dependency itself, not another profile dependency, not
   * an official @deepseek-ai/* package, and absent from every node_modules
   * the loader could import them from. Import-time failures beyond this
   * static check still surface only at the first real boot.
   */
  private async unresolvableInsertNames(name: string): Promise<string[]> {
    const moduleDir = join(this.facts.profileDir, 'node_modules', ...name.split('/'))
    let text: string
    try {
      text = await readFile(join(moduleDir, 'cordis.patch.yml'), 'utf8')
    } catch {
      return []
    }
    const missing: string[] = []
    for (const row of insertRowsOf(text)) {
      const target = row.name
      if (target === undefined || target === '') continue
      if (target === name) continue
      if (target.startsWith('@deepseek-ai/')) continue
      if (existsSync(join(this.facts.profileDir, 'node_modules', ...target.split('/')))) continue
      if (existsSync(join(moduleDir, 'node_modules', ...target.split('/')))) continue
      missing.push(target)
    }
    return missing
  }

  /** The new dependency of an install, when one exists. */
  private newDependency(before: CapturedState, after: CapturedState): string | undefined {
    return after.dependencies.find(name => !before.dependencies.includes(name))
  }

  /**
   * Whether a run wrote a package that declares its own bundle without the
   * profile selecting it.
   *
   * The landing reads in {@link runInner} look at `dependencies` alone, and
   * pnpm writes that line before the build-script gate decides the exit: a
   * dependency is not a mount. A package declaring `dsh.bundle` is only
   * reachable through `dsh.profile.bundles`, so a selection that never landed
   * (a fresh install) or left with the run (a replacement of a selected
   * package) is a half mount: the composition carries not one row of it while
   * every other check passes.
   * @param name - the dependency the run added or targeted.
   * @param bundles - the selection the CLI's own run left behind, read before
   *   the duplicate-mount strip can correct its entries.
   * @param required - whether the selection has to be present: always for a
   *   fresh install, and for a replacement only when the profile already
   *   selected the package (a patch-row mount was never selected to lose).
   * @returns whether a bundle-declaring package ended up unselected.
   */
  private async bundleSelectionMissing(
    name: string,
    bundles: readonly string[],
    required = true,
  ): Promise<boolean> {
    if (!required || bundles.includes(name)) return false
    return declaresBundle(this.facts, name)
  }

  /**
   * The diagnostic for {@link bundleSelectionMissing}: which package the
   * composition does not mount, and the two steps that repair it. Repeating the
   * same command cannot — the CLI reconciles only the dependencies it newly
   * added — so the remedy is an approval followed by remove and add.
   * @param name - the dependency left unselected.
   * @param lead - the run's own prefix for the sentence.
   * @param tolerated - the accepted non-zero exit, whose pnpm tail names the
   *   build scripts it skipped.
   * @returns the error text.
   */
  private halfMountError(name: string, lead: string, tolerated: TolerableExit | undefined): string {
    const reason = `${lead}${name} 未进入 dsh.profile.bundles（半挂载：该组合不会挂载它）。请先在 ${join(this.facts.profileDir, 'pnpm-workspace.yaml')} 的 allowBuilds 里把要批准的包键写成 \`<包名>: true\` 的映射形式（写成列表会被 pnpm 改写成占位条目），再 dsh plugin --profile ${this.facts.profileName} remove ${name} 后重新 add`
    return tolerated === undefined
      ? `plugin-manager: ${reason}`
      : `plugin-manager: ${reason}：\n${tolerated.output}`
  }

  /** The claimed entry ids of one installed dependency (its own bundle patch, or its name). */
  private claimedEntriesOf(name: string): Promise<string[]> {
    return claimedEntryIdsOf(this.facts, name)
  }

  /** Whether the new install claims an entry id another plugin already holds. */
  private async detectDuplicateClaims(before: CapturedState, after: CapturedState): Promise<{ name: string; ids: string[] } | undefined> {
    const name = this.newDependency(before, after)
    if (name === undefined) return undefined
    const claimed = await this.claimedEntriesOf(name)
    const taken = new Set<string>(after.layer.rows.keys())
    for (const dep of after.dependencies) {
      if (dep === name) continue
      for (const id of await this.claimedEntriesOf(dep)) taken.add(id)
    }
    const overlap = overlappingIds(claimed, taken)
    if (overlap.length === 0) return undefined
    return { name, ids: overlap }
  }

  /**
   * Boot preflight after an install or update: compose the profile with the
   * CLI's `--dump-config` (resolves every entry without binding the port). A
   * failure that implicates the new plugin disables it so the next start
   * cannot fail; an unrelated failure is reported without touching anything.
   * The captured dump is returned on success so the update path can read the
   * composed entry set from the same probe (see {@link pruneOrphanOverrides}).
   * @returns the composed dump text, or undefined when the preflight did not
   *   produce one (no CLI on this runtime, or a failure the caller must read
   *   from `job`).
   */
  private async verifyBoot(job: GatewayJob, before: CapturedState, after: CapturedState, conflicts: LayerChange[]): Promise<string | undefined> {
    const binary = this.binary()
    if (binary === null) return undefined
    const name = this.newDependency(before, after)
    const verifyOutput = createOutputCapture(MAX_OUTPUT_BYTES)
    const child = this.spawnCli(binary, ['--profile', this.facts.profileName, '--dump-config'])
    child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, verifyOutput) })
    child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, verifyOutput) })
    const code = await awaitCliExit(child, verifyOutput, 90_000)
    const dump = verifyOutput.read()
    if (code === 0) return dump
    const tail = dump.trim()
    if (name === undefined) {
      job.phase = 'error'
      job.error = tail === '' ? 'plugin-manager: boot preflight failed' : tail
      return undefined
    }
    const claimed = await this.claimedEntriesOf(name)
    const implicated = tail.includes(name) || claimed.some(id => tail.includes(id))
    if (implicated) {
      // Owner-aware: roll the new package back rather than disabling shared
      // rows, which cannot reach every failure shape anyway.
      await this.rollbackInstall(job, name, `启动预检失败${tail === '' ? '' : `：\n${tail}`}`, conflicts)
    } else {
      job.phase = 'error'
      job.error = tail === ''
        ? 'plugin-manager: 启动预检失败（与本次安装无关）'
        : `plugin-manager: 启动预检失败（与本次安装无关）：\n${tail}`
    }
    return undefined
  }
}
