# Agent Note: 窄屏抽屉的命中落在抽屉上，而不是 frame

[English](2026-11-06-mobile-drawer-hit-testing.md) | 中文

Status: implemented

## Problem

≤768px 时聚合包 compat 层把侧栏列变成浮层抽屉：`RESPONSIVE_CSS` 里把侧栏面板绝对定位、给 `z-index: 1100`，并在 frame 上以 `::after` 画一层 `z-index: 1050` 的遮罩。抽屉与遮罩此前只按视觉验收过，从未按命中目标验收。

官方布局自己也有 drawer 模式：`.frame[data-sidebar-drawer] .sidebarCol` 声明 `position: absolute; z-index: 71`，`.drawerMask` 声明 `z-index: 70`，而 ui-layout 客户端模块是在运行时通过 `document.head.appendChild` 注入这份样式表的，也就是落在 compat 标签之后。compat 选择器 `[data-dsh-frame] [data-pane="sidebar"]:is([data-pane="sidebar"])` 与官方 `.frame[data-sidebar-drawer] .sidebarCol` 同为 0-3-0，于是层叠把同权重的平手交给了文档顺序：后注入的官方表赢下了这里每一条普通声明。`position` 因为带 `!important` 活了下来，`z-index: 1100` 没有，抽屉的 computed 值是 **71**；而 compat 遮罩以非 important 的 1050 声明、并且保持可命中，正好盖在它本来要压暗的抽屉之上。

伪元素的命中会归到其宿主元素，所以在打开的抽屉内调用 `document.elementFromPoint` 得到的是 frame。上报的现象正是这个形状：抽屉看得见、蒙着一层灰、里面的行全部无响应，第一次点击就被遮罩接收并让抽屉折起（#2013）。手机镜像通过 remote 包报的是同一形状（#2012/#2014）：那边同样有聚合遮罩，而 `mobile-adapt.ts` 的 `ADAPT_CSS` 根本没有声明抽屉层级，只是默默继承了官方表恰好压在顶上的结果。

## Decision

层级契约由拥有它的那条声明决定，而不是由两份被注入的样式表谁先谁后决定。

`packages/dsh-web-all/src/client/index.ts` 保留 0-3-0 选择器上限，并把抽屉的层级声明为 important：在已经 important 的 `position: absolute` 旁边写下 `z-index: 1100 !important`。`:is()` 依旧只负责把特异性抬到皮肤 0-2-2 / 0-2-3 之上；与官方表同权重时的平手由 `!important` 结束。同时，窄屏抽屉规则（`[data-dsh-frame]:where(:not([data-mobile-nav])) [data-pane="sidebar"]:is([data-pane="sidebar"])`）与 `::after` 遮罩都在 `[data-dsh-frame]` 上追加零特异性的 `:where(:not([data-mobile-nav]))`，使之在保持 0-3-0 上限的同时，于同装 `dsh-web-mobile` 且宿主帧带有 `data-mobile-nav="frame"` 时自动让位（#2050），不再以 `1100 !important` 覆盖移动插件抽屉或截留点击。

compat 遮罩继续只做抽屉的压暗，永不成为命中面：同一条 `::after` 上写 `pointer-events: none`。关闭动作保持它既有的两个归属者不变：布局在我方抽屉之下绘制的官方 `.drawerMask`，以及 `installMobileSidebarDismiss` 里捕获阶段对「点击落在侧栏之外」折起抽屉的处理器（见[#1716 关闭行为笔记](2026-09-25-issue-batch-1716-1719-and-ci-unblock.md)），同时在 `sidebar.closest('[data-mobile-nav]') !== null` 时立即返回让位给 `dsh-web-mobile`。

`packages/dsh-remote-web-ui/src/client/mobile-adapt.ts` 在 `ADAPT_CSS` 里声明同一套阶梯：`[class*="_sidebarCol"]{z-index:1100 !important}` 与 `[class*="_drawerMask"]{z-index:1050 !important}`。竖屏面因此不依赖聚合 compat 层（本包也会被单独安装），官方的压暗层留在它所压暗的抽屉之下、它所要变暗的内容之上。没有任何节点被 portal：两层的宿主仍归 React 所有。

## Verification

阶梯的两端在两个包里各有一条聚焦断言：`packages/dsh-web-all/tests/responsive-contract.spec.ts` 断言抽屉层级带 important、遮罩不可命中、且遮罩层级位于抽屉之下；`packages/dsh-remote-web-ui/tests/mobile-adapt.spec.ts` 断言适配层自己注入的那两条规则及其前后顺序。

层叠本身在真实 CSS 引擎里实测（headless Chromium，390x844，竖屏、粗指针），三份样式表按运行中 GUI 的投递顺序加载：本包源码里的 compat 表、`@deepseek-ai/dsh-client-ui-layout` 运行时注入的原样官方布局表、以及 remote 的 `ADAPT_CSS`。对五个抽屉行测中心点：

| 已安装的样式表 | 抽屉 `z-index` | compat 遮罩 | `elementFromPoint` 命中的行 |
| --- | --- | --- | --- |
| 修改前：compat + remote | 71 | 1050，可命中 | 0/5——每行都归到 `_frame` |
| 修改前：仅 compat | 71 | 1050，可命中 | 0/5——每行都归到 `_frame` |
| 修改前：仅 remote | 71 | 无 | 5/5——只是因为官方 71/70 恰好成立 |
| 修改后：compat + remote | 1100 | 1050，不可命中 | 5/5 |
| 修改后：仅 compat | 1100 | 1050，不可命中 | 5/5 |
| 修改后：仅 remote | 1100 | 无（官方 1050） | 5/5 |

修改后三个变体里点击背景命中的都是官方 `.drawerMask`，也就是 issue 要求保留的关闭面。

此处未验证的：390x844 的真实 GUI 过一遍。正在运行的宿主把 URL 放在启动 token 之后，且它的 profile 没有挂 compat 行，所以矩阵里聚合那一半只有引擎级证据；修改后的 GUI 验收由本轮在重建客户端 bundle 之后统一执行。

## Alternatives considered

把抽屉与遮罩 portal 到 `body`（issue 的建议之一）。否决：compat 层只写属性，不得移动 React 拥有的节点——重新挂载侧栏列会破坏布局的 `insertBefore`/`removeChild` 锚点，`inset` 与动画契约也是按 frame 作为包含块写的。

抽屉打开时让 frame 退出命中路径（给 `[data-dsh-frame]` 加 `pointer-events: none`），也是 issue 的建议。否决：抽屉是 frame 的后代，frame 的命中抑制会连抽屉一起冻住，并且会改掉 frame 内所有插件的命中面。

给 frame 加 `z-index: 0` / `isolation: isolate` 让它不再压过抽屉。否决：这仍然把结论留在与顺序相关的平手里，任何后加载的样式表重新声明层级就能重开同一个故障，而 compat 层必须与它无法控制的样式表共存。

改用上报者调试时的数字（`2147483001` / `2147483000`）。否决：那是定位问题时的探针数字，不是边界。聚合已经拥有一个刻意的上限（0-3-0）以及「未来皮肤越过它就是皮肤的 bug」的说明；再加一套临时数字标尺只会把军备竞赛从特异性搬到数值膨胀。

只修抽屉层级、保留可命中的遮罩。否决：行命中会通过，但压暗层依旧吞掉本应落到下方会话区的每一次点击（与 #1829 在 composer 内修掉的是同一形状），而且在官方 drawer 未挂载的 profile 上，一层残留的遮罩会变成唯一的关闭入口。

## Consequences

聚合的抽屉现在真的位于契约一直声称的那一层，因此它在 frame 内压过官方 overlay 层——这正是抽屉阶梯的本意，也是在「布局表后于 compat 标签注入」的宿主上第一次真正成立。压暗层不再吞掉会话区的点击：那些点击到达它们原本的目标，同时捕获阶段的处理器仍旧折起抽屉。

两个包里的两条规则陈述同一组数字；以后调整阶梯必须同时移动两处。remote 侧规则的注释里带着这句话的后半段，就写在聚合自己的 `BOUNDARY` 说明旁边。

聚合包提交了自己的构建产物 `lib/`，所以 compat 这一半只有在 `pnpm build` 刷新之后才会到达页面：在 `pnpm libs:write` 重新记录指纹之前，`pnpm libs:check` 会把已提交的产物判为陈旧。那次重建是交付本改动的组成部分，不是可选项。

剩余上限不变：特异性高于 0-3-0 的皮肤规则仍然赢，正确的修法仍然是那皮肤，而不是这条规则。
