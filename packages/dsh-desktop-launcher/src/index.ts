/**
 * dsh-desktop-launcher — host half. Serves the loopback-only
 * /api/dsh-desktop-launcher/create route that writes the launcher script
 * under $DSH_HOME/desktop-launcher/ and places a double-click icon on the
 * Desktop (Windows .lnk, macOS .command, Linux .desktop), and the
 * loopback-only /api/dsh-desktop-launcher/shutdown route that requests the
 * host process to exit gracefully. Also provides a system-prompt
 * announcement. The browser half (./client) renders the settings card with
 * the "create desktop icon" button and the floating shutdown trigger.
 * Everything rides official NPM SDK packages — no dsh source changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { DEFAULT_DSH_COMMAND, DEFAULT_URL, resolveLauncherSpec } from './core/launcher.ts'
import { makeRoutes } from './routes.ts'
import { isLoopbackRequest, makeShutdownRoute } from './shutdown-routes.ts'
import { mountOnce } from './mount-once.ts'

// The dsh launcher provides ctx.appExit (a bounded process-exit request) via
// @deepseek-ai/dsh-cmdline before the tree mounts. Spelled locally so this
// package builds without depending on that launcher-only package.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Bounded process-exit request provided by the dsh launcher. */
    appExit?: (code: number) => void
  }
}

/** Stable cordis plugin name. */
export const name = 'desktop-launcher'

/** Services required before the launcher surfaces can mount. */
export const inject = ['webServer', 'systemPrompt']

/**
 * Settings namespace of the desktop-launcher capability — the section the
 * web settings surface edits. Spelled here rather than imported so the
 * browser half can spell the same value without depending on a Host package.
 */
export const DESKTOP_LAUNCHER_SETTINGS_NAMESPACE = 'desktop-launcher' as SettingsNamespace

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
  /** Master switch for the plugin; off by default. */
  enabled?: boolean
  /** Command that starts dsh (must be on PATH when the launcher runs). */
  dshCommand?: string
  /** Base URL of the dsh web GUI. */
  url?: string
  /** Optional profile started as `dsh --profile <profile> --no-open`. */
  profile?: string
  /** Optional icon file (.ico/.png) for the desktop icon; empty uses the bundled dsh icon. */
  iconPath?: string
  /** Whether the floating shutdown button asks for confirmation before exiting. */
  confirmShutdown?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(false),
  // Off by default: the launcher surfaces (routes, announcement, floating
  // shutdown button) mount only after the user enables the plugin.
  enabled: z.boolean().default(false),
  dshCommand: z.string().default(DEFAULT_DSH_COMMAND),
  url: z.string().default(DEFAULT_URL),
  profile: z.string().default(''),
  iconPath: z.string().default(''),
  confirmShutdown: z.boolean().default(true),
})

/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = false

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 210

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const DESKTOP_LAUNCHER_GUIDANCE = '本机已安装 dsh-desktop-launcher 插件（DSH 桌面启动器 + 一键关机）：设置 → 插件配置 → Web 插件 卡片内「创建桌面图标」可在桌面生成一键启动图标（Windows .lnk / macOS .command / Linux .desktop），双击即启动 dsh web 并打开 Web GUI；可配置 dshCommand / url / profile。界面右下角还有关机样式浮动按钮，点击弹出确认框，确认后请求宿主进程优雅退出（经 ctx.appExit，先回收插件树再退出；无 appExit 时回退 process.exit(0)）。限制：图标创建与关机路由均仅限 loopback，退出会终止 dsh web 进程，正在运行的会话/任务可能中断。用户提到「桌面图标 / 快捷方式 / 一键启动 dsh / 关机 / 退出 DSH / 关闭 DeepSeek Harness」时即指本插件，请据此协作。'

/**
 * Mount the route and announcement, gated on the composition entry config
 * (and the live settings value once the web settings surface is served).
 * @param ctx - host plugin context carrying webServer/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@linxin666/dsh-desktop-launcher', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  let current: () => Config = () => config ?? {}
  let disposeRoutes: (() => void) | undefined
  let disposeShutdownRoute: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  /** Ask the launcher for a bounded exit at most once; fall back to a direct exit. */
  let exitRequested = false
  const requestExit = (code: number): void => {
    if (exitRequested) return
    exitRequested = true
    const exit = ctx.get('appExit')
    if (exit !== undefined) {
      exit(code)
      return
    }
    process.exit(code)
  }

  // Register (or drop) every surface to match the current source. Each
  // group is kept under one disposer: re-registering first tears the old one
  // down so duplicate-name registrations never throw.
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeShutdownRoute !== undefined) {
      disposeShutdownRoute()
      disposeShutdownRoute = undefined
    }
    const value = current()
    // The plugin is off unless the resolved config says otherwise.
    if ((value.enabled ?? false) === false) return
    disposeRoutes = ctx.effect(
      () => {
        const disposers = makeRoutes({
          resolveSpec: () => resolveLauncherSpec(current()),
        }).routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-desktop-launcher: routes',
    )
    disposeShutdownRoute = ctx.effect(
      () => ctx.webServer.register(makeShutdownRoute({
        fence: isLoopbackRequest,
        requestExit,
      })),
      'dsh-desktop-launcher: shutdown route',
    )
    if ((value.announceToAgent ?? DEFAULT_ANNOUNCE) !== false) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-desktop-launcher',
        order: SECTION_ORDER,
        text: DESKTOP_LAUNCHER_GUIDANCE,
      })
    }
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, DESKTOP_LAUNCHER_SETTINGS_NAMESPACE, Config, config ?? {}, {
      setSource: (source) => { current = source; sync() },
      onChange: sync,
    })
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSection never fires its hooks).
  sync()
}