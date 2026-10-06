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

import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import type { InstalledPluginItem } from '../core/protocol.ts'
import type { ControlChange } from '../core/conflict.ts'
import { diffLayer, overlappingIds, significantChanges, type LayerChange, type LayerSnapshot } from '../core/patch-diff.ts'
import { duplicateMountBundles } from './bundle-guard.ts'
import { readProfileManifest, reorderProfileBundle, stripProfileBundles, type ProfileFacts } from './profile.ts'
import { insertRowsOf, parsePatch, bareRowEnabled, bareRowId } from './rows.ts'
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
 * Spawn the dsh CLI with piped stdio and no shell parsing (see
 * {@link dshSpawnCommand}).
 *
 * The CLI's own directory goes first on the child PATH: npm-global, homebrew and
 * packaged layouts keep `node`, `pnpm` and `npx` beside the `dsh` shim, and a
 * GUI-launched host carries none of them on its own PATH — the CLI forwards
 * `dsh plugin` to pnpm, so without this the update would start and then fail on
 * a missing pnpm instead. This mirrors the packaged Desktop launcher, which
 * prepends its bundled runtime bin to the host it spawns.
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
    return spawn('cmd.exe', windowsCmdShimArgs(command, args), {
      env: childEnv,
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  return spawn(command, [...argsPrefix, ...args], {
    env: command === process.execPath ? { ...childEnv, ELECTRON_RUN_AS_NODE: '1' } : childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Entry-id line of the official installer channels in the boot dump. A plain
 * substring probe false-positives on any unrelated entry whose id, name, or
 * config mentions the mark, so only a real `id:` row counts.
 */
const OFFICIAL_INSTALLER_PATTERN = /^\s*-?\s*id:\s*['"]?plugin-(?:installer|control)['"]?\s*$/m

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
  const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })
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
   * Install or update one package spec through the official manager.
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

/** One layer snapshot plus the profile patch text and dependency list. */
interface CapturedState {
  layer: LayerSnapshot
  bundles: string[]
  /** Raw profile patch text (the duplicate-mount guard reads row names from it). */
  patchText: string
  dependencies: string[]
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
    const timer = setTimeout(() => { child.kill() }, timeoutMs)
    const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })
    clearTimeout(timer)
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
    if (shouldAddTarget) {
      const add = await this.runCli(
        binary,
        ['plugin', '--profile', this.facts.profileName, 'add', targetSpec],
        ADD_TIMEOUT_MS,
      )
      if (add.code !== 0) {
        await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
        job.error = `plugin-manager: 迁移安装 ${targetSpec} 失败${add.output === '' ? '' : `：\n${add.output}`}`
        return
      }
      after = await this.capture()
    }
    if (!after.dependencies.includes(targetId)) {
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      job.error = `plugin-manager: dsh plugin add 报告成功，但 ${targetId} 未出现在 profile 中`
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
    const verdict = await native.installBundle(job.spec, { enabled: true, requestId: job.id })
    const refusal = nativeManagerFailure(verdict)
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
    job.plugin = updated
    job.conflicts = significantChanges(diffLayer(before.layer, after.layer)).map(change => ({
      id: change.id,
      name: change.id,
      from: change.from,
      to: change.to,
    }))
    job.phase = 'done'
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
    const timer = setTimeout(() => { child.kill() }, timeoutMs)
    const code = await new Promise<number | null>(resolve => {
      child.on('close', resolve)
    })
    clearTimeout(timer)
    if (code !== 0) {
      job.phase = 'error'
      const tail = output.read().trim()
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
        // B8: a success exit code is not proof the install landed.
        job.phase = 'error'
        job.error = 'plugin-manager: dsh plugin add 报告成功，但 profile 未新增任何依赖（安装未生效）'
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
        job.error = 'plugin-manager: dsh plugin add 报告成功，但目标插件未保留在 profile 中（更新未生效）'
        return
      }
      const manifest = await readProfileManifest(this.facts.packageJsonPath)
      const updated = await buildPluginRow(this.facts, targetId, manifest.dependencies[targetId] ?? job.spec, after.layer.rows)
      if (updated.version !== targetVersion) {
        job.phase = 'error'
        job.error = `plugin-manager: dsh plugin add 报告成功，但 ${targetId} 仍为 ${updated.version}，预期 ${targetVersion}（更新未生效）`
        return
      }
      job.plugin = updated
      await this.verifyBoot(job, before, after, conflicts)
      if (job.phase === 'error') return
    } else {
      // B8 (remove): a success exit code must mean the dependency is gone.
      const removed = before.dependencies.find(candidate => !after.dependencies.includes(candidate))
      if (removed === undefined) {
        job.phase = 'error'
        job.error = 'plugin-manager: dsh plugin remove 报告成功，但依赖仍在 profile 中（卸载未生效）'
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
    job.phase = 'done'
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
      const timer = setTimeout(() => { child.kill() }, REMOVE_TIMEOUT_MS)
      const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })
      clearTimeout(timer)
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
   * Boot preflight after an install: compose the profile with the CLI's
   * `--dump-config` (resolves every entry without binding the port). A failure
   * that implicates the new plugin disables it so the next start cannot fail;
   * an unrelated failure is reported without touching anything.
   */
  private async verifyBoot(job: GatewayJob, before: CapturedState, after: CapturedState, conflicts: LayerChange[]): Promise<void> {
    const binary = this.binary()
    if (binary === null) return
    const name = this.newDependency(before, after)
    const verifyOutput = createOutputCapture(MAX_OUTPUT_BYTES)
    const child = this.spawnCli(binary, ['--profile', this.facts.profileName, '--dump-config'])
    child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, verifyOutput) })
    child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, verifyOutput) })
    const timer = setTimeout(() => { child.kill() }, 90_000)
    const code = await new Promise<number | null>(resolve => {
      child.on('close', resolve)
    })
    clearTimeout(timer)
    if (code === 0) return
    const tail = verifyOutput.read().trim()
    if (name === undefined) {
      job.phase = 'error'
      job.error = tail === '' ? 'plugin-manager: boot preflight failed' : tail
      return
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
  }
}
