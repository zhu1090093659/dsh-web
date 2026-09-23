# 智能体决策记录：会话归档弹窗视口约束与 Escape 键盘事件隔离

状态：已实现

## 问题描述

Issue #1412：在 `@linxin666/dsh-session-archive` 中，在设置面板内打开弹窗（如会话预览或删除确认）存在两处交互缺陷：
1. 在矮视口（高度 $\le 560\text{px}$）或祖先元素具有 `backdrop-filter`（将 `position: fixed` 后代的包含块限制在设置面板区域）时，弹窗采用 `max-height: 82vh` 与 `content-box`，导致弹窗 footer 操作栏（包含「关闭」按钮）被裁剪在可视区域之外，鼠标点击无法命中；
2. 按下 Escape 键时触发冒泡阶段的 keydown 事件，且未阻止传播。由于宿主外层设置面板同样在 `document` 上监听了 Escape，单次按键会导致预览弹窗与底层设置面板同时关闭。

## 决策

1. 在 `packages/dsh-session-archive/src/client/archive.module.css` 中：
   - 将 `.modal` 设置为 `box-sizing: border-box`、`max-height: min(82vh, calc(100% - 32px))` 并设置 `overflow: hidden`。
   - 保持 `.modalTitle` 与 `.modalActions` 为非收缩栏（`flex: 0 0 auto`），为 `.modalActions` 添加 `margin-top: auto` 保持置底。
   - 将 `.confirmBody`、`.batchBody`、`.previewBody` 设置为 `flex: 1 1 auto`、`min-height: 0` 与 `overflow-y: auto`，使长内容在中间区域独立滚动，操作栏在任何视口高度下均常驻可视且可点击。
2. 在 `packages/dsh-session-archive/src/client/dialogs.tsx` 中：
   - 在捕获阶段注册 keydown 监听器（`{ capture: true }`）。
   - 捕获到 Escape 键时调用 `event.stopPropagation()` 与 `event.stopImmediatePropagation?.()`，然后再触发 `onClose()`。

## 测试验证

- 新增单元测试：`packages/dsh-session-archive/tests/dialogs-layout.spec.ts`（3 项测试通过），校验弹窗 CSS 包含块规则与 Escape 传播隔离。
- 插件包全量测试：`pnpm --filter @linxin666/dsh-session-archive test`（10 个测试文件，82 项测试全部通过）。
- 全局质量门禁：`pnpm typecheck` 通过。
