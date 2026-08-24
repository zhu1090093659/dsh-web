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
import { readJsonBody, writeJson } from './http.ts'
import { isLoopbackRequest } from './loopback.ts'
import { detectOfficialChannels, findDshBinary, spawnDsh, unsafeSpecReason, type CliGateway } from './gateway.ts'
import { dshRequirementOf, meetsMinimumDsh, parseDshVersion } from '../core/version.ts'
import { readPatchText, readProfileManifest, type ProfileFacts } from './profile.ts'
import { legacyMigrationFor, targetSpecForLegacy } from './legacy-migration.ts'
import { setRowEnabled, writePatchAtomic } from './rows.ts'
import { buildPluginRow, claimedEntryRowsOf, snapshotGateway } from './state.ts'

/** Route prefix the browser half mirrors. */
export const GATEWAY_PREFIX = '/api/plugin-manager'

/** Registry timeout for one update check. */
const REGISTRY_TIMEOUT_MS = 30_000

/** Deadline for one dsh --version probe. */
const VERSION_TIMEOUT_MS = 10_000

/** Bounded capture of the version probe output. */
const VERSION_MAX_OUTPUT_CHARS = 4_096

/** Grace period after SIGTERM before a stuck probe child is SIGKILLed. */
const VERSION_ESCALATION_TIMEOUT_MS = 5_000

/** Successful probe freshness window before the host version is re-read. */
const VERSION_PROBE_TTL_MS = 5 * 60_000

/** Minimum gap between failed version probes (avoids a spawn per request). */
const VERSION_PROBE_COOLDOWN_MS = 60_000

/**
 * Entry ids that must stay mounted so the local plugin-management escape hatch
 * remains available. Aggregate packages may still disable every other entry.
 */
const SELF_MANAGED_ENTRY_IDS = new Set(['ui-plugin-manager', 'web-ui-plugin-manager'])

/** Dependencies every route shares. */
export interface GatewayRouteDeps {
  facts: ProfileFacts
  gateway: CliGateway
  /** Resolve the dsh binary presence (the CLI is the write path). */
  cliAvailable: () => boolean
  /** Registry fetch seam for update checks (test seam); the default reads the
   * `/<name>/latest` manifest including the `dsh` / `engines` metadata. */
  fetchManifest?: (name: string) => Promise<RegistryVersionManifest | undefined>
  /** Running DSH host version seam (test seam); the default probes `dsh --version`. */
  dshVersion?: () => Promise<string | undefined>
  /** Official-channel detection seam (test seam); defaults to the boot dump probe. */
  officialChannels?: () => Promise<boolean>
}

/** Error text for a caught request or lifecycle failure. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The published `/latest` manifest: version plus the compat metadata fields. */
export interface RegistryVersionManifest {
  version: string
  /** Untrusted package manifest `dsh` object (bundle / client / engines). */
  dsh?: unknown
  /** Untrusted package manifest `engines` object (node / dsh). */
  engines?: unknown
}

/** Append bounded probe output. */
function captureProbe(chunk: Buffer, buffer: { value: string }): void {
  buffer.value = (buffer.value + chunk.toString()).slice(-VERSION_MAX_OUTPUT_CHARS)
}

/**
 * Default registry manifest probe for npm packages: `/<name>/latest` returns
 * the full latest-version manifest, so the `dsh` / `engines` compat metadata
 * rides the same request as the version (no packument needed).
 */
async function fetchRegistryManifest(name: string): Promise<RegistryVersionManifest | undefined> {
  const encoded = name.startsWith('@') ? name.replace('/', '%2F') : name
  const response = await fetch(`https://registry.npmjs.org/${encoded}/latest`, {
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  })
  if (!response.ok) return undefined
  const body = await response.json() as { version?: unknown; dsh?: unknown; engines?: unknown }
  if (typeof body.version !== 'string') return undefined
  return { version: body.version, dsh: body.dsh, engines: body.engines }
}

/**
 * Read the running DSH host version through `dsh --version` (the CLI is the
 * gateway's write path already; this package has no in-process source).
 * Returns undefined when the binary is unavailable or the output is not a
 * plain semver; callers treat an unknown host version as a fail-closed
 * verdict for declared requirements (issue #754).
 */
async function probeDshVersion(cliAvailable: () => boolean): Promise<string | undefined> {
  if (!cliAvailable()) return undefined
  const binary = findDshBinary()
  if (binary === null) return undefined
  const output = { value: '' }
  const child = spawnDsh(binary, ['--version'], process.env)
  child.stdout?.on('data', (chunk: Buffer) => { captureProbe(chunk, output) })
  child.stderr?.on('data', (chunk: Buffer) => { captureProbe(chunk, output) })
  // SIGTERM can be ignored by a stuck CLI; escalate once so a probe can never
  // hang the update/check endpoints for the host process lifetime, and always
  // settle the promise on spawn failure (an 'error' event follows a vanished
  // or unexecutable binary between findDshBinary and spawnDsh).
  let escalated: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
    child.kill()
    escalated = setTimeout(() => { child.kill('SIGKILL') }, VERSION_ESCALATION_TIMEOUT_MS)
  }, VERSION_TIMEOUT_MS)
  const code = await new Promise<number | null>(resolve => {
    let settled = false
    const finish = (value: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (escalated !== undefined) clearTimeout(escalated)
      resolve(value)
    }
    child.once('error', () => finish(null))
    child.once('close', finish)
  })
  if (code !== 0) return undefined
  const version = output.value.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  return parseDshVersion(version) === undefined ? undefined : version
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
  const fetchManifest = deps.fetchManifest ?? fetchRegistryManifest
  /**
   * Cached `dsh --version`: successful verdicts refresh after a TTL (the CLI
   * update path is the gateway itself, so a stale success is wrong long-term),
   * failed probes are retried after a cooldown instead of being cached forever,
   * and concurrent requests share one in-flight probe.
   */
  let dshVersion: string | undefined
  let dshVersionAt = 0
  let dshVersionPending: Promise<string | undefined> | undefined
  const resolveDshVersion = (): Promise<string | undefined> => {
    if (deps.dshVersion !== undefined) return deps.dshVersion()
    const now = Date.now()
    if (dshVersion !== undefined && now - dshVersionAt < VERSION_PROBE_TTL_MS) return Promise.resolve(dshVersion)
    if (dshVersionAt !== 0 && now - dshVersionAt < VERSION_PROBE_COOLDOWN_MS) return Promise.resolve(undefined)
    if (dshVersionPending === undefined) {
      dshVersionAt = now
      dshVersionPending = probeDshVersion(deps.cliAvailable)
        .catch(() => undefined)
        .then(version => {
          dshVersionPending = undefined
          if (version !== undefined) {
            dshVersion = version
            dshVersionAt = now
          }
          return version
        })
    }
    return dshVersionPending
  }

  /**
   * Compat verdict for one declared requirement. Unverified (unknown host,
   * malformed host output, unsupported range) is incompatible so an update
   * can never run against a runtime we cannot prove compatible (issue #754);
   * only absent metadata keeps the update fail-open.
   */
  const compatibleVerdict = async (requiresDsh: string): Promise<{ hostVersion?: string; compatible: boolean }> => {
    const hostVersion = await resolveDshVersion()
    if (hostVersion === undefined) return { compatible: false }
    return { hostVersion, compatible: meetsMinimumDsh(hostVersion, requiresDsh) === true }
  }

  /** Wrap a handler with the loopback fence and JSON error reporting. */
  const guard = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
        return
      }
      try {
        await handler(req, res)
      } catch (error) {
        writeJson(res, 500, { error: messageOf(error) })
      }
    }

  const listHandler = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const patchText = await readPatchText(facts.patchPath)
    const snapshot = await snapshotGateway(facts, patchText)
    writeJson(res, 200, { plugins: snapshot.plugins })
  }

  const installHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = (await readJsonBody(req, { maxBytes: 64 * 1024, objectOnly: true }) ?? {}) as Record<string, unknown>
    const spec = body['spec']
    if (typeof spec !== 'string' || spec.trim() === '') {
      writeJson(res, 400, { error: 'plugin-manager: install needs a spec' })
      return
    }
    const unsafeSpec = unsafeSpecReason(spec.trim())
    if (unsafeSpec !== undefined) {
      writeJson(res, 400, { error: unsafeSpec })
      return
    }
    if (!deps.cliAvailable()) {
      writeJson(res, 500, { error: 'plugin-manager: dsh CLI not found on PATH' })
      return
    }
    writeJson(res, 200, gateway.install(spec.trim()))
  }

  const updateHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = (await readJsonBody(req, { maxBytes: 64 * 1024, objectOnly: true }) ?? {}) as Record<string, unknown>
    const id = body['id']
    if (typeof id !== 'string' || id.trim() === '') {
      writeJson(res, 400, { error: 'plugin-manager: update needs an id' })
      return
    }
    const target = id.trim()
    const unsafe = unsafeSpecReason(target)
    if (unsafe !== undefined) {
      writeJson(res, 400, { error: unsafe })
      return
    }
    if (!deps.cliAvailable()) {
      writeJson(res, 500, { error: 'plugin-manager: dsh CLI not found on PATH' })
      return
    }
    const outcome = await gateway.withMutationLock(async () => {
      const patchText = await readPatchText(facts.patchPath)
      const row = (await snapshotGateway(facts, patchText)).plugins.find(plugin => plugin.id === target)
      if (row === undefined) return { status: 404, error: `plugin-manager: plugin ${target} is not installed` }
      const migration = legacyMigrationFor(target)
      if (migration !== undefined) {
        const targetManifest = await fetchManifest(migration.to).catch(() => undefined)
        if (targetManifest === undefined || targetManifest.version === '') {
          return { status: 502, error: `plugin-manager: cannot resolve the migration target ${migration.to}` }
        }
        const targetSpec = targetSpecForLegacy(row.source.spec, targetManifest.version)
        if (targetSpec === undefined) {
          return { status: 400, error: `plugin-manager: cannot derive the migration target spec for ${target}` }
        }
        const unsafeTarget = unsafeSpecReason(targetSpec)
        if (unsafeTarget !== undefined) return { status: 400, error: unsafeTarget }
        const requiresDsh = dshRequirementOf(targetManifest)
        if (requiresDsh !== undefined) {
          const { hostVersion, compatible } = await compatibleVerdict(requiresDsh)
          if (!compatible) {
            return {
              status: 412,
              error: hostVersion === undefined
                ? `plugin-manager: cannot verify the DSH version for ${migration.to} (dsh --version failed); upgrade DSH before migrating`
                : `plugin-manager: ${migration.to} requires DSH ${requiresDsh} (current DSH ${hostVersion}); upgrade DSH before migrating`,
            }
          }
        }
        return { status: 200, job: gateway.migrate(target, migration.to, targetManifest.version, targetSpec) }
      }
      if (row.source.kind !== 'npm' || !isDirectRegistrySpec(row.source.spec)) {
        return { status: 400, error: `plugin-manager: ${target} is not a direct npm registry plugin` }
      }
      const manifest = await fetchManifest(target).catch(() => undefined)
      if (manifest === undefined) return { status: 502, error: `plugin-manager: cannot resolve the latest version for ${target}` }
      const latest = manifest.version
      if (latest === '') return { status: 502, error: `plugin-manager: cannot resolve the latest version for ${target}` }
      const unsafeLatest = unsafeSpecReason(`${target}@${latest}`)
      if (unsafeLatest !== undefined) return { status: 502, error: unsafeLatest }
      if (row.version === latest) return { status: 409, error: `plugin-manager: ${target} is already at ${latest}` }
      const requiresDsh = dshRequirementOf(manifest)
      if (requiresDsh !== undefined) {
        const { hostVersion, compatible } = await compatibleVerdict(requiresDsh)
        if (!compatible) {
          return {
            status: 412,
            error: hostVersion === undefined
              ? `plugin-manager: cannot verify the DSH version for ${target} (dsh --version failed); upgrade DSH before updating`
              : `plugin-manager: ${target} requires DSH ${requiresDsh} (current DSH ${hostVersion}); upgrade DSH before updating`,
          }
        }
      }
      return { status: 200, job: gateway.update(target, latest) }
    })
    if ('error' in outcome) {
      writeJson(res, outcome.status, { error: outcome.error })
      return
    }
    writeJson(res, outcome.status, outcome.job)
  }

  const removeHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = (await readJsonBody(req, { maxBytes: 64 * 1024, objectOnly: true }) ?? {}) as Record<string, unknown>
    const id = body['id']
    if (typeof id !== 'string' || id.trim() === '') {
      writeJson(res, 400, { error: 'plugin-manager: remove needs an id' })
      return
    }
    const unsafeId = unsafeSpecReason(id.trim())
    if (unsafeId !== undefined) {
      writeJson(res, 400, { error: unsafeId })
      return
    }
    if (!deps.cliAvailable()) {
      writeJson(res, 500, { error: 'plugin-manager: dsh CLI not found on PATH' })
      return
    }
    writeJson(res, 200, gateway.remove(id.trim()))
  }

  const statusHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const jobId = url.searchParams.get('job')
    if (jobId === null) {
      writeJson(res, 400, { error: 'plugin-manager: status needs a job id' })
      return
    }
    const job = gateway.status(jobId)
    if (job === undefined) {
      writeJson(res, 404, { error: 'plugin-manager: unknown job' })
      return
    }
    writeJson(res, 200, { job })
  }

  const setEnabledHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = (await readJsonBody(req, { maxBytes: 64 * 1024, objectOnly: true }) ?? {}) as Record<string, unknown>
    const id = body['id']
    const enabled = body['enabled']
    if (typeof id !== 'string' || id.trim() === '' || typeof enabled !== 'boolean') {
      writeJson(res, 400, { error: 'plugin-manager: set-enabled needs an id and a boolean enabled' })
      return
    }
    const target = id.trim()
    const unsafeTarget = unsafeSpecReason(target)
    if (unsafeTarget !== undefined) {
      writeJson(res, 400, { error: unsafeTarget })
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
        // Never persist a disabled override for the gateway that performs this
        // write. For an aggregate package, all sibling entries are still
        // disabled; for the standalone manager this makes the request a no-op.
        const entryEnabled = enabled || SELF_MANAGED_ENTRY_IDS.has(entry.id)
        next = setRowEnabled(next, facts.patchPath, entry.id, entry.name, entryEnabled)
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
      writeJson(res, 404, { error: outcome.error })
      return
    }
    writeJson(res, 200, { plugin: outcome.plugin })
  }

  const failuresHandler = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The npm web runtime keeps no boot-failure ring; the install-error path
    // is the only repair surface here.
    writeJson(res, 200, { items: [], pluginRoot: facts.profileDir, safeMode: false })
  }

  // One verdict per host process: the browser half reads it instead of
  // probing the official channel, whose route 405s on the npm web runtime.
  let modePromise: Promise<{ official: boolean | null }> | undefined
  const probeOfficialChannels = (): Promise<boolean> => {
    const binary = findDshBinary()
    if (binary === null) return Promise.resolve(false)
    return detectOfficialChannels(binary, facts.profileName)
  }
  const modeHandler = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
    writeJson(res, 200, await modePromise)
  }

  const checkUpdatesHandler = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const patchText = await readPatchText(facts.patchPath)
    const snapshot = await snapshotGateway(facts, patchText)
    const updates: Array<{ id: string; current: string; latest: string; kind?: 'update' | 'migrate'; target?: string; targetVersion?: string; requiresDsh?: string; compatible?: boolean }> = []
    for (const plugin of snapshot.plugins) {
      const migration = legacyMigrationFor(plugin.id)
      if (migration !== undefined) {
        const targetManifest = await fetchManifest(migration.to).catch(() => undefined)
        if (targetManifest === undefined || targetManifest.version === '') continue
        const update: {
          id: string
          current: string
          latest: string
          kind: 'migrate'
          target: string
          targetVersion: string
          requiresDsh?: string
          compatible?: boolean
        } = {
          id: plugin.id,
          current: plugin.version,
          latest: targetManifest.version,
          kind: 'migrate',
          target: migration.to,
          targetVersion: targetManifest.version,
        }
        const requiresDsh = dshRequirementOf(targetManifest)
        if (requiresDsh !== undefined) {
          update.requiresDsh = requiresDsh
          update.compatible = (await compatibleVerdict(requiresDsh)).compatible
        }
        updates.push(update)
        continue
      }
      if (plugin.source.kind !== 'npm' || !isDirectRegistrySpec(plugin.source.spec)) continue
      const manifest = await fetchManifest(plugin.id).catch(() => undefined)
      if (manifest === undefined || manifest.version === plugin.version) continue
      const update: { id: string; current: string; latest: string; requiresDsh?: string; compatible?: boolean } =
        { id: plugin.id, current: plugin.version, latest: manifest.version }
      const requiresDsh = dshRequirementOf(manifest)
      if (requiresDsh !== undefined) {
        update.requiresDsh = requiresDsh
        update.compatible = (await compatibleVerdict(requiresDsh)).compatible
      }
      updates.push(update)
    }
    writeJson(res, 200, { updates })
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
