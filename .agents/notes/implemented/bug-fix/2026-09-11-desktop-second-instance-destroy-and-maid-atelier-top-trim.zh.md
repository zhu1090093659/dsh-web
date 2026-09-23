# Agent Note: 桌面端关闭后启动未捕获异常与女仆皮肤顶部饰边遮挡修复

Status: implemented

## Problem

### 1. 桌面端关闭后立即再次启动抛出 Object has been destroyed 异常 (Issue #1465)
在关闭 DSH 桌面端窗口后，主进程进入退出流程（`before-quit`），需要调用 `stopHost` 停止内置 DSH 宿主服务，最长等待 5 秒收尾。在此 5 秒窗口期内，若用户再次双击快捷方式启动，第二实例触发 `second-instance` 事件。`desktop/src/main.cjs` 中仅判断了 `mainWindow !== null`，未校验 `mainWindow.isDestroyed()`，且在进程已处于 `quitting` 退出状态时未提前短路，直接调用 `mainWindow.isMinimized()` 导致抛出未捕获异常：`TypeError: Object has been destroyed`。

### 2. 深海女仆工坊皮肤顶部装饰层遮挡标题栏按钮与右侧栏无底色 (Issue #1471)
工坊发布的 `maid-atelier` 皮肤中，`patches.css` 对 `[data-skin-chrome="top-trim"]` 设置了 `position: fixed; z-index: 20`，导致固定在顶部的装饰层覆盖了会话标题栏右上角的「右侧栏开关」等核心控制按钮，按钮图标不可见且交互受到干扰；同时缺少针对 `dsh-better-sidebar` 的底色覆盖层规则，导致展开右侧面板时没有底色直接浮在背景壁纸上。

## Decision

### 1. 桌面端生命周期与 second-instance 唤醒守卫
- 在 `desktop/src/runtime.cjs` 中导出纯函数 `shouldRaiseWindowOnSecondInstance(argv, state)`，对退出态（`state.quitting`）、窗口为空、窗口已销毁（`state.window.isDestroyed()`）以及命令行辅助子进程启动（`isProgrammaticLaunch`）进行统一过滤与短路。
- 在 `desktop/src/main.cjs` 的 `second-instance` 事件中接入该判定函数，并在 `createWindow()` 里为 `window` 的 `closed` 事件注册监听以清空 `mainWindow`。
- 在 `desktop/tests/runtime.test.mjs` 中添加全覆盖单元测试。

### 2. maid-atelier 顶部饰边与右侧栏样式修正
- 将 `packages/skins/skin-center/skins/maid-atelier/patches.css` 中 `[data-skin-chrome="top-trim"]` 调整为 `position: absolute; z-index: 1; inset: 0 0 auto; top: 0;`，彻底解除对标题栏控件的遮挡。
- 在 `patches.css` 中同步上游关于 `[data-dsh-better-sidebar]` 的亮色与暗色底色 token 映射，保证右侧面板具备完整的不透明背景。
- 更新 `maid-atelier/skin.json` 版本号至 `0.3.2`，重新生成 `reviewed-hooks.generated.ts` 并通过 `scripts/market-build` 刷新工坊分发包。

## Testing

- Desktop 单元测试：执行 `node --test desktop/tests/*.test.mjs`，20 项测试全部通过（包含销毁窗口与退出态判定用例）。
- 皮肤中心与工坊门禁：
  - `pnpm skin-center:check` 通过（31 个皮肤资产目录及 hooks 校验合规）。
  - `pnpm market:check` 通过（dist 产物与 hash 校验完全匹配）。
- 脚本测试：`pnpm test:scripts` 通过。
