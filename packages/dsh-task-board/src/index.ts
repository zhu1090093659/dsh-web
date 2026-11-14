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
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { TaskBoardHostService, type HostTimerFace } from './host-service.ts'
import { createOwnerPeer } from './host-runner.ts'
import { parseTaskDraft, TaskParseError } from './host-ai.ts'
import { TASK_PERMISSIONS, isTaskPermission, type TaskPermission } from './core/tasks.ts'
import { LEGACY_AGENT_TEAMS_TOOL, DEFAULT_SUBTASK_DEPTH, SUBTASK_DEPTH_MAX, SUBTASK_DEPTH_MIN } from './core/subtask.ts'
import { DEFAULT_SESSION_POLL_SECONDS, SESSION_POLL_MAX_SECONDS, SESSION_POLL_MIN_SECONDS } from './core/poll-cadence.ts'
import { DEFAULT_RUN_LAUNCH_WIDTH, RUN_LAUNCH_WIDTH_MAX, RUN_LAUNCH_WIDTH_MIN } from './core/launch-width.ts'
import { DEFAULT_SPEND_BUDGET_TOKENS } from './core/spend-budget.ts'
import { DEFAULT_SESSION_PERMISSION } from './core/handover.ts'
import type { CardDefaults } from './core/card-defaults.ts'
import { buildTaskBoardTools, TASK_BOARD_TOOL_NAMES } from './host/agent-tools.ts'
import { PLUGIN_TOOL_SECTION_ORDERS, visibleToolText } from './tool-surface.ts'
import { makeTaskBoardRoutes, type TaskBoardConnectionTrust } from './host-routes.ts'
import type { ModelInfoResolver, TaskBoardAttachmentStore } from './host/attachments.ts'
import { TASK_BOARD_SERVICE_NAME, type TaskBoardExtension } from './core/extension.ts'
import type { TaskBoardAction } from './protocol.ts'
import { mountOnce } from './mount-once.ts'
import { normalizeCatalog, type ModelCatalogView } from './core/model-catalog.ts'

/** Order of the announcement section within the shared tool-guidance band. */
const SECTION_ORDER = PLUGIN_TOOL_SECTION_ORDERS['task-board']

/** Default environment variable holding the authenticated proxy token. */
export const DEFAULT_PROXY_TOKEN_ENV = 'DSH_TASK_BOARD_PROXY_TOKEN'

export const inject = ['systemPrompt', 'typertGateway', 'workspaceRegistry', 'webServer', 'agents', 'commands']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const TASK_BOARD_GUIDANCE = '本机已安装 dsh-task-board 插件（DSH Web GUI 的任务看板）：侧边栏「任务看板」入口；在 dsh-web 插件全家桶仓库（packages/dsh-task-board）统一维护，经聚合包 web-ui-all 一键安装。能力：多列看板管理任务；Host 权威账本；关闭浏览器后仍由 Host 执行和结算；任务可钉住工作区、agent 预设和权限；任务可建子任务（深度上限可配 1..3，默认 1 层，子任务不能再带子任务），执行父任务会并发执行其子任务树，子任务可单独覆盖权限与模型；另注册 task_board_* agent 工具（list/get/create/update/set_parent/run/manage/schedule），任何会话都可直接读写看板、子任务与定时计划，但运行任务会真实执行并消耗额度，高于会话默认权限的绑定仍必须由用户在 GUI 人工确认（工具刻意不提供确认能力）；支持 Host 本地时区的 5 段 cron，错过的触发点不补跑；可选且默认关闭的空闲系统睡眠保护允许屏幕熄灭，但不承诺拦截合盖、手动睡眠、休眠、关机或唤醒已睡眠机器。执行消耗 API 额度。用户提到「任务看板 / 看板 / 定时任务」时即指本插件，请据此协作。若你同时用 todo_write 维护会话顶部的可见计划列表，最终回复前必须再次调用 todo_write 收尾：没有剩余工作时不要保留 in_progress，已完成的最后一步要标为 completed。'

/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * This schema IS the board's settings page: the 0.1.7 Host serves one
 * configuration form per profile entry from the entry's own Config, so the
 * fields the browser card edits are marked volatile — the Loader commits
 * an edit into the running fiber's references without remounting the row (no
 * settings document of the plugin's own exists any more). A field without the
 * marker is refused by the settings write path, which fences writes on
 * volatility.
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
   * Whether the operator's OWN reverse proxy or tunnel may speak for the
   * browser (default OFF). Off keeps the pre-existing fence exactly: a request
   * that carries a forwarding header is never local, so only a direct loopback
   * client or an allowlisted token-injecting proxy reaches the board (issue
   * #1906). On admits one narrower case — a forwarded request whose socket and
   * Host are both this machine's loopback upstream, i.e. the proxy dials the
   * board itself (issue #1918) — and still requires the browser same-origin
   * marker, so a third party's tunnel is only trusted while the operator says
   * it is. Volatile: the fence reads it at each request, so an edit binds the
   * next request without re-registering the routes.
   */
  trustForwardedProxy?: Volatile<boolean>
  /**
   * An explicit baseline for the permission confirmation gate. Left unset, the
   * board follows the Host's own default permission preset — the value new DSH
   * sessions start at — and falls back to `read-only` when the deployment
   * serves no permission catalog. A card whose effective permission (handover
   * bundle or pin) is above the baseline requires a human confirmation before
   * it may run; cron refuses unconfirmed cards.
   */
  sessionDefaultPermission?: TaskPermission
  /**
   * Subtask depth limit, 1..3 (default 1). At 1 a task may carry one level of
   * subtasks and a subtask cannot be given subtasks of its own; raising it
   * allows deeper trees. Every extra level is another tree the card's own
   * session may have to dispatch, so the ceiling is deliberately small.
   */
  maxSubtaskDepth?: Volatile<number>
  /**
   * How often, in seconds, the Host re-reads the DSH session roster while the
   * board has something to reconcile: a running card, an open execution, or an
   * active provider extension. An idle board with none of those does not poll
   * at all, so this cadence only bounds how quickly a running card settles.
   */
  sessionPollSeconds?: Volatile<number>
  /**
   * How many run launches this board may have in flight at once (1..16,
   * default 3). A run opens one session, so a burst is several cards run at
   * once (several tabs, or a due schedule firing while a manual run starts);
   * without a bound the Host would ask DSH for all of them in the same tick.
   * This is the mechanism that enforces the repository's measured guidance for
   * heavy implementation subagents. Runs wait their turn instead of being
   * dropped, and every one of them still starts. Read at each admission, so an
   * edit bounds the next launch of a run that is still queueing.
   */
  runLaunchWidth?: Volatile<number>
  /**
   * Daily token ceiling for the work this board dispatches (default 0 = no
   * gate). Tokens, not money: the ledger the board measures against prices
   * DeepSeek's own routes only, so a cost cap would read 0 elsewhere. Read at
   * each gate, so an edit binds the next run without a remount; a manual
   * run/rerun whose day already spent the cap is refused, and a due occurrence
   * is skipped onto the scheduler with its run budget untouched.
   */
  spendBudgetTokens?: Volatile<number>
  /**
   * Agent preset a NEW card starts from (volatile, default blank = not set).
   * A prefill, never a pin: the create dialog opens with it selected, the
   * caller may override it, and the card stores what it was created with. It
   * reaches the create path only when that caller opts in with
   * `applyCardDefaults`, so the extension provider's own create and the legacy
   * import are untouched.
   */
  cardDefaultMode?: Volatile<string>
  /**
   * Permission a NEW card starts from (volatile, default blank = not set), one
   * of the three presets. A prefill like the rest: a value above
   * `sessionDefaultPermission` still has to be confirmed by a human before the
   * card may run, because the pre-execution gate is what decides that.
   */
  cardDefaultPermission?: Volatile<TaskPermission | ''>
  /**
   * Model a NEW card starts from (volatile, default blank = not set).
   */
  cardDefaultModel?: Volatile<string>
  /**
   * Reasoning level a NEW card starts from (volatile, default blank = not set).
   * Bound to `cardDefaultModel` exactly as a card's own level is bound to its
   * own model: it applies only while the card's final model IS that default
   * model, and a blank `cardDefaultModel` makes it inert.
   */
  cardDefaultReasoningEffort?: Volatile<string>
}

/**
 * Profile-patch shape of {@link Config}: what the Host validates the row's
 * config against, before the schema turns volatile fields into live references
 * and applies defaults. Declared separately because the two sides no longer
 * share one shape, so the schema is annotated `z<ConfigInput, Config>` — the
 * same split the git-family packages use. The annotation is also what keeps the
 * emitted declaration portable: an unannotated schema holding a nested object
 * array infers a type that cannot be named without reaching into a transitive
 * dependency's own types.
 */
export interface ConfigInput {
  /** Announce the board in the system prompt. */
  announceToAgent?: boolean
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Prevent idle system sleep while sessions run or schedules are armed. */
  preventIdleSleep?: boolean
  /** Canonical reverse-proxy Host authorities. */
  trustedProxyHosts?: string[]
  /** Environment variable whose value the authenticated proxy injects. */
  proxyTokenEnv?: string
  /** Trust a forwarded request that landed on this machine's loopback upstream; default off. */
  trustForwardedProxy?: boolean
  /** Explicit baseline for the permission confirmation gate; unset follows the Host default. */
  sessionDefaultPermission?: TaskPermission
  /** Subtask depth limit, 1..3. */
  maxSubtaskDepth?: number
  /** Roster-poll cadence in seconds while the board has work to reconcile. */
  sessionPollSeconds?: number
  /** Concurrent run launches allowed at once, 1..16. */
  runLaunchWidth?: number
  /** Daily token ceiling for board runs; 0 disables the gate. */
  spendBudgetTokens?: number
  /** Agent preset a new card starts from; blank = not set. */
  cardDefaultMode?: string
  /** Permission a new card starts from; blank = not set. */
  cardDefaultPermission?: TaskPermission | ''
  /** Model a new card starts from; blank = not set. */
  cardDefaultModel?: string
  /** Reasoning level a new card starts from; blank = not set. */
  cardDefaultReasoningEffort?: string
}

export const Config: z<ConfigInput, Config> = z.object({
  announceToAgent: z.boolean().default(false).volatile(),
  enabled: z.boolean().default(true).volatile(),
  preventIdleSleep: z.boolean().default(false).volatile(),
  trustedProxyHosts: z.array(z.string()).default([]),
  proxyTokenEnv: z.string().min(1).default(DEFAULT_PROXY_TOKEN_ENV),
  trustForwardedProxy: z.boolean().default(false).volatile(),
  sessionDefaultPermission: z.union(TASK_PERMISSIONS),
  maxSubtaskDepth: z.number().min(SUBTASK_DEPTH_MIN).max(SUBTASK_DEPTH_MAX).default(DEFAULT_SUBTASK_DEPTH).volatile(),
  sessionPollSeconds: z.number().min(SESSION_POLL_MIN_SECONDS).max(SESSION_POLL_MAX_SECONDS).default(DEFAULT_SESSION_POLL_SECONDS).volatile(),
  runLaunchWidth: z.number().min(RUN_LAUNCH_WIDTH_MIN).max(RUN_LAUNCH_WIDTH_MAX).default(DEFAULT_RUN_LAUNCH_WIDTH).volatile(),
  spendBudgetTokens: z.number().min(DEFAULT_SPEND_BUDGET_TOKENS).default(DEFAULT_SPEND_BUDGET_TOKENS).volatile(),
  cardDefaultMode: z.string().default('').volatile(),
  cardDefaultPermission: z.union([...TASK_PERMISSIONS, '']).default('').volatile(),
  cardDefaultModel: z.string().default('').volatile(),
  cardDefaultReasoningEffort: z.string().default('').volatile(),
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

/**
 * Resolve proxy access without ever placing the token value in plugin config.
 *
 * The forwarded-proxy switch travels as a reader rather than a value: it is
 * schema-volatile, so the fence must read it when a request arrives instead of
 * when the routes are registered.
 * @param config - the resolved plugin config.
 * @param env - environment holding the proxy token value.
 * @returns the route access handed to {@link makeTaskBoardRoutes}.
 */
export function resolveProxyAccess(config: Config | undefined, env: NodeJS.ProcessEnv = process.env): {
  trustedProxyHosts: string[]
  proxyToken?: string
  trustForwardedProxy: () => boolean
} {
  const trustForwardedProxy = (): boolean => readConfigField(config?.trustForwardedProxy, DEFAULT_TRUST_FORWARDED_PROXY)
  const trustedProxyHosts = config?.trustedProxyHosts ?? []
  if (trustedProxyHosts.length === 0) return { trustedProxyHosts, trustForwardedProxy }
  const proxyTokenEnv = config?.proxyTokenEnv ?? DEFAULT_PROXY_TOKEN_ENV
  if (proxyTokenEnv.trim() === '') throw new Error('task-board: proxyTokenEnv must not be empty')
  const proxyToken = env[proxyTokenEnv]
  if (proxyToken === undefined || proxyToken === '') {
    throw new Error(`task-board: trustedProxyHosts requires a non-empty ${proxyTokenEnv} environment variable`)
  }
  return { trustedProxyHosts, proxyToken, trustForwardedProxy }
}

/**
/**
 * Schema default for the forwarded-proxy switch, re-read for hand-built
 * contexts. Deliberately false: a deployment that never configured it keeps
 * refusing every forwarded request, which is the #1906 fence.
 */
export const DEFAULT_TRUST_FORWARDED_PROXY = false

/**
 * Resolve the composition's optional `connection` service.
 *
 * The service is the Host's own browser-session authority: it fronts every
 * `/api` request with the Host/Origin fence and the signed `dsh-auth-*` cookie,
 * which is what a deployment behind a reverse proxy or ingress validates on the
 * same authority the GUI is served from. The board bridges it instead of
 * repeating that check, so a proxy request the Host already authenticated is
 * admitted without a board-specific host allowlist (issue #1930). It is
 * deliberately resolved like the agent-tool registry rather than injected:
 * a composition that serves no connection keeps mounting the board on the
 * pre-existing loopback fence, and one that mounts the service later is picked
 * up on the next request because the fence asks this resolver each time.
 * @param ctx - the plugin context.
 * @returns the trust face, or undefined when this deployment serves none.
 */
export function resolveConnectionTrust(ctx: Context): TaskBoardConnectionTrust | undefined {
  try {
    const connection = ctx.get('connection') as Partial<TaskBoardConnectionTrust> | undefined
    if (connection === undefined || connection === null) return undefined
    return typeof connection.admit === 'function' || typeof connection.requestRejection === 'function'
      ? connection as TaskBoardConnectionTrust
      : undefined
  } catch {
    return undefined
  }
}

/** The registry face the agent tools register into. */
interface AgentToolRegistry {
  register(definition: ToolDefinition): () => void
  /** Scoped lookup; present on the real registry, absent on a stub that only registers. */
  get?(name: string, scope?: unknown): unknown
}

/** The lookup half of a resolved registry, when it exposes one. */
function lookupOf(registry: AgentToolRegistry | undefined): { get: (name: string, scope?: unknown) => unknown } | undefined {
  return registry !== undefined && typeof registry.get === 'function' ? { get: registry.get.bind(registry) } : undefined
}

/**
 * Resolve the optional agent-tool registry. The board deliberately does not
 * inject it: a deployment whose runtime serves no registry must still mount the
 * whole board and lose only the agent-tool surface, the same tolerance the
 * optional llm service gets.
 * @param ctx - the plugin context.
 * @returns the registry, or undefined when this deployment serves none.
 */
export function resolveToolRegistry(ctx: Context): AgentToolRegistry | undefined {
  try {
    const tools = ctx.get('tools') as AgentToolRegistry | undefined
    return tools !== undefined && typeof tools.register === 'function' ? tools : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the native cordis timer service (dsh-base's own `cordis-plugin-timer`
 * row). The board arms its schedule through it so unloading the row clears
 * every pending timer with the owning fiber, instead of the row tracking raw
 * process handles by hand. A composition that serves no timer service keeps
 * working on the process globals.
 * @param ctx - the plugin context.
 * @returns the timer face, or undefined when this deployment serves none.
 */
export function resolveHostTimers(ctx: Context): HostTimerFace | undefined {
  try {
    const timer = ctx.get('timer') as Partial<HostTimerFace> | undefined
    if (timer === undefined) return undefined
    return typeof timer.timeout === 'function' && typeof timer.interval === 'function'
      ? { timeout: timer.timeout.bind(timer), interval: timer.interval.bind(timer) }
      : undefined
  } catch {
    return undefined
  }
}

/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = false

/** The subset of the official permission-preset service the board reads. */
interface PermissionPresetsFace {
  catalog(): { defaultPreset?: unknown }
}

/**
 * The Host's own default permission preset, mapped into the board's vocabulary.
 *
 * This is the value new DSH sessions start at (the deployment's `permission`
 * settings row), so a board that follows it treats an ordinary card exactly as
 * the Host would. Absent when the deployment serves no permission catalog, or
 * its default is a current-session identity (`auto`) that names no fixed
 * sandbox mode; the caller then keeps the fail-safe baseline.
 * @param ctx - the plugin context.
 * @returns the Host default as a board permission, or undefined when unreadable.
 */
export function resolveHostDefaultPermission(ctx: Context): TaskPermission | undefined {
  try {
    const presets = ctx.get('permissionPresets') as PermissionPresetsFace | undefined
    if (presets === undefined || typeof presets.catalog !== 'function') return undefined
    const preset = presets.catalog()?.defaultPreset
    return isTaskPermission(preset) ? preset : undefined
  } catch {
    return undefined
  }
}

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
 * Resolve the optional attachment storage.
 *
 * The board does not inject the service: a deployment without one must still
 * mount the board, and every attachment surface then answers with a typed
 * "storage unavailable" failure instead of the plugin failing to load.
 * @param ctx - the plugin context.
 * @returns the attachment storage, or undefined when this deployment serves none.
 */
export function resolveAttachmentStore(ctx: Context): TaskBoardAttachmentStore | undefined {
  try {
    const store = ctx.get('attachments') as TaskBoardAttachmentStore | undefined
    return store !== undefined && typeof store.saveImage === 'function' ? store : undefined
  } catch {
    return undefined
  }
}

/**
 * The model-info reader the image preflight uses.
 *
 * It asks the OFFICIAL model service about one exact route. The model catalog
 * the board already publishes carries no modality information and must not be
 * used to answer that question: only the model's own declared input
 * modalities can refuse an image route, and a route whose modalities cannot be
 * read is UNKNOWN and therefore allowed.
 * @param ctx - the plugin context.
 * @returns the reader, or undefined when the deployment serves no model service.
 */
export function resolveModelInfoReader(ctx: Context): ModelInfoResolver | undefined {
  return async (provider: string, model: string): Promise<{ inputModalities?: readonly string[] } | undefined> => {
    const llm = resolveLlmRuntime(ctx)
    if (llm === undefined) return undefined
    try {
      const info = await llm.resolveModelInfo(provider, model)
      return { ...(info.inputModalities === undefined ? {} : { inputModalities: info.inputModalities }) }
    } catch (error) {
      console.warn('[dsh-task-board] could not resolve the model info of ' + provider + '/' + model + '; the image preflight allows the route', error)
      return undefined
    }
  }
}

/**
 * The subset of `sessionController` the board uses to wake a cold persisted
 * session before running a slash command on it (issue #1861).
 */
interface SessionControllerFace {
  resolveAgent(
    sessionId: Parameters<Context['agents']['get']>[0],
  ): Promise<
    | { readonly agent: Parameters<Context['commands']['execute']>[0] }
    | { readonly error: { readonly message?: string } }
  >
}

/**
 * Resolve the optional `sessionController` service. Like the tool registry and
 * the llm runtime, it is read dynamically so capture-only test contexts that do
 * not mount the full session controller still activate the board.
 * @param ctx - the plugin context.
 * @returns the session controller face, or undefined when unavailable.
 */
export function resolveSessionController(ctx: Context): SessionControllerFace | undefined {
  try {
    const controller = (ctx as { get?: (name: string) => unknown }).get?.('sessionController') as SessionControllerFace | undefined
    return controller !== undefined && typeof controller.resolveAgent === 'function' ? controller : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the live Agent for an execution session, resuming a cold persisted
 * session through `sessionController.resolveAgent` when it is not yet in
 * `ctx.agents` (issue #1861).
 *
 * A fresh run (`session/create`) or a session the browser is currently
 * following is already in `ctx.agents`, so the fast path returns immediately.
 * A scheduled or manual reuse of a cold session — one that `session/list`
 * reports as idle from disk without activating its Agent — is not in
 * `ctx.agents` when `pinAndPrompt` runs `/permission` ahead of
 * `session/selectModel` and `session/prompt`; delegating to
 * `sessionController.resolveAgent` resumes it with its recorded preset and
 * model-selection state, matching what those gateway endpoints do next.
 * @param ctx - the plugin context.
 * @param sessionId - the target execution session id.
 * @returns the live Agent for `sessionId`.
 */
export async function resolveExecutionAgent(
  ctx: Context,
  sessionId: Parameters<Context['agents']['get']>[0],
): Promise<Parameters<Context['commands']['execute']>[0]> {
  const live = ctx.agents.get(sessionId)
  if (live !== undefined) return live
  const controller = resolveSessionController(ctx)
  if (controller !== undefined) {
    const resolved = await controller.resolveAgent(sessionId)
    if ('agent' in resolved && resolved.agent !== undefined) return resolved.agent
    const detail = 'error' in resolved && typeof resolved.error?.message === 'string' && resolved.error.message !== ''
      ? `: ${resolved.error.message}`
      : ''
    throw new Error(`execution session ${sessionId} is not available${detail}`)
  }
  throw new Error(`execution session ${sessionId} is not available`)
}

/**
 * Activate the board's host half: ledger, routes, cron scheduler, power
 * inhibitor, and the model-facing announcement.
 *
 * The effective settings are the config the Host hands this row. The fields
 * the browser card edits are schema-volatile, so the Loader commits an
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
  /** Current subtask depth limit (read live: the settings card edits it in place). */
  const maxSubtaskDepth = (): number => readConfigField(config?.maxSubtaskDepth, DEFAULT_SUBTASK_DEPTH)
  /** Current roster-poll cadence in seconds (read live: the settings card edits it in place). */
  const sessionPollSeconds = (): number => readConfigField(config?.sessionPollSeconds, DEFAULT_SESSION_POLL_SECONDS)
  /**
   * Current run-launch admission width. Read live on every admission, so the
   * settings card bounds the next launch of a run that is still queueing without
   * remounting the row; the Host clamps a hand-edited value into the schema range.
   */
  const runLaunchWidth = (): number => readConfigField(config?.runLaunchWidth, DEFAULT_RUN_LAUNCH_WIDTH)
  /**
   * Current daily token cap, read at each gate like the width above. The value
   * decides first: 0 — the default — ends the gate before a file is opened, so
   * a board that never set a cap pays nothing for it.
   */
  const spendBudgetTokens = (): number => readConfigField(config?.spendBudgetTokens, DEFAULT_SPEND_BUDGET_TOKENS)
  /**
   * The baseline the permission confirmation gate judges against: the row's own
   * `sessionDefaultPermission` when the deployment pins one, otherwise the Host's
   * default preset. Read per call through the ledger, so a Host Settings change
   * reaches the running board without remounting the row; the fail-safe default
   * still applies when no catalog is available.
   */
  const sessionDefaultPermission = (): TaskPermission =>
    config?.sessionDefaultPermission ?? resolveHostDefaultPermission(ctx) ?? DEFAULT_SESSION_PERMISSION

  // The catalog reader needs the service, and the service needs the reader;
  // the reader only runs after start(), so a late holder is enough.
  let hostForCatalog: TaskBoardHostService | undefined
  /**
   * Live reader of the host model catalog, normalized for the board. The
   * service reads it once per run group and carries the value, so a settings
   * edit only reaches executions that start afterwards.
   */
  const modelCatalog = async (): Promise<ModelCatalogView | undefined> => {
    const runner = hostForCatalog?.runner
    return runner === undefined ? undefined : normalizeCatalog(await runner.modelCatalog())
  }
  /**
   * Live reader of the new-card defaults, read at every use like the switch
   * above: the create dialog prefills from the published snapshot, and each
   * creating session re-reads them when it submits the create. A blank value
   * means "not set" and reaches the resolver as an absent target.
   */
  const cardDefaults = (): CardDefaults => {
    const permission = readConfigField<TaskPermission | ''>(config?.cardDefaultPermission, '')
    return {
      mode: readConfigField(config?.cardDefaultMode, '').trim() || undefined,
      permission: isTaskPermission(permission) ? permission : undefined,
      model: readConfigField(config?.cardDefaultModel, '').trim() || undefined,
      reasoningEffort: readConfigField(config?.cardDefaultReasoningEffort, '').trim() || undefined,
    }
  }
  // The 0.2.1 gateway requires every request to name the peer it speaks for:
  // the board calls as the host-local owner, so its peer is minted on this
  // fiber and aborts with it (see createOwnerPeer).
  const ownerPeer = createOwnerPeer(ctx)
  // A deployment that registers the legacy Agent Teams fingerprint cannot
  // orchestrate under the dispatcher preset: the preset's own compatibility
  // gate stops and waits for a human reply, which a scheduled or unattended run
  // never brings (issue #2031). Read at launch, so a runtime mounted after this
  // row is still judged, and read tolerantly: no registry, no lookup half, or a
  // throw all answer false, which keeps today's behaviour rather than refusing
  // cards on a guess.
  const legacyAgentTeams = (): boolean => {
    const lookup = lookupOf(resolveToolRegistry(ctx))
    if (lookup === undefined) return false
    try {
      return lookup.get(LEGACY_AGENT_TEAMS_TOOL) !== undefined
    } catch {
      return false
    }
  }
  const host = new TaskBoardHostService(ctx.typertGateway, {
    workspaceRegistry: ctx.workspaceRegistry,
    ownerPeer,
    sessionDefaultPermission,
    maxSubtaskDepth: maxSubtaskDepth(),
    runLaunchWidth,
    spendBudgetTokens,
    cardDefaults,
    modelCatalog,
    attachments: () => resolveAttachmentStore(ctx),
    modelInfo: () => resolveModelInfoReader(ctx),
    legacyAgentTeams,
    timers: resolveHostTimers(ctx),
    commandDispatcher: {
      async execute(sessionId, line, signal) {
        const agent = await resolveExecutionAgent(ctx, sessionId)
        return (await ctx.commands.execute(agent, line, [], signal))?.result
      },
    },
  })
  hostForCatalog = host
  // Configuration before start(): a disabled row must not take the first
  // scheduler tick, which would roll schedules the board is not running.
  host.setConfiguration(enabled(), preventIdleSleep(), sessionPollSeconds())
  host.start()

  // External providers. The board publishes its registration service so any
  // provider package can resolve it and admit itself; the board itself knows
  // no provider vocabulary. A capture-only test context implements no service
  // registry and the board still serves its own surfaces.
  //
  // The same service carries the read/write face an in-process consumer drives
  // the board through — the remote bridge's board plugin reads and applies over
  // it instead of opening an HTTP surface of its own, which the board's routes
  // would refuse anyway (their guard admits a browser-shaped request, not a
  // process). Every member is a forward of the Host service method of the same
  // name: no gate, no normalization and no state lives here, so a consumer
  // reaching the board this way is refused by exactly what refuses a browser.
  if (typeof (ctx as { provide?: unknown }).provide === 'function') {
    ctx.provide(TASK_BOARD_SERVICE_NAME, {
      registerExtension: (extension: TaskBoardExtension) => host.registerExtension(extension),
      isExtensionEnabled: (extensionId: string) => host.extensions.isActive(extensionId),
      snapshot: () => host.snapshot(),
      apply: (requestId: string, action: TaskBoardAction, initiator?: string) => host.apply(requestId, action, initiator),
      subscribe: (listener: () => void) => host.subscribe(listener),
      modelCatalogOptions: () => host.modelCatalogOptions(),
    })
  }

  // Agent tools: the same Host ledger the browser drives, so any session can
  // list, create, link, run and settle board work. Registration follows the
  // master switch (a disabled board answers no tool call), and the mount
  // effect below owns the disposers. Provider tools register through the
  // extension registry, which follows the same gate and rebinds when the tool
  // registry appears late.
  let disposeTools: (() => void) | undefined
  const setToolsEnabled = (active: boolean): void => {
    if (!active) {
      // Releasing is the whole job on the way down. Rebinding the extension
      // registry here would re-register every provider tool, and the teardown
      // path runs this while the fiber is already unloading, so each of those
      // re-registrations is a request the host can only refuse.
      disposeTools?.()
      disposeTools = undefined
      return
    }
    host.extensions.setToolRegistry(() => resolveToolRegistry(ctx))
    if (disposeTools !== undefined) return
    const registry = resolveToolRegistry(ctx)
    if (registry === undefined) return
    const disposers = buildTaskBoardTools(host).map(tool => registry.register(tool))
    disposeTools = () => {
      for (const dispose of disposers.splice(0)) dispose()
    }
  }
  setToolsEnabled(enabled())
  // A registry that activates after this row (or a row activated before it) is
  // followed through scoped injection where the runtime serves one; capture-only
  // contexts without it register through the direct resolution above.
  const scopedInject = (ctx as { inject?: (names: readonly string[], callback: (scoped: Context) => unknown) => unknown }).inject
  if (typeof scopedInject === 'function') {
    scopedInject.call(ctx, ['tools'], () => {
      setToolsEnabled(enabled())
      // The extension registry follows the same rebinding: a registry that
      // appears (or is replaced) after a provider started adopts its tools.
      host.extensions.setToolRegistry(() => resolveToolRegistry(ctx))
      // Cordis unloads and re-runs this callback when the injected service's
      // provider fiber changes, and the old registry dies with its provider.
      // Releasing the guard here is what lets the callback register into the
      // NEW registry instead of short-circuiting on the stale disposer.
      return () => {
        disposeTools?.()
        disposeTools = undefined
      }
    })
  }

  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      const routes = makeTaskBoardRoutes(host, {
        ...resolveProxyAccess(config),
        connection: () => resolveConnectionTrust(ctx),
      }, {
        attachments: () => resolveAttachmentStore(ctx),
        parseTask: async (request, signal) => {
          const llm = resolveLlmRuntime(ctx)
          if (llm === undefined) throw new TaskParseError('no-model', 'this deployment serves no llm service')
          return await parseTaskDraft(llm, request, signal)
        },
      })
      for (const route of routes) disposers.push(ctx.webServer.register(route))
    } catch (error) {
      // A failed mount must not leave the agent tools bound to a disposed
      // host: the effect cleanup never runs when this body throws.
      setToolsEnabled(false)
      for (const dispose of disposers) dispose()
      host.dispose()
      throw error
    }
    return () => {
      setToolsEnabled(false)
      for (const dispose of disposers) dispose()
      host.dispose()
    }
  }, 'task-board: host ledger, scheduler, and routes')

  let disposeSection: (() => void) | undefined
  let applied: { enabled: boolean; announceToAgent: boolean; preventIdleSleep: boolean; maxSubtaskDepth: number; sessionPollSeconds: number } | undefined

  // Apply the current values to the host service and the announcement. A
  // commit that changes nothing visible is a no-op, so following a coarse
  // invalidation cannot churn the system-prompt registry. The section is kept
  // under one disposer: re-registering first tears the old one down so a
  // duplicate-name registration never throws.
  const sync = (): void => {
    const next = {
      enabled: enabled(),
      announceToAgent: announceToAgent(),
      preventIdleSleep: preventIdleSleep(),
      maxSubtaskDepth: maxSubtaskDepth(),
      sessionPollSeconds: sessionPollSeconds(),
    }
    if (applied !== undefined && applied.enabled === next.enabled && applied.announceToAgent === next.announceToAgent && applied.preventIdleSleep === next.preventIdleSleep && applied.maxSubtaskDepth === next.maxSubtaskDepth && applied.sessionPollSeconds === next.sessionPollSeconds) {
      return
    }
    applied = next
    host.ledger.setMaxSubtaskDepth(next.maxSubtaskDepth)
    host.setConfiguration(next.enabled, next.preventIdleSleep, next.sessionPollSeconds)
    setToolsEnabled(next.enabled)
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (!next.enabled || !next.announceToAgent) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:task-board',
      order: SECTION_ORDER,
      // The announcement names the task_board_* tools, so it renders only while
      // at least one of them is reachable: a runtime that serves no tool
      // registry, or a restriction that withholds them, must not leave guidance
      // telling the model to call tools this session cannot see.
      text: visibleToolText(lookupOf(resolveToolRegistry(ctx)), TASK_BOARD_TOOL_NAMES, TASK_BOARD_GUIDANCE),
    })
  }

  // A settings edit of a volatile field is committed into the references this
  // fiber already holds, with no remount and no second call to apply: the
  // commit event is what makes the edit take effect without a restart.
  ctx.on('loader/volatile-update', () => { sync() })
  sync()
}
