/**
 * Host loader entry for the shutdown plugin.
 *
 * The host half owns the loopback-only /api/dsh-shutdown route and the
 * system-prompt announcement; the browser half (./client) renders the
 * sidebar footer power button and the confirm dialog. Exit goes through the
 * launcher-provided `ctx.appExit` (bounded: the tree is disposed before the
 * process exits), with a direct `process.exit` fallback for trees built
 * without a launcher.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-cmdline'
import { isLoopbackRequest, makeShutdownRoute } from './routes.ts'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 260

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const SHUTDOWN_GUIDANCE = '本机已安装 dsh-shutdown 插件（DSH Web GUI 的一键关机）：侧边栏底部「设置」旁的关机样式按钮，点击弹出确认框，确认后请求宿主进程优雅退出（经 ctx.appExit，先回收插件树再退出；无 appExit 时回退 process.exit(0)）。限制：退出会终止 dsh web 进程，正在运行的会话/任务可能中断；路由仅限 loopback。用户提到「关机 / 退出 DSH / 关闭 DeepSeek Harness」时即指本插件，请据此协作。'

/** Settings namespace of the shutdown capability. */
export const SHUTDOWN_SETTINGS_NAMESPACE = settingsNamespace('shutdown')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the plugin (browser half + host surfaces). */
  enabled?: boolean
  /** When true (default), the sidebar button asks for confirmation before exiting. */
  confirmShutdown?: boolean
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  confirmShutdown: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
})

/** Schema default, re-read for hand-built test contexts. */
const DEFAULT_ANNOUNCE = true

/**
 * Register the shutdown route and announcement, gated on the composition
 * entry and the live settings value.
 * @param ctx - the plugin context (systemPrompt/webServer injected).
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  // The live source the surfaces read: the settings section once the web
  // settings surface is served, the composition entry otherwise.
  let current: () => Config = () => config ?? {}
  let disposeSection: (() => void) | undefined
  let disposeRoute: (() => void) | undefined

  /** Ask the launcher for a bounded exit; fall back to a direct exit. */
  const requestExit = (code: number): void => {
    const exit = ctx.get('appExit')
    if (exit !== undefined) {
      exit(code)
      return
    }
    process.exit(code)
  }

  // Register (or drop) every surface to match the current source. Each group
  // is kept under one disposer: re-registering first tears the old one down
  // so duplicate-name registrations never throw.
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeRoute !== undefined) {
      disposeRoute()
      disposeRoute = undefined
    }
    const value = current()
    if ((value.enabled ?? true) === false) return
    if ((value.announceToAgent ?? DEFAULT_ANNOUNCE) !== false) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-shutdown',
        order: SECTION_ORDER,
        text: SHUTDOWN_GUIDANCE,
      })
    }
    disposeRoute = ctx.effect(
      () => ctx.webServer.register(makeShutdownRoute({
        fence: isLoopbackRequest,
        requestExit,
      })),
      'dsh-shutdown: route',
    )
    // confirmShutdown is read by the browser half through the same settings
    // namespace; the host schema merely carries the field.
  }

  installSettingsSection(ctx, SHUTDOWN_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => { current = source },
    onChange: sync,
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}
