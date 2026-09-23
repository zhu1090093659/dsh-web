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
 * 'both' presentation by default — the assembled native roster stays on the
 * wire for ordinary work and the `run_code` transport sits co-resident for
 * programmatic batch computation and wide fan-out, declared once per session
 * instead of staged across a turn boundary ('native' and 'ptc' are one-line
 * opt-outs). High-fan-out tool families
 * (default `mcp__*`) stay paged out of the executed surface through the
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
export const PRESENTATION_OPTIONS = ['ptc', 'native', 'both'] as const

/** Sensitivity presets for the circuit breaker's adaptive thresholds. */
export const SENSITIVITY_OPTIONS = ['conservative', 'balanced', 'aggressive'] as const

/** One wire presentation. */
export type Presentation = (typeof PRESENTATION_OPTIONS)[number]

/** One circuit-breaker sensitivity preset. */
export type GuardSensitivity = (typeof SENSITIVITY_OPTIONS)[number]

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
   * `both` (default) keeps the assembled roster and the `run_code` transport
   * co-resident; `native` keeps only the roster; `ptc` collapses the wire to
   * the transport.
   */
  presentation?: ConfigField<Presentation>
  /** Master switch for the runtime degeneration circuit breaker (default true). */
  guardEnabled?: ConfigField<boolean>
  /**
   * Sensitivity preset scaling the breaker's adaptive thresholds
   * (default 'balanced'). 'conservative' interrupts less, 'aggressive' fires earlier.
   */
  guardSensitivity?: ConfigField<GuardSensitivity>
  /**
   * Reasoning characters one zero-output step must reach for the per-step
   * ladder to fire (default 8000, calibrated against V4.1's 384K max output).
   */
  guardStallReasoningChars?: ConfigField<number>
  /**
   * Consecutive output-free reasoning steps that trip the slow-burn ladder
   * (default 4).
   */
  guardGlobalStallCap?: ConfigField<number>
  /** Identical-argument tool failures in a row that trip the echo ladder (default 3). */
  guardEchoFailures?: ConfigField<number>
}

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  announceToAgent: z.boolean().default(false).volatile(),
  presentation: z.union([...PRESENTATION_OPTIONS]).default('both').volatile(),
  guardEnabled: z.boolean().default(true).volatile(),
  guardSensitivity: z.union([...SENSITIVITY_OPTIONS]).default('balanced').volatile(),
  guardStallReasoningChars: z.number().default(8000).volatile(),
  guardGlobalStallCap: z.number().default(4).volatile(),
  guardEchoFailures: z.number().default(3).volatile(),
})

/** The settings the runtime acts on, every field read at its use site. */
export interface ResolvedConfig {
  /** Whether the preset is declared at all. */
  enabled: boolean
  /** Whether the announcement section registers. */
  announceToAgent: boolean
  /** Wire presentation the declared preset's tool-catalog row carries. */
  presentation: Presentation
  /** Breaker master switch written into the declared preset's guard row. */
  guardEnabled: boolean
  /** Breaker sensitivity written into the declared preset's guard row. */
  guardSensitivity: GuardSensitivity
  /** Per-step reasoning-character floor written into the guard row. */
  guardStallReasoningChars: number
  /** Slow-burn step cap written into the guard row. */
  guardGlobalStallCap: number
  /** Echo-ladder failure count written into the guard row. */
  guardEchoFailures: number
}

/** Schema defaults, re-read for hand-built test contexts. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  announceToAgent: false,
  presentation: 'both',
  guardEnabled: true,
  guardSensitivity: 'balanced',
  guardStallReasoningChars: 8000,
  guardGlobalStallCap: 4,
  guardEchoFailures: 3,
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
  return {
    enabled: readField(config?.enabled, DEFAULT_CONFIG.enabled),
    announceToAgent: readField(config?.announceToAgent, DEFAULT_CONFIG.announceToAgent),
    presentation: readField(config?.presentation, DEFAULT_CONFIG.presentation),
    guardEnabled: readField(config?.guardEnabled, DEFAULT_CONFIG.guardEnabled),
    guardSensitivity: readField(config?.guardSensitivity, DEFAULT_CONFIG.guardSensitivity),
    guardStallReasoningChars: readField(config?.guardStallReasoningChars, DEFAULT_CONFIG.guardStallReasoningChars),
    guardGlobalStallCap: readField(config?.guardGlobalStallCap, DEFAULT_CONFIG.guardGlobalStallCap),
    guardEchoFailures: readField(config?.guardEchoFailures, DEFAULT_CONFIG.guardEchoFailures),
  }
}

/** Model-facing announcement: plugin presence, principle, and limits. */
export const LIANGSHEN_GUIDANCE = '本机已安装 dsh-liangshen 插件（梁神模式 agent preset）：新建会话的预设选择器中可选「梁神模式」。原理：系统提示词保持极简 persona（minimal-prompt 放行该段与 plan 模式的 plan:policy），persona 内置本模式工作纪律（反思熔断——同一假设推演不超过两轮、缺事实立即闭合思考并调用原生检测工具；行动导向——思考只决定下一步具体操作、不在思考中预演代码实现；并发探索——多处独立检查或搜索在单轮内并发发射多个工具调用；YAGNI/PDCA——单步验证单一假设、不写冗余注释；有界收敛——不无限下钻依赖链、前置检查最多2-3轮后立即收敛并作答或编辑），并在组装时追加工作区目录行 Your working directory is <cwd>.。AGENTS.md 工作区指令默认交还宿主自身的 agent-instructions 行，以 user 角色注入，本插件不追加任何系统提示词段、也不改动 pre-step 的消息批次；可选 instructionSource: system-prompt 才由本插件在组装时读取 AGENTS.md 链并追加 workspace-instructions 段（65536 字节预算，每次组装重读）。wire 呈现由 tool-catalog 按会话一次声明，取值 \'both\'（默认：原生清单与 run_code 同驻，原生直调优先、run_code 用于程序化批处理与并发扇出）、\'native\'（组装出的原生清单）或 \'ptc\'（wire 收拢为唯一的 run_code），并可在插件设置界面切换（写入所声明预设的 tool-catalog 行）；未挂载 code runtime 时不做声明，会话运行原生工具面。温和工具分页出厂开启（pagedToolPatterns 默认 [\'mcp__*\']）：匹配工具在激活前被作用域级工具限制移出可见面（既不在 wire，也不在生成的 SDK 声明中），目录消息列出常驻工具签名与未激活命名空间摘要，调用 tool_activate({ namespace }) 按需激活（LRU 上限 3 个活跃命名空间，驱逐最久未用）；激活状态从持久会话事件流重建，resume/压缩后自然恢复。运行时退化熔断器（guard）从事件流折叠停摆（连续零产出长思考）与空转（同参重复失败）信号，每 episode 触发一次：注入熔断消息并把推理档位临时下调一档（max→high→low，窗口 3 个请求）；无信号时从不改写请求。关键事实登记簿（fact_register）让模型把硬约束/已确认决策/失败路径登记为单行事实，随 working-context 行每步投射进局部注意力窗口。working-context 插件在 pre-step 注入单行 [Working Context: ...] 就近状态投射（plan 模式、活跃命名空间、进行中 todo、登记事实，全部从事件流折叠，读不到则省略，全部为空则不注入）。历史工具结果修剪为 4096 字符阈值（head 2048 / tail 1024）。文件操作受宿主沙箱约束；shell 在每个平台都挂上游标准 Stdio 栈（POSIX 为 bash，Windows 为 pwsh），带简短描述标题卡片与确定性退出码。真实推理探针通过不等于模式集成通过，更不等于统计效果提升。预设由插件在激活时向 agent-preset registry 直接注册（不写任何预设目录），插件停用即注销；默认预设由用户自行选择。用户提到「梁神模式 / 锚定模式 / anchored standard」时即指本插件，请据此协作。'

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
      if (!values.enabled) return
      const registry = registryOf()
      if (registry === undefined) {
        warn('the agent-preset registry is unavailable; the preset is not declared')
        return
      }
      try {
        release = await registry.register(declaration(values))
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
