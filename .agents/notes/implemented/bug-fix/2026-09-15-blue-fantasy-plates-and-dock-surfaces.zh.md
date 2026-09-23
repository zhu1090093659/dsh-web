# 智能体笔记：蓝幻想可读性托底、队列 dock 表面与右侧面板

Status: implemented

## 问题

2026-09-14 报告的三处缺陷（#1571、#1572、#1573）都指向蓝幻想可读性层（2026-09-11 落地：`75bd994e`、`5c7c9c92`、`48984e6d`）之后交付的代码。该层当时没有留下决策记录——规则只以注释形式存在于 `skins/blue-fantasy/patches.css` 中——因此它隐含的约束从未写在后继改动会去查的地方。

1. **提示气泡飞离按钮（#1571）。** `patches.css` 给回合尾部操作行（复制/点赞/点踩/重新生成）同时加了 `background` 与 `backdrop-filter`。壳层把每个图标的提示气泡渲染成该行**内部**的 `position: fixed` span：`ui-primitives/Tooltip.tsx` 有意不用 portal（"Fixed positioning lets the bubble escape ancestor overflow clipping without a portal"）。`backdrop-filter` 与 `filter`、`transform` 一样会让元素成为其 fixed 后代的包含块，于是气泡以该行为基准排版——实测距按钮 719px，而视口只有 874px 高，气泡被推到屏幕外。
2. **队列 dock 画了两层表面（#1572）。** 共享壳层适配器把 `conversation.input.dock` 的每个直接子元素都当作配件面（`--dsh-composer-accessory-bg`，回退 `--dsw-specific-tip`）。原生 `QueueDock` 的根元素只提供 dock 内缩（`padding: 0 var(--dsh-composer-dock-inset)`，8px），而内层 panel 自己也画同一个 `--dsw-specific-tip` 底色，于是外壳多垫了一层不透明白板，每边比 panel 宽 8px。
3. **右侧面板叠了两层，分割线差一档（#1573）。** `[class*="rightbarCol"] [class*="panel"]` 是子串匹配，而壳层的 `panelBody` 是类名含同一子串的嵌套元素，两个 0.75 叠加后等效 0.94。壳层给左栏边框用 `--dsw-alias-border-l3`，却给该面板的 `border-left` 用 `--dsw-alias-border-l4`，两条竖线因此看起来深浅不同。

## 决定

1. 尾部操作行的托底改由 `::before` 层绘制（`position: absolute; inset: 0; z-index: -1`）；行本身只保留 `position: relative`、内边距、圆角与 `fit-content` 宽度。`inset: 0` 精确复现原先背景填充的内边距盒，所以托底、行几何与图标位置都不变，而行不再建立包含块。**承接规则：包裹壳层提示气泡锚点的托底必须用伪元素绘制，不能画在元素自身。** 回合状态行的托底原本就是这个形态。
2. `shell-rendering.ts` 为 `[data-queue-dock]` 增加例外，只对该子元素复位配件面（背景、边框、圆角、阴影、backdrop-filter）——与既有的目标栏（goal dock）例外同形。队列 panel 仍是唯一一层，外壳保留内缩，因此 panel 继续与输入卡对齐。待办与统计 dock 不受影响：它们的底色要么画在同一元素上，要么确实依赖配件填充。
3. `patches.css` 在亮暗两套规则里排除 `panelBody`，并把右侧面板的 `border-left-color` 接到左栏使用的 `--dsw-alias-border-l3`。l4 这个 token 本身不动，因为还有其它消费方共用它。
4. 可读性层依赖但从未记录的两条约束在此写明为已交付事实：上述伪元素规则，以及窗口外框的固定密度（会话顶栏与右侧面板维持固定 0.75 基色，不跟随 `--dsh-skin-bubble-alpha`，因为它们是外框而非气泡）。

刻意不改：托底本身（它保证图标与正文压在插画上仍可读）以及外框密度。

## 测试

- `pnpm --filter @linxin666/dsh-client-ui-skin-center test`：40 个文件、648 个测试通过，其中包含新增的"适配器输出队列 dock 复位"断言。
- `pnpm typecheck`、`pnpm -r --workspace-concurrency=1 test`、`pnpm test:scripts`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm sync-shared:check`、`pnpm runtime-deps:check`、`pnpm aggregate:check`、`pnpm libs:check`、`pnpm skin-center:check`（内含 `skin-hooks:check`）与 `pnpm market:check` 全部通过。本机并行执行的 `pnpm test` 存在时序抖动：两次分别在不同包的时序敏感用例上失败（`dsh-doctor` 的锁心跳、`dsh-task-board` 的 claim provenance），这两条单独跑与串行跑都通过；与本改动无关——本改动不涉及这些包加载的任何代码。
- `pnpm build` 重建了已提交的 bundle；`node scripts/market-build` 重新生成了 `market/dist`（皮肤 zip、`styles.js`、试用资产）；`pnpm libs:write` 重新记录了四个 `lib/` 的指纹。
- 本次改动**没有**采集 GUI 视觉证据。两点环境事实决定修复如何到达运行中的 GUI：`$DSH_HOME/skins/<id>` 下的用户安装副本会遮蔽包内置资产，因此仍持有旧安装副本的 GUI 会继续用旧 CSS，直到该副本被重装或删除；队列 dock 的规则位于客户端 bundle，运行中的宿主按已安装包提供该 bundle。因此视觉验证需要先刷新已安装副本再重载 GUI（若 bundle 未重载则重启宿主），并在亮暗两态下检查尾部操作行提示气泡、输入框上方的队列 dock，以及右侧面板与左栏竖线。

## 备选方案

- 直接去掉尾部操作行的托底。否：图标压在鲸鱼插画上，托底正是保证可读的手段，去掉等于用一个定位缺陷换回可读性层本来要修的那个缺陷。
- 用选择器把提示气泡排除在外。否：`position: fixed` 是气泡自身的声明，外壳上的任何规则都无法取消外壳建立的包含块。
- 把 `--dsw-specific-tip` 全局调向半透明以消除队列光圈。否，理由已记录在[wallpaper-exclusive 队列 dock 笔记](./2026-08-24-wallpaper-exclusive-queue-dock-chrome.zh.md)：光圈来自外壳自身的表面，全局重映射会泄入该 token 的无关消费方。
- 只在蓝幻想皮肤内修队列 dock。否：多出来的那层与皮肤无关（外壳表面相对 panel 底色永远是多余的），应由共享适配器承担。
- 把 `--dsw-alias-border-l4` 改成与 l3 同值。否：l4 还被其它边共用，而不一致的只是这一个面板的 `border-left`，所以覆盖范围就限定在那里。
- 给答题卡与计划复核卡补毛玻璃、把输入区配件模糊与顶栏并入遮挡变量、重做提示气泡与 hover 卡片配色（#1569、#1570、#1574）。已在 issue 中带源码证据回绝，理由留在对应讨论串。

## 影响

- 仍把 `backdrop-filter` 画在元素自身的托底——markdown 块、代码块、工具行、折叠行、回合处理行、产物行、用户气泡——都是 #1571 的潜在复现点。本次审计未在其中发现已交付的提示气泡锚点：在所查壳层里，会话行内使用 `Tooltip` 的只有 `ui-chat` 的 `MessageIconActions` 与 `ui-message-feedback` 的 `MessageFeedbackActions`，两者都在本次修好的操作行内；markdown、工具、产物与提问相关包都不渲染提示气泡。今后若有新元素在托底内放提示气泡，必须先把托底改成伪元素。
- 子串托底选择器仍是子串匹配；将来只要壳层新类名"含有"这些子串同样会被刷上托底，这正是 #1573 的失效模式。新的托底规则应锚定直接子关系或精确属性。
- 两条竖线现已一致。底部面板右缘压住右侧面板边界的 1px（#1573 剩余部分）属于上游 docking kit 布局，保持不动。
