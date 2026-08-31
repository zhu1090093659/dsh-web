# Agent Note: Git Graph branch chip portals into hero workspace row

Status: implemented

## Problem

在空白会话中，Git 分支选择器（`BranchChip`）发生脱落，漂浮在对话区和空白鲸鱼插画上方，未能与 `WorkspaceChip` 和 `AgentPresetSeat` 并排处于同一行。

根因是 `BranchChip` 通过 `top = rowRect.top - stackRect.top + ...`（相对 `div.wSkVaW_composerStack` 的坐标）计算位置并应用了 `position: absolute; left: ${left}px; top: ${top}px`（`css.anchorHero`）。然而，`composerStack` 和 `heroWorkspaceRow` 是 `position: static` 的 flex 容器，并未建立 containing block；最近的定位祖先是对话视图顶部的 `div.wSkVaW_body`（`y = 0`）。因此，相对垂直居中的 `composerStack` 计算的坐标在相对 `body` 定位时导致 chip 跳跃到 composer 卡片和 hero 行上方数百像素处。

## Decision

`BranchChip` 不再使用 `getBoundingClientRect` 坐标计算、动画帧调度器与 `position: absolute`，而是在 `heroSeat` 激活时通过 React `createPortal` 直接 portal 到 `heroWorkspaceRow` 中。

1. **DOM 目标解析**：`findHeroRow(anchor)` 解析匹配 `.heroWorkspaceRow` 的已连接元素（`outlet.previousElementSibling` 或 `composerStack` 内部）。
2. **Portal 挂载**：当 `heroSeat` 处于激活状态且 `heroRow` 已解析时，`createPortal(chipNode, heroRow)` 将 chip 直接渲染至官方 `heroWorkspaceRow` flex 容器中。`conversation.input.dock` 中保留一个隐藏的零尺寸占位符。
3. **Flex 流布局**：`.anchorHero` 使用 `display: inline-flex; align-items: center;`，无需 `position: absolute;`。Chip 作为 `heroWorkspaceRow` 的原生 flex 子节点自然排列，继承官方 2px 间距、垂直居中与响应式流，无需坐标计算或 resize observer。
4. **生命周期与清理**：当会话离开 hero 状态时（如发送消息或切换至活跃会话），`BranchChip` 卸载并干净移除 portal 节点。

## Alternatives considered

- **针对 `anchor.offsetParent` 计算坐标**：在滚动、视口缩放、动态加载 composer 以及不同皮肤的父级 containing block 样式差异下十分脆弱。
- **对 dock 容器施加 translate 变换**：Dock outlet 位于 hero 行下方，负向 translate 会破坏 flex 边界并引发与 composer 卡片元素的碰撞风险。

## Consequences

- Git 分支 chip 在空白会话中与工作区 chip 和智能体预设 chip 完全对齐，具备精确的原生间距与排版。
- 消除了动画帧调度、`ResizeObserver` 循环与像素坐标计算。
- `@linxin666/dsh-client-ui-git-graph` 客户端 bundle 已更新。

## Testing

- `packages/dsh-git-graph/tests/client.spec.tsx` 中的单元测试已更新，`dsh-git-graph` 中的全部 10 个测试文件（145 个测试）全部通过。
- 仓库级 `pnpm typecheck`、`pnpm test`、`pnpm docs:check` 和 `pnpm i18n:check` 全部通过。
