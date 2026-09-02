# Agent Note: 会话归档管理设置界面校准到官方 token 契约

Status: implemented

## Problem

会话归档管理设置区在所有主题下配色都是坏的，且打开弹窗时整体观感剧变。同一皮肤、同为浅色模式的两张用户截图：列表视图整片半透明、发灰；打开物理删除确认弹窗后，整个设置面板变成深灰，弹窗文字直接浮在暗色背景上。

根因：`archive.module.css` 使用了六个官方 token 契约
（`skins/skin-center/contracts/official-tokens-v1.json`）中不存在的变量——
`--dsw-alias-bg-primary`、`--dsw-alias-bg-hover`、`--dsw-alias-bg-danger`、
`--dsw-alias-label-danger`、`--dsw-alias-border-primary`、`--dsw-alias-label-link`。
运行时这些自定义属性取不到值，所有仅依赖它们的声明进入
"invalid at computed-value time"：背景与边框退化为透明（卡片、输入框、弹窗
表面全部隐形），`color: var(--dsw-alias-label-danger)` 继承正文颜色（危险
操作失去红色）。此外弹窗遮罩硬编码 `rgba(0,0,0,0.45)`——一层不受 token
管辖的纯黑幕布，无论皮肤与主题如何都会把整个视口压暗。

## Decision

`archive.module.css` 现在只使用官方契约 token，且每个引用都带字面量兜底
（`var(--token, #fallback)`），未覆盖的 token 不可能再产生透明表面：

- 表面：`bg-layer-1`（列表卡片、输入框、按钮）、`bg-layer-2`（选择栏、
  自动维护面板）、`bg-base`（弹窗卡片），配 `border-l1`/`border-l2` 细线与
  `shadow-lv1`/`shadow-lv3` 阴影层级。
- 遮罩：`bg-mask-1` 加 `backdrop-filter: var(--dsw-mask-blur, blur(10px))`，
  对齐 `dsh-task-board` 的弹窗惯例；皮肤对 mask 的重映射让弹窗投色留在
  皮肤自己的色板内。
- 语义色：`state-*` 家族——`state-error-primary`（危险文字、实心危险填充配
  `label-primary-inverted` 前景、警告 callout）、`state-warn-primary`
  （运行中 chip、跨筛选提示）、`state-success-primary`（普通 chip）、
  `state-business-primary`（已归档 chip），chip/callout 软底全部用
  `color-mix` 调色，皮肤对 state 的重映射即可整段换装。
- 状态 chip 从旧的 ok/warn/muted 三档改为 success/warn/danger/business/
  neutral 五档 tonal 药丸；行选中态为 `button-primary-fill` 内嵌条加品牌
  浅色洗底。

同一轮 UX 打磨：筛选 tab 改分段控件、所有控件加 focus-visible 光圈与
hover/press 过渡、复选框 `accent-color`、行操作改横向排布、会话 ID 用
monospace chip、危险弹窗红色顶边与红色标题、不可恢复警告改为 callout
框、强确认复选行用虚线框、批量进度条按任务类型着色（归档品牌色、删除
错误色）、预览弹窗加宽并带角色着色的对话气泡。弹窗入场动画（淡入/缩放）
并遵循 `prefers-reduced-motion`。

同日追加一轮（来自真实使用反馈）：列表下方的工作区快捷选择 chip 栏与
工具栏的工作区筛选功能重复，整体移除（组件块、CSS，以及 zh/en 的
`arch.select.workspace` / `arch.select.workspaceClear` 键与 dsh-i18n 的
ru 集中词条）；两个原生 `<select>` 换成主题化下拉（`client/Select.tsx`：
触发器 + listbox 弹层，排序菜单支持分组头，方向键/Home/End/Enter/Esc
键盘操作，点外部关闭，`listbox`/`option` 角色加
`aria-activedescendant`）；弹层表面改用 `bg-overlay` 加强模糊——玻璃皮肤
把所有层级 token 都做成半透明，whale-song 下原 layer-1 弹层透明到选项
文字背后能透出行内容，而 `bg-overlay` 是这些皮肤重映射的近不透明浮层
表面。

## Testing

`pnpm --filter @linxin666/dsh-session-archive build/typecheck/test`（77 例）
与全仓 `typecheck`、`test`、`docs:check`、`i18n:check` 全部通过。并在真实
Web GUI（whale-song 皮肤、浅色模式）验证：列表卡片、tonal chip、红色危险
链接、自动维护面板均正常着色；删除确认弹窗为实卡片加皮肤色调的轻遮罩与
模糊，警告 callout 与实心确认按钮清晰；预览弹窗 meta 与对话气泡正常；两
个自定义下拉弹层不透明、分组渲染正常，选择工作区后列表正确过滤。证据：
设置区、删除确认、预览与两个下拉的会话截图。

## Alternatives considered

- 在 skin-center fallback 层补定义这六个别名 token，保留旧类名。否决：
  等于把非契约 token 制度化，且 `bg-danger`/`label-danger` 的语义已被皮肤
  实际重映射的 `state-*` 家族覆盖。
- 用 `@media (prefers-color-scheme)` 硬编码明暗两套。否决：皮肤下 GUI 主
  题并不跟随 OS scheme；契约别名本身就带明暗两套并承接皮肤重映射。
- 只替换 token 名、保留原布局。否决：本次诉求即 UI/UX 打磨，且原本扁平
  的层级（无表面、行操作纵向堆叠、警告无样式）即使配色正确也显得粗糙。

## Consequences

- 本设置区在构造上免疫皮肤与主题漂移：所有颜色经契约 token 表加字面量
  兜底解析，重映射 `state-*`/`bg-layer-*`/`bg-mask-1` 的皮肤即可完整换装，
  未覆盖 token 退化为合理字面量而非透明。
- 仍引用非契约 token 的其他包（`dsh-plugin-manager` 使用
  `bg-danger`/`label-danger`/`label-on-danger`/`bg-warning`/`bg-brand`；
  `dsh-doctor` 使用 `label-error`）存在同样的透明/继承退化模式，轮到时需
  做同样校准。
- `backdrop-filter` 依赖 `--dsw-mask-blur`，个别皮肤把它定义为颜色值；此
  时声明被丢弃、遮罩保留色调但无模糊——属于优雅降级而非回归。
