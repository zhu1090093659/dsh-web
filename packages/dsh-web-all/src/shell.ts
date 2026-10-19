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
 * Config contract (written by scripts/aggregate.mjs, then edited by the Host
 * settings surface):
 *   - id: web-ui-task-board
 *     name: '@linxin666/dsh-web-all/task-board'
 *     config:
 *       plugin: '@linxin666/dsh-client-ui-task-board'
 *       (the real plugin's own config fields, at the row config root)
 *
 * `plugin` is the shell's own key; every other key of the row config IS the
 * real plugin's config, forwarded verbatim. The flattened shape is what makes
 * the row configurable: the Host settings surface edits an entry's own Config
 * schema, so the family plugin's fields must sit where a standalone install of
 * that package keeps them — one shape whether a profile mounts the aggregate
 * row or the package on its own. See {@link Config}.
 *
 * The aggregate's SELF row (web-ui-compat) mounts this package with NO
 * config: that is the compat shim's own mount (its host half is a no-op and
 * its browser half rides the package's ./client face), so a config-less row
 * is accepted as a no-op rather than treated as a mis-generated row.
 *
 * Health surface: a loopback-only GET /api/dsh-web-all/degraded answers with
 * the current degradation ledger so doctor/monitoring can surface "these
 * plugins are degraded, the rest of the Web is healthy" without log scraping.
 * Every record carries a one-line `reason` beside the full `message` (stack):
 * a degraded plugin registered no route of its own, so this ledger is the only
 * surface that can tell its panel WHY. The task board reads it for exactly
 * that (issue #1730): its row degrades when another DSH process holds the
 * ledger lock, and a bare 404 from /api/task-board/* cannot say so.
 *
 * The shell no longer has a row-state surface. Family rows mount their real
 * packages now (issue #1901), so the loader's own entry state is the answer to
 * "is this family mounted", and the browser half has no inlined children left
 * to gate: /api/dsh-web-all/rows and its ledger were removed with the
 * subpath-row mount.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { listDegraded, recordDegraded } from './degraded.ts'
import { RETIRED_PLUGINS as RETIRED_PLUGINS_GENERATED } from './retired-plugins.generated.ts'
import { shellState } from './state.ts'

/** Required services: none — the shell must activate before anything else. */
export const inject = [] as const

/** The shell's own row-config key: the real plugin's module specifier. */
export interface ShellConfig {
  /** Import specifier of the real plugin package, resolved from the profile root. */
  readonly plugin?: string
  /** The real plugin's own config fields, forwarded verbatim. */
  readonly [field: string]: unknown
}

/**
 * Row config as the Loader hands it to {@link apply}: a reference for a
 * root-volatile schema (the schema below), or a plain object on a
 * programmatic mount.
 */
export type ShellConfigInput = Volatile<ShellConfig> | ShellConfig | undefined

/**
 * The shell row's Config schema — deliberately shapeless.
 *
 * The shell mounts the real plugin, so the row config IS that plugin's config,
 * and the Host serves a settings form and accepts writes only for an entry
 * whose own Config schema declares the edited fields as volatile. The shell
 * cannot declare those fields: it would have to import the family module to
 * learn its schema, and importing it eagerly is the failure mode this shell
 * exists to contain. Two properties of this stand-in make the real fields
 * editable anyway:
 *
 * - `any` (not an object) keeps them at the form root: an object schema
 *   projects only its own declared keys, and every family card would read
 *   empty values.
 * - `.volatile()` is what puts the entry on the settings surface at all
 *   (`SettingsForms.describe` skips an entry with no volatile field) and what
 *   admits a write to any path. It also moves the edit to the live path: the
 *   Loader commits the new config into this entry's reference instead of
 *   remounting the row, and {@link apply} mounts the family plugin again with
 *   the committed config.
 *
 * The accepted cost: the Host cannot validate family fields at write time. The
 * family plugin's own Config validates them when the shell mounts it, and a
 * value it refuses leaves that one row degraded (the ledger and log say so)
 * instead of taking the boot down.
 */
export const Config = z.any().volatile()

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount; dispatched to the owning fiber only. Spelled here because the
     * Loader package is not a dependency of this plugin, with the Loader's own
     * shape so the two declarations merge when a Host program carries both.
     * @param paths - changed config paths as key arrays; every value is committed before dispatch.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * Loopback-fenced degraded-state route (installed once per shell context).
 * Payload is additive: `{ ok, degraded: [{ plugin, stage, message, reason, at }] }`
 * — the reason field is what a degraded plugin's own panel renders (#1730),
 * and a reader that predates it keeps using stage/message.
 */
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


/**
 * Route registration state lives in the process-wide shared state
 * (src/state.ts): multiple shell entries (the self row plus one per family
 * plugin) mount sequentially under the aggregate, AND the bundler splits the
 * two entry artifacts (lib/index.js vs lib/shells/shell.js) into separate
 * module copies — module-local state would double-register the routes. Both
 * health routes are singletons on the host webServer; ref-counting registers
 * them exactly once on the first shell entry and tears them down with the
 * last.
 */

/** For test teardown and test isolation only. */
export function _resetDegradedRouteForTest(): void {
  const routes = shellState().healthRoutes
  routes.count = 0
  try {
    routes.unregister?.()
  } catch {
    // Ignore.
  }
  routes.unregister = undefined
}

/**
 * Hold the health route (degraded) for this shell entry's lifetime. Every
 * shell entry calls this — including the config-less self row — so the route
 * stays up even when every family row is disabled.
 *
 * The shell applies with inject=[] (it must activate before anything else),
 * which means it usually runs BEFORE the web app provides webServer. A direct
 * read at apply time therefore misses the service and the routes would never
 * register — registration instead rides a nested inject fiber that starts
 * when webServer appears and disposes with this entry. Hosts without
 * webServer (some minimal profiles) simply never start the fiber: no routes,
 * no error.
 */
function holdHealthRoutes(ctx: Context): void {
  ctx.inject(['webServer'], (scoped) => {
    const webServer = (scoped as { webServer?: { register(route: WebRoute): () => void } }).webServer
    if (webServer === undefined) return
    const routes = shellState().healthRoutes
    if (routes.count === 0) {
      try {
        const unregisterDegraded = webServer.register(makeDegradedRoute())
        routes.unregister = () => {
          unregisterDegraded()
        }
      } catch (error) {
        // Defensive fallback: if another module already owns an exact route,
        // log a warning without throwing so the fault-isolation shell fiber
        // never fails.
        console.warn('[dsh-web-all] failed to register health routes:', error)
      }
    }
    routes.count += 1
    scoped.effect(() => () => {
      routes.count -= 1
      if (routes.count <= 0) {
        routes.count = 0
        try {
          routes.unregister?.()
        } catch {
          // Dispose must never throw.
        }
        routes.unregister = undefined
      }
    }, 'dsh-web-all: health routes')
  })
}

/** The slice of a cordis fiber this shell watches for a deferred start failure. */
interface NestedFiber {
  /**
   * Settle on the fiber's current lifecycle work and rethrow its startup
   * error, if it has one. Resolves for a fiber that is still waiting for its
   * injected services, so watching it is free of false positives.
   */
  await(): Promise<unknown>
}

/** One mounted family plugin, kept so a later config edit can be applied to it. */
interface MountedFamily {
  /** Module specifier the mounted plugin was imported from. */
  spec: string
  /** The config the real plugin was mounted with (undefined when the row declared none). */
  config: unknown
  /** Dispose the nested plugin's fiber (a real mount; a test double may omit it). */
  dispose?: () => Promise<void>
  /** The nested fiber, watched for a start failure that lands after this mount returned. */
  fiber?: NestedFiber
}

/** Whether one row config is a mapping (the shape every real row has). */
function isRowConfig(value: unknown): value is ShellConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the live row config. The schema is root-volatile, so the Loader hands a
 * stable reference it commits a new config into without remounting the entry —
 * every read goes through it instead of capturing the value at activation.
 * @param config - the row config as handed to {@link apply}.
 * @returns the plain row config, or undefined when this entry has none.
 */
function liveRowConfig(config: ShellConfigInput): unknown {
  if (config === undefined) return undefined
  const read = (config as { get?: unknown }).get
  return typeof read === 'function' ? (read as () => unknown).call(config) : config
}

/** The config the real plugin receives: every row key but the shell's own. */
function familyConfigOf(row: ShellConfig): unknown {
  const { plugin: _spec, ...family } = row
  return Object.keys(family).length === 0 ? undefined : family
}

/** Whether two family configs carry the same values (row configs are JSON data). */
function sameFamilyConfig(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** Render one config value for a degraded-log message without ever throwing. */
function describeConfig(value: unknown): string {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return '[unrepresentable]'
  }
}

/** Config shapes that must mount quietly: absent (self row) or a bare-row override. */
function isOverrideShape(config: unknown): boolean {
  if (config === undefined) return true
  if (!isRowConfig(config)) return false
  const keys = Object.keys(config)
  return keys.length === 0 || !('plugin' in config)
}

/**
 * Known retired family plugins: stale rows from older user profiles mount as
 * silent no-ops so upgrading the aggregate package never breaks the host boot.
 *
 * The list is generated from the aggregate.yml `retiredPlugins` section
 * (src/retired-plugins.generated.ts) and is therefore the single source for
 * this behavior: adding a retired family edits the manifest and reruns
 * `node scripts/aggregate.mjs`. It used to be a hand-written literal here,
 * and it drifted — the 2026-09-23 removal of dsh-doctor and
 * dsh-tool-describe-image never added its two package names, so their leftover
 * profile rows fell through to the import below and recorded a normal
 * retirement as a degraded plugin. The semantics are unchanged: a row naming a
 * retired plugin mounts empty and records nothing.
 */
const RETIRED_PLUGINS = new Set(RETIRED_PLUGINS_GENERATED)

/**
 * Whether a lifecycle transition belongs to the fiber one row mounted.
 *
 * `ctx.plugin()` returns `Object.create(fiber)` — a thin wrapper whose `then`
 * forwards to the fiber's own `await()` — so the mounted handle is NOT the
 * fiber the `internal/status` event reports. The wrapper's prototype is that
 * fiber, which is what makes the two comparable.
 * @param watched - the handle `ctx.plugin()` returned for this row.
 * @param fiber - the fiber an `internal/status` transition reported.
 * @returns whether the transition is this row's own nested plugin.
 */
function isNestedFiber(watched: NestedFiber, fiber: unknown): boolean {
  return watched === fiber || Object.getPrototypeOf(watched as object) === fiber
}

/**
 * The fiber, when it can be watched for a start failure that lands LATE.
 *
 * Awaiting the fiber covers the failures that settle while the mount is still
 * in flight. It does NOT cover the shape every real family plugin has: a plugin
 * that declares injected services is created PENDING, so `ctx.plugin()` returns
 * while the plugin body has not run at all — and the promise it returns resolves
 * then. When the injected service finally appears, cordis runs the body, the
 * body throws (the task board's ledger lock: issue #1730/#1850), the fiber goes
 * FAILED — and the shell, having already watched a promise that resolved, hears
 * nothing. The row then keeps its UI entry while `/api/dsh-web-all/degraded`
 * answers an empty ledger, which is exactly the report this covers.
 *
 * So the fiber itself is watched: `fiber.await()` resolves once the fiber
 * settles and rethrows its startup error, whenever that happens. It is only
 * ever consulted on a lifecycle transition, so it adds no polling, and it
 * resolves (rather than throws) for a fiber still waiting for its services, so
 * a healthy row is never recorded as degraded.
 * @param fiber - the nested plugin fiber as `ctx.plugin()` returned it.
 * @returns the watchable face of that fiber, or undefined for a test double.
 */
function watchable(fiber: unknown): NestedFiber | undefined {
  const candidate = fiber as { await?: unknown } | undefined
  return candidate !== null && typeof candidate?.await === 'function' ? candidate as NestedFiber : undefined
}

/**
 * Record a family plugin's start failure, at whichever point it lands.
 *
 * Called on every lifecycle transition of a nested fiber — including the one
 * that fails a plugin whose body only ran once its injected services appeared.
 * A healthy fiber has no startup error, so `await()` resolves and this is a
 * no-op; a fiber that has not finished waiting for its services resolves too,
 * so a row that is merely deferred is never reported as broken.
 * @param spec - the real plugin package name the row named.
 * @param fiber - the nested fiber to settle and inspect.
 */
function recordDeferredStartFailure(spec: string, fiber: NestedFiber): void {
  void fiber.await().catch(error => recordDegraded(spec, 'start', error))
}

/**
 * Apply one shell entry: mount the configured real plugin behind an isolation
 * boundary, and re-mount it whenever the row config changes.
 *
 * The entry's schema is root-volatile (see {@link Config}), so a settings edit
 * never remounts this entry: the Loader commits the new config into the
 * reference handed here and emits `loader/volatile-update`. The shell applies
 * that itself by mounting the family plugin again with the committed config,
 * which is also what keeps a hand-edited `plugin` (or any other key) honest.
 * @param ctx - the shell entry's context.
 * @param config - the row config: the plugin specifier plus the real plugin's own fields.
 */
export async function apply(ctx: Context, config: ShellConfigInput): Promise<void> {
  holdHealthRoutes(ctx)
  let mounted: MountedFamily | undefined
  /** Serializes config syncs: an update may land while a mount is still running. */
  let tail: Promise<void> = Promise.resolve()

  /** Mount the real plugin the current row config names, replacing any previous mount. */
  const sync = async (): Promise<void> => {
    const raw = liveRowConfig(config)
    const row = isRowConfig(raw) ? raw : undefined
    if (row === undefined) {
      if (raw === undefined) return
      recordDegraded('(no plugin)', 'shape', new Error(`shell row config is not a mapping (row config: ${describeConfig(raw)}); the entry mounted empty`))
      return
    }
    const spec = row.plugin
    if (typeof spec !== 'string' || spec === '') {
      // Two legitimate shapes land here and must mount QUIETLY (no degraded
      // record, no throw — an async apply's rejection escapes the loader
      // lifecycle as an unhandled rejection and the host's fail-loud guard
      // kills the whole process):
      // - the SELF row (web-ui-compat): no config at all (undefined or {}).
      //   The compat shim's host half has no host behavior; its browser half
      //   rides the package's ./client face.
      // - a USER bare-row override (`- id: <row>` + `config:` in a patch
      //   layer): patch overrides REPLACE the row config wholesale, so a
      //   hand-written tuning that drops the `plugin` key leaves this row
      //   with nothing to mount. Silence is the documented behavior for that
      //   shape; anything else still lands in the ledger for visibility.
      if (isOverrideShape(row)) return
      recordDegraded('(no plugin)', 'shape', new Error(`shell row config is missing the "plugin" package name (row config: ${describeConfig(row)}); the entry mounted empty`))
      return
    }
    if (RETIRED_PLUGINS.has(spec)) {
      // Stale row from an older profile whose plugin has been retired. Mount empty quietly.
      return
    }
    const family = familyConfigOf(row)
    if (mounted !== undefined && mounted.spec === spec && sameFamilyConfig(mounted.config, family)) return
    if (mounted !== undefined) {
      const previous = mounted
      mounted = undefined
      try {
        await previous.dispose?.()
      } catch (error) {
        // A failed unmount must never keep the new config from mounting.
        console.warn('[dsh-web-all] unmounting the previous family plugin failed:', error)
      }
    }
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
      const fiber = ctx.plugin(plugin as Parameters<Context['plugin']>[0], family)
      mounted = { spec, config: family, dispose: fiber.dispose, fiber: watchable(fiber) }
      void Promise.resolve(fiber).then(
        () => {},
        error => recordDegraded(spec, 'start', error),
      )
    } catch (error) {
      recordDegraded(spec, 'start', error)
    }
  }

  const schedule = (): Promise<void> => {
    tail = tail.then(() => sync().catch((error: unknown) => {
      // An async apply's rejection escapes the loader lifecycle as an
      // unhandled rejection (the host's fail-loud guard then kills the whole
      // process), so every path out of a sync is captured here.
      console.error('[dsh-web-all] applying the shell row config failed:', error)
    }))
    return tail
  }

  // A settings edit on this entry commits the new config into the reference
  // and reaches the family plugin through this listener, not through a remount.
  ctx.on('loader/volatile-update', () => { void schedule() })
  ctx.on('internal/status', (fiber: unknown) => {
    const current = mounted
    if (current?.fiber === undefined || !isNestedFiber(current.fiber, fiber)) return
    recordDeferredStartFailure(current.spec, current.fiber)
  })
  // A plugin that injects services starts LATER than this mount call: cordis
  // creates its fiber PENDING and runs the body only once every injected
  // service exists. A failure in that body therefore lands after the promise
  // above has already resolved, so the fiber's own lifecycle transitions are
  // watched as well. Transitions are rare and `await()` settles without
  // throwing for a fiber that is still waiting, so a healthy row costs nothing.
  await schedule()
}