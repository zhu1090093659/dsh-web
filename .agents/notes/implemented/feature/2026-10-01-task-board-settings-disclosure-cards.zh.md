# Agent Note: 任务看板设置以折叠主题卡打开

Status: implemented

由 [家族设置卡片带标识与一行文案](./2026-10-01-family-settings-cards-identity-marks-and-copy.md) 补充：两条主题说明与卡片的文案被缩短，电源状态行改为安静的小字；折叠布局本身不变。

由 [新建卡片默认值](./2026-10-14-task-board-new-card-defaults.zh.md) 补充，并由 [移除任务看板的 /goal 运行与任务验收](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.zh.md) 收窄：原运行行为与任务验收主题卡移除后，看板自己的选项为两张嵌套主题卡（基础、新建卡片默认值），排在提供方席位之前；折叠布局本身不变。

## Problem

看板自己的设置卡把所有选项渲染在一个平铺的卡体里：总开关、agent 播报、空闲睡眠保护、子任务深度上限，以及整块任务验收（开关、裁判模型、推理强度与解析后的预览），最后才是 GitHub Issues 扩展贡献进来的提供方席位。

只有提供方贡献的那张卡是可折叠的。看板自己的选项始终可见，因此为了够到一个开关而展开看板卡，会把用户并没有要的文案一股脑摊开，验收区块的长提示还主导了整列版面。

## Decision

设置卡是一列折叠主题卡，也就是任务表单已经在用的版式（[任务表单分区](./2026-09-27-task-board-create-dialog-regions.zh.md)）应用到设置表面。

- 看板自己的选项是两张嵌套的 `PluginSettingsCard` 折叠卡——基础（总开关、agent 播报、空闲睡眠保护、转发代理信任、轮询间隔、子任务深度、启动并发、花费上限）与新建卡片默认值（[新建卡片默认值](./2026-10-14-task-board-new-card-defaults.zh.md)；原任务验收主题卡已于 [2026-11-11](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.zh.md) 移除）——渲染进本来就已经承载提供方席位的同一个列表（`board-settings.module.css` 的 `.nestedCards`）。
- 所有嵌套卡一律默认折叠（`defaultOpen={false}`），看板卡自己的内置主题与 GitHub Issues 区块都一样，设置页因此以一份简短的主题清单打开。
- 嵌套卡带 `hideFooter`：它们落入看板卡的同一份表单，由那一行唯一的保存写入，那张保存按钮也仍是界面上唯一的保存入口。它们的 chrome 状态因此报 `dirty: false`——未保存角标归外层卡头——而 `writable` 跟随表单，只读部署在展开的主题里仍会说明只读。
- 看板卡保留自己的折叠卡头与电源状态行；移动的只是选项。

### Copy

`settings.enabledCardHint` 与 `settings.cardDefaultsCardBrief` 是内置主题描述（zh 与 en 在包内，ru 镜像在 `packages/dsh-i18n`；原 `settings.goalVerificationCardHint` 已随任务验收一并移除）。原有的长字段提示留在它们解释的字段上，因此折叠卡头只有一行描述。

## Alternatives considered

**保留平铺版式，只把验收区块折叠起来。** 否决：用户打开看板卡就是为了总开关，而第一行是一整墙提示文字的页面正是这次报告的内容。

**给每张嵌套卡各自一个保存行。** 否决：这些主题写的是同一个设置命名空间，走同一次原子变更；一份文档每个主题配一个保存按钮会诱发部分保存，也凭空多出一次没有效果的确认步骤。

**把其余看板字段（播报、空闲睡眠、子任务深度）留在第一张主题卡之外。** 否决：它们就是看板自己的运行行为，看板关掉时没有意义；与总开关拆开会在两张卡之间留下孤儿字段。

**另做一个折叠组件，不用共享卡片外壳。** 否决：提供方席位已经在这个列表里渲染共享的 `PluginSettingsCard`，需求也正是要同一种外壳；第二套折叠写法只会与它逐渐分叉。

## Consequences

- 看板卡打开后就是内置主题行加提供方席位与电源状态行；每个主题一次点击可达，各自的字段与提示保持不变。
- GitHub Issues 区块默认折叠，因此它的仓库与凭据摘要需要一次点击才能读到；它对自己命名空间仍保留自己的保存行。该区块内的仓库列表又是它自己的一层折叠（扩展样式表的 `setupDisclosure`，默认收起）：同步多个仓库的部署会把每一行都摊开，把凭据表单与连接测试挤出视线。每行分两行——仓库名与它的「收无指派 / 移除」按钮同行，纳入标签、指派与含无指派的 chip 折到下一行——因为单行时 chip 会被同行的按钮挤压成 `d…`/`@…` 的省略号（`setupRepositoryHead` / `setupRepositoryTags`）。折叠按钮带 `aria-expanded`/`aria-controls`，可访问名包含仓库数量，收起时这些行完全不进 DOM。
- 这次折叠本身不涉及任何存储值、线形字段或账本 schema，也没有新增属于它的设置键：只有呈现方式与新增文案键。
- 覆盖：`packages/dsh-task-board/tests/settings-card-disclosure.spec.tsx` 在 jsdom 里驱动整套折叠（折叠时只有一个卡头、展开后四张主题卡均折叠、每个主题的控件以及提供方席位同处一个列表），`packages/dsh-task-board-github/tests/github-ui.spec.tsx` 覆盖被贡献卡片的默认折叠。
- 单测之外的证据：用一个隔离 home 的宿主（`DSH_HOME=/tmp/dsh-verify`、web profile 的本地聚合、`--port 19400`）经无头 Chrome CDP 驱动，截图存放在 `packages/dsh-task-board/docs/e2e/`（`tb-settings-topics-collapsed.png`、`tb-settings-board-topic-open.png`、`tb-settings-acceptance-topic-open.png`，另附过程记录）。用户自己的宿主从未被重启或重新占端口；刷新页面即可加载重新构建的 bundle。
