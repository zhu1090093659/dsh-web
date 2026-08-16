/**
 * dsh-skill-manager — host half. Mounts the /api/dsh-skill-manager route
 * family (list / toggle / install / uninstall) over the official
 * `ctx.skills` registry, session headers, and the live agent scope. The
 * browser half (./client) registers the Settings page section "Skills".
 * Everything rides official NPM SDK packages — no dsh source changes.
 * @module @linxin666/dsh-skill-manager
 */

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SkillLedger } from './core/ledger.ts'
import { SkillInstaller } from './core/install.ts'
import { hostDshHome } from './core/roots.ts'
import { SkillManagerService } from './core/service.ts'
import { makeRoutes } from './routes.ts'

export { SkillLedger } from './core/ledger.ts'
export { SkillInstaller } from './core/install.ts'
export { SkillManagerService } from './core/service.ts'
export type { SkillManagerDeps, SkillsRegistryLike, SessionView, ManagerError, ManagerResult } from './core/service.ts'
export { makeRoutes } from './routes.ts'
export type { SkillManagerRoutesDeps } from './routes.ts'
export { API, API_BASE } from './core/protocol.ts'
export type {
  ApiErrorBody, InstalledEntryWire, InstallRequest, InstallResponse, InstallSourceWire,
  ListRequest, ListResponse, SkillRow, ToggleRequest, ToggleResponse, UninstallRequest, UninstallResponse,
} from './core/protocol.ts'

/** Stable cordis plugin name. */
export const name = 'skill-manager'

/** Services required before the routes can mount. */
export const inject = ['webServer', 'skills', 'sessions', 'agents']

/** Run one git command (clone). */
function runGit(args: readonly string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd: options.cwd, timeout: options.timeoutMs, windowsHide: true }, (error, _stdout, stderr) => {
      if (error !== null) {
        const detail = typeof stderr === 'string' && stderr.trim() !== '' ? stderr.trim() : error.message
        reject(new Error(detail))
        return
      }
      resolve()
    })
  })
}

/**
 * Mount the skill-manager routes on the shared web server.
 * @param ctx - host plugin context carrying webServer and skills.
 */
export function apply(ctx: Context): void {
  const webServer = ctx.get('webServer')
  const skills = ctx.get('skills')
  if (webServer === undefined || skills === undefined) return
  const dshHome = hostDshHome()
  const ledger = new SkillLedger(join(dshHome, 'skill-manager.json'))
  const installer = new SkillInstaller({ dshHome, ledger, runGit })
  const service = new SkillManagerService({
    sessions: ctx.sessions,
    agents: ctx.agents,
    skills,
    ledger,
    dshHome,
    installer,
  })
  const routes = makeRoutes({ service })
  ctx.effect(() => {
    const disposers = routes.map(route => webServer.register(route))
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'dsh-skill-manager: routes')
}
