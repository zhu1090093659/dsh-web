/**
 * Host half of the in-GUI pet center: mounts the `/api/pet-center/*` routes
 * the browser half uses for one-click pet switching. Every switch delegates
 * to the embedded `usePet` port, which owns the managed pet section of
 * `~/.dsh/cordis.patch.yml`; the DSH config watcher hot-reloads the patch
 * within seconds, so no restart is needed. The browser half (the `./client`
 * entry) renders the pet-center card in the Web UI plugin group.
 * @module @linxin666/dsh-client-ui-pet-center
 */

import { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the dsh-host-webserver service seat (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makePetCenterRoutes, PET_CENTER_API_PREFIX } from './routes.ts'

export { makePetCenterRoutes, PET_CENTER_API_PREFIX } from './routes.ts'
export { currentPet, currentActive, PETS, renderManaged, stripManaged, usePet, DEFAULT_PET } from './pet-switch.ts'
export type { PetId, PetSwitchEntry, PetSwitchPaths } from './pet-switch.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-pet-center'

/** Services required before the pet center can mount its routes. */
export const inject = ['webServer']

/**
 * Register the pet-center API routes.
 *
 * Failure policy: route mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and the pet center
 * must not take the GUI down.
 * @param ctx - cordis context.
 */
export function apply(ctx: Context): void {
  const routes = makePetCenterRoutes()
  try {
    ctx.effect(() => {
      const disposers: Array<() => void> = []
      try {
        for (const route of routes) disposers.push(ctx.webServer.register(route))
      } catch (error) {
        // Roll back whatever registered before the failure so a partial
        // mount never leaves half a route family live; the outer catch logs.
        for (const dispose of disposers) dispose()
        throw error
      }
      return () => { for (const dispose of disposers) dispose() }
    }, 'ui-pet-center: routes')
  } catch (error) {
    console.error('[ui-pet-center] route registration failed:', error)
  }
}
