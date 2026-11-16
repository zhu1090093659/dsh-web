# Agent Note: compat 移动契约镜像官方抽屉资格

[English](2026-11-16-compat-mobile-eligibility-mirrors-official-drawer.md) | 中文

Status: implemented

## Problem

聚合 compat 层（`web-ui-compat`，`packages/dsh-web-all/src/client/index.ts`）在 `@media (max-width: 768px)`——含边界值——于所有平台套用移动布局。官方布局的抽屉判定不同：`ui-layout` 的 `AppFrame` 计算 `drawer = viewport < SIDEBAR_DRAWER_BREAKPOINT && !windowsTitlebar`，其中 `SIDEBAR_DRAWER_BREAKPOINT = 768`，`windowsTitlebar` 即 `document.documentElement.hasAttribute('data-windows-titlebar')`。因此 Windows 桌面外壳在恰好 768 CSS px 以及更窄的任何宽度都保持三栏桌面网格。

Windows 125% 缩放下靠边分屏到恰好 960 物理 px（768 CSS px）的窗口命中含边界的查询：compat 表强制 `grid-template-columns: minmax(0, 1fr) !important`，把侧栏变成绝对定位抽屉，并改写会话标题栏网格。侧栏收起后 frame 留着 1fr 空轨道（约 454px），对话列被压到约 314px 贴在右缘，标题栏「新建会话」按钮消失（#2054）。关闭 `web-ui-compat` 即恢复官方布局；大于 768px 的宽度不受影响。同一错配也存在于 Windows 桌面外壳低于 768px 时——官方在那里根本不进抽屉模式。

## Decision

compat 移动契约在 CSS 与 JS 两半都镜像官方资格。

- **断点严格小于 768。** 两个移动媒体块都用 `@media (max-width: 767.98px)`。0.02px 写法是 `< 768` 在本表既有浏览器下限内的亚像素安全形式：本表已要求 `:has()`（Safari 15.4+），而区间语法 `(width < 768px)` 会把下限抬到 Safari 16.4。常见 Windows 缩放系数下 CSS 宽度步进恰好落在 768.0，0.02px 带永远不会是上报的边界。
- **每条移动规则都带桌面标题栏守卫。** 两个块里每个选择器头都加 `:where(html:not([data-windows-titlebar]))` 前缀。`:where()` 贡献零特异性，因此[抽屉命中笔记](2026-11-06-mobile-drawer-hit-testing.md)拥有的 0-3-0 上限不动，与皮肤及官方表的层叠关系不变。守卫覆盖整个移动契约——网格、抽屉、收起轨道、details 浮层、标题栏行、composer 与触控目标——因为官方桌面外壳在任何宽度都保持桌面布局，而不只是在边界值。
- **折叠处理器问同一个问题。** `installMobileSidebarDismiss` 在 `document.documentElement.hasAttribute('data-windows-titlebar')` 时提前返回，其 `matchMedia` 门槛用 `(max-width: 767.98px)`。捕获阶段的折叠因此永不折叠桌面侧栏，与 CSS 一致。

## Alternatives considered

- **只收紧断点。** Windows 桌面外壳在低于 768px 的任何宽度仍被强制进抽屉布局，而官方在那里保持三栏。
- **只加标题栏守卫。** 非 Windows 窄视口在恰好 768px 仍命中含边界查询，而官方 `viewport < 768` 在那里为假。
- **不用 `:where()` 的 `html:not([data-windows-titlebar])`。** 给每条移动规则加 0-1-1，打破成文的 0-3-0 上限，重新打开抽屉笔记已了结的皮肤/官方层叠之争。
- **CSS 嵌套包装。** 嵌套需要 Chromium 112+/Safari 16.5+，高于本表的 `:has()` 下限；显式零特异性前缀只用本表已依赖的特性。
- **标题栏下更高特异性的重置块。** 抽屉笔记明确否决的中和剂军备竞赛；守卫让每条声明只有一个归属者。

## Consequences

- compat 移动布局恰在官方进抽屉模式时套用：低于 768px 且永不在 Windows 桌面标题栏下。边界以下的手机与窄浏览器行为不变，包括 `dsh-web-mobile` 让位（`:where(:not([data-mobile-nav]))`）与抽屉层级阶梯。
- `dsh-web-all` 提交构建产物 `lib/`，因此修复只有在 `pnpm build` 刷新它、`pnpm libs:write` 重录指纹后才到达页面；这次重建是交付本改动的一部分。
- 两个媒体块与 JS 门槛陈述同一资格；将来改断点必须三处一起动，`responsive-contract.spec.ts` 逐一钉住。

## Verification

`pnpm --filter @linxin666/dsh-web-all typecheck` 与 `test`（`responsive-contract.spec.ts`，20 个用例）：严格查询及其计数、每个移动选择器头带标题栏守卫、折叠处理器在标题栏属性下让位、门槛问严格查询。

层叠在无头 Chromium 里对 shell 形状帧实测，帧带官方桌面内联网格 `260px minmax(0, 1fr) 300px`，compat 表取自本包源码（After）与 `git show HEAD:`（Before），deviceScaleFactor 1：

| 视口 | `data-windows-titlebar` | Before 网格 | After 网格 | 官方抽屉 |
| --- | --- | --- | --- | --- |
| 768 | 无 | `768px` 单栏 | `260px 208px 300px` | false |
| 768 | 有 | `768px` 单栏 | `260px 208px 300px` | false |
| 767 | 无 | `767px` 单栏 | `767px` 单栏 | true |
| 767 | 有 | `767px` 单栏 | `260px 207px 300px` | false |
| 700 | 无 | `700px` 单栏 | `700px` 单栏 | true |
| 700 | 有 | `700px` 单栏 | `260px 140px 300px` | false |

侧栏在所有 Before 行以及移动契约套用的 After 行 computed 为 `position: absolute`；在三栏 After 行保持 `static`。上报场景（768px、标题栏、收起）的截图显示 Before 的单栏抽屉布局与 After 完整的桌面网格。实时 GUI 验收需要重建后的聚合包被挂载（宿主重启），因此留给用户确认，不在此声称已验证。
