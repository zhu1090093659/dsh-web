/**
 * Host-half fault-isolation shell for the dsh-web family aggregate.
 *
 * The DSH loader mounts every patch row as a transactional loader entry: one
 * entry that fails to import or start rolls the whole group back and the boot
 * audit (`assertEntriesActivated`) kills the entire `dsh web` process — one
 * broken plugin takes every plugin down. This shell redefines the fault unit:
 * each family plugin's patch row points at THIS package (a module that never
 * fails to import) and carries the real plugin package name in its row config.
 * The shell imports the real module at start time; an import or activation
 * failure is captured, logged, and recorded — the shell fiber itself stays
 * active, so the boot audit sees a healthy entry and the rest of the family
 * mounts regardless.
 *
 * The real plugin runs as a nested plugin on the shell's child context, which
 * keeps cordis semantics intact: services it provides stay visible through the
 * normal scope chain, its lifecycle (config updates, disposal) tracks the
 * shell entry, and a later failure retracts only its own services.
 *
 * Config contract (written by scripts/aggregate.mjs):
 *   - id: web-ui-usage
 *     name: '@linxin666/dsh-web-all'
 *     config:
 *       plugin: '@linxin666/dsh-usage'
 *       (config: {...})   forwarded verbatim to the real plugin
 *
 * The aggregate's SELF row (web-ui-compat) mounts this package with NO
 * config: that is the compat shim's own mount (its host half is a no-op and
 * its browser half rides the package's ./client face), so a config-less row
 * is accepted as a no-op rather than treated as a mis-generated row.
 *
 * Health surface: a loopback-only GET /api/dsh-web-all/degraded answers with
 * the current degradation ledger so doctor/monitoring can surface "these
 * plugins are degraded, the rest of the Web is healthy" without log scraping.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { listDegraded, recordDegraded } from './degraded.ts'

/** Required services: none — the shell must activate before anything else. */
export const inject = [] as const

export interface ShellConfig {
  /** Import specifier of the real plugin package, resolved from the profile root. */
  plugin: string
  /** Config forwarded verbatim to the real plugin. */
  config?: unknown
}

/** Loopback-fenced degraded-state route (installed once per shell context). */
function makeDegradedRoute(): WebRoute {
  return {
    kind: 'exact',
    path: '/api/dsh-web-all/degraded',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      let remote = req.socket.remoteAddress ?? ''
      if (remote.startsWith('::ffff:')) remote = remote.slice(7)
      if (remote !== '127.0.0.1' && remote !== '::1') {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'forbidden: loopback-only' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, degraded: listDegraded() }))
    },
  }
}

/** Config shapes that must mount quietly: absent (self row) or a bare-row override. */
function isOverrideShape(config: ShellConfig | undefined): boolean {
  if (config === undefined) return true
  if (typeof config !== 'object' || config === null) return false
  const keys = Object.keys(config)
  return keys.length === 0 || !('plugin' in config)
}

/** Apply one shell entry: mount the configured real plugin behind an isolation boundary. */
export async function apply(ctx: Context, config: ShellConfig | undefined): Promise<void> {
  const spec = config?.plugin
  if (typeof spec !== 'string' || spec === '') {
    // Two legitimate shapes land here and must mount QUIETLY (no degraded
    // record, no throw — an async apply's rejection escapes the loader
    // lifecycle as an unhandled rejection and the host's fail-loud guard
    // kills the whole process):
    // - the SELF row (web-ui-compat): no config at all (undefined or {}).
    //   The compat shim's host half has no host behavior; its browser half
    //   rides the package's ./client face.
    // - a USER bare-row override (`- id: <row>` + `config:` in a patch
    //   layer): patch overrides REPLACE the row config wholesale, so the
    //   user's tuning (e.g. remote-web-ui's autoTunnel) strips the `plugin`
    //   key. The real plugin already mounted under the same entry id from
    //   the bundle layer's shell config — a bare override is a RE-patch of
    //   an existing shell entry, not a fresh mount, so mounting empty must
    //   be silent (and the override should carry the plugin key; the
    //   aggregate docs show the correct form).
    // Anything else still lands in the ledger for visibility.
    if (isOverrideShape(config)) return
    recordDegraded('(no plugin)', 'shape', new Error(`shell row config is missing the "plugin" package name (row config: ${JSON.stringify(config ?? null)}); the entry mounted empty`))
    return
  }
  // Optional service read: a plugin-fiber context proxy throws on an
  // undeclared property read, so the optional webServer face goes through
  // reflect.get(name, false) (strict=false: no inject requirement). The
  // degraded route is a best-effort surface — a host without webServer (some
  // minimal profiles) simply skips it.
  const webServer = ctx.reflect.get('webServer', false) as { register(route: WebRoute): () => void } | undefined
  const disposeRoute = webServer?.register(makeDegradedRoute())
  ctx.effect(() => () => disposeRoute?.(), 'dsh-web-all: degraded route')
  let mod: unknown
  try {
    mod = await import(/* @vite-ignore */ spec)
  } catch (error) {
    recordDegraded(spec, 'import', error)
    return
  }
  const plugin = (mod as { default?: unknown; apply?: unknown })?.default ?? mod
  if (typeof plugin !== 'function' && !(typeof plugin === 'object' && plugin !== null && typeof (plugin as { apply?: unknown }).apply === 'function')) {
    recordDegraded(spec, 'shape', new Error(`module has no usable plugin shape (expected a function or { apply })`))
    return
  }
  try {
    // Sync application errors (invalid config, throwing apply) escape the
    // ctx.plugin() call itself; async ones settle on the returned fiber.
    // Both paths are captured here so the shell fiber never fails.
    const fiber = ctx.plugin(plugin as Parameters<Context['plugin']>[0], config?.config)
    void Promise.resolve(fiber).then(
      () => {},
      error => recordDegraded(spec, 'start', error),
    )
  } catch (error) {
    recordDegraded(spec, 'start', error)
  }
}