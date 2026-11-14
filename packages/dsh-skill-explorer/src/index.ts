/**
 * skill-explorer — host half. Serves the skill center data source: the
 * /api/dsh-skill-explorer route family (list grouped by source, set enabled,
 * create, delete, health) over the shared trust fence (loopback by default;
 * a live paired-device cookie is an extra allow path). The browser half
 * (./client) renders the skill center panel.
 *
 * Ported from the local dsh-skill-explorer plugin; everything rides official
 * NPM SDK packages — no dsh source changes.
 */

import { homedir } from 'node:os'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { captureConnection } from './access.ts'
import { makeRoutes, ROUTES } from './routes.ts'
import { customSkillDirsFromLoader, normalizeSkillRoots, type CollectOptions, type LoaderEntryLike } from './collect.ts'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name. */
export const name = 'skill-explorer'

/** Services required before the skill center routes can mount. */
export const inject = ['webServer', 'skills', 'sessions']

/** Route paths (re-exported for the client contract check). */
export { ROUTES }

/** Skill center services (skills/sessions come from harness services not typed on Context). */
interface SkillContext {
  webServer: Context['webServer']
  skills: CollectOptions['registry']
  sessions: unknown
}

/** Session list surface used to resolve active workspaces. */
interface SessionList {
  list?: () => Array<{ header?: { cwd?: string } }>
}

/** Loader surface used to read the live skill provider rows. */
interface LoaderSurface {
  entries?: () => Iterable<LoaderEntryLike>
}

/** Plugin config. */
export interface Config {
  /** Master switch for the plugin (routes). */
  enabled?: boolean
  /** Extra custom skill root directories. */
  customSkillDirs?: string[]
  /** User dsh config root override (defaults to $DSH_HOME or ~/.dsh). */
  dshHome?: string
  /** User agents config root override (defaults to $DSH_AGENTS_HOME or ~/.agents). */
  agentsHome?: string
}

/**
 * Mount the skill center routes (trust fence looks up remoteWebUiPairing on ctx).
 * @param ctx - host plugin context carrying webServer/skills/sessions.
 * @param config - resolved plugin config.
 */
function applyImpl(ctx: Context, config?: Config): void {
  if (config?.enabled === false) return
  const skillCtx = ctx as unknown as SkillContext
  const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? homedir() + sep + '.dsh'
  const agentsHome = config?.agentsHome ?? process.env.DSH_AGENTS_HOME ?? homedir() + sep + '.agents'
  /**
   * Every custom skill root the panel should scan: this plugin's own config
   * plus whatever the live `skill-filesystem` rows declare. The official
   * documented placement is the provider row (a profile patch), not this
   * plugin, so reading only `config.customSkillDirs` left those skills
   * listed with no editable path — the "Custom directories" group rendered
   * without controls and every write route answered 404.
   */
  const customSkillDirs = (): string[] => {
    const own = Array.isArray(config?.customSkillDirs) ? config.customSkillDirs : []
    let fromRows: string[] = []
    try {
      // Non-strict read: the loader is present in every real composition but
      // is not a declared dependency of this plugin, so a shell without one
      // must degrade to the plugin's own config instead of failing the mount.
      const loader = (ctx as unknown as { get(name: string, strict?: boolean): unknown }).get('loader', false) as LoaderSurface | undefined
      if (typeof loader?.entries === 'function') fromRows = customSkillDirsFromLoader(loader.entries())
    } catch {
      fromRows = []
    }
    return normalizeSkillRoots([...own, ...fromRows])
  }

  /** Active session workspace cwds (degraded to [] when the registry is unavailable). */
  const activeSessionCwds = (): string[] => {
    try {
      const sessions = skillCtx.sessions as SessionList | undefined
      if (typeof sessions?.list !== 'function') return []
      return sessions
        .list()
        .map((session) => session.header?.cwd)
        .filter((cwd): cwd is string => typeof cwd === 'string' && cwd !== '')
    } catch {
      return []
    }
  }

  // The peer-auth connection bridge reads `connection.authentication` through
  // the calling context, so it is captured in a scope that injects it; a
  // deployment that serves no such service keeps the bare lookup.
  const connection = captureConnection(ctx)
  const routes = makeRoutes(ctx, {
    dshHome,
    agentsHome,
    customSkillDirs,
    registry: skillCtx.skills,
    activeSessionCwds,
    logger: { warn: (error: unknown) => ctx.logger.warn(error) },
    connection,
  })

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'skill-explorer: routes')
}

/**
 * Single-instance guard shared by the plugin family: the aggregate bundle
 * (dsh-web-all) and a standalone install of this package can coexist in
 * one profile, so the second host apply must be a no-op instead of
 * re-registering the same routes and failing the boot.
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-skill-explorer', applyImpl)
