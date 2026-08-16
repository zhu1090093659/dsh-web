/** Host-side plugin lifecycle and local-only HTTP routes. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  buildInstallPlan,
  fetchStoreCatalog,
  findCatalogRepository,
  isInstalledPackageName,
  matchInstalledPlugin,
  parseInstalledPluginList,
  type InstalledPlugin,
} from './core/store-catalog.ts'

export const COMMUNITY_STORE_API_PREFIX = '/api/dsh-community-plugins'

const LIST_ARGS = Object.freeze(['plugin', '--profile', 'web', 'list', '--depth=0', '--json'])
const REMOVE_ARGS = Object.freeze(['plugin', '--profile', 'web', '--config.ignore-scripts=true', 'remove'])
const MAX_BODY_BYTES = 4096

export interface RunnerOptions {
  runner: NativeCommandRunner
  execPath: string
  cliPath: string
  signal: AbortSignal
}

export interface InstallOptions extends RunnerOptions {
  fetcher: typeof fetch
  listInstalled?: (signal: AbortSignal) => Promise<InstalledPlugin[]>
}

export interface RemoveOptions extends RunnerOptions {
  installed: InstalledPlugin[]
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
}

function commandOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].map(value => value.trim()).filter(Boolean).join('\n').slice(-8000)
}

export async function listInstalledPlugins(options: RunnerOptions): Promise<InstalledPlugin[]> {
  const result = await options.runner(options.execPath, [options.cliPath, ...LIST_ARGS], options.signal)
  return parseInstalledPluginList(result.stdout)
}

/** Re-fetch and validate an exact API project immediately before mutation. */
export async function installCatalogProject(selector: string, options: InstallOptions): Promise<LifecycleResult> {
  const catalog = await fetchStoreCatalog(options.fetcher, options.signal, 'no-store')
  const repository = findCatalogRepository(catalog, selector)
  if (repository === undefined) throw new Error('Store project was not found')
  const plan = buildInstallPlan(repository)
  if (plan === null) throw new Error('Store project has no executable Web install plan')
  const installed = await (options.listInstalled?.(options.signal) ?? listInstalledPlugins(options))
  const action = matchInstalledPlugin(repository, installed) === null ? 'install' : 'update'
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
  const options = (signal: AbortSignal): RunnerOptions => ({
    runner: dependencies.runner,
    execPath: dependencies.execPath,
    cliPath: dependencies.cliPath,
    signal,
  })

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
      try {
        const body = await readJsonBody(request)
        if (typeof body !== 'object' || body === null || !('repositoryId' in body)) throw new Error('Repository ID is required')
        const repositoryId = (body as { repositoryId: unknown }).repositoryId
        if (typeof repositoryId !== 'string' && typeof repositoryId !== 'number') throw new Error('Repository ID is invalid')
        selector = String(repositoryId)
      } catch (error) {
        sendJson(response, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      mutating = true
      try {
        const result = await installCatalogProject(selector, {
          ...options(requestSignal(request)),
          fetcher: dependencies.fetcher,
        })
        sendJson(response, 200, { ok: true, ...result })
      } catch (error) {
        sendJson(response, 502, { ok: false, message: error instanceof Error ? error.message : String(error) })
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
      try {
        const body = await readJsonBody(request)
        if (typeof body !== 'object' || body === null || !('name' in body) || typeof (body as { name: unknown }).name !== 'string') {
          throw new Error('Plugin package name is required')
        }
        name = (body as { name: string }).name
      } catch (error) {
        sendJson(response, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      mutating = true
      const signal = requestSignal(request)
      try {
        const installed = await listInstalledPlugins(options(signal))
        const result = await removeInstalledPlugin(name, { ...options(signal), installed })
        sendJson(response, 200, { ok: true, ...result })
      } catch (error) {
        sendJson(response, 502, { ok: false, message: error instanceof Error ? error.message : String(error) })
      } finally {
        mutating = false
      }
    },
  }

  return [inventory, install, remove]
}
