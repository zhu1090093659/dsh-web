/**
 * dsh-ssh — host half. Mounts the SSH engine (persistent ssh2 connection
 * pool, exec / PTY shell / SFTP / tunnels / cluster), the /api/dsh-ssh route
 * family plus the terminal WebSocket upgrade, the agent tools (ssh_list,
 * ssh_exec, ssh_upload, ssh_download, ssh_tunnel, ssh_cluster), and a
 * system-prompt announcement. The browser half (./client) renders the host
 * manager and web terminal. Everything rides official NPM SDK packages —
 * no dsh source changes.
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { SshEngine } from './engine.ts'
import { makeRoutes } from './routes.ts'
import { HostStore } from './store.ts'
import { sshClusterTool, sshDownloadTool, sshExecTool, sshListTool, sshTunnelTool, sshUploadTool } from './tools.ts'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name. */
export const name = 'ssh'

/** Services required before the SSH surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running instance without a
     * remount (cordis-plugin-loader); dispatched to the owning fiber only.
     * @param paths - the changed config paths, as key arrays.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/** Plugin config as a profile patch declares it, before schema resolution. */
export interface Config {
  /**
   * When true, a system-prompt section announces the SSH plugin to every agent
   * (tools + host store). Off by default to keep prompts clean.
   */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled?: boolean
  /**
   * xterm `fontFamily` for the web terminal (issue #577). Empty (default)
   * defers to the CSS chain: `--dsh-ssh-terminal-font`, then the official
   * `--ds-font-family-code` token, then the built-in monospace stack. Set a
   * Nerd Font stack here to render powerline/Nerd glyphs.
   */
  terminalFontFamily?: string
}

/** The stable reference a `volatile()` config field resolves to; its owner updates it in place. */
interface ConfigRef<T> {
  /** @returns the field's current value. */
  get(): T
}

/** One resolved config field: a live reference, or a plain value from a hand-built context. */
type ConfigField<T> = ConfigRef<T> | T

/** The config the Host hands to {@link apply} — the runtime face of {@link Config}. */
export interface ResolvedConfig {
  announceToAgent?: ConfigField<boolean>
  enabled?: ConfigField<boolean>
  terminalFontFamily?: ConfigField<string>
}

/**
 * Plugin config schema. Under the 0.1.7 settings model this schema IS the
 * entry's settings page: the Host derives one form per profile entry from it
 * and serves it through the shared configuration forms. Every field is
 * `volatile()`, which is what puts it on that page and what lets an edit reach
 * a running instance without a remount: the loader commits the new value into
 * the field's reference and announces `loader/volatile-update` on this fiber.
 */
export const Config = z.object({
  announceToAgent: z.boolean().default(false).volatile(),
  enabled: z.boolean().default(true).volatile(),
  terminalFontFamily: z.string().default('').volatile(),
})

/** Schema defaults, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = false
const DEFAULT_ENABLED = true

/** Read one resolved config field, following the live reference the schema produces. */
function readConfigField<T>(field: ConfigField<T> | undefined, fallback: T): T {
  if (field === undefined) return fallback
  if (typeof field === 'object' && field !== null && typeof (field as ConfigRef<T>).get === 'function') {
    const value = (field as ConfigRef<T>).get()
    return value === undefined ? fallback : value
  }
  return field as T
}

/**
 * The loader's own record of the profile entry this instance was activated
 * from, which carries the row's raw config — the user's own declaration, as
 * opposed to the schema defaults and the inherited bundle layers. Absent on a
 * host without the loader, which reads as "the profile declares nothing".
 */
interface LoaderEntry {
  options?: { config?: unknown }
}

/** Raw config the profile declares for this entry, when the loader exposes it. */
function profileConfig(ctx: Context): Record<string, unknown> | undefined {
  const entry = (ctx.fiber as Fiber & { entry?: LoaderEntry }).entry
  const config = entry?.options?.config
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return undefined
  return config as Record<string, unknown>
}

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const SSH_GUIDANCE = '本机已安装 dsh-ssh 插件（DSH 远程 SSH 运维）：侧边栏「SSH」入口；在 dsh-web 插件全家桶仓库（packages/dsh-ssh）统一维护。能力：主机配置存 $DSH_HOME/dsh-ssh.json（默认 ~/.dsh）（可从 ~/.ssh/config 导入）；持久连接池复用长连接（空闲 30 分钟自动断开）；ssh_list 列出主机、ssh_exec 执行远程命令、ssh_upload/ssh_download 传输文件、ssh_tunnel 本地端口转发（访问远程数据库/内网服务）、ssh_cluster 按 aliases/environment/tags 至少一种非空 selector 筛选后集群并发执行；支持密钥/密码/ssh-agent 认证、passphrase 密钥、ProxyJump 跳板机（别名或 [user@]host[:port] 地址）与 OpenSSH 语义的 ProxyCommand（跳过堡垒机客户端场景，只能由用户在 GUI 配置，agent 不可写）；Web 终端走 WebSocket。限制：主机操作由用户在 GUI 中配置后 agent 方可使用；密码以明文存在用户主目录私有文件（权限 0600）；命令输出原样返回、可能含敏感信息；断线重连可能重放非幂等命令；传输/执行消耗真实远程资源，先确认再操作。路径区分：本机（dsh host）上的文件与命令一律用本地工具（read / write / edit / bash），ssh_* 工具只针对远程主机上的路径。用户提到「SSH / 远程服务器 / 服务器操作 / 跳板机 / 隧道 / 部署 / 上传下载」时即指本插件，请据此协作。'

/**
 * Mount the SSH engine, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@linxin666/dsh-ssh', applyImpl)

function applyImpl(ctx: Context, config?: ResolvedConfig): void {
  const store = new HostStore()
  const engine = new SshEngine(store)
  ctx.effect(() => () => { engine.dispose() }, 'dsh-ssh: engine')

  const resolve = (): { announceToAgent: boolean; enabled: boolean } => {
    let enabled = readConfigField(config?.enabled, DEFAULT_ENABLED)
    // When dsh-ssh was seeded with enabled: false (e.g. from an aggregate profile
    // line), but the profile's own entry config never set the switch AND the user
    // already has active host records in dsh-ssh.json, keep the plugin enabled so
    // existing users are not broken upon upgrade (#1250).
    if (enabled === false && profileConfig(ctx)?.enabled === undefined && store.list().length > 0) {
      enabled = true
    }
    return {
      announceToAgent: readConfigField(config?.announceToAgent, DEFAULT_ANNOUNCE),
      enabled,
    }
  }

  // The /api/dsh-ssh route family + terminal upgrade.
  const { routes, upgrade } = makeRoutes({ store, engine })
  let disposeRoutes: (() => void) | undefined

  // Agent tools + their prompt sections.
  const tools = [
    sshListTool(engine),
    sshExecTool(engine),
    sshUploadTool(engine),
    sshDownloadTool(engine),
    sshTunnelTool(engine),
    sshClusterTool(engine),
  ]
  let disposeTools: (() => void) | undefined

  // System-prompt announcement.
  let disposeSection: (() => void) | undefined

  // Register (or drop) every surface to match the resolved config. Each group
  // is kept under one disposer: re-registering first tears the old one down
  // so duplicate-name registrations never throw.
  const sync = (): void => {
    const value = resolve()
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeTools !== undefined) {
      disposeTools()
      disposeTools = undefined
    }
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-ssh',
        order: SECTION_ORDER,
        text: SSH_GUIDANCE,
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map(route => ctx.webServer.register(route))
        const upgradeDisposer = ctx.webServer.registerUpgrade(upgrade)
        return () => {
          for (const dispose of disposers) dispose()
          upgradeDisposer()
        }
      },
      'dsh-ssh: routes',
    )
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map(tool => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-ssh: tools',
    )
  }

  // A settings edit is committed into this instance's config references and
  // announced on the owning fiber (the entry is not remounted), so the
  // surfaces are re-derived from the new values here.
  ctx.on('loader/volatile-update', () => { sync() })

  // Initial registration from the config the Host activated this row with.
  sync()
}
