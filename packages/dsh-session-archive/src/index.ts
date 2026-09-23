import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { mountOnce } from './mount-once.ts'
import { ArchiveService } from './host/janitor.ts'
import { makeArchiveRoutes } from './host/routes.ts'
import { readArchiveConfig, resolveAutoConfig, type SessionArchiveConfigFields } from './core/config.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount; dispatched to the owning fiber only. The settings surface edits
     * this plugin's own Config through the profile entry, so this is the edge
     * that re-arms the runtime after the user changes a setting.
     * @param paths - changed config paths as key arrays.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

export const name = 'dsh-session-archive'
export const inject = ['webServer', 'workspaceRegistry']

/**
 * The plugin's own settings, served by the Host as this profile entry's
 * configuration page. Every field is volatile: a settings write commits a new
 * value into the running activation's references (see the
 * `loader/volatile-update` listener in {@link apply}) instead of remounting the
 * row, which is what keeps the archive service, its ledger and its scheduler
 * alive across a settings change.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  autoArchiveEnabled: z.boolean().default(false).volatile(),
  autoArchiveDays: z.number().min(1).max(3650).default(7).volatile(),
  autoDeleteEnabled: z.boolean().default(false).volatile(),
  autoDeleteDays: z.number().min(1).max(3650).default(7).volatile(),
  checkIntervalMin: z.number().min(15).max(1440).default(60).volatile(),
})

export const apply = mountOnce('@linxin666/dsh-session-archive', (ctx: Context, config?: SessionArchiveConfigFields): void => {
  let service: ArchiveService | undefined
  let disposeRoutes: (() => void) | undefined

  /**
   * Apply the activation's current settings: unmount the whole surface when
   * disabled, otherwise mount it on first use and hand the service the values.
   * Volatile references are read here, so every re-arm sees the latest
   * committed settings.
   */
  const rearm = (): void => {
    const value = readArchiveConfig(config)
    if (!resolveAutoConfig(value).enabled) {
      service?.stop()
      service = undefined
      disposeRoutes?.()
      disposeRoutes = undefined
      return
    }
    if (service === undefined) {
      const next = new ArchiveService(ctx)
      service = next
      void next.start()
      const disposers = makeArchiveRoutes(next).map((route) => ctx.webServer.register(route))
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
    service?.applyConfig(value)
  }

  // The settings write path: the Host committed new values into this row's
  // volatile references without remounting it, so re-arm from them.
  ctx.on('loader/volatile-update', () => {
    rearm()
  })

  ctx.effect(() => {
    rearm()
    return () => {
      disposeRoutes?.()
      service?.stop()
      service = undefined
    }
  }, 'dsh-session-archive: runtime')
})
