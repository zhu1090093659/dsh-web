/**
 * dsh-liangshen — LiangShen (梁神) agent preset plugin.
 *
 * Host half only: on startup it syncs the bundled `presets/` tree into the
 * harness-home agent-presets root (`~/.dsh/.agent-presets`), making the
 * LiangShen preset selectable for new sessions without copying files by hand,
 * and announces the capability through a system-prompt section. No browser
 * half, no routes, no agent tools — the preset itself provides the tools.
 *
 * The preset is the "anchored-standard" idea shipped as a named mode: the
 * first model request sees only the builtin Minimal preset's exact two tools
 * (persistent `bash` plus `str_replace_editor`), and after the anchor the
 * wire switches to PTC Mode. Derived from
 * https://github.com/xiaobright/dsh-anchored-standard (MIT).
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from 'schemastery'
import { dshHome } from './dsh-home.ts'
import { syncPresetTrees } from './sync.ts'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name. */
export const name = 'liangshen'

/** Prompt assembly must exist before the announcement section can register. */
export const inject = ['systemPrompt']

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch: when false, neither sync nor announcement runs. */
  enabled?: boolean
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
})

/** Schema default, re-read for hand-built test contexts. */
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/** Model-facing announcement: plugin presence, principle, and limits. */
export const LIANGSHEN_GUIDANCE = '本机已安装 dsh-liangshen 插件（梁神模式 agent preset）：新建会话的预设选择器中可选「梁神模式」。原理：两阶段锚定——首轮模型请求仅暴露官方 Minimal 精确双工具（持久 bash 与 str_replace_editor，文件工具继承宿主沙箱），只保留一行 persona，清空运行时上下文并只放行用户的直接消息，锚定 Minimal 推理轨迹；晋升受首块锚定门控（首块包含 we 且无 let me，四步兜底），无工具首轮会在响应后自动晋升，晋升后 wire 切换为 PTC Mode（单一 run_code）并在 persona 追加所选工作区路径，workspace 指令与 skill 目录在晋升后再延迟一步注入。preset 文件由插件维护于 ~/.dsh/.agent-presets，升级插件时自动更新；默认预设由用户自行选择。用户提到「梁神模式 / 锚定模式 / anchored standard」时即指本插件，请据此协作。'
// The harness-home resolution (DSH_HOME override with the platform-home
// fallback and ~ expansion) lives in the family-shared copy ./dsh-home.ts.
// Re-export it so the plugin surface stays stable while the implementation is
// shared across packages. A relative DSH_HOME resolves against the process CWD
// (absolute), which is the shared contract.
export { dshHome } from './dsh-home.ts'

/** Absolute path of the bundled preset tree inside this package. */
export function bundledPresetsRoot(): string {
  return fileURLToPath(new URL('../presets/', import.meta.url))
}

/**
 * Mount the plugin: sync bundled presets into the harness-home agent-presets
 * root, then announce through a system-prompt section.
 * @param ctx - host plugin context carrying systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@linxin666/dsh-liangshen', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  const resolve = (): Config => ({
    announceToAgent: config?.announceToAgent ?? DEFAULT_ANNOUNCE,
    enabled: config?.enabled ?? true,
  })

  const sync = (): void => {
    const targetRoot = join(dshHome(), '.agent-presets')
    try {
      mkdirSync(targetRoot, { recursive: true })
      const result = syncPresetTrees(bundledPresetsRoot(), targetRoot, ['liangshen-exact'])
      for (const { id, error } of result.failed) {
        ctx.logger?.warn?.(`dsh-liangshen: preset ${id} sync failed: ${error}`)
      }
      if (result.synced.length > 0) {
        ctx.logger?.info?.(`dsh-liangshen: presets synced into ${targetRoot}: ${result.synced.join(', ')}`)
      }
      if (result.retired.length > 0) {
        ctx.logger?.info?.(`dsh-liangshen: retired stale presets from ${targetRoot}: ${result.retired.join(', ')}`)
      }
    } catch (error) {
      ctx.logger?.warn?.(`dsh-liangshen: preset sync failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let disposeSection: (() => void) | undefined
  const refresh = (): void => {
    disposeSection?.()
    disposeSection = undefined
    if (!resolve().enabled) return
    sync()
    if (resolve().announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-liangshen',
        order: SECTION_ORDER,
        text: LIANGSHEN_GUIDANCE,
      })
    }
  }

  refresh()
  ctx.effect(() => () => { disposeSection?.(); disposeSection = undefined }, 'dsh-liangshen: announcement')
}
