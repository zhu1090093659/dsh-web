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
import { readJsonBody, withIdentityEncoding, writeJson } from './http.ts'
import { isLoopbackRequest } from './loopback.ts'
import { detectOfficialChannels, findDshBinary, spawnDsh, unsafeSpecReason, type CliGateway } from './gateway.ts'
import { dshRequirementOf, meetsMinimumDsh, parseDshVersion } from '../core/version.ts'
import { readManifestVersion, readPatchText, readProfileManifest, type ProfileFacts } from './profile.ts'
import { legacyMigrationFor, targetSpecForLegacy } from './legacy-migration.ts'
import { setRowEnabled, writePatchAtomic } from './rows.ts'
import { runDetached } from './detached-work.ts'
import { buildPluginRow, claimedEntryRowsOf, findRowOwner, LOCKED_ENTRY_IDS, snapshotGateway } from './state.ts'
import { performRestart, planRestart, type RestartFacts, type RestartRuntime } from './restart.ts'
import { createOutputCapture, type OutputCapture } from './console-output.ts'

/** Route prefix the browser half mirrors. */
export const GATEWAY_PREFIX = '/api/plugin-manager'

/** Registry timeout for one update check. */
const REGISTRY_TIMEOUT_MS = 30_000

/** Deadline for one dsh --version probe. */
const VERSION_TIMEOUT_MS = 10_000

/** Bounded capture of the version probe output, counted in bytes. */
const VERSION_MAX_OUTPUT_BYTES = 4_096

/** Grace period after SIGTERM before a stuck probe child is SIGKILLed. */
const VERSION_ESCALATION_TIMEOUT_MS = 5_000

/** Successful probe freshness window before the host version is re-read. */
const VERSION_PROBE_TTL_MS = 5 * 60_000

/** Minimum gap between failed version probes (avoids a spawn per request). */
const VERSION_PROBE_COOLDOWN_MS = 60_000



/** Dependencies every route shares. */
export interface GatewayRouteDeps {
  facts: ProfileFacts
  gateway: CliGateway
  /**
   * Resolve the dsh binary presence. Only the CLI-backed writer needs it: an
   * application-owned profile writes through the official in-process manager
   * (`gateway.usesNativeWriter()`), so its routes must not demand a binary.
   */
  cliAvailable: () => boolean
  /** Registry fetch seam for update checks (test seam); the default reads the
   * `/<name>/latest` manifest including the `dsh` / `engines` metadata. */
  fetchManifest?: (name: string) => Promise<RegistryVersionManifest | undefined>
  /**
   * Running DSH host version seam (test seam). The default reads the version of
   * the running installation in process, then falls back to `dsh --version`.
   */
  dshVersion?: () => Promise<string | undefined>
  /**
   * The running installation's own `@deepseek-ai/dsh` package.json, when the
   * launcher published one. It is the primary version source: the file belongs
   * to the runtime this process booted, so reading it needs no subprocess and no
   * PATH — which a packaged Desktop host does not have (issue #1819).
   */
  installAnchor?: string
  /** Official-channel detection seam (test seam); defaults to the boot dump probe. */
  officialChannels?: () => Promise<boolean>
  /** Launch-fact seam for the restart route (test seam); defaults to this process. */
  restartFacts?: () => RestartFacts
  /** Restart effect seam (test seam); defaults to the detached helper plus a real exit. */
  restartRuntime?: RestartRuntime
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

/** Append bounded probe output (bytes accumulate; one decode at read time). */
function captureProbe(chunk: Buffer, buffer: OutputCapture): void {
  buffer.push(chunk)
}

/**
 * Default registry manifest probe for npm packages: `/<name>/latest` returns
 * the full latest-version manifest, so the `dsh` / `engines` compat metadata
 * rides the same request as the version (no packument needed).
 */
async function fetchRegistryManifest(name: string): Promise<RegistryVersionManifest | undefined> {
  const encoded = name.startsWith('@') ? name.replace('/', '%2F') : name
  const response = await fetch(`https://registry.npmjs.org/${encoded}/latest`, withIdentityEncoding({
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  }))
  if (!response.ok) return undefined
  const body = await response.json() as { version?: unknown; dsh?: unknown; engines?: unknown }
  if (typeof body.version !== 'string') return undefined
  return { version: body.version, dsh: body.dsh, engines: body.engines }
}

/**
 * Read the running DSH host version out of the installation's own manifest.
 *
 * The launcher publishes the `@deepseek-ai/dsh` package.json it booted from on
 * `profileContext.installAnchor`; that manifest's `version` is by construction
 * the version of the DSH this host is running. It is the primary source because
 * it is the only one a packaged Desktop install can answer: there the CLI is not
 * on PATH, every `.bin` shim is stripped from the installer, and the private
 * host package ships no `lib/bin.js` to run (issue #1819). A runtime that
 * publishes no anchor (or one whose manifest cannot be read) falls through to
 * {@link probeDshVersion}.
 * @param installAnchor - the published anchor path, when there is one.
 * @returns the running version, or undefined when it cannot be read.
 */
function readInstalledDshVersion(installAnchor: string | undefined): string | undefined {
  if (installAnchor === undefined) return undefined
  return readManifestVersion(installAnchor)
}

/**
 * Read the running DSH host version through `dsh --version`.
 *
 * This is the FALLBACK source, used only when the installation's own manifest
 * could not be read. It costs a subprocess and needs a CLI this host can reach,
 * which a packaged Desktop host cannot: the launcher puts only `node` on its
 * PATH, the installer strips every `node_modules/.bin`, and the private host
 * package ships no `lib/bin.js` (issue #1819). Returns undefined when the
 * binary is unavailable or the output is not a plain semver; callers treat an
 * unknown host version as a fail-closed verdict for declared requirements
 * (issue #754).
 */
async function probeDshVersion(cliAvailable: () => boolean): Promise<string | undefined> {
  if (!cliAvailable()) return undefined
  const binary = findDshBinary()
  if (binary === null) return undefined
  const output = createOutputCapture(VERSION_MAX_OUTPUT_BYTES)
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
  const version = output.read().trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  return parseDshVersion(version) === undefined ? undefined : version
}

/** Whether a dependency spec is a direct npm-registry selector, not an alias or external source. */
function isDirectRegistrySpec(spec: string): boolean {
  return !/^(?:link:|file:|git:|github:|git\+|https?:\/\/|npm:|workspace:|catalog:)/.test(spec)
}

/**
 * The package name of a spec that names no version, or undefined when the
 * caller already chose one.
 *
 * A scoped name's `@` opens the scope, so only a `@` after the scope counts as
 * a version separator; every other separator form (`name@1.2.3`, `name@next`,
 * `name@^1`) yields undefined and is passed through untouched.
 * @param spec - the install spec the caller supplied.
 * @returns the bare package name when the spec is unversioned.
 */
function barePackageName(spec: string): string | undefined {
  if (spec === '') return undefined
  const separator = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.indexOf('@')
  return separator < 0 ? spec : undefined
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
   * Cached host version: successful verdicts refresh after a TTL (the CLI update
   * path is the gateway itself, so a stale success is wrong long-term), failed
   * probes are retried after a cooldown instead of being cached forever, and
   * concurrent requests share one in-flight probe.
   *
   * The running installation's own manifest is read first. That is a local file
   * read with no process to spawn and nothing to fall out of date mid-run, so it
   * is re-read per resolution and never cached: a packaged Desktop host, where
   * the CLI fallback is unreachable, would otherwise spend its first request on
   * a probe that cannot succeed.
   */
  let dshVersion: string | undefined
  let dshVersionAt = 0
  let dshVersionPending: Promise<string | undefined> | undefined
  const resolveDshVersion = (): Promise<string | undefined> => {
    if (deps.dshVersion !== undefined) return deps.dshVersion()
    const installed = readInstalledDshVersion(deps.installAnchor)
    if (installed !== undefined) return Promise.resolve(installed)
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
    if (!deps.cliAvailable() && !gateway.usesNativeWriter()) {
      writeJson(res, 500, { error: 'plugin-manager: dsh CLI not found on PATH' })
      return
    }
    // A bare package name must be pinned to the registry's current latest
    // before it reaches the installer (#1759). pnpm 11 applies a supply-chain
    // gate that silently skips releases younger than `minimumReleaseAge`
    // (24 h by default), so an unpinned spec resolves to the newest release OLDER
    // than the cutoff — the same-day version the panel just advertised was
    // silently skipped and the install landed one release behind with no error.
    // An explicit version or range the caller chose is honored as given.
    let installSpec = spec.trim()
    const name = barePackageName(installSpec)
    if (name !== undefined && isDirectRegistrySpec(installSpec)) {
      const manifest = await fetchManifest(name).catch(() => undefined)
      if (manifest?.version !== undefined && manifest.version !== '') {
        const pinned = `${name}@${manifest.version}`
        const unsafePinned = unsafeSpecReason(pinned)
        if (unsafePinned !== undefined) {
          writeJson(res, 400, { error: unsafePinned })
          return
        }
        installSpec = pinned
      }
    }
    writeJson(res, 200, gateway.install(installSpec))
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
    if (!deps.cliAvailable() && !gateway.usesNativeWriter()) {
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
                ? `plugin-manager: cannot verify the running DSH version for ${migration.to}; check the DSH runtime before migrating`
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
              ? `plugin-manager: cannot verify the running DSH version for ${target}; check the DSH runtime before updating`
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
    if (!deps.cliAvailable() && !gateway.usesNativeWriter()) {
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
      let ownerName = target
      let entries: Array<{ id: string; name: string; baseEnabled: boolean }>
      if (manifest.dependencies[target] !== undefined) {
        entries = await claimedEntryRowsOf(facts, target)
      } else {
        // Row-level toggle: the id is one entry row claimed by an aggregate's
        // bundle patch (e.g. web-ui-pet), not a dependency name. Only that
        // row gets the override; its siblings keep their state.
        const owner = await findRowOwner(facts, Object.keys(manifest.dependencies), target)
        if (owner === undefined) {
          return { error: `plugin-manager: plugin ${target} is not installed` } as const
        }
        if (!enabled && LOCKED_ENTRY_IDS.has(target)) {
          // Never persist a disabled override that would take down the manager
          // tab itself, its settings surface, or the aggregate compat face —
          // the UI performing these writes must stay reachable to undo them.
          return { error: `plugin-manager: row ${target} is required by this manager and cannot be disabled` } as const
        }
        ownerName = owner.packageName
        entries = [owner.row]
      }
      let next = patchText
      for (const entry of entries) {
        // A whole-package disable still force-keeps the locked rows mounted.
        const entryEnabled = enabled || LOCKED_ENTRY_IDS.has(entry.id)
        next = setRowEnabled(next, facts.patchPath, entry.id, entry.name, entryEnabled, entry.baseEnabled)
      }
      if (next !== patchText) {
        // The write must leave this handler's async context. The toggle can
        // arrive inside the Host's hmr.runExclusive transaction, and
        // cordis.patch.yml is exactly the file the HMR config watcher refreshes
        // from: a write issued on the transaction's context makes the watcher's
        // refresh re-enter runExclusive, which rejects with "HMR transactions
        // cannot be nested" and fails the toggle (#1816). A bare deferral would
        // NOT help - setImmediate inherits the transaction mark (measured; see
        // shared/host/detached-work.ts) - so the write is scheduled through the
        // module-scope AsyncResource. It is still awaited, so the response
        // reports the real write outcome and the snapshot below stays ordered.
        await runDetached(() => new Promise<void>((resolve, reject) => {
          setImmediate(() => {
            writePatchAtomic(facts.patchPath, next).then(resolve, reject)
          })
        }))
      }
      const snapshot = await snapshotGateway(facts, next)
      const plugin = snapshot.plugins.find(item => item.id === ownerName)
      return plugin === undefined
        ? { error: `plugin-manager: plugin ${ownerName} is not installed` } as const
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
    const updates: Array<{ id: string; current: string; latest: string; kind?: 'update' | 'migrate'; target?: string; targetVersion?: string; requiresDsh?: string; compatible?: boolean; hostVersion?: string }> = []
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
          hostVersion?: string
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
          const verdict = await compatibleVerdict(requiresDsh)
          update.compatible = verdict.compatible
          // An unknown host version is reported as such instead of being
          // flattened into "incompatible": the row is equally blocked, but the
          // user is told to check the runtime rather than to upgrade a DSH that
          // may already satisfy the requirement (issue #1819).
          if (verdict.hostVersion !== undefined) update.hostVersion = verdict.hostVersion
        }
        updates.push(update)
        continue
      }
      if (plugin.source.kind !== 'npm' || !isDirectRegistrySpec(plugin.source.spec)) continue
      const manifest = await fetchManifest(plugin.id).catch(() => undefined)
      if (manifest === undefined || manifest.version === plugin.version) continue
      const update: { id: string; current: string; latest: string; requiresDsh?: string; compatible?: boolean; hostVersion?: string } =
        { id: plugin.id, current: plugin.version, latest: manifest.version }
      const requiresDsh = dshRequirementOf(manifest)
      if (requiresDsh !== undefined) {
        update.requiresDsh = requiresDsh
        const verdict = await compatibleVerdict(requiresDsh)
        update.compatible = verdict.compatible
        if (verdict.hostVersion !== undefined) update.hostVersion = verdict.hostVersion
      }
      updates.push(update)
    }
    writeJson(res, 200, { updates })
  }

  /**
   * The running process's own launch facts, read once per request: the desktop
   * verdict comes from the profile facts (packaged Desktop launcher), the rest
   * from this process.
   */
  const liveRestartFacts = (): RestartFacts => ({
    desktop: facts.desktop,
    env: process.env,
    execPath: process.execPath,
    argv: process.argv.slice(1),
    execArgv: process.execArgv,
    cwd: process.cwd(),
    interactive: process.stdin.isTTY === true || process.stdout.isTTY === true,
  })

  /**
   * Restart the host so an applied plugin update is loaded. The route answers
   * with the mode it actually used (see host/restart.ts): 'relaunch' when this
   * process re-executes itself, 'shell' when the packaged Desktop shell owns
   * the process tree and runs its own restart, 'manual' when neither is safe.
   */
  const restartHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const plan = planRestart((deps.restartFacts ?? liveRestartFacts)())
    // Reading the plan is side-effect free. The toolbar asks for it before it
    // tells the user what a restart will do, and no GET-shaped request (a
    // prefetch, a typed URL, a link scanner) may ever stop a running host.
    if (req.method === 'GET' || req.method === 'HEAD') {
      writeJson(res, 200, { restart: { mode: plan.mode } })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'plugin-manager: restart needs GET (plan) or POST (execute)' })
      return
    }
    const mode = performRestart(plan, deps.restartRuntime ?? {})
    writeJson(res, 202, { restart: { mode } })
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
    { kind: 'exact', path: `${GATEWAY_PREFIX}/restart`, handler: guard(restartHandler) },
  ]
}

/** Re-exported for host wiring: build a plugin row against the live snapshot. */
export { buildPluginRow }
