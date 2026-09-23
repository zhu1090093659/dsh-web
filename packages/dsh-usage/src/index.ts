import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { mountOnce } from './mount-once.ts'
import { UsageService, type UsageServiceOptions } from './host/usage-service.ts'
import { makeUsageOverviewRoute, makeUsageRefreshRoute } from './host/routes.ts'

export const name = 'dsh-usage'
export const inject = ['webServer']
/**
 * Family settings namespace this row serves. Since 0.1.7 the settings surface
 * addresses one form per profile entry id and the Host generates this row's
 * page from the Config schema below, so the namespace is only the alias the
 * family settings bridge (dsh-web-settings) resolves onto this row's entry id.
 */
export const USAGE_SETTINGS_NAMESPACE = 'dsh-usage' as SettingsNamespace

export interface Config {
  enabled?: boolean
  /** Provider probe cycle in seconds; 30-3600. */
  pollIntervalSec?: number
  /** Ledger retention in local days. */
  retainDays?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  pollIntervalSec: z.number().min(30).max(3600).default(60),
  retainDays: z.number().min(7).max(730).default(180),
})

export interface ResolvedConfig extends UsageServiceOptions {
  enabled: boolean
}

export function resolveConfig(config?: Config): ResolvedConfig {
  return {
    enabled: config?.enabled ?? true,
    pollIntervalSec: typeof config?.pollIntervalSec === 'number' ? config.pollIntervalSec : 60,
    retainDays: typeof config?.retainDays === 'number' ? config.retainDays : 180,
  }
}

/**
 * Tail of the process-wide flush chain; undefined while no predecessor's final
 * ledger flush is still in flight. The Host reloads this profile row when its
 * configuration changes, so a successor activation is a dispose + apply pair in
 * the same process: its first ledger load must serialize behind its
 * predecessor's final write (and behind the reloads before that one).
 */
let pendingStop: Promise<unknown> | undefined

/**
 * Host body. The plugin's own Config schema above is the settings document the
 * 0.1.7 Host serves for this row; the effective config arrives here as the
 * `config` argument the Loader resolved and the Host reloads the row when the
 * user saves a change, so nothing in this body observes or writes settings.
 * @param ctx - host root context.
 * @param config - the row's resolved configuration.
 */
export const apply = mountOnce('@linxin666/dsh-usage', (ctx: Context, config?: Config): void => {
  const value = resolveConfig(config)
  // A disabled row mounts nothing: no probe cycle, no ledger, no routes. The
  // settings page owns the enable switch, and re-enabling reloads this row.
  if (!value.enabled) return

  let live = true
  let service: UsageService | undefined
  let disposeRoutes: (() => void) | undefined

  const begin = (): void => {
    // The fiber may have gone down while the predecessor's final flush was
    // still pending; only start while this activation is the live one.
    if (!live) return
    const next = new UsageService(ctx, value)
    service = next
    next.start()
    const disposers = [makeUsageOverviewRoute(ctx, next), makeUsageRefreshRoute(ctx, next)]
      .map((route) => ctx.webServer.register(route))
    disposeRoutes = () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // Route fiber already gone during shutdown.
        }
      }
    }
  }

  ctx.effect(() => {
    if (pendingStop === undefined) {
      // No predecessor's flush is in flight: start now.
      begin()
    } else {
      // Serialize the start behind every predecessor: their final writes must
      // land on disk before this instance loads the file.
      pendingStop = pendingStop.then(begin, begin).then(() => undefined)
    }
    return () => {
      live = false
      disposeRoutes?.()
      disposeRoutes = undefined
      const stopping = service?.stop()
      service = undefined
      // A successor waits for this instance's final flush, which itself waited
      // for the predecessor's start: a row disposed before it ever started
      // keeps the earlier link instead of dropping it.
      if (stopping !== undefined) pendingStop = (pendingStop ?? Promise.resolve()).then(() => stopping)
    }
  }, 'dsh-usage: runtime')
})
