/**
 * Chrome process lifecycle: find the binary, start it headless on a private
 * temporary profile, and tear both the process and the profile down again.
 *
 * The host half owns exactly one browser at a time and never attaches to a
 * browser the user is running: an already-running Chrome ignores
 * `--remote-debugging-port` in practice, so a shared profile would be
 * unspeakable while looking connected. A throwaway `--user-data-dir` and an
 * OS-assigned port make every start independent and disposable.
 *
 * Failure messages are written for the person reading the panel, not for a
 * stack trace: "no Chrome installed", "the port never opened", and "the process
 * exited first" are the three things that actually happen.
 *
 * @module @linxin666/dsh-client-ui-browser-view/core/chrome
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { mkdtemp, lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_VIEWPORT } from './protocol.ts'

/** Environment variable that overrides binary discovery. */
export const CHROME_PATH_ENV = 'CHROME_PATH'

/** How long a fresh process gets to publish its DevTools endpoint. */
export const CHROME_STARTUP_TIMEOUT_MS = 20_000

/** How long `dispose` waits for a polite exit before it escalates. */
export const CHROME_EXIT_TIMEOUT_MS = 5_000

/**
 * Conventional Windows install locations, most specific first. Linux and macOS
 * paths are listed too so the same resolver works on a developer machine; a
 * missing candidate is skipped rather than reported.
 */
export const CHROME_INSTALL_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
] as const

/** Linux and macOS binaries probed by their absolute path (Windows ignores these). */
const POSIX_CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
] as const

/** Injection seams so a test can exercise discovery without touching the disk. */
export interface ChromeDiscovery {
  /** Environment to read `CHROME_PATH` from. @default process.env */
  env?: NodeJS.ProcessEnv
  /** File probe. @default existsSync */
  isFile?: (path: string) => boolean
}

/**
 * The candidate list for this platform, in probe order.
 * @param env - environment carrying `CHROME_PATH`.
 * @returns absolute candidate paths, the override first when it is set.
 */
export function chromePathCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env[CHROME_PATH_ENV]
  const candidates: string[] = []
  if (override !== undefined && override.trim() !== '') candidates.push(override.trim())
  candidates.push(...CHROME_INSTALL_CANDIDATES)
  if (process.platform !== 'win32') candidates.push(...POSIX_CHROME_CANDIDATES)
  return candidates
}

/**
 * Resolve the browser binary to launch.
 * @param discovery - environment and file-probe overrides.
 * @returns the first existing candidate, or undefined when none is installed.
 */
export function resolveChromePath(discovery: ChromeDiscovery = {}): string | undefined {
  const isFile = discovery.isFile ?? existsSync
  for (const candidate of chromePathCandidates(discovery.env ?? process.env)) {
    if (isFile(candidate)) return candidate
  }
  return undefined
}

/**
 * Ask the OS for a port that is free right now on the loopback interface.
 *
 * Binding port 0 and reading the assignment back is the only way to get a port
 * nothing else holds at this instant; the listener is closed before the caller
 * starts Chrome, so there is a small window in which another process could take
 * it. Chrome's own bind failure is detected by {@link ChromeProcess.launch}
 * (the DevTools endpoint never appears), which is why that path must report a
 * readable error rather than hanging.
 * @returns the assigned port.
 */
export async function pickFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close()
        reject(new Error('could not determine the assigned port'))
        return
      }
      const { port } = address
      probe.close(() => { resolve(port) })
    })
  })
}

/** Launch options; every field has a working default. */
export interface LaunchChromeOptions {
  /** Explicit binary path; resolution happens when omitted. */
  chromePath?: string
  /** Run without a visible window. @default true */
  headless?: boolean
  /** Window and viewport size. @default DEFAULT_VIEWPORT */
  viewport?: { width: number; height: number }
  /** Deadline for the DevTools endpoint to appear. @default CHROME_STARTUP_TIMEOUT_MS */
  startupTimeoutMs?: number
  /** Extra command-line switches appended last. */
  extraArgs?: readonly string[]
  /** Environment and file-probe overrides for discovery. */
  discovery?: ChromeDiscovery
  /**
   * Liveness seams used by {@link ChromeProcess.dispose} to decide whether the
   * browser really stopped before its profile is removed.
   */
  probe?: BrowserProbeOptions
}

/** The command-line switches every launch shares. */
export function chromeLaunchArgs(options: {
  port: number
  userDataDir: string
  headless: boolean
  viewport: { width: number; height: number }
  extraArgs?: readonly string[]
}): string[] {
  const args = [
    options.headless ? '--headless=new' : '--window-position=0,0',
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.userDataDir}`,
    `--window-size=${options.viewport.width},${options.viewport.height}`,
    // A fresh profile still phones home for the first-run experience, which
    // delays the first paint the panel is waiting for.
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--disable-component-update',
    '--disable-default-apps',
    '--hide-scrollbars',
    '--mute-audio',
    'about:blank',
  ]
  if (options.extraArgs !== undefined) args.push(...options.extraArgs)
  return args
}

/** A launched browser plus everything needed to undo the launch. */
export interface ChromeHandle {
  /** Binary that was started. */
  chromePath: string
  /** Port the DevTools endpoint listens on. */
  port: number
  /** Browser-level `webSocketDebuggerUrl`. */
  webSocketDebuggerUrl: string
  /** Profile directory this launch created and therefore owns. */
  userDataDir: string
  /** OS process id. */
  pid: number | undefined
}

/** What one disposal actually achieved. */
export interface ChromeDisposeResult {
  /**
   * Whether the BROWSER is gone. The process this module spawned may be only a
   * launcher that exits while the real browser keeps running, so a dead child
   * handle says nothing on its own.
   */
  readonly stopped: boolean
  /** Whether the profile directory was removed. */
  readonly profileRemoved: boolean
}

/** The three steps a disposal takes, injected so the decision is testable without a browser. */
export interface BrowserDisposalHooks {
  /** Ask the spawned process to exit, escalating; resolves once it had its chance. */
  terminate(): Promise<void>
  /** Resolve true while the browser still answers or its process is still alive. */
  probeAlive(): Promise<boolean>
  /** Delete the profile directory this launch created. */
  removeProfile(): Promise<void>
}

/**
 * Terminate one browser, then delete its profile only once the browser is
 * confirmed gone.
 *
 * Deleting the profile of a browser that is still running is worse than
 * leaving the directory behind: the live process loses its storage under it
 * while the caller reports a clean shutdown, and the leftover browser keeps a
 * profile path that no longer exists. So the profile is removed on evidence,
 * never on schedule.
 * @param hooks - terminate, liveness probe, profile removal.
 * @returns what the disposal achieved; never throws for a surviving browser.
 */
export async function settleBrowserDispose(hooks: BrowserDisposalHooks): Promise<ChromeDisposeResult> {
  await hooks.terminate()
  if (await hooks.probeAlive()) {
    // The browser outlived our request: its profile is live data, so it stays
    // where the running process put it.
    return { stopped: false, profileRemoved: false }
  }
  await hooks.removeProfile()
  return { stopped: true, profileRemoved: true }
}

/** How long one DevTools liveness probe may take. */
export const CHROME_PROBE_TIMEOUT_MS = 750

/** Injection seams for {@link probeBrowserAlive}. */
export interface BrowserProbeOptions {
  /** Process liveness check. @default process.kill(pid, 0) */
  isAlive?: (pid: number) => boolean
  /** DevTools endpoint query; true when it answers. @default a bounded fetch */
  fetchEndpoint?: (port: number, timeoutMs: number) => Promise<boolean>
  /** Deadline for the endpoint query. @default CHROME_PROBE_TIMEOUT_MS */
  timeoutMs?: number
}

/** Default process liveness check: signal 0 tests existence without signalling. */
function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Default DevTools probe: does /json/version still answer on the pinned port. */
async function defaultDevToolsProbe(port: number, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      headers: { host: `127.0.0.1:${port}` },
      signal: controller.signal,
    })
    return response.ok
  } catch {
    // A refused connection, an abort, or any transport failure all mean the
    // same thing here: nothing is listening, so nothing is alive.
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whether the browser behind one handle is still running.
 *
 * Two independent facts are checked because either alone lies: the spawned pid
 * can be a launcher that exited while the browser lives, and the port can be
 * closed while a process is still shutting down. Alive wins on either.
 * @param info - port and pid pinned at launch.
 * @param options - liveness seams, for tests.
 * @returns true when the browser should be considered alive.
 */
export async function probeBrowserAlive(
  info: Pick<ChromeHandle, 'port' | 'pid'>,
  options: BrowserProbeOptions = {},
): Promise<boolean> {
  const isAlive = options.isAlive ?? defaultIsProcessAlive
  if (info.pid !== undefined && isAlive(info.pid)) return true
  const query = options.fetchEndpoint ?? defaultDevToolsProbe
  try {
    return await query(info.port, options.timeoutMs ?? CHROME_PROBE_TIMEOUT_MS)
  } catch {
    // A probe that fails is a probe that found nothing; reporting "alive" here
    // would permanently retain a profile nobody is using.
    return false
  }
}

/**
 * One Chrome process together with the temporary profile it owns.
 */
export class ChromeProcess {
  private readonly child: ChildProcess
  private readonly handle: ChromeHandle
  private readonly probeOptions: BrowserProbeOptions
  private disposed = false
  private disposeResult: ChromeDisposeResult | undefined

  private constructor(child: ChildProcess, handle: ChromeHandle, probeOptions: BrowserProbeOptions) {
    this.child = child
    this.handle = handle
    this.probeOptions = probeOptions
  }

  /**
   * Start a browser and wait until its DevTools endpoint answers.
   * @param options - binary, window size, deadlines.
   * @returns the running process.
   * @throws Error naming the actual failure (missing binary, exited process, silent port).
   */
  static async launch(options: LaunchChromeOptions = {}): Promise<ChromeProcess> {
    const viewport = options.viewport ?? { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height }
    const chromePath = options.chromePath ?? resolveChromePath(options.discovery)
    if (chromePath === undefined) {
      const candidates = chromePathCandidates(options.discovery?.env ?? process.env)
      throw new Error(
        `No Chrome binary found. Set ${CHROME_PATH_ENV} to the executable, or install Chrome. Probed: ${candidates.join(', ')}`,
      )
    }
    const port = await pickFreePort()
    const userDataDir = await mkdtemp(join(tmpdir(), 'dsh-browser-view-'))
    const args = chromeLaunchArgs({
      port,
      userDataDir,
      headless: options.headless ?? true,
      viewport,
      extraArgs: options.extraArgs,
    })
    let child: ChildProcess
    try {
      child = spawn(chromePath, args, { stdio: 'ignore', windowsHide: true })
    } catch (error) {
      await removeTempProfile(userDataDir)
      throw new Error(`Could not start ${chromePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    const process_ = new ChromeProcess(
      child,
      { chromePath, port, userDataDir, webSocketDebuggerUrl: '', pid: child.pid },
      options.probe ?? {},
    )
    try {
      const endpoint = await waitForDevToolsEndpoint({
        port,
        child,
        timeoutMs: options.startupTimeoutMs ?? CHROME_STARTUP_TIMEOUT_MS,
      })
      process_.handle.webSocketDebuggerUrl = endpoint
      return process_
    } catch (error) {
      await process_.dispose()
      throw error
    }
  }

  /** The endpoint facts of this launch. */
  get info(): Readonly<ChromeHandle> {
    return this.handle
  }

  /** Whether {@link dispose} already ran. */
  get isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Subscribe to child-process exit so attached transports mark themselves
   * closed without waiting for idle WebSocket teardown (#2051).
   */
  onExit(listener: () => void): () => void {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      listener()
      return () => undefined
    }
    this.child.once('exit', listener)
    return () => {
      this.child.off('exit', listener)
    }
  }

  /**
   * What the disposal achieved, once it ran. A caller that needs to know
   * whether a browser survived the shutdown reads this instead of assuming.
   * @returns the recorded outcome, or undefined before {@link dispose}.
   */
  get lastDispose(): ChromeDisposeResult | undefined {
    return this.disposeResult
  }

  /**
   * Kill the process (escalating once), then delete the profile directory this
   * launch created — but only once the browser is confirmed gone.
   * @returns whether the browser stopped and whether its profile was removed.
   */
  async dispose(): Promise<ChromeDisposeResult> {
    if (this.disposeResult !== undefined) return this.disposeResult
    this.disposed = true
    this.disposeResult = await settleBrowserDispose({
      terminate: () => terminate(this.child),
      probeAlive: async () => await probeBrowserAlive(this.handle, this.probeOptions),
      removeProfile: async () => { await removeTempProfile(this.handle.userDataDir) },
    })
    return this.disposeResult
  }
}

/**
 * Poll `/json/version` until the browser publishes its debugger URL.
 * @param options - port, child handle, deadline.
 * @returns the `webSocketDebuggerUrl`.
 */
async function waitForDevToolsEndpoint(options: {
  port: number
  child: ChildProcess
  timeoutMs: number
}): Promise<string> {
  const deadline = Date.now() + options.timeoutMs
  let lastError = 'no response'
  while (Date.now() < deadline) {
    // A process that already exited will never open the port; reporting that
    // separately turns a 20 s hang into an immediate, specific message.
    const exitCode = options.child.exitCode
    if (exitCode !== null) {
      throw new Error(
        `Chrome exited before its DevTools endpoint came up (exit code ${exitCode})${describeExitHint(options.port)}`,
      )
    }
    try {
      const response = await fetch(`http://127.0.0.1:${options.port}/json/version`, { headers: { host: `127.0.0.1:${options.port}` } })
      if (response.ok) {
        const body = (await response.json()) as { webSocketDebuggerUrl?: unknown }
        if (typeof body.webSocketDebuggerUrl === 'string' && body.webSocketDebuggerUrl !== '') {
          return body.webSocketDebuggerUrl
        }
        lastError = 'the DevTools endpoint reported no webSocketDebuggerUrl'
      } else {
        lastError = `HTTP ${response.status} from /json/version`
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise<void>(resolve => { setTimeout(resolve, 100) })
  }
  throw new Error(
    `Chrome did not open its DevTools endpoint on 127.0.0.1:${options.port} within ${options.timeoutMs} ms (${lastError})`,
  )
}

/** A hint appended to an early-exit message for the most common cause. */
function describeExitHint(port: number): string {
  return `. The profile directory may be locked, or another process holds port ${port}.`
}

/**
 * Terminate one child process, escalating to SIGKILL after a grace period.
 * On Windows, `child.kill()` stops only the parent PID while Chrome's GPU and
 * Crashpad children linger and lock the temp profile; invoke `taskkill /T /F`
 * beside it so the whole process tree shuts down cleanly (#2051).
 * @param child - the process launched for this browser.
 */
async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.once('error', () => resolve())
  })
  if (process.platform === 'win32' && child.pid !== undefined) {
    await killProcessTreeWin32(child.pid)
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    await exited
    return
  }
  try {
    child.kill()
  } catch {
    return
  }
  const escalated = await Promise.race([
    exited.then(() => 'exited' as const),
    new Promise<'timeout'>(resolve => { setTimeout(() => resolve('timeout'), CHROME_EXIT_TIMEOUT_MS) }),
  ])
  if (escalated === 'exited') return
  try {
    child.kill('SIGKILL')
  } catch {
    return
  }
  await Promise.race([
    exited,
    new Promise<void>(resolve => { setTimeout(resolve, CHROME_EXIT_TIMEOUT_MS) }),
  ])
}

/** Force-terminate a Windows process tree rooted at `pid`, ignoring already-gone errors. */
async function killProcessTreeWin32(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, CHROME_EXIT_TIMEOUT_MS)
    const unref = (timer as unknown as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(timer)
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('close', finish)
      killer.once('error', finish)
    } catch {
      finish()
    }
  })
}

/**
 * Delete the profile directory this launch created, without ever following a
 * link out of it. Retries briefly on transient file locks left behind while
 * browser subprocesses release handles (#2051).
 *
 * `fs.rm({ recursive: true })` is banned repository-wide: recursion walks a
 * junction or symlink happily and deletes whatever it points at, so a temp
 * profile that happens to contain one could remove an unrelated tree. This
 * walk instead unlinks a link in place (never descending into it), unlinks
 * regular files, and removes directories only after their contents are gone.
 * Failures are swallowed: a leftover file in the OS temp directory is a lesser
 * problem than failing the dispose path that the caller is awaiting.
 * @param dir - absolute path of the profile directory created by this launch.
 * @param retryDelaysMs - backoff delays after locked removals.
 */
export async function removeTempProfile(
  dir: string,
  retryDelaysMs: readonly number[] = [50, 150, 350],
): Promise<void> {
  // Only ever clean a directory this module created under the OS temp dir.
  const root = tmpdir()
  if (!dir.startsWith(root) || dir === root) return
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    await emptyDirectory(dir)
    try {
      await rmdir(dir)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT') return
      const delay = retryDelaysMs[attempt]
      if (delay === undefined) return
      await new Promise<void>(resolve => { setTimeout(resolve, delay) })
    }
  }
}

/** Recursively empty one directory, refusing to descend through links. */
async function emptyDirectory(dir: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      // A link is removed as a link; its target is outside this tree by
      // definition and is not ours to delete.
      await unlink(path).catch(() => undefined)
      continue
    }
    if (entry.isDirectory()) {
      // A Windows directory junction reports as a directory, so the link test
      // above is not enough: re-check the entry itself before descending.
      const stats = await lstat(path).catch(() => undefined)
      if (stats === undefined) continue
      if (stats.isSymbolicLink()) {
        await unlink(path).catch(() => undefined)
        continue
      }
      await emptyDirectory(path)
      await rmdir(path).catch(() => undefined)
      continue
    }
    await unlink(path).catch(() => undefined)
  }
}
