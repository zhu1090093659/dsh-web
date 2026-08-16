/**
 * dsh-plugin-manager — host half. Mounts the /api/dsh-plugin-manager route
 * family (list / set-enabled) over the Cordis Loader service, the user patch
 * layer `<dshHome>/cordis.patch.yml`, and the fallback ledger. The browser
 * half (./client) registers the "Manage" tab inside the Plugins settings
 * section. Everything rides official NPM SDK packages — no dsh source
 * changes.
 * @module @linxin666/dsh-plugin-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { PluginLedger } from './core/ledger.ts'
import { PatchFileEditor } from './core/patch-file.ts'
import { hostDshHome, ledgerPath, userPatchPath } from './core/roots.ts'
import { PluginManagerService, isProtectedEntry } from './core/service.ts'
import { makeRoutes } from './routes.ts'
import type { LoaderEntryLike } from './loader-types.ts'

export { PluginLedger } from './core/ledger.ts'
export { PatchFileEditor, mergeDisabledOverride } from './core/patch-file.ts'
export { PluginManagerService, isProtectedEntry } from './core/service.ts'
export type { PluginManagerDeps, ManagerError, ManagerResult } from './core/service.ts'
export { makeRoutes } from './routes.ts'
export type { PluginManagerRoutesDeps } from './routes.ts'
export { API, API_BASE } from './protocol.ts'
export type {
  ApiErrorBody, ListResponse, PluginRow, SetEnabledRequest, SetEnabledResponse,
} from './protocol.ts'
export { fiberPhaseOf } from './loader-types.ts'
export type { LoaderEntryLike, LoaderFiberPhase, LoaderLike } from './loader-types.ts'

/** Stable cordis plugin name. */
export const name = 'plugin-manager'

/** The manager's own loader entry id (never toggleable from its own UI). */
export const OWN_ENTRY_ID = 'plugin-manager'

/** Boot-glue entries that must never be toggled. */
export const PROTECTED_ENTRY_IDS = ['include'] as const

/** Boot-glue modules that must never be toggled (include, groups, HMR, timers, self). */
export const PROTECTED_MODULE_NAMES = [
  'cordis:include',
  'cordis:group',
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-timer',
  '@linxin666/dsh-plugin-manager',
] as const

/** Services required before the routes can mount. */
export const inject = ['webServer', 'loader']

/**
 * Mount the plugin-manager routes and the ledger replay.
 * @param ctx - host plugin context carrying webServer and loader.
 */
export function apply(ctx: Context): void {
  const webServer = ctx.get('webServer')
  const loader = ctx.get('loader')
  if (webServer === undefined || loader === undefined) return

  const dshHome = hostDshHome()
  const service = new PluginManagerService({
    loader,
    ownEntryId: OWN_ENTRY_ID,
    protectedEntryIds: PROTECTED_ENTRY_IDS,
    protectedModuleNames: PROTECTED_MODULE_NAMES,
    patch: new PatchFileEditor(userPatchPath(dshHome)),
    ledger: new PluginLedger(ledgerPath(dshHome)),
  })

  const routes = makeRoutes({ service })
  ctx.effect(() => {
    const disposers = routes.map(route => webServer.register(route))
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'dsh-plugin-manager: routes')

  // Replay recorded disable intents once the loader tree settles (a patch
  // layer write may have failed while the host was up; the ledger is the
  // durable fallback that survives a restart).
  ctx.effect(() => {
    let cancelled = false
    void (async () => {
      try {
        await loader.await()
      } catch {
        return
      }
      if (cancelled) return
      let intents
      try {
        intents = await service.deps.ledger.disableIntents()
      } catch (error) {
        console.warn('[dsh-plugin-manager] ledger read failed:', error)
        return
      }
      for (const intent of intents) {
        const entry = findEntry(loader.entries(), intent.entryId)
        if (entry === undefined || entry.options.group || isProtectedEntry(entry, service.deps)) continue
        if (entry.disabled) continue
        try {
          await entry.update({ disabled: true })
        } catch (error) {
          console.warn(`[dsh-plugin-manager] ledger replay failed for ${intent.entryId}:`, error)
        }
      }
    })()
    return () => { cancelled = true }
  }, 'dsh-plugin-manager: ledger replay')
}

/** Find one loader entry by id. */
function findEntry(entries: Iterable<LoaderEntryLike>, entryId: string): LoaderEntryLike | undefined {
  for (const entry of entries) {
    if (entry.id === entryId) return entry
  }
  return undefined
}