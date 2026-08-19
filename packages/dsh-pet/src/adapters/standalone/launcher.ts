import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isPetNativeToken } from '../web/native-auth.ts'

export const STANDALONE_PACKAGE_NAME = '@linxin666/dsh-pet-standalone'

export type StandaloneRuntimeSource = 'explicit' | 'package' | 'development'
export type StandaloneRuntimeLaunchMode = 'direct' | 'electron-app'

export interface StandaloneRuntimeTarget {
  executablePath: string
  appRoot: string
  entryPath: string
  version?: string
  source: StandaloneRuntimeSource
  launchMode: StandaloneRuntimeLaunchMode
}

export interface DiscoverStandaloneRuntimeOptions {
  /** URL of the plugin's source or built entry module. */
  moduleUrl: string
  /** Managed Electron binary selected by StandaloneRuntimeManager. */
  runtimeExecutable?: string
  environment?: NodeJS.ProcessEnv
  packageName?: string
}

export interface LaunchStandaloneRuntimeOptions extends DiscoverStandaloneRuntimeOptions {
  origin: string
  nativeToken: string
  parentPid?: number
  sourceId?: string
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  onError?: (code: 'launch-failed' | 'cleanup-failed') => void
}

/** One launched parent registration with an explicit asynchronous startup result. */
export interface StandaloneRuntimeLaunchHandle {
  /** Resolves on ChildProcess `spawn`; rejects when Node reports an asynchronous spawn error. */
  readonly ready: Promise<void>
  /** PID of the process passed to `spawn`, when Node assigned one. */
  readonly pid?: number
  /**
   * Process termination as an uninterpreted launcher fact. A successfully
   * spawned secondary Electron instance may exit normally after forwarding a
   * registration to the existing primary instance, so callers must not treat
   * this promise alone as a presentation failure.
   */
  readonly exited?: Promise<StandaloneRuntimeExit>
  /** Remove this parent registration. Idempotent. */
  dispose(): void
}

export interface StandaloneRuntimeExit {
  code: number | null
  signal: NodeJS.Signals | null
}

interface StandalonePackageJson {
  name?: unknown
  version?: unknown
  main?: unknown
}

function safeChild(root: string, target: string): boolean {
  const child = relative(root, target)
  return child !== '' && !child.startsWith('..') && !isAbsolute(child)
}

function existingPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const path = resolve(value.trim())
  try {
    return statSync(path).isFile() ? path : undefined
  } catch {
    return undefined
  }
}

function readPackageJson(path: string): StandalonePackageJson | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return typeof value === 'object' && value !== null ? value as StandalonePackageJson : undefined
  } catch {
    return undefined
  }
}

function electronExecutable(explicit?: string): string | undefined {
  // Never discover an arbitrary Electron dependency from the DSH profile.
  // The managed runtime is supplied only after the user-approved installer
  // has selected and verified one exact executable.
  return existingPath(explicit)
}

function electronAppTarget(
  packageJsonPath: string,
  source: Exclude<StandaloneRuntimeSource, 'explicit'>,
  executablePath: string | undefined,
): StandaloneRuntimeTarget | undefined {
  if (executablePath === undefined) return undefined
  const manifest = readPackageJson(packageJsonPath)
  if (manifest === undefined || typeof manifest.main !== 'string') return undefined
  const appRoot = dirname(packageJsonPath)
  const entryPath = resolve(appRoot, manifest.main)
  if (!safeChild(appRoot, entryPath) || !existsSync(entryPath)) return undefined
  return {
    executablePath,
    appRoot,
    entryPath,
    ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
    source,
    launchMode: 'electron-app',
  }
}

function findPluginPackageRoot(moduleUrl: string): string | undefined {
  return findNamedPackageRoot(fileURLToPath(moduleUrl), '@linxin666/dsh-pet')
}

function findNamedPackageRoot(startPath: string, packageName: string): string | undefined {
  let directory = dirname(startPath)
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = resolve(directory, 'package.json')
    const manifest = readPackageJson(packageJsonPath)
    if (manifest?.name === packageName) return directory
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  return undefined
}

function installedPackageTarget(
  options: DiscoverStandaloneRuntimeOptions,
): StandaloneRuntimeTarget | undefined {
  const packageName = options.packageName ?? STANDALONE_PACKAGE_NAME
  const require = createRequire(options.moduleUrl)
  let packageJsonPath: string | undefined
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`)
  } catch {
    try {
      const entryPath = require.resolve(packageName)
      const packageRoot = findNamedPackageRoot(entryPath, packageName)
      if (packageRoot !== undefined) packageJsonPath = resolve(packageRoot, 'package.json')
    } catch {
      return undefined
    }
  }
  if (packageJsonPath === undefined) return undefined
  const executable = electronExecutable(options.runtimeExecutable)
  return electronAppTarget(packageJsonPath, 'package', executable)
}

function developmentTarget(
  options: DiscoverStandaloneRuntimeOptions,
): StandaloneRuntimeTarget | undefined {
  const packageRoot = findPluginPackageRoot(options.moduleUrl)
  if (packageRoot === undefined) return undefined
  const packageJsonPath = resolve(packageRoot, 'desktop', 'package.json')
  const executable = electronExecutable(options.runtimeExecutable)
  return electronAppTarget(packageJsonPath, 'development', executable)
}

/**
 * Discover Standalone in the documented order without importing Electron:
 * explicit executable, installed standalone package, then development build.
 */
export function discoverStandaloneRuntime(
  options: DiscoverStandaloneRuntimeOptions,
): StandaloneRuntimeTarget | undefined {
  const environment = options.environment ?? process.env
  const explicit = existingPath(environment.DSH_PET_STANDALONE_EXECUTABLE)
  if (explicit !== undefined) {
    return {
      executablePath: explicit,
      appRoot: dirname(explicit),
      entryPath: explicit,
      source: 'explicit',
      launchMode: 'direct',
    }
  }
  return installedPackageTarget(options) ?? developmentTarget(options)
}

function normalizeBridgeOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('standalone-origin-invalid')
  }
  const hostname = url.hostname.toLowerCase()
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  if (url.protocol !== 'http:' || !loopback || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new TypeError('standalone-origin-invalid')
  }
  return url.origin
}

function normalizeSourceId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError('standalone-source-id-invalid')
  }
  return value
}

/** Build a private child environment and clear credentials from older runs. */
export function standaloneChildEnvironment(
  parentPid: number,
  sourceId: string,
  origin: string,
  nativeToken: string,
  parentAction: 'add' | 'remove',
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...baseEnvironment }
  delete environment.DSH_PET_PARENT_PID
  delete environment.DSH_PET_SOURCE_ID
  delete environment.DSH_PET_ORIGIN
  delete environment.DSH_PET_NATIVE_TOKEN
  delete environment.DSH_PET_PARENT_ACTION
  environment.DSH_PET_PARENT_PID = String(parentPid)
  environment.DSH_PET_SOURCE_ID = sourceId
  environment.DSH_PET_ORIGIN = origin
  environment.DSH_PET_NATIVE_TOKEN = nativeToken
  environment.DSH_PET_PARENT_ACTION = parentAction
  return environment
}

/** Build log-safe process arguments; origin and token remain environment-only. */
export function standaloneLaunchArguments(
  target: StandaloneRuntimeTarget,
  parentPid: number,
  sourceId: string,
  parentAction: 'add' | 'remove',
): string[] {
  return [
    ...(target.launchMode === 'electron-app' ? [target.appRoot] : []),
    `--dsh-parent-pid=${String(parentPid)}`,
    `--dsh-source-id=${sourceId}`,
    `--dsh-parent-action=${parentAction}`,
  ]
}

/** Launch Standalone and return its startup result plus an idempotent registration disposer. */
export function launchStandaloneRuntime(options: LaunchStandaloneRuntimeOptions): StandaloneRuntimeLaunchHandle {
  const parentPid = options.parentPid ?? process.pid
  if (!Number.isInteger(parentPid) || parentPid <= 0) throw new TypeError('standalone-parent-pid-invalid')
  if (!isPetNativeToken(options.nativeToken)) throw new TypeError('standalone-native-token-invalid')
  const origin = normalizeBridgeOrigin(options.origin)
  const sourceId = normalizeSourceId(options.sourceId ?? `host:${String(parentPid)}`)
  const target = discoverStandaloneRuntime(options)
  if (target === undefined) throw new Error('standalone-runtime-unavailable')
  const spawnProcess = options.spawnProcess ?? spawn

  const childEnvironment = standaloneChildEnvironment(
    parentPid,
    sourceId,
    origin,
    options.nativeToken,
    'add',
    options.environment,
  )
  let child: ChildProcess
  try {
    child = spawnProcess(
      target.executablePath,
      standaloneLaunchArguments(target, parentPid, sourceId, 'add'),
      {
        cwd: target.appRoot,
        env: childEnvironment,
        stdio: 'ignore',
        windowsHide: true,
      },
    )
  } catch {
    options.onError?.('launch-failed')
    throw new Error('standalone-launch-failed')
  }
  let spawned = false
  const ready = new Promise<void>((resolve, reject) => {
    child.once('spawn', () => {
      spawned = true
      resolve()
    })
    child.once('error', (cause) => {
      if (!spawned) reject(new Error('standalone-launch-failed', { cause }))
      try {
        options.onError?.('launch-failed')
      } catch {
        // Diagnostics must never replace the startup result delivered to the Host.
      }
    })
  })
  const exited = new Promise<StandaloneRuntimeExit>((resolve) => {
    child.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
  child.unref()

  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const cleanupEnvironment = standaloneChildEnvironment(
      parentPid,
      sourceId,
      origin,
      options.nativeToken,
      'remove',
      options.environment,
    )
    try {
      const cleanup = spawnProcess(
        target.executablePath,
        standaloneLaunchArguments(target, parentPid, sourceId, 'remove'),
        {
          cwd: target.appRoot,
          env: cleanupEnvironment,
          stdio: 'ignore',
          windowsHide: true,
        },
      )
      cleanup.once('error', () => {
        try {
          options.onError?.('cleanup-failed')
        } catch {
          // Cleanup is already best-effort; diagnostics cannot make it throw later.
        }
      })
      cleanup.unref()
    } catch {
      options.onError?.('cleanup-failed')
      // The Standalone parent-liveness watcher is the final cleanup path.
    }
  }
  return {
    ready,
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    exited,
    dispose,
  }
}
