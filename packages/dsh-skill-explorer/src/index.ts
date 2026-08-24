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
import { makeRoutes, ROUTES } from './routes.ts'
import type { CollectOptions } from './collect.ts'
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
  const customSkillDirs = Array.isArray(config?.customSkillDirs) ? config.customSkillDirs : []

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

  const routes = makeRoutes(ctx, {
    dshHome,
    agentsHome,
    customSkillDirs,
    registry: skillCtx.skills,
    activeSessionCwds,
    logger: { warn: (error: unknown) => ctx.logger.warn(error) },
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
