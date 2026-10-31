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
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import type { InstalledPluginItem } from '../core/protocol.ts'
import type { ControlChange } from '../core/conflict.ts'
import { diffLayer, overlappingIds, significantChanges, type LayerChange, type LayerSnapshot } from '../core/patch-diff.ts'
import { duplicateMountBundles } from './bundle-guard.ts'
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

/** One CLI-backed operation in flight or settled. */
export interface GatewayJob {
  id: string
  action: 'install' | 'update' | 'migrate' | 'remove'
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

/**
 * What one two-phase replacement produced: the failure to report, or the fact
 * that the target landed and only a restart loads it.
 */
interface ReplacementResult {
  /** The failure to report, or undefined once the target spec landed. */
  failure?: string
  /**
   * Whether the official manager answered `restart-required` for a run that
   * applied (issue #1905): the profile carries the target version while the
   * running process no longer holds the bundle's rows.
   */
  restartRequired: boolean
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
        await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
        job.error = `plugin-manager: 迁移安装 ${targetSpec} 失败${add.output === '' ? '' : `：\n${add.output}`}`
        return
      }
      after = await this.capture()
    }
    if (!after.dependencies.includes(targetId)) {
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      job.error = tolerated === undefined
        ? `plugin-manager: dsh plugin add 报告成功，但 ${targetId} 未出现在 profile 中`
        : `plugin-manager: 迁移安装 ${targetSpec} 失败${tolerated.output === '' ? '' : `：\n${tolerated.output}`}`
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
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      job.error = `plugin-manager: 迁移后的启动预检失败${verify.output === '' ? '' : `：\n${verify.output}`}`
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
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      job.error = `plugin-manager: 迁移后 ${targetId} 版本为 ${updated.version}，预期 ${targetVersion}`
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

  /** Restore the original legacy package after a failed migration. */
  private async rollbackMigration(
    job: GatewayJob,
    sourceId: string,
    targetId: string,
    oldSpec: string,
    oldIndex: number,
    targetPreviouslyInstalled: boolean,
  ): Promise<void> {
    const binary = this.binary()
    if (binary === null) {
      job.phase = 'error'
      job.error = 'plugin-manager: 迁移失败且无法回滚：dsh CLI not found on PATH'
      return
    }
    const current = await this.capture()
    if (!targetPreviouslyInstalled && current.dependencies.includes(targetId)) {
      await this.runCli(binary, ['plugin', '--profile', this.facts.profileName, 'remove', targetId], REMOVE_TIMEOUT_MS)
    }
    // If the current aggregate already existed before this migration, the
    // profile already had both bundles and was unusable. Keep the single
    // current aggregate on rollback instead of re-adding the legacy duplicate.
    if (targetPreviouslyInstalled) {
      job.phase = 'error'
      job.error = 'plugin-manager: 聚合包迁移失败，已保留当前聚合包并移除旧包'
      return
    }
    const restoreOld = this.restoreSpec(sourceId, oldSpec)
    const restored = await this.runCli(
      binary,
      ['plugin', '--profile', this.facts.profileName, 'add', restoreOld],
      ADD_TIMEOUT_MS,
    )
    if (restored.code !== 0) {
      job.phase = 'error'
      job.error = `plugin-manager: 迁移失败且回滚到 ${restoreOld} 失败${restored.output === '' ? '' : `：\n${restored.output}`}`
      return
    }
    if (oldIndex >= 0) {
      await reorderProfileBundle(this.facts.packageJsonPath, sourceId, oldIndex).catch(() => undefined)
    }
    job.phase = 'error'
    job.error = 'plugin-manager: 聚合包迁移失败，已回滚到旧包'
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
    const spec = `${id}@${version}`
    const job: GatewayJob = {
      id: `job-${++this.counter}`,
      action: 'update',
      spec,
      targetId: id,
      targetVersion: version,
      phase: 'running',
    }
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
      this.enqueueNativeUpdate(job, native)
      return { jobId: job.id }
    }
    this.enqueue(() => this.run(job, ['plugin', '--profile', this.facts.profileName, 'add', spec], ADD_TIMEOUT_MS))
    return { jobId: job.id }
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

  /** Start an in-place update through the official in-process manager. */
  private enqueueNativeUpdate(job: GatewayJob, native: NativePluginManager): void {
    this.enqueue(async () => {
      try {
        await this.runNativeUpdate(job, native)
      } catch (error) {
        job.phase = 'error'
        job.error = `plugin-manager: 官方插件管理器更新失败：${error instanceof Error ? error.message : String(error)}`
      }
      this.retainFinished(job.id)
    })
  }

  /**
   * Run one update through the official in-process manager (an application-owned
   * profile, where the CLI refuses to write). The manager resolves the registry,
   * runs pnpm with the launcher's bundled toolchain and applies the bundle, then
   * this reads the profile the same way the CLI path does: the dependency must
   * still be there and the installed version must be the one the route resolved,
   * so a green manager call that changed nothing is still reported as a failure.
   * Its resolved verdict is read first ({@link nativeManagerFailure}): a refused
   * run (pnpm exited non-zero, an incompatible version, a cancellation) resolves
   * with `application: 'failed'`, and only that verdict carries the reason — the
   * profile re-read can only show that the version did not move.
   *
   * An `already-installed` refusal is answered by {@link replaceInstalled}: the
   * manager refuses to install a dependency the profile already carries while the
   * host mounts `hmr` (0.2.1-rc.2, and dsh-base mounts that service on every
   * profile host), so an in-place update there is only expressible as its two
   * phases. The single call stays first so the day the manager accepts an
   * in-place update this path needs no change.
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
    const before = await this.capture()
    const carried = await readProfileManifest(this.facts.packageJsonPath)
    const first = await native.installBundle(job.spec, { enabled: true, requestId: job.id })
    let refusal = nativeManagerFailure(first)
    // A landed run that answered `restart-required` is still a landed run; the
    // fact is carried to the caller instead of being folded into a failure.
    let restartRequired = nativeManagerRestartRequired(first)
    if (refusal !== undefined && nativeManagerRefusalCode(first) === 'already-installed') {
      const replacement = await this.replaceInstalled(job, native, targetId, carried.dependencies[targetId])
      refusal = replacement.failure
      restartRequired = replacement.restartRequired
    }
    if (refusal !== undefined) {
      job.phase = 'error'
      job.error = `plugin-manager: 官方插件管理器更新失败：${refusal}`
      return
    }
    const after = await this.capture()
    if (!after.dependencies.includes(targetId)) {
      job.phase = 'error'
      job.error = `plugin-manager: 官方插件管理器报告成功，但目标插件未保留在 profile 中（更新未生效）`
      return
    }
    const manifest = await readProfileManifest(this.facts.packageJsonPath)
    const updated = await buildPluginRow(this.facts, targetId, manifest.dependencies[targetId] ?? job.spec, after.layer.rows)
    if (updated.version !== targetVersion) {
      job.phase = 'error'
      job.error = `plugin-manager: 官方插件管理器报告成功，但 ${targetId} 仍为 ${updated.version}，预期 ${targetVersion}（更新未生效）`
      return
    }
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
    // The version landed, so the job is `done`; this names what only a restart
    // can load, which is exactly the fact an in-place success does not carry.
    if (restartRequired) job.restartRequired = [targetId]
    job.phase = 'done'
  }

  /**
   * Replace an installed bundle with the update job's target spec through the
   * official manager, the only writer an application-owned profile accepts.
   * Removing first is what makes the install possible: the manager's
   * `already-installed` guard reads the profile, so the same name is a fresh
   * dependency once the old one is gone.
   *
   * A failed second phase reinstalls the spec the profile carried before the run,
   * so an update that cannot land leaves a working plugin behind instead of an
   * empty slot; the report says which of the two happened.
   *
   * Two facts make the replacement safe to repeat in one session:
   *
   * - **The bundle keeps its layer index.** A removal drops the name from
   *   `dsh.profile.bundles` and the reinstall appends it, so a plain
   *   remove-then-install moves the bundle behind every bundle that followed it
   *   and its patch layer starts overriding rows it never overrode
   *   ({@link restoreBundleIndex} puts it back).
   * - **A `bundle-in-use` refusal is answered once, not repeated.** The
   *   official guard deselects the bundle and reloads before it checks whether
   *   the bundle's rows still run, so a real occupant cleared by that reload is
   *   gone on the second call: the update is retried exactly once against that
   *   settled state, and a second refusal restores the selection and names the
   *   restart the person has to do ({@link removeForReplacement}).
   * - **A landed replacement can still need a restart.** The guard answers
   *   `application: 'restart-required'` when the removal applied and the
   *   replaced bundle's rows are already gone from the running process (issue
   *   #1905). The version does land, so that is a fact to report, not a failure:
   *   the update is `done` and names what only a restart loads.
   *
   * @param job - the update job whose spec is installed.
   * @param native - the official manager.
   * @param targetId - the installed bundle being replaced.
   * @param previousSpec - the dependency spec the profile carried before the run.
   * @returns the failure to report, or the restart fact once the target landed.
   */
  private async replaceInstalled(
    job: GatewayJob,
    native: NativePluginManager,
    targetId: string,
    previousSpec: string | undefined,
  ): Promise<ReplacementResult> {
    if (previousSpec === undefined) {
      return { failure: `${targetId} 不在 profile 依赖中，无法替换已安装版本`, restartRequired: false }
    }
    // Read while the bundle is still in the list: the removal is what drops it.
    const index = await this.bundleIndexOf(targetId)
    const removal = await this.removeForReplacement(native, targetId)
    if (removal.failure !== undefined) {
      if (removal.deselected) await this.restoreBundleSelection(native, targetId)
      return { failure: `已安装版本无法移除（${removal.failure}），本次更新未做改动${removal.remedy}`, restartRequired: false }
    }
    const installVerdict = await native.installBundle(job.spec, { enabled: true, requestId: job.id })
    const refusal = nativeManagerFailure(installVerdict)
    // Either phase can report it: the removal because the old rows are already
    // gone, the reinstall because the new ones cannot be loaded in place.
    const restartRequired = removal.restartRequired || nativeManagerRestartRequired(installVerdict)
    if (refusal === undefined) {
      await this.restoreBundleIndex(targetId, previousSpec, index)
      return { restartRequired }
    }
    const restoreSpec = `${targetId}@${previousSpec}`
    const restoreFailure = nativeManagerFailure(await native.installBundle(restoreSpec, { enabled: true, requestId: job.id }))
    if (restoreFailure !== undefined) {
      return { failure: `${refusal}；装回 ${restoreSpec} 也失败：${restoreFailure}，请手动重新安装`, restartRequired: false }
    }
    // The rollback reinstalls the previous version at the end of the list too,
    // so the same index has to be restored for a failed update as for a landed one.
    await this.restoreBundleIndex(targetId, previousSpec, index)
    return { failure: `${refusal}；已装回 ${restoreSpec}`, restartRequired: false }
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

  /**
   * Remove a bundle for the two-phase replacement, answering the official
   * manager's in-use refusal instead of repeating it.
   *
   * Read the official `removeBundle` guard in order: it deselects the bundle,
   * reloads the profile, and only then checks whether the bundle's own rows
   * still hold a running fiber, which it reports as `bundle-in-use`. A refusal
   * is therefore answered exactly once, against the state that reload left on
   * disk: that covers a real occupant whose fiber the reload did clear.
   *
   * It does not cover a reload that rebuilds the very rows it just unloaded —
   * the fresh fiber matches the guard again — so the retry is worth exactly one
   * call and never a loop, and the second refusal names the restart instead of
   * a bare code. A removal the guard does apply while the rows are already gone
   * resolves as `application: 'restart-required'`; that is a success carrying a
   * restart fact, which is reported as such rather than as a refusal.
   * @param native - the official manager.
   * @param name - the bundle to remove.
   * @returns the refusal to report, whether the profile lost the selection on the
   * way, the remedy text for that refusal, and whether the applied removal still
   * needs a restart to load.
   */
  private async removeForReplacement(
    native: NativePluginManager,
    name: string,
  ): Promise<{ failure?: string, deselected: boolean, remedy: string, restartRequired: boolean }> {
    const first = await native.removeBundle(name)
    const failure = nativeManagerFailure(first)
    if (failure === undefined) {
      return { deselected: false, remedy: '', restartRequired: nativeManagerRestartRequired(first) }
    }
    // Any other refusal is final: a retry cannot change a management-owned
    // bundle, a missing dependency or a failed pnpm run.
    if (nativeManagerRefusalCode(first) !== 'bundle-in-use') {
      return { failure, deselected: await this.bundleSelectionLost(name), remedy: '', restartRequired: false }
    }
    // The guard deselected the bundle before refusing; a second call finds the
    // selection it left and checks the rows once more.
    const second = await native.removeBundle(name)
    const retryFailure = nativeManagerFailure(second)
    if (retryFailure === undefined) {
      return { deselected: false, remedy: '', restartRequired: nativeManagerRestartRequired(second) }
    }
    return {
      failure: retryFailure,
      deselected: await this.bundleSelectionLost(name),
      remedy: '；该插件仍由当前 DSH 进程加载，重启 DSH 后再执行本次更新即可',
      restartRequired: false,
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
    const job: GatewayJob = {
      id: `job-${++this.counter}`,
      action: 'migrate',
      spec: targetSpec,
      sourceId,
      targetId,
      targetVersion,
      targetSpec,
      phase: 'running',
    }
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(sourceId) ?? unsafeSpecReason(targetId) ?? unsafeSpecReason(targetSpec)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    this.enqueue(async () => {
      try {
        await this.runMigration(job)
      } catch (error) {
        if (job.phase !== 'error') {
          job.phase = 'error'
          job.error = `plugin-manager: unexpected migration failure: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      this.retainFinished(job.id)
    })
    return { jobId: job.id }
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
    }
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
   * plus every id the profile's own bundle layers still declare.
   *
   * The composition alone does not prove a row is retired. A host that
   * composes while a bundle is being replaced — the remove-then-install half of
   * an application-owned update, or an upgrade whose packages are half
   * installed — composes *without* the rows of the bundle that is momentarily
   * gone, and pruning on that probe deletes the user's override for a row that
   * still exists (0.4.7 lost `web-ui-remote-web-ui` and `ui-schedule` this
   * way). Declarations live in the bundle layers, so they survive that window.
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
    for (const name of manifest.bundles) {
      const dir = join(this.facts.profileDir, 'node_modules', ...name.split('/'))
      try {
        await readFile(join(dir, 'package.json'), 'utf8')
      } catch {
        // The bundle's package is not resolvable right now (mid-install, or a
        // link that moved): its rows cannot be known, so nothing may be pruned.
        return undefined
      }
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
    // inside them: a profile whose bundle list names a package that is not
    // installed (the normal shape of a CLI-created profile, which lists
    // `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` without
    // installing them) leaves {@link liveOverrideIds} unknown, and a repair
    // gated behind that would never run, while the boot repair does it anyway.
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
