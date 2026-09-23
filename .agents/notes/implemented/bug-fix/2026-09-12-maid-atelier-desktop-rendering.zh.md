# Agent Note: maid-atelier 输入卡背衬、立绘舞台与统计条

Status: implemented

## Problem

针对 maid-atelier 移植包报告的三个渲染缺陷（#1501，转交自 `Small-tailqwq/dsh-deep-whale#128`）。三者在
同机同样式表的 Chrome 中都正常，只在 DSH Desktop（Electron）下复现：

1. `[data-composer-card]:after`——继承卡片背景的那层背衬——位于 `z-index: 0`。会话开始后它绘制在输入
   文字之上，输入框看起来是空的（占位符、光标与发送都仍正常）。
2. `[data-skin-chrome="character-stage"]` 用 `z-index: -1` 加 `contain: strict` 放置两位女仆。负层级
   是否被绘制取决于该路径上根背景是否被绘制；Electron 丢弃了该层，女仆几乎不可见。皮肤自己的
   `:has()` 规则又在舞台节点存在时关掉了 `body::before/:after` 兜底，两条路同时被堵死。
3. 会话统计条——官方 `StatsPills` 的根节点，标记为 `data-composer-stats`
   （`packages/client/ui-chat/src/client/chat/StatsPills.tsx`）——渲染在
   `[data-slot="conversation.composer"]` 之下，而不在 `.dock` 槽位里。皮肤已有的深浅配色规则因此从未
   命中它，文字继续继承 `--dsw-alias-label-tertiary`（浅色下 #6f7c99）压在浅色表面上。

## Decision

1. 输入卡背衬改为 `z-index: -1`。卡片本身已隔离层叠上下文（`patches.css` 的
   `[data-composer-card] { isolation: isolate }`），因此该层仍绘制在它从卡片继承的背景之上，但不再可能
   位于卡片内容之上——任何引擎下文字都不会被它遮住。
2. 立绘舞台去掉 `contain: strict`，并由 `z-index: -1` 改为 `z-index: 0`。舞台是 `body.prepend` 的
   （`hooks.mjs`），因此同层级的应用定位面板按 DOM 顺序仍绘制在它之上，同时它不再依赖根背景是否被
   绘制。
3. 统计条获得自己的一组配色——浅色 `#33415f`、分隔符 `#7d8aa6`，深色沿用皮肤既有的 `#aebdde`
   （与 `#aebdde80`）——选择器基于官方的 `data-composer-stats` 属性。只改前景色：官方根节点的
   `background` 本就是 transparent，在这里写背景会与皮肤自己的 composer 图层打架。

## Verification

- `node scripts/market-build` 针对改动的资产重建了 `market/dist`
  （`assets/skins/maid-atelier/patches.css`、`assets/skins/maid-atelier.zip`、`styles.js`、
   `tryon-assets/skins/maid-atelier/patches.css`），且 `pnpm market:check` 通过，说明样式表仍能被市场
   构建管线解析与变换。
- `pnpm --filter @linxin666/dsh-client-ui-skin-center test`（39 个文件、637 条测试）与 `pnpm skin-center:check` 通过。`tests/maid-atelier-patches.spec.ts` 在样式表内部钉住三处修复：背衬的 `z-index: -1`、卡片的 `isolation: isolate` 前提、舞台的 `z-index: 0` 且无 `contain`，以及统计条的四条规则。
- Playwright 探针（本机 Edge / Chromium 152）在 composer fixture 上加载真实 `patches.css`：统计条计算色为 `rgb(51, 65, 95)`，说明新规则命中；统计条不在 `[data-slot="conversation.composer.dock"]` 之内，且该 dock 选择器只匹配到 dock 行，说明旧规则本就不可能到达它；舞台计算值为 `z-index: 0`、`contain: none`、`pointer-events: none`。同一张卡片仅改变背衬 z-index 的两张截图展示了机制：`-1` 时裸露的常规流文字正常渲染，原来的 `0` 时被继承来的不透明渐变完全盖住。
- **仍无 DSH Desktop 或实时 GUI 证据。** 运行中的 GUI 确实服务本检出，但缺少其进程级令牌时返回 401，而该令牌被有意未使用；本机也无法复现 Electron 合成器。因此第 2 项仍建立在报告者自己在该环境验证过的绕过方式上，Consequences 中的残留风险依然成立。

## Alternatives considered

把 `#root` 抬到 `z-index: 1`、从而让立绘永远位于应用内容之下被否决：那会形成新的层叠上下文，任何
之后挂在 `<body>` 上、z-index 为 `auto` 或较低的界面（例如宠物等第三方插件）都会掉到应用之下。官方
弹层虽用 1000+，但 body 级节点集合无法在此穷举，因此选择了更小的假设——舞台 prepend、同级面板在 DOM
顺序上更靠后。

删除立绘舞台、只保留 `body::before/:after` 兜底被否决：两条路都是固定全屏层、都依赖负层级，兜底并不
解决 Desktop 的问题，`:has()` 抑制规则也会失去意义。

保留 `z-index: -1`、只去掉 `contain: strict` 被否决：根因（是否绘制根背景）仍在，而报告者的 Desktop
验证只覆盖了把 z-index 提到 0 的组合。

统计条连背景一起改写被否决：官方根节点是透明的，其下的表面来自皮肤自己的 composer 图层，在这里写背景
会与它们冲突；而报告的缺陷是文字对比度。

## Consequences

Desktop 下输入文字不会再被输入卡背衬遮住，女仆不再依赖根背景绘制，统计条在两种主题下都有明确的前景色。
舞台现在位于 `z-index: 0`，理论上应用内**非定位**的常规流内容可能被它底部两角的立绘盖住（舞台本身是
`pointer-events: none`，不会导致任何东西点不到）。待办的 Desktop 与 Chrome 截图比对正是为了关闭这一
残留风险。
