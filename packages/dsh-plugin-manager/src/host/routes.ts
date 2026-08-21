/**
 * The gateway HTTP surface: loopback-fenced routes serving the plugin
 * inventory, CLI-backed install/removal jobs, next-start enablement, the
 * (empty on this runtime) failure ring, and registry update checks. The
 * fence is the shared family loopback guard — same-origin local browsers
 * only, mirroring the official loopback authority the installer channels
 * would have enforced.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from './loopback.ts'
import { detectOfficialChannels, findDshBinary, unsafeSpecReason, type CliGateway } from './gateway.ts'
import { readPatchText, readProfileManifest, type ProfileFacts } from './profile.ts'
import { setRowEnabled, writePatchAtomic } from './rows.ts'
import { buildPluginRow, claimedEntryRowsOf, snapshotGateway } from './state.ts'

/** Route prefix the browser half mirrors. */
export const GATEWAY_PREFIX = '/api/plugin-manager'

/** Cap on JSON request bodies (an install spec or a toggle is tiny). */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Registry timeout for one update check. */
const REGISTRY_TIMEOUT_MS = 30_000

/** Dependencies every route shares. */
export interface GatewayRouteDeps {
  facts: ProfileFacts
  gateway: CliGateway
  /** Resolve the dsh binary presence (the CLI is the write path). */
  cliAvailable: () => boolean
  /** Registry fetch seam for update checks (test seam). */
  fetchLatest?: (name: string) => Promise<string | undefined>
  /** Official-channel detection seam (test seam); defaults to the boot dump probe. */
  officialChannels?: () => Promise<boolean>
}

/** Error text for a caught request or lifecycle failure. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Send one JSON response. */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** Read a bounded JSON request body; throws on oversized or invalid input. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) throw new Error('plugin-manager: request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('plugin-manager: request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** Default registry latest-version probe for npm packages. */
async function fetchLatestFromRegistry(name: string): Promise<string | undefined> {
  const encoded = name.startsWith('@') ? name.replace('/', '%2F') : name
  const response = await fetch(`https://registry.npmjs.org/${encoded}/latest`, {
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  })
  if (!response.ok) return undefined
  const body = await response.json() as { version?: unknown }
  return typeof body.version === 'string' ? body.version : undefined
}

/** Whether a dependency spec is a direct npm-registry selector, not an alias or external source. */
function isDirectRegistrySpec(spec: string): boolean {
  return !/^(?:link:|file:|git:|github:|git\+|https?:\/\/|npm:|workspace:|catalog:)/.test(spec)
}

/**
 * Build the gateway routes.
 * @param deps - profile facts, the CLI gateway, and seams.
 * @returns the web-server routes to register.
 */
export function makeGatewayRoutes(deps: GatewayRouteDeps): WebRoute[] {
  const { facts, gateway } = deps
  const fetchLatest = deps.fetchLatest ?? fetchLatestFromRegistry

  /** Wrap a handler with the loopback fence and JSON error reporting. */
  const guard = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isLoopbackRequest(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      try {
        await handler(req, res)
      } catch (error) {
        sendJson(res, 500, { error: messageOf(error) })
      }
    }

  const listHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const patchText = await readPatchText(facts.patchPath)
    const snapshot = await snapshotGateway(facts, patchText)
    sendJson(res, 200, { plugins: snapshot.plugins })
  }

  const installHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJsonBody(req)
    const spec = body['spec']
    if (typeof spec !== 'string' || spec.trim() === '') {
      sendJson(res, 400, { error: 'plugin-manager: install needs a spec' })
      return
    }
    const unsafeSpec = unsafeSpecReason(spec.trim())
    if (unsafeSpec !== undefined) {
      sendJson(res, 400, { error: unsafeSpec })
      return
    }
    if (!deps.cliAvailable()) {
      sendJson(res, 500, { error: 'plugin-manager: dsh CLI not found on PATH' })
      return
    }
    sendJson(res, 200, gateway.install(spec.trim()))
  }

  const updateHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJsonBody(req)
    const id = body['id']
    if (typeof id !== 'string' || id.trim() === '') {
      sendJson(res, 400, { error: 'plugin-manager: update needs an id' })
      return
    }
    const target = id.trim()
    const unsafe = unsafeSpecReason(target)
    if (unsafe !== undefined) {
      sendJson(res, 400, { error: unsafe })
      return
    }
    if (!deps.cliAvailable()) {
      sendJson(res, 500, { error: 'plugin-manager: dsh CLI not found on PATH' })
      return
    }
    const outcome = await gateway.withMutationLock(async () => {
      const patchText = await readPatchText(facts.patchPath)
      const row = (await snapshotGateway(facts, patchText)).plugins.find(plugin => plugin.id === target)
      if (row === undefined) return { status: 404, error: `plugin-manager: plugin ${target} is not installed` }
      if (row.source.kind !== 'npm' || !isDirectRegistrySpec(row.source.spec)) {
        return { status: 400, error: `plugin-manager: ${target} is not a direct npm registry plugin` }
      }
      const latest = await fetchLatest(target).catch(() => undefined)
      if (latest === undefined || latest === '') return { status: 502, error: `plugin-manager: cannot resolve the latest version for ${target}` }
      const unsafeLatest = unsafeSpecReason(`${target}@${latest}`)
      if (unsafeLatest !== undefined) return { status: 502, error: unsafeLatest }
      if (row.version === latest) return { status: 409, error: `plugin-manager: ${target} is already at ${latest}` }
      return { status: 200, job: gateway.update(target, latest) }
    })
    if ('error' in outcome) {
      sendJson(res, outcome.status, { error: outcome.error })
      return
    }
    sendJson(res, outcome.status, outcome.job)
  }

  const removeHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJsonBody(req)
    const id = body['id']
    if (typeof id !== 'string' || id.trim() === '') {
      sendJson(res, 400, { error: 'plugin-manager: remove needs an id' })
      return
    }
    const unsafeId = unsafeSpecReason(id.trim())
    if (unsafeId !== undefined) {
      sendJson(res, 400, { error: unsafeId })
      return
    }
    if (!deps.cliAvailable()) {
      sendJson(res, 500, { error: 'plugin-manager: dsh CLI not found on PATH' })
      return
    }
    sendJson(res, 200, gateway.remove(id.trim()))
  }

  const statusHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const jobId = url.searchParams.get('job')
    if (jobId === null) {
      sendJson(res, 400, { error: 'plugin-manager: status needs a job id' })
      return
    }
    const job = gateway.status(jobId)
    if (job === undefined) {
      sendJson(res, 404, { error: 'plugin-manager: unknown job' })
      return
    }
    sendJson(res, 200, { job })
  }

  const setEnabledHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJsonBody(req)
    const id = body['id']
    const enabled = body['enabled']
    if (typeof id !== 'string' || id.trim() === '' || typeof enabled !== 'boolean') {
      sendJson(res, 400, { error: 'plugin-manager: set-enabled needs an id and a boolean enabled' })
      return
    }
    const target = id.trim()
    const unsafeTarget = unsafeSpecReason(target)
    if (unsafeTarget !== undefined) {
      sendJson(res, 400, { error: unsafeTarget })
      return
    }
    const outcome = await gateway.withMutationLock(async () => {
      const patchText = await readPatchText(facts.patchPath)
      // Write and read the same id space: the entry ids the package's bundle
      // patch claims (falling back to the package name), not the package name
      // itself. Package-name rows never matched the loader entries. The row
      // carries the entry's own name: the include semantics skip a bare row
      // whose name mismatches the inserted entry.
      const manifest = await readProfileManifest(facts.packageJsonPath)
      if (manifest.dependencies[target] === undefined) {
        return { error: `plugin-manager: plugin ${target} is not installed` } as const
      }
      const entries = await claimedEntryRowsOf(facts, target)
      let next = patchText
      for (const entry of entries) {
        next = setRowEnabled(next, facts.patchPath, entry.id, entry.name, enabled)
      }
      if (next !== patchText) {
        await writePatchAtomic(facts.patchPath, next)
      }
      const snapshot = await snapshotGateway(facts, next)
      const plugin = snapshot.plugins.find(item => item.id === target)
      return plugin === undefined
        ? { error: `plugin-manager: plugin ${target} is not installed` } as const
        : { plugin } as const
    })
    if ('error' in outcome) {
      sendJson(res, 404, { error: outcome.error })
      return
    }
    sendJson(res, 200, { plugin: outcome.plugin })
  }

  const failuresHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The npm web runtime keeps no boot-failure ring; the install-error path
    // is the only repair surface here.
    sendJson(res, 200, { items: [], pluginRoot: facts.profileDir, safeMode: false })
  }

  // One verdict per host process: the browser half reads it instead of
  // probing the official channel, whose route 405s on the npm web runtime.
  let modePromise: Promise<{ official: boolean | null }> | undefined
  const probeOfficialChannels = (): Promise<boolean> => {
    const binary = findDshBinary()
    if (binary === null) return Promise.resolve(false)
    return detectOfficialChannels(binary, facts.profileName)
  }
  const modeHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (modePromise === undefined) {
      if (facts.desktop) {
        // Desktop registers installer services programmatically, so the CLI
        // dump cannot see them. Null tells the browser to perform its existing
        // direct RPC capability probe before falling back to this gateway.
        modePromise = Promise.resolve({ official: null })
      } else {
        const probe = deps.officialChannels ?? probeOfficialChannels
        modePromise = probe().then(official => ({ official })).catch(() => ({ official: false }))
      }
    }
    sendJson(res, 200, await modePromise)
  }

  const checkUpdatesHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const patchText = await readPatchText(facts.patchPath)
    const snapshot = await snapshotGateway(facts, patchText)
    const updates: Array<{ id: string; current: string; latest: string }> = []
    for (const plugin of snapshot.plugins) {
      if (plugin.source.kind !== 'npm' || !isDirectRegistrySpec(plugin.source.spec)) continue
      const latest = await fetchLatest(plugin.id).catch(() => undefined)
      if (latest !== undefined && latest !== plugin.version) {
        updates.push({ id: plugin.id, current: plugin.version, latest })
      }
    }
    sendJson(res, 200, { updates })
  }

  return [
    { kind: 'exact', path: `${GATEWAY_PREFIX}/list`, handler: guard(listHandler) },
    { kind: 'exact', path: `${GATEWAY_PREFIX}/install`, handler: guard(installHandler) },
    { kind: 'exact', path: `${GATEWAY_PREFIX}/update`, handler: guard(updateHandler) },
    { kind: 'exact', path: `${GATEWAY_PREFIX}/remove`, handler: guard(removeHandler) },
    { kind: 'exact', path: `${GATEWAY_PREFIX}/status`, handler: guard(statusHandler) },
    { kind: 'exact', path: `${GATEWAY_PREFIX}/set-enabled`, handler: guard(setEnabledHandler) },
    { kind: 'exact', path: `${GATEWAY_PREFIX}/failures`, handler: guard(failuresHandler) },
    { kind: 'exact', path: `${GATEWAY_PREFIX}/mode`, handler: guard(modeHandler) },
    { kind: 'exact', path: `${GATEWAY_PREFIX}/check-updates`, handler: guard(checkUpdatesHandler) },
  ]
}

/** Re-exported for host wiring: build a plugin row against the live snapshot. */
export { buildPluginRow }
