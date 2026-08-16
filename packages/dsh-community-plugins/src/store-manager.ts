/** Host-side plugin lifecycle and local-only HTTP routes. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  buildInstallPlan,
  COMMUNITY_STORE_API_PREFIX,
  fetchStoreCatalog,
  findCatalogRepository,
  getInstallModes,
  isInstalledPackageName,
  matchInstalledPlugin,
  parseInstalledPluginList,
  type InstalledPlugin,
  type InstallMode,
  type LifecycleAction,
  type LifecycleOperation,
  type LifecycleStageName,
} from './core/store-catalog.ts'

export { COMMUNITY_STORE_API_PREFIX } from './core/store-catalog.ts'

const LIST_ARGS = Object.freeze(['plugin', '--profile', 'web', 'list', '--depth=0', '--json'])
const REMOVE_ARGS = Object.freeze(['plugin', '--profile', 'web', '--config.ignore-scripts=true', 'remove'])
const MAX_BODY_BYTES = 4096
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/

interface LifecycleProgressUpdate {
  stage: Extract<LifecycleStageName, 'catalog' | 'inventory' | 'executing'>
  action?: LifecycleAction
  target?: string
  command?: string
}

interface StoreLogger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export interface RunnerOptions {
  runner: NativeCommandRunner
  execPath: string
  cliPath: string
  signal: AbortSignal
}

export interface InstallOptions extends RunnerOptions {
  fetcher: typeof fetch
  listInstalled?: (signal: AbortSignal) => Promise<InstalledPlugin[]>
  onProgress?: (update: LifecycleProgressUpdate) => void
}

export interface RemoveOptions extends RunnerOptions {
  installed: InstalledPlugin[]
  onProgress?: (update: LifecycleProgressUpdate) => void
}

export interface LifecycleResult {
  action: 'install' | 'update' | 'remove'
  target: string
  fullName?: string
  needsRestart: true
  output: string
}

export interface StoreRouteDependencies {
  fetcher: typeof fetch
  runner: NativeCommandRunner
  execPath: string
  cliPath: string
  logger?: StoreLogger
}

function commandOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].map(value => value.trim()).filter(Boolean).join('\n').slice(-8000)
}

export function failureDetails(error: unknown): { message: string; output: string } {
  const message = error instanceof Error ? error.message : String(error)
  if (typeof error !== 'object' || error === null) return { message, output: '' }
  const value = error as { stdout?: unknown; stderr?: unknown }
  return {
    message,
    output: commandOutput(
      typeof value.stdout === 'string' ? value.stdout : '',
      typeof value.stderr === 'string' ? value.stderr : '',
    ),
  }
}

export async function listInstalledPlugins(options: RunnerOptions): Promise<InstalledPlugin[]> {
  const result = await options.runner(options.execPath, [options.cliPath, ...LIST_ARGS], options.signal)
  return parseInstalledPluginList(result.stdout)
}

/** Re-fetch and validate an exact API project immediately before mutation. */
export async function installCatalogProject(selector: string, mode: InstallMode | undefined, options: InstallOptions): Promise<LifecycleResult> {
  options.onProgress?.({ stage: 'catalog' })
  const catalog = await fetchStoreCatalog(options.fetcher, options.signal, 'no-store')
  const repository = findCatalogRepository(catalog, selector)
  if (repository === undefined) throw new Error('Store project was not found')
  const modes = getInstallModes(repository)
  if (modes.length > 1 && mode === undefined) {
    throw new Error('Choose the verified or latest GitHub version before installation')
  }
  const plan = buildInstallPlan(repository, mode)
  if (plan === null) throw new Error('Store project has no executable Web install plan')
  options.onProgress?.({ stage: 'inventory', target: plan.target, command: plan.command })
  const installed = await (options.listInstalled?.(options.signal) ?? listInstalledPlugins(options))
  const action = matchInstalledPlugin(repository, installed) === null ? 'install' : 'update'
  options.onProgress?.({ stage: 'executing', action, target: plan.target, command: plan.command })
  const result = await options.runner(options.execPath, [options.cliPath, ...plan.args], options.signal)
  return {
    action,
    target: plan.target,
    fullName: repository.fullName,
    needsRestart: true,
    output: commandOutput(result.stdout, result.stderr),
  }
}

/** Remove only a package that is present as a direct Web-profile dependency. */
export async function removeInstalledPlugin(name: string, options: RemoveOptions): Promise<LifecycleResult> {
  if (!isInstalledPackageName(name, options.installed)) {
    throw new Error('Plugin is not installed as a direct dependency of the Web profile')
  }
  options.onProgress?.({
    stage: 'executing',
    action: 'remove',
    target: name,
    command: `dsh ${REMOVE_ARGS.join(' ')} ${name}`,
  })
  const result = await options.runner(
    options.execPath,
    [options.cliPath, ...REMOVE_ARGS, name],
    options.signal,
  )
  return {
    action: 'remove',
    target: name,
    needsRestart: true,
    output: commandOutput(result.stdout, result.stderr),
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  const normalized = address?.replace(/^::ffff:/i, '')
  return normalized === '::1' || normalized === '127.0.0.1' || normalized === '0:0:0:0:0:0:0:1'
}

function isLocalHost(host: string | undefined): boolean {
  if (host === undefined) return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

export function isAuthorizedLocalRequest(request: IncomingMessage): boolean {
  return isLoopbackAddress(request.socket?.remoteAddress) && isLocalHost(request.headers.host)
}

export function isAuthorizedMutationRequest(request: IncomingMessage): boolean {
  if (!isAuthorizedLocalRequest(request)) return false
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin.length === 0) return false
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Error('Request body is not valid JSON')
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function requestSignal(request: IncomingMessage): AbortSignal {
  const controller = new AbortController()
  request.once('aborted', () => { controller.abort(new Error('Request aborted')) })
  return controller.signal
}

function requireMethod(request: IncomingMessage, response: ServerResponse, method: 'GET' | 'POST'): boolean {
  if (request.method === method) return true
  response.setHeader('Allow', method)
  sendJson(response, 405, { ok: false, message: `Only ${method} is supported` })
  return false
}

function requireJson(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.headers['content-type']?.toLowerCase().startsWith('application/json')) return true
  sendJson(response, 415, { ok: false, message: 'Only JSON requests are accepted' })
  return false
}

/** Create the local inventory/install/remove route family owned by this package. */
export function createStoreRoutes(dependencies: StoreRouteDependencies): WebRoute[] {
  let mutating = false
  let operation: LifecycleOperation | null = null
  const options = (signal: AbortSignal): RunnerOptions => ({
    runner: dependencies.runner,
    execPath: dependencies.execPath,
    cliPath: dependencies.cliPath,
    signal,
  })

  const startOperation = (id: string, action: LifecycleAction, target?: string): void => {
    const timestamp = new Date().toISOString()
    operation = {
      id,
      action,
      status: 'running',
      ...(target === undefined ? {} : { target }),
      startedAt: timestamp,
      updatedAt: timestamp,
      stages: [{ name: 'preparing', status: 'running', startedAt: timestamp }],
      output: '',
    }
    dependencies.logger?.info(`community-plugins: operation ${id} ${action} preparing`)
  }

  const advanceOperation = (update: LifecycleProgressUpdate): void => {
    if (operation === null || operation.status !== 'running') return
    const timestamp = new Date().toISOString()
    operation = {
      ...operation,
      ...(update.action === undefined ? {} : { action: update.action }),
      ...(update.target === undefined ? {} : { target: update.target }),
      ...(update.command === undefined ? {} : { command: update.command }),
      updatedAt: timestamp,
      stages: [
        ...operation.stages.map(stage => stage.status === 'running'
          ? { ...stage, status: 'success' as const, finishedAt: timestamp }
          : stage),
        { name: update.stage, status: 'running', startedAt: timestamp },
      ],
    }
    dependencies.logger?.info(`community-plugins: operation ${operation.id} ${operation.action} ${update.stage}`)
  }

  const completeOperation = (result: LifecycleResult): LifecycleOperation | null => {
    if (operation === null) return null
    const timestamp = new Date().toISOString()
    operation = {
      ...operation,
      action: result.action,
      status: 'success',
      target: result.target,
      updatedAt: timestamp,
      finishedAt: timestamp,
      stages: [
        ...operation.stages.map(stage => stage.status === 'running'
          ? { ...stage, status: 'success' as const, finishedAt: timestamp }
          : stage),
        { name: 'complete', status: 'success', startedAt: timestamp, finishedAt: timestamp },
      ],
      output: result.output,
    }
    dependencies.logger?.info(`community-plugins: operation ${operation.id} ${operation.action} complete`)
    return operation
  }

  const failOperation = (error: unknown): { message: string; output: string; operation: LifecycleOperation | null } => {
    const details = failureDetails(error)
    if (operation !== null) {
      const timestamp = new Date().toISOString()
      operation = {
        ...operation,
        status: 'error',
        updatedAt: timestamp,
        finishedAt: timestamp,
        stages: operation.stages.map(stage => stage.status === 'running'
          ? { ...stage, status: 'error' as const, finishedAt: timestamp }
          : stage),
        output: details.output,
        error: details.message,
      }
      dependencies.logger?.error(
        `community-plugins: operation ${operation.id} ${operation.action} failed: ${details.message}${details.output === '' ? '' : `\n${details.output}`}`,
      )
    }
    return { ...details, operation }
  }

  const readOperationId = (body: object): string => {
    if (!('operationId' in body) || (body as { operationId?: unknown }).operationId === undefined) return randomUUID()
    const id = (body as { operationId: unknown }).operationId
    if (typeof id !== 'string' || !OPERATION_ID.test(id)) throw new Error('Operation ID is invalid')
    return id
  }

  const inventory: WebRoute = {
    kind: 'exact',
    path: `${COMMUNITY_STORE_API_PREFIX}/plugins`,
    handler: async (request, response) => {
      if (!requireMethod(request, response, 'GET')) return
      if (!isAuthorizedLocalRequest(request)) {
        sendJson(response, 403, { ok: false, message: 'Local plugin inventory is available only from loopback' })
        return
      }
      try {
        const plugins = await listInstalledPlugins(options(requestSignal(request)))
        sendJson(response, 200, { ok: true, plugins })
      } catch (error) {
        sendJson(response, 502, { ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const operationStatus: WebRoute = {
    kind: 'exact',
    path: `${COMMUNITY_STORE_API_PREFIX}/operation`,
    handler: (request, response) => {
      if (!requireMethod(request, response, 'GET')) return
      if (!isAuthorizedLocalRequest(request)) {
        sendJson(response, 403, { ok: false, message: 'Local plugin operation status is available only from loopback' })
        return
      }
      sendJson(response, 200, { ok: true, operation })
    },
  }

  const install: WebRoute = {
    kind: 'exact',
    path: `${COMMUNITY_STORE_API_PREFIX}/install`,
    handler: async (request, response) => {
      if (!requireMethod(request, response, 'POST') || !requireJson(request, response)) return
      if (!isAuthorizedMutationRequest(request)) {
        sendJson(response, 403, { ok: false, message: 'Cross-origin or non-loopback installation is refused' })
        return
      }
      if (mutating) {
        sendJson(response, 409, { ok: false, message: 'Another plugin mutation is already running' })
        return
      }
      let selector: string
      let installMode: InstallMode | undefined
      let operationId: string
      try {
        const body = await readJsonBody(request)
        if (typeof body !== 'object' || body === null || !('repositoryId' in body)) throw new Error('Repository ID is required')
        const repositoryId = (body as { repositoryId: unknown }).repositoryId
        if (typeof repositoryId !== 'string' && typeof repositoryId !== 'number') throw new Error('Repository ID is invalid')
        selector = String(repositoryId)
        const requestedMode = (body as { installMode?: unknown }).installMode
        if (requestedMode !== undefined && requestedMode !== 'verified' && requestedMode !== 'latest') {
          throw new Error('Install mode must be verified or latest')
        }
        installMode = requestedMode
        operationId = readOperationId(body)
      } catch (error) {
        sendJson(response, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      mutating = true
      startOperation(operationId, 'install', selector)
      try {
        const result = await installCatalogProject(selector, installMode, {
          ...options(requestSignal(request)),
          fetcher: dependencies.fetcher,
          onProgress: advanceOperation,
        })
        sendJson(response, 200, { ok: true, ...result, operation: completeOperation(result) })
      } catch (error) {
        sendJson(response, 502, { ok: false, ...failOperation(error) })
      } finally {
        mutating = false
      }
    },
  }

  const remove: WebRoute = {
    kind: 'exact',
    path: `${COMMUNITY_STORE_API_PREFIX}/remove`,
    handler: async (request, response) => {
      if (!requireMethod(request, response, 'POST') || !requireJson(request, response)) return
      if (!isAuthorizedMutationRequest(request)) {
        sendJson(response, 403, { ok: false, message: 'Cross-origin or non-loopback removal is refused' })
        return
      }
      if (mutating) {
        sendJson(response, 409, { ok: false, message: 'Another plugin mutation is already running' })
        return
      }
      let name: string
      let operationId: string
      try {
        const body = await readJsonBody(request)
        if (typeof body !== 'object' || body === null || !('name' in body) || typeof (body as { name: unknown }).name !== 'string') {
          throw new Error('Plugin package name is required')
        }
        name = (body as { name: string }).name
        operationId = readOperationId(body)
      } catch (error) {
        sendJson(response, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      mutating = true
      startOperation(operationId, 'remove', name)
      const signal = requestSignal(request)
      try {
        advanceOperation({ stage: 'inventory', action: 'remove', target: name })
        const installed = await listInstalledPlugins(options(signal))
        const result = await removeInstalledPlugin(name, {
          ...options(signal),
          installed,
          onProgress: advanceOperation,
        })
        sendJson(response, 200, { ok: true, ...result, operation: completeOperation(result) })
      } catch (error) {
        sendJson(response, 502, { ok: false, ...failOperation(error) })
      } finally {
        mutating = false
      }
    },
  }

  return [inventory, operationStatus, install, remove]
}
