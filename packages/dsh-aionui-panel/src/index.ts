/**
 * @linxin666/dsh-client-ui-aionui-panel — host half: the workspace-gated
 * filesystem + git services and the /aionui-panel/* HTTP routes (JSON
 * operations + SSE change stream) on the shared webserver. The browser half
 * (exports "./client") is served by client-modules from the same package's
 * dsh.client declaration.
 *
 * The host half also announces the plugin to every agent through the
 * system-prompt section mechanism (the same band task-board uses), so agents
 * know the right-panel system exists and how to cooperate with it.
 *
 * AionUi right-panel design (Apache-2.0, iOfficeAI/AionUi) — re-implemented
 * from measured behavior and architecture, not copied code.
 * @module @linxin666/dsh-client-ui-aionui-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { FsService } from './host/fs-service.ts'
import { GitService, subprocessRunner } from './host/git-service.ts'
import { createWorkspaceGate } from './host/gate.ts'
import { registerPanelRoutes } from './host/routes.ts'
import { mountOnce } from './mount-once.ts'

/** Required services: the route registry, the managed subprocess seam, the workspace registry, and the prompt band. */
export const inject = ['webServer', 'subprocess', 'workspaceRegistry', 'systemPrompt']

/** Settings namespace the browser settings card edits (the Host registers it). */
export const AIONUI_PANEL_SETTINGS_NAMESPACE = 'aionui-panel'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 210

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const AIONUI_PANEL_GUIDANCE = '本机已安装 dsh-aionui-panel 插件（DSH Web GUI 的右侧面板系统）：项目会话打开时，聊天区右侧出现「预览」与「文件/变更」两块面板。能力：Explorer 文件树（点击文件在预览面板打开、整行点击展开文件夹、按文件名搜索定位）；Preview 多 tab 预览（markdown/html/code/diff/csv/pdf/office/图片/文本等格式，支持源码/预览切换、分屏编辑、保存；markdown 中的 mermaid 代码块会渲染成图表（图源语法错误时回退为代码块），数学公式（$$...$$ 块级与 $...$ 行内）经 KaTeX 渲染（运行时缺失或语法错误时回退为原文）；聊天消息中的 mermaid 代码块同样渲染）；SCM 变更面板（真实 git stage/unstage/discard）；面板宽度可拖拽调整（Explorer 220~500px、Preview 340~1200px），双击把手复位默认宽度，折叠状态与宽度按项目持久化（localStorage）。数据源为当前会话工作目录的真实文件系统与真实 git 仓库，宿主进程经 /aionui-panel/* 路由提供。用户提到「右侧面板 / 预览面板 / 文件树 / 变更面板」时即指本插件，请据此协作。'

/** Settings section the browser card edits: a total on/off switch (issue #307). */
export interface AionUiPanelSettings {
  /** Whether the right-panel system is mounted at all; default on. */
  enabled?: boolean
}

/**
 * Mount the panel data services and their routes.
 * @param ctx - context carrying webServer, subprocess, workspaceRegistry, systemPrompt.
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-aionui-panel', applyImpl)

function applyImpl(ctx: Context, config: AionUiPanelSettings = {}): void {
  const gate = createWorkspaceGate(ctx)
  const fs = new FsService(gate)
  const git = new GitService(subprocessRunner(ctx), gate, (root, rel) => fs.delete(root, rel))

  // Settings the browser card edits through the 'aionui-panel' namespace:
  // turning the panel off unmounts the /aionui-panel/* routes (which stops
  // the workspace fs watch and git polling, since both live behind the SSE
  // stream) and the agent-facing announcement, mirroring the pet's model.
  let current: () => AionUiPanelSettings = () => base
  const base: AionUiPanelSettings = { enabled: config.enabled ?? true }
  let disposePanel: (() => void) | undefined
  let disposePrompt: (() => void) | undefined
  const syncPanel = (): void => {
    const enabled = current().enabled ?? true
    if (disposePanel === undefined && enabled) {
      disposePanel = ctx.effect(() => {
        const disposeRoutes = registerPanelRoutes(ctx, fs, git)
        return () => disposeRoutes()
      }, 'dsh-aionui-panel: /aionui-panel routes')
      disposePrompt = ctx.effect(() => ctx.systemPrompt.section({
        name: 'plugin:aionui-panel',
        order: SECTION_ORDER,
        text: AIONUI_PANEL_GUIDANCE,
      }), 'dsh-aionui-panel: prompt section')
    } else if (disposePanel !== undefined && !enabled) {
      disposePanel()
      disposePanel = undefined
      disposePrompt?.()
      disposePrompt = undefined
    }
  }
  installSettingsSection(
    ctx,
    settingsNamespace(AIONUI_PANEL_SETTINGS_NAMESPACE),
    z.object({ enabled: z.boolean().default(true) }),
    base,
    {
      setSource: (source) => { current = source },
      onChange: () => syncPanel(),
    },
  )
  syncPanel()
}
