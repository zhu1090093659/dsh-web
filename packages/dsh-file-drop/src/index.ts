/**
 * Host loader entry for the dsh-file-drop plugin.
 *
 * The browser half listens for drops and uploads file bytes; this half owns
 * the /api/dsh-file-drop/upload route that writes them into the drop inbox
 * directory and returns the path. All surface re-syncs on settings edits
 * without a restart.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeRoutes } from './routes.ts'

export const inject = ['webServer']

/**
 * Settings namespace for the plugin. Spelled here rather than imported: the
 * browser half does not need it in v1 (no settings card yet).
 */
export const FILE_DROP_SETTINGS_NAMESPACE = settingsNamespace('file-drop')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the plugin (host route + browser half). */
  enabled?: boolean
  /** Optional inbox directory; empty means the default ~/.dsh/dsh-file-drop. */
  destDir?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  destDir: z.string().default(''),
})

/** Fully-resolved switches (no optional fields downstream). */
interface ResolvedConfig {
  enabled: boolean
  destDir: string
}

/**
 * Register the upload route, gated on the composition entry (and the live
 * settings value once the web settings surface is served).
 * @param ctx - the plugin context (webServer injected).
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  let current: () => Config = () => config ?? {}
  const resolve = (): ResolvedConfig => {
    const value = current()
    return {
      enabled: value.enabled ?? true,
      destDir: (value.destDir ?? '').trim(),
    }
  }

  let disposeRoutes: (() => void) | undefined

  const sync = (): void => {
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    const value = resolve()
    if (!value.enabled) return
    disposeRoutes = ctx.effect(
      () => {
        const routes = makeRoutes({ uploadDir: value.destDir === '' ? undefined : value.destDir })
        const disposers = routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-file-drop: routes',
    )
  }

  installSettingsSection(ctx, FILE_DROP_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => { current = source },
    onChange: sync,
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}
