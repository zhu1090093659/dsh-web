/**
 * Host loader entry for the task-board plugin.
 *
 * The Host owns the v2 ledger, action API, cron scheduler, session runner,
 * execution reconciliation, and optional idle-sleep inhibitor. The browser is
 * a same-origin asynchronous view over that service.
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { TaskBoardHostService } from './host-service.ts'
import { parseTaskDraft, TaskParseError } from './host-ai.ts'
import { TASK_PERMISSIONS, type TaskPermission } from './core/tasks.ts'
import { DEFAULT_SESSION_PERMISSION } from './core/handover.ts'
import { makeTaskBoardRoutes } from './host-routes.ts'
import { mountOnce } from './mount-once.ts'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 200

/** Default environment variable holding the authenticated proxy token. */
export const DEFAULT_PROXY_TOKEN_ENV = 'DSH_TASK_BOARD_PROXY_TOKEN'

export const inject = ['systemPrompt', 'typertGateway', 'workspaceRegistry', 'webServer', 'agents', 'commands']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const TASK_BOARD_GUIDANCE = '本机已安装 dsh-task-board 插件（DSH Web GUI 的任务看板）：侧边栏「任务看板」入口；在 dsh-web 插件全家桶仓库（packages/dsh-task-board）统一维护，经聚合包 web-ui-all 一键安装。能力：多列看板管理任务；Host 权威账本；关闭浏览器后仍由 Host 执行和结算；任务可钉住工作区、agent 预设和权限；支持 Host 本地时区的 5 段 cron，错过的触发点不补跑；可选且默认关闭的空闲系统睡眠保护允许屏幕熄灭，但不承诺拦截合盖、手动睡眠、休眠、关机或唤醒已睡眠机器。执行消耗 API 额度。用户提到「任务看板 / 看板 / 定时任务」时即指本插件，请据此协作。若你同时用 todo_write 维护会话顶部的可见计划列表，最终回复前必须再次调用 todo_write 收尾：没有剩余工作时不要保留 in_progress，已完成的最后一步要标为 completed。'

/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * This schema IS the board's settings page: the 0.1.7 Host serves one
 * configuration form per profile entry from the entry's own Config, so the
 * three fields the browser card edits are marked volatile — the Loader commits
 * an edit into the running fiber's references without remounting the row (no
 * settings document of the plugin's own exists any more).
 */
export interface Config {
  /**
   * When true (default), a system-prompt section announces the board to every
   * agent. Set false to keep the board silent in prompts; agents then learn
   * about it only when the user mentions it.
   */
  announceToAgent?: Volatile<boolean>
  /** Master switch for the plugin (browser half + host announcement). */
  enabled?: Volatile<boolean>
  /** Prevent idle system sleep while sessions run or schedules are armed. */
  preventIdleSleep?: Volatile<boolean>
  /**
   * Canonical reverse-proxy Host authorities admitted with a server-side
   * token. Deployment-level, so it stays an ordinary field: editing it reloads
   * the row, which re-registers the routes with the new proxy access.
   */
  trustedProxyHosts?: string[]
  /** Environment variable whose value the authenticated proxy injects upstream. */
  proxyTokenEnv?: string
  /**
   * The deployment's session-default permission. A card whose effective
   * permission (handover bundle or pin) is above this value requires a human
   * confirmation before it may run; cron refuses unconfirmed cards.
   */
  sessionDefaultPermission?: TaskPermission
}

/**
 * The schema is left to inference rather than annotated with `z<Config>`: a
 * volatile field's parsed output is a `Volatile` reference while its accepted
 * input stays the plain value, so the two sides no longer share one shape and
 * the annotation would reject the schema the Host must be given.
 */
export const Config = z.object({
  announceToAgent: z.boolean().default(false).volatile(),
  enabled: z.boolean().default(true).volatile(),
  preventIdleSleep: z.boolean().default(false).volatile(),
  trustedProxyHosts: z.array(z.string()).default([]),
  proxyTokenEnv: z.string().min(1).default(DEFAULT_PROXY_TOKEN_ENV),
  sessionDefaultPermission: z.union(TASK_PERMISSIONS).default(DEFAULT_SESSION_PERMISSION),
})

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount; dispatched to the owning fiber only. Spelled here because the
     * Loader package is not a dependency of this plugin, with the Loader's own
     * shape so the two declarations merge when a Host program carries both.
     * @param paths - changed config paths as key arrays; every value is committed before dispatch.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * Read one config field's current value.
 *
 * The Loader hands schema-volatile fields as stable references it commits in
 * place, so a live value must be read at use time rather than captured when
 * the plugin activates; a plain value (a programmatic mount, or a field the
 * schema does not mark volatile) is returned as it stands.
 * @param field - the config field as the Loader handed it.
 * @param fallback - value to use when the field is absent.
 * @returns the effective field value.
 */
export function readConfigField<T>(field: Volatile<T> | T | undefined, fallback: T): T {
  if (field === undefined) return fallback
  if (typeof field === 'object' && field !== null && typeof (field as { get?: unknown }).get === 'function') {
    return (field as Volatile<T>).get() as T
  }
  return field as T
}

/** Resolve proxy access without ever placing the token value in plugin config. */
export function resolveProxyAccess(config: Config | undefined, env: NodeJS.ProcessEnv = process.env): { trustedProxyHosts: string[]; proxyToken?: string } {
  const trustedProxyHosts = config?.trustedProxyHosts ?? []
  if (trustedProxyHosts.length === 0) return { trustedProxyHosts }
  const proxyTokenEnv = config?.proxyTokenEnv ?? DEFAULT_PROXY_TOKEN_ENV
  if (proxyTokenEnv.trim() === '') throw new Error('task-board: proxyTokenEnv must not be empty')
  const proxyToken = env[proxyTokenEnv]
  if (proxyToken === undefined || proxyToken === '') {
    throw new Error(`task-board: trustedProxyHosts requires a non-empty ${proxyTokenEnv} environment variable`)
  }
  return { trustedProxyHosts, proxyToken }
}

/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = false

/**
 * Read the optional `llm` service. The board deliberately does not inject it:
 * a deployment without a model must still mount the board, and the parse route
 * answers a typed failure instead of the plugin failing to load (issue #1540).
 * @param ctx - the plugin context.
 * @returns the llm service, or undefined when this deployment serves none.
 */
export function resolveLlmRuntime(ctx: Context): LlmRuntime | undefined {
  try {
    const llm = ctx.get('llm') as LlmRuntime | undefined
    return llm !== undefined && typeof (llm as { stream?: unknown }).stream === 'function' ? llm : undefined
  } catch {
    return undefined
  }
}

/**
 * Activate the board's host half: ledger, routes, cron scheduler, power
 * inhibitor, and the model-facing announcement.
 *
 * The effective settings are the config the Host hands this row. The three
 * fields the browser card edits are schema-volatile, so the Loader commits an
 * edit into the running fiber's references instead of remounting the row —
 * `sync` therefore reads them at use time and follows
 * `loader/volatile-update`, the event the Loader emits once it has committed
 * them. Every other field reloads the row, which re-runs this activation.
 * @param ctx - the plugin context (systemPrompt injected).
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-task-board', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  /** Current master switch (the browser half reads the same field from its own form). */
  const enabled = (): boolean => readConfigField(config?.enabled, true)
  /** Current announcement flag. */
  const announceToAgent = (): boolean => readConfigField(config?.announceToAgent, DEFAULT_ANNOUNCE)
  /** Current idle-sleep protection flag. */
  const preventIdleSleep = (): boolean => readConfigField(config?.preventIdleSleep, false)

  const host = new TaskBoardHostService(ctx.typertGateway, {
    workspaceRegistry: ctx.workspaceRegistry,
    sessionDefaultPermission: config?.sessionDefaultPermission ?? DEFAULT_SESSION_PERMISSION,
    commandDispatcher: {
      async execute(sessionId, line, signal) {
        const agent = ctx.agents.get(sessionId)
        if (agent === undefined) throw new Error(`execution session ${sessionId} is not available`)
        return (await ctx.commands.execute(agent, line, [], signal))?.result
      },
    },
  })
  // Configuration before start(): a disabled row must not take the first
  // scheduler tick, which would roll schedules the board is not running.
  host.setConfiguration(enabled(), preventIdleSleep())
  host.start()
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      const routes = makeTaskBoardRoutes(host, resolveProxyAccess(config), {
        parseTask: async (request, signal) => {
          const llm = resolveLlmRuntime(ctx)
          if (llm === undefined) throw new TaskParseError('no-model', 'this deployment serves no llm service')
          return await parseTaskDraft(llm, request, signal)
        },
      })
      for (const route of routes) disposers.push(ctx.webServer.register(route))
    } catch (error) {
      for (const dispose of disposers) dispose()
      host.dispose()
      throw error
    }
    return () => {
      for (const dispose of disposers) dispose()
      host.dispose()
    }
  }, 'task-board: host ledger, scheduler, and routes')

  let disposeSection: (() => void) | undefined
  let applied: { enabled: boolean; announceToAgent: boolean; preventIdleSleep: boolean } | undefined

  // Apply the current values to the host service and the announcement. A
  // commit that changes nothing visible is a no-op, so following a coarse
  // invalidation cannot churn the system-prompt registry. The section is kept
  // under one disposer: re-registering first tears the old one down so a
  // duplicate-name registration never throws.
  const sync = (): void => {
    const next = { enabled: enabled(), announceToAgent: announceToAgent(), preventIdleSleep: preventIdleSleep() }
    if (applied !== undefined && applied.enabled === next.enabled && applied.announceToAgent === next.announceToAgent && applied.preventIdleSleep === next.preventIdleSleep) {
      return
    }
    applied = next
    host.setConfiguration(next.enabled, next.preventIdleSleep)
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (!next.enabled || !next.announceToAgent) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:task-board',
      order: SECTION_ORDER,
      text: TASK_BOARD_GUIDANCE,
    })
  }

  // A settings edit of a volatile field is committed into the references this
  // fiber already holds, with no remount and no second call to apply: the
  // commit event is what makes the edit take effect without a restart.
  ctx.on('loader/volatile-update', () => { sync() })
  sync()
}
