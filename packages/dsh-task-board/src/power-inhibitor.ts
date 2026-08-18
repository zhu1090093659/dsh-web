import { spawn as nodeSpawn, spawnSync as nodeSpawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import type { PowerPhase, TaskBoardPowerSnapshot } from './protocol.ts'

const RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000] as const
const DARWIN_STABLE_MS = 30_000

const WINDOWS_HELPER = String.raw`
$source = @'
using System;
using System.Runtime.InteropServices;
public static class DshExecutionState {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint flags);
}
'@
Add-Type -TypeDefinition $source
$continuous = [Convert]::ToUInt32('80000000', 16)
$systemRequired = [uint32]0x00000001
try {
  $result = [DshExecutionState]::SetThreadExecutionState($continuous -bor $systemRequired)
  if ($result -eq 0) { throw 'SetThreadExecutionState failed' }
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
  while ([Console]::In.ReadLine() -ne $null) { }
} finally {
  [void][DshExecutionState]::SetThreadExecutionState($continuous)
}
`

const LINUX_HELPER = String.raw`
process.stdout.write('READY\n')
process.stdin.resume()
`

const LINUX_INHIBIT_PATHS = ['/usr/bin/systemd-inhibit', '/bin/systemd-inhibit'] as const

export interface PowerReasons {
  runningSessions: number
  armedSchedules: number
  sessionStateKnown: boolean
}

export interface SpawnOptions {
  shell: false
  windowsHide: boolean
  stdio: ['pipe', 'pipe', 'pipe'] | ['ignore', 'ignore', 'ignore']
}

export type SpawnLike = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess
export type SpawnSyncLike = (
  file: string,
  args: readonly string[],
  options: { stdio: 'ignore'; timeout: number; windowsHide: boolean },
) => Pick<SpawnSyncReturns<Buffer>, 'status' | 'error'>

export interface PowerInhibitorOptions {
  platform?: NodeJS.Platform
  pid?: number
  env?: NodeJS.ProcessEnv
  spawn?: SpawnLike
  spawnSync?: SpawnSyncLike
  exists?: typeof existsSync
  execPath?: string
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

export class PowerInhibitor {
  private readonly listeners = new Set<() => void>()
  private enabled = false
  private reasons: PowerReasons = { runningSessions: 0, armedSchedules: 0, sessionStateKnown: false }
  private phase: PowerPhase = 'disabled'
  private child: ChildProcess | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private retryReset: ReturnType<typeof setTimeout> | undefined
  private retryIndex = 0
  private lastError: string | undefined
  private stopping = false
  private readonly platform: NodeJS.Platform
  private readonly pid: number
  private readonly env: NodeJS.ProcessEnv
  private readonly spawn: SpawnLike
  private readonly spawnSync: SpawnSyncLike
  private readonly exists: typeof existsSync
  private readonly execPath: string
  private readonly timer: typeof globalThis.setTimeout
  private readonly clearTimer: typeof globalThis.clearTimeout
  private linuxProbe: { executable?: string; available: boolean } | undefined

  constructor(options: PowerInhibitorOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.pid = options.pid ?? process.pid
    this.env = options.env ?? process.env
    this.spawn = options.spawn ?? ((file, args, spawnOptions) => nodeSpawn(file, [...args], spawnOptions))
    this.spawnSync = options.spawnSync ?? ((file, args, spawnOptions) => nodeSpawnSync(file, [...args], spawnOptions))
    this.exists = options.exists ?? existsSync
    this.execPath = options.execPath ?? process.execPath
    this.timer = options.setTimeout ?? globalThis.setTimeout
    this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.sync()
    this.emit()
  }

  updateReasons(reasons: PowerReasons): void {
    this.reasons = reasons
    this.sync()
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot(): TaskBoardPowerSnapshot {
    return {
      platform: this.platform,
      phase: this.phase,
      enabled: this.enabled,
      ...this.reasons,
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
    }
  }

  dispose(): void {
    this.enabled = false
    this.release()
    this.phase = 'disabled'
    this.emit()
    this.listeners.clear()
  }

  private desired(): boolean {
    return this.enabled && (!this.reasons.sessionStateKnown || this.reasons.runningSessions > 0 || this.reasons.armedSchedules > 0)
  }

  private sync(): void {
    if (!this.enabled) {
      this.release()
      this.phase = 'disabled'
      return
    }
    if (this.platform !== 'darwin' && this.platform !== 'win32' && this.platform !== 'linux') {
      this.release()
      this.phase = 'unsupported'
      return
    }
    if (this.platform === 'linux' && this.linuxSystemdInhibit() === undefined) {
      this.release()
      this.phase = 'unsupported'
      return
    }
    if (!this.desired()) {
      this.release()
      this.phase = 'idle'
      return
    }
    if (this.child === undefined && this.retry === undefined) this.acquire()
  }

  private acquire(): void {
    this.phase = 'acquiring'
    this.emit()
    this.stopping = false
    try {
      const child = this.spawnCommand()
      this.child = child
      let ready = false
      let stderr = ''
      if (this.platform === 'darwin') {
        child.once('spawn', () => {
          ready = true
          this.markReady(child)
        })
      }
      child.stdout?.on('data', (chunk: Buffer) => {
        if (!ready && chunk.toString('utf8').includes('READY')) {
          ready = true
          this.markReady(child)
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2_000)
      })
      child.on('error', error => { this.fail(error, child) })
      child.on('exit', (code, signal) => {
        if (this.child !== child) return
        this.child = undefined
        if (this.stopping || !this.desired()) return
        const detail = stderr.trim()
        this.fail(new Error(`power helper exited (${String(code ?? signal ?? 'unknown')})${detail === '' ? '' : `: ${detail}`}`))
      })
    } catch (error) {
      this.fail(error)
    }
  }

  private markReady(child: ChildProcess): void {
    if (this.child !== child || !this.desired()) return
    this.phase = 'active'
    if (this.platform === 'darwin') {
      this.retryReset = this.timer(() => {
        this.retryReset = undefined
        if (this.child === child && this.desired()) this.retryIndex = 0
      }, DARWIN_STABLE_MS)
    } else {
      this.retryIndex = 0
    }
    this.lastError = undefined
    this.emit()
  }

  private fail(error: unknown, source?: ChildProcess): void {
    if (source !== undefined && this.child !== source) return
    this.clearRetryReset()
    this.lastError = error instanceof Error ? error.message : String(error)
    this.phase = 'error'
    this.emit()
    const child = this.child
    this.child = undefined
    child?.stdin?.end()
    child?.kill()
    if (!this.desired() || this.retry !== undefined) return
    const delay = RETRY_DELAYS[Math.min(this.retryIndex, RETRY_DELAYS.length - 1)]
    this.retryIndex += 1
    this.retry = this.timer(() => {
      this.retry = undefined
      if (this.desired()) this.acquire()
    }, delay)
  }

  private release(): void {
    this.clearRetryReset()
    if (this.retry !== undefined) {
      this.clearTimer(this.retry)
      this.retry = undefined
    }
    this.lastError = undefined
    const child = this.child
    this.child = undefined
    if (child === undefined) return
    this.stopping = true
    if (this.platform === 'win32' || this.platform === 'linux') {
      child.stdin?.end()
      const force = this.timer(() => { if (child.exitCode === null) child.kill() }, 1_000)
      child.once('exit', () => { this.clearTimer(force) })
    } else {
      child.kill('SIGTERM')
    }
  }

  private clearRetryReset(): void {
    if (this.retryReset === undefined) return
    this.clearTimer(this.retryReset)
    this.retryReset = undefined
  }

  private windowsPowerShell(): string {
    const root = this.env.SystemRoot
    if (root === undefined || root.trim() === '') throw new Error('SystemRoot is unavailable')
    if (!win32.isAbsolute(root)) throw new Error('SystemRoot is not an absolute path')
    return win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  }

  private linuxSystemdInhibit(): string | undefined {
    if (this.linuxProbe !== undefined) return this.linuxProbe.available ? this.linuxProbe.executable : undefined
    const executable = LINUX_INHIBIT_PATHS.find(path => this.exists(path))
    if (executable === undefined) {
      this.linuxProbe = { available: false }
      return undefined
    }
    const probe = this.spawnSync(executable, ['--list', '--no-pager'], {
      stdio: 'ignore',
      timeout: 2_000,
      windowsHide: true,
    })
    this.linuxProbe = { executable, available: probe.status === 0 && probe.error === undefined }
    return this.linuxProbe.available ? executable : undefined
  }

  private spawnCommand(): ChildProcess {
    if (this.platform === 'darwin') {
      return this.spawn('/usr/bin/caffeinate', ['-i', '-w', String(this.pid)], {
        shell: false,
        windowsHide: false,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
    }
    if (this.platform === 'linux') {
      const executable = this.linuxSystemdInhibit()
      if (executable === undefined) throw new Error('systemd-inhibit is unavailable')
      return this.spawn(executable, [
        '--what=idle',
        '--who=DeepSeek Harness task board',
        '--why=DSH sessions are running or schedules are armed',
        '--mode=block',
        '--',
        this.execPath,
        '-e',
        LINUX_HELPER,
      ], { shell: false, windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] })
    }
    return this.spawn(this.windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_HELPER], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export { LINUX_HELPER, LINUX_INHIBIT_PATHS, WINDOWS_HELPER }
