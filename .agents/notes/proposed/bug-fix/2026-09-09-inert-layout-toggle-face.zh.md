# Agent Note: 宿主布局切换接口在已安装 cohort 上惰性（暂缓上报上游）

Status: proposed

## Problem

官方布局服务在已安装 cohort 上是静默空操作，插件按文档去开/关侧边栏的路径失效。在运行中的 `dsh web` 宿主上实测（npm 安装的 0.1.2 cohort、profile `web`、Chrome 152、竖屏 390x844 触摸模拟）：

- 插件通过 `ctx.get('layout').toggleSidebar()` 接线（`dsh-remote-web-ui` 用的就是这条路），挂载后调用正常返回、不抛异常。
- 用 `requestAnimationFrame` 采样 `document.querySelector('[data-dsh-frame]').hasAttribute('data-sidebar-collapsed')` 共 800ms（约 50 个样本），该属性自始至终没有变化——两个方向都没动。
- 同一页面里点击官方 logo 行的折叠按钮（`aria-label` 为打开/收起侧边栏的那个按钮），同一属性立刻翻转，两个方向都生效。

影响：任何插件或手势只要走文档化的服务，就无法开/关侧边栏。`dsh-remote-web-ui` 只能把自己的控制顺序倒过来——现在优先驱动官方 logo 行按钮，把已接线的布局面留作回退（见[手机适配记录](../../implemented/bug-fix/2026-09-09-mobile-remote-tap-and-adaptation-fixes.md)）。缺陷本身在 DSH 宿主里，本仓库不得修改，因此本仓库的代码修不了它。

## Proposal

1. **先把复现与证据记在这里**，暂不向上游提报：用户要求在有目标仓库与授权之前先留我们自己的记录。
2. **保留已发布的绕行方案**（优先点官方按钮，布局面作为已验证的回退）。它对 cohort 是稳健的：布局面能用的地方，按钮也能用；没有 logo 行按钮的组合则直接调用布局面。
3. **若宿主修好了**，把该层简化回单次布局面调用，并把这则记录移到 `implemented/`（如果该服务被确认为有意惰性、官方按钮才是受支持控件，则移到 `rejected/`）。
4. **绝不**改动宿主 checkout、不从插件里 monkey-patch 布局服务、也不依赖 `ctx.layout` 之外的宿主内部实现。

## Context & Efficiency Impact

没有运行时或提示词成本：绕行方案已存在且有测试覆盖（`mobile-adapt.spec.ts` 中的 "drives the official toggle first and never waits on the inert layout face" 与 "falls back to the wired face when the official toggle does not flip the frame"）。这则记录只是把测量结果保存下来，避免后续读者重新踩一遍，也让将来的上游报告不必重跑调查。

## Evidence

- 复现：调用已接线的布局面，然后用 rAF 采样 `[data-dsh-frame]` 的 `data-sidebar-collapsed` 共 800ms——每个样本都不变。
- 对照：同一页面里官方 logo 行按钮立刻翻转同一属性（收起→展开、展开→收起各验证一次）。
- 消费方：`packages/dsh-remote-web-ui/src/client/mobile-adapt.ts` 的 `toggleSidebarVerified()`；接线在 `src/client/index.ts`（`ctx.get('layout')`，按契约容忍启动顺序异常）。

## Alternatives considered

- **现在就向上游提报。** 未获授权，也没有给出目标仓库；用户要求先留本地记录。
- **从插件里补丁宿主 checkout 或布局服务。** 禁止：本仓库绝不修改 DSH checkout，monkey-patch 服务也会破坏插件边界、且下个 cohort 就失效。
- **去掉回退、只信任布局面。** 否决：实测惰性，手机上的侧边栏入口会变成死键。
- **去掉布局面、只保留点按钮。** 否决（作为唯一路径）：没有 logo 行按钮的组合将完全没有控件；布局面正是为这种情况保留的回退。
- **每个消费方各记一则。** 否决：这是同一个宿主缺陷、同一套绕行契约；手机适配记录链接到本则即可。

## Acceptance criteria

当已安装 cohort 上已接线的布局面在调用后一帧内翻转 `data-sidebar-collapsed`（或文档化的状态），且该层可以去掉"按钮优先"顺序并同步更新两条 spec 时，本记录移到 `implemented/`。若最终确认该服务是有意惰性、官方 logo 行按钮才是受支持控件，则移到 `rejected/`——此时绕行方案就是文档化路径，而不再是回退。

## Risks

- 绕行方案依赖官方 logo 行按钮的 `_toggle` 类（回退选择器取该行最后一个按钮）；若某个 cohort 把两者都改名，就只剩惰性的布局面，侧边栏入口会失效。包内 spec 覆盖选择逻辑，但不覆盖未来 cohort 的标记变化。
- 在上游报告出现之前，其他插件作者会反复重新发现这个惰性调用，各自再造一套绕行方案。
