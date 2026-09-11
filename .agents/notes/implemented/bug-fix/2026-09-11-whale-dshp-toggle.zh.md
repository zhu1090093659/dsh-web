# Agent Note：当前 DSH 核心 UI 上手机鲸鱼点击无法展开侧栏

Status: implemented

## Problem

在当前 DSH 核心 UI 组合下，点击手机小鲸鱼（`#dshRemoteWhale`）没有反应：
侧栏保持收起。`officialSidebarToggle()` 只按旧锚点解析切换按钮——先找
`[class$="_railFish"] button`，再找 `[class$="_logoRow"]` 内的
`button[class*="_toggle"]`。当前组合下两者都不存在（实测均为 0 个节点），
而真实的侧栏切换按钮由 dsh-better-sidebar/核心 UI 渲染为
`.dshp-iconButton.dshp-toggle`（aria-label 打开侧边栏 / Open sidebar）。
函数返回 null 后，`toggleSidebarVerified()` 落到 layout face，而它在当前
组合下是 inert 挂载的，所以鲸鱼点击空转。`src/client/index.ts` 的 bridge
null 分支里同样保留了过时的选择器。

## Decision

让 `officialSidebarToggle()` 优先尝试当前锚点：

1. `.dshp-iconButton.dshp-toggle`
2. `[aria-label="打开侧边栏"]:not(#dshRemoteWhale)` /
   `[aria-label="Open sidebar"]:not(#dshRemoteWhale)`
3. 然后保持原有的 `_railFish` / `_logoRow` 旧锚点不变

`:not(#dshRemoteWhale)` 排除是承重设计：鲸鱼自身也带「打开侧边栏」的
aria-label，裸 aria 选择器会自匹配并递归点击鲸鱼。`src/client/index.ts`
的 bridge null 分支同步使用同一选择器集。新增一个单元测试覆盖当前组合
DOM（只有 `.dshp-iconButton.dshp-toggle`，没有 logo row）。

这是对
[mobile-remote-tap-and-adaptation-fixes](../../implemented/bug-fix/2026-09-09-mobile-remote-tap-and-adaptation-fixes.md)
引入的 toggle-first 顺序的扩展：那次把官方 toggle 锚定在 logo row 上，
而当前 DSH 核心 UI 已不再匹配（该 note 的上游报告
[inert-layout-toggle-face](../../proposed/bug-fix/2026-09-09-inert-layout-toggle-face.md)
记录了宿主侧始终 inert 的 LayoutController）。

Rejected alternative：完全删掉旧锚点。旧组合仍可能带
`_railFish`/`_logoRow`；保留它们以零成本维持向后兼容。

## Consequences

鲸鱼点击直接驱动当前的 `.dshp-toggle` 按钮；本组合下不再命中 inert 的
layout-face 兜底。未来任何对侧栏切换按钮的 DSH 核心 UI 改动都必须重新
审计这组选择器。已通过单元测试验证（mobile-adapt.spec.ts 19 项全过，
含新增用例）和真实浏览器验证（playwright，390x844 触屏视口）：点按时
侧栏宽度 1px -> 280px 再收回，`data-sidebar-collapsed` 翻转 true -> null
-> true。
