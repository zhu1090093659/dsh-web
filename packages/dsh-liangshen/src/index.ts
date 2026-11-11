/**
 * dsh-liangshen — LiangShen (梁神) agent preset plugin.
 *
 * Host half only: at activation it DECLARES the bundled LiangShen agent preset
 * to the harness's agent-preset registry (`ctx.agentPresets`), reading the
 * composition rows of `presets/liangshen/agent.cordis.yml` and handing the
 * registry a definition whose relative module paths resolve inside the bundled
 * preset directory. Declare = enabled: the registry mounts the preset's rows
 * eagerly and hands back a disposer this plugin owns, so disabling the plugin
 * (or the row unloading) unmounts them, and nothing is written to the harness
 * home. The registration is released in `ctx.effect`; the plugin's own Config
 * is the settings page the Host generates for this profile entry, and a
 * settings write re-declares the preset with the new values instead of
 * remounting the row. The capability announcement is a system-prompt section
 * that ships OFF by default (`announceToAgent: false`) and can be enabled in
 * the web settings surface (plugin config) or the profile patch. No browser
 * routes, no agent tools — the preset itself provides the tools.
 *
 * The preset combines a minimal persona with a lifetime-declared tool
 * presentation: the system prompt keeps a minimal persona with standing
 * working discipline and workspace instructions, and the wire runs the SDK's
 * 'ptc' presentation by default — the wire collapses to the `run_code`
 * transport and every other tool is reached from inside the program through
 * the generated SDK ('native' keeps the assembled roster alone), declared once
 * per session instead of staged across a turn boundary. High-fan-out tool families
 * (default `mcp__*`, `browser_*`, `task_board_*`, `team_*`, `squad*`, `ui_*`, `ssh_*`) stay paged out of the executed surface through the
 * host's scoped tool restriction until the preset's own `tool_activate` tool
 * loads their namespace (LRU cap three), with the activation state replayed
 * from the durable session event stream. The tool catalog — listing exactly
 * the tools the request carries plus the paged-out namespace summaries — and a
 * one-line working-context projection travel as durable user messages,
 * republished only on change.
 */

import { fileURLToPath } from 'node:url'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { AgentPresetRegistry, PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
// Type-only: pulls the `ctx.agentPresets` Context merge and the registry types.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { applyPresetOverrides, readPresetDefinition } from './composition.ts'
import { LIANGSHEN_PRESET_ID } from './core/lever.ts'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name. */
export const name = 'liangshen'

/**
 * Settings namespace of the plugin. Under the 0.1.7 settings contract a
 * plugin's own Config IS its settings page and the namespace IS the profile
 * entry id, so this is the row id the standalone bundle patch inserts; the
 * aggregate install names the generated `web-ui-liangshen` row and the family
 * binder resolves between the two.
 */
export const LIANGSHEN_SETTINGS_NAMESPACE = 'liangshen' as SettingsNamespace

/** Prompt assembly must exist before the announcement section can register. */
export const inject = ['systemPrompt']

/** The wire presentations the preset's tool catalog accepts. */
export const PRESENTATION_OPTIONS = ['ptc', 'native'] as const

/** One wire presentation. */
export type Presentation = (typeof PRESENTATION_OPTIONS)[number]

/**
 * One activation field as the Host hands it over: a stable reference whose
 * `get()` reads the value committed for this instance (a settings write updates
 * it in place, without remounting the row), or the plain value a profile patch
 * or a hand-built test context passes.
 */
export type ConfigField<T> = Volatile<T> | T | undefined

/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * Every field is `volatile()`: the Host serves exactly the volatile fields of a
 * Config as this entry's settings form and refuses writes anywhere else, and a
 * volatile write is committed into the references this activation holds instead
 * of remounting the row.
 */
export interface Config {
  /** Master switch: when false, neither the preset declaration nor the announcement runs. */
  enabled?: ConfigField<boolean>
  /** When true, a system-prompt section announces the plugin (default false — keep prompts clean unless the user opts in). */
  announceToAgent?: ConfigField<boolean>
  /**
   * Wire presentation written into the declared preset's tool-catalog row.
   * `ptc` (default) collapses the wire to the single `run_code` transport and
   * reaches every other tool through the generated SDK; `native` keeps the
   * assembled roster alone. Legacy `'both'` (the pre-0.2.1 shipped default) is
   * accepted from older saved profiles and normalized to `'ptc'`.
   */
  presentation?: ConfigField<Presentation | 'both'>
  /**
   * When true, the preset appends the dispatcher rule block to its persona:
   * the session becomes a dispatch agent whose deliverable is the plan, the
   * task book, the review verdict, and the hand-off, on top of the mode's own
   * working discipline. Orthogonal to `presentation` — the tool wire is the
   * same either way. Default true: the shipped preset runs as a dispatcher,
   * and the switch is what returns a session to the bare persona.
   */
  dispatcher?: ConfigField<boolean>
  /**
   * On-demand tool families, comma separated (each entry a prefix ending in one
   * `*`), written to every row that pages from the list — the catalog, the
   * activation tool and the working context all replay the session log with it,
   * so the three must never disagree. Empty keeps the preset's shipped list; a
   * malformed text is ignored.
   */
  pagedToolPatterns?: ConfigField<string>
}

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  announceToAgent: z.boolean().default(false).volatile(),
  presentation: z.union([
    ...PRESENTATION_OPTIONS,
    z.transform('both', (): Presentation => 'ptc').deprecated().hidden(),
  ]).default('ptc').volatile(),
  dispatcher: z.boolean().default(true).volatile(),
  pagedToolPatterns: z.string().default('').volatile(),
})

/** The settings the runtime acts on, every field read at its use site. */
export interface ResolvedConfig {
  /** Whether the preset is declared at all. */
  enabled: boolean
  /** Whether the announcement section registers. */
  announceToAgent: boolean
  /** Wire presentation the declared preset's tool-catalog row carries. */
  presentation: Presentation
  /** Whether the declared preset's minimal-prompt row appends the dispatcher rule block. */
  dispatcher: boolean
  /** On-demand tool family text; empty inherits the preset's shipped list. */
  pagedToolPatterns: string
}

/** Schema defaults, re-read for hand-built test contexts. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  announceToAgent: false,
  presentation: 'ptc',
  dispatcher: true,
  pagedToolPatterns: '',
}

/**
 * Read one activation field. The Host validates the raw profile config and
 * hands volatile fields over as references, so a read goes through `get()`; a
 * plain value passes through, and an absent field falls back to the schema
 * default.
 */
function readField<T>(field: ConfigField<T>, fallback: T): T {
  if (field === undefined || field === null) return fallback
  const ref = field as { get?: () => T | undefined }
  const value = typeof ref.get === 'function' ? ref.get() : field as T
  return value === undefined ? fallback : value
}

/**
 * Read the effective settings of this activation.
 * @param config - the config the Host passed to the activation.
 * @returns every field resolved against the schema defaults.
 */
export function resolveConfig(config?: Config): ResolvedConfig {
  const rawPresentation = readField<Presentation | 'both'>(config?.presentation, DEFAULT_CONFIG.presentation)
  return {
    enabled: readField(config?.enabled, DEFAULT_CONFIG.enabled),
    announceToAgent: readField(config?.announceToAgent, DEFAULT_CONFIG.announceToAgent),
    presentation: rawPresentation === 'both' ? 'ptc' : rawPresentation,
    dispatcher: readField(config?.dispatcher, DEFAULT_CONFIG.dispatcher),
    pagedToolPatterns: readField(config?.pagedToolPatterns, DEFAULT_CONFIG.pagedToolPatterns),
  }
}

/** Model-facing announcement: plugin presence, principle, and limits. */
export const LIANGSHEN_GUIDANCE = '本机已安装 dsh-liangshen 插件（梁神模式 agent preset）：新建会话的预设选择器中可选「梁神模式」。原理：系统提示词保持极简 persona（minimal-prompt 放行该段与 plan 模式的 plan:policy），persona 内置本模式工作纪律（反思熔断——同一假设推演不超过两轮、缺事实立即闭合思考并调用原生检测工具；行动导向——思考只决定下一步具体操作、不在思考中预演代码实现；并发探索——多处独立检查或搜索在单轮内并发发射多个工具调用；YAGNI/PDCA——单步验证单一假设、不写冗余注释；有界收敛——不无限下钻依赖链、前置检查最多2-3轮后立即收敛并作答或编辑），并在组装时追加工作区目录行 Your working directory is <cwd>.。AGENTS.md 工作区指令默认交还宿主自身的 agent-instructions 行，以 user 角色注入，本插件不追加任何系统提示词段、也不改动 pre-step 的消息批次；可选 instructionSource: system-prompt 才由本插件在组装时读取 AGENTS.md 链并追加 workspace-instructions 段（65536 字节预算，每次组装重读）。wire 呈现由 tool-catalog 按会话一次声明，取值 \'ptc\'（默认：wire 收拢为唯一的 run_code，其余工具经生成的 SDK 调用）或 \'native\'（组装出的原生清单，无程序化传输），并可在插件设置界面切换（写入所声明预设的 tool-catalog 行）；未挂载 code runtime 时不做声明，会话运行原生工具面。按需工具族出厂开启（pagedToolPatterns 默认 [\'mcp__*\', \'browser_*\', \'task_board_*\', \'team_*\', \'squad*\', \'ui_*\', \'ssh_*\']，可在插件设置的「按需工具族」中用逗号分隔的前缀改写）：匹配工具在激活前被作用域级工具限制移出可见面（既不在 wire，也不在生成的 SDK 声明中），目录消息列出常驻工具签名与未激活命名空间摘要，调用 tool_activate({ namespace }) 按需激活（LRU 上限 3 个活跃命名空间，驱逐最久未用）；激活状态从持久会话事件流重建，resume/压缩后自然恢复。关键事实登记簿（fact_register）让模型把硬约束/已确认决策/失败路径登记为单行事实，随 working-context 行每步投射进局部注意力窗口。working-context 插件在 pre-step 注入单行 [Working Context: ...] 就近状态投射（plan 模式、活跃命名空间、进行中 todo、登记事实，全部从事件流折叠，读不到则省略，全部为空则不注入）。历史工具结果修剪为 4096 字符阈值（head 2048 / tail 1024）。文件操作受宿主沙箱约束；shell 在每个平台都挂上游标准 Stdio 栈（POSIX 为 bash，Windows 为 pwsh），带简短描述标题卡片与确定性退出码。真实推理探针通过不等于模式集成通过，更不等于统计效果提升。预设由插件在激活时向 agent-preset registry 直接注册（不写任何预设目录），插件停用即注销；默认预设由用户自行选择。用户提到「梁神模式 / 锚定模式 / anchored standard」时即指本插件，请据此协作。'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/**
 * Absolute path of the bundled LiangShen preset directory: the composition,
 * the display map, and the preset-local `.mjs` plugins this plugin declares.
 * @returns the preset directory as a filesystem path.
 */
export function bundledPresetDir(): string {
  // Resolved from this module's own URL rather than the process CWD, so the
  // declaration works whatever directory the host was started in.
  return fileURLToPath(new URL('../presets/liangshen/', import.meta.url))
}

/**
 * Build the registry declaration of the bundled preset with the settings
 * currently committed applied to the rows they shape.
 * @param values - the activation's effective settings.
 * @returns the definition to submit to `ctx.agentPresets.register`.
 */
function declaration(values: ResolvedConfig): PresetDefinition {
  const definition = readPresetDefinition(LIANGSHEN_PRESET_ID, bundledPresetDir())
  return { ...definition, plugins: applyPresetOverrides(definition.plugins, values) }
}

/**
 * Mount the plugin: declare the bundled preset, register the announcement
 * section when announceToAgent is on (off by default), and re-declare on every
 * committed settings write.
 * @param ctx - host plugin context carrying systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@linxin666/dsh-liangshen', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  /** The live registry, or undefined on a deployment that composes none. */
  const registryOf = (): AgentPresetRegistry | undefined => {
    try {
      return ctx.get('agentPresets')
    } catch {
      return undefined
    }
  }

  /** Disposer of the live declaration; the declaring plugin owns it. */
  let release: (() => Promise<void>) | undefined
  /** Declaration generation: a re-arm supersedes the one it replaced. */
  let generation = 0
  /** Set once the owning fiber unloads: a late re-arm must not declare again. */
  let closed = false
  /** Serializes declaration work, so a settings write cannot interleave with an in-flight activation. */
  let queue: Promise<void> = Promise.resolve()
  /**
   * True when the last declaration attempt found no registry. It is the ONLY
   * state the late-registry recovery below acts on, so a registry that was
   * already present at activation is never re-declared.
   */
  let registryMissing = false

  const warn = (message: string): void => { ctx.logger?.warn?.(`dsh-liangshen: ${message}`) }

  /** Release the live declaration, waiting for the registry to unmount its rows. */
  const undeclare = async (): Promise<void> => {
    const dispose = release
    release = undefined
    if (dispose === undefined) return
    try {
      await dispose()
    } catch (error) {
      // A registry already gone is not this plugin's failure.
      warn(`releasing the preset declaration failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Declare the preset with the settings committed right now. Queued behind any
   * in-flight activation and skipped when a newer re-arm superseded it, so a
   * burst of settings writes settles on the last one.
   */
  const declare = (): void => {
    const target = ++generation
    queue = queue.then(async () => {
      if (closed || target !== generation) return
      await undeclare()
      const values = resolveConfig(config)
      if (!values.enabled) {
        registryMissing = false
        return
      }
      const registry = registryOf()
      if (registry === undefined) {
        registryMissing = true
        warn('the agent-preset registry is unavailable; the preset is not declared')
        return
      }
      try {
        release = await registry.register(declaration(values))
        registryMissing = false
        ctx.logger?.info?.(`liangshen: preset ${LIANGSHEN_PRESET_ID} declared`)
      } catch (error) {
        warn(`declaring the preset failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }).catch((error: unknown) => {
      warn(`preset declaration failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** The live announcement section, replaced on every re-arm. */
  let disposeSection: (() => void) | undefined

  /**
   * Apply the committed settings: swap the announcement section and re-declare
   * the preset. This is the edge the pre-0.1.7 settings `setSource`/`onChange`
   * hooks ran on, from the settings write that the Loader now commits into this
   * row's volatile references instead of remounting it.
   */
  const rearm = (): void => {
    disposeSection?.()
    disposeSection = undefined
    const values = resolveConfig(config)
    if (values.enabled && values.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-liangshen',
        order: SECTION_ORDER,
        text: LIANGSHEN_GUIDANCE,
      })
    }
    declare()
  }

  ctx.on('loader/volatile-update', () => { rearm() })

  /**
   * Recover the declaration when the agent-preset registry appears.
   *
   * The registry is deliberately NOT a hard inject: a deployment may compose no
   * preset registry at all, and waiting on it would then pend this row forever
   * -- which under the host's boot gate fails the entire web boot, not just this
   * plugin (issue #1712). But the registry's own publication is decided by its
   * dependency chain (the official registry injects `loader` and
   * `sessionProjections`, and reaches `settings` through `ctx.inject`), so this
   * row's single activation can land BEFORE the service exists. Without this
   * edge the one declaration attempt was simply lost until an unrelated settings
   * write happened to re-arm -- exactly the "toggle any switch and the preset
   * appears, and only then" report (issue #1721).
   *
   * `registryMissing` is the gate rather than a plain `rearm()`: the registry is
   * normally already present at activation, and this callback fires
   * asynchronously even then, so re-arming unconditionally would release and
   * re-declare the preset the activation had just registered (and swap the
   * announcement section for nothing). The callback only repairs the missed
   * case -- the one where the earlier attempt warned and gave up -- and `declare`
   * is idempotent (it undeclares first and carries a generation guard), so a
   * recovery racing an in-flight declaration still settles on one live
   * registration. The fiber's `closed` flag keeps a late arrival from declaring
   * after this row unloads.
   */
  ctx.inject(['agentPresets'], () => {
    if (registryMissing) rearm()
  })

  ctx.effect(() => {
    rearm()
    return async () => {
      disposeSection?.()
      disposeSection = undefined
      // Stop any re-arm that arrives while this row is unloading, then wait for
      // the declaration work already queued and release what it declared.
      closed = true
      generation += 1
      await queue
      await undeclare()
    }
  }, 'dsh-liangshen: preset declaration and announcement')
}

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
