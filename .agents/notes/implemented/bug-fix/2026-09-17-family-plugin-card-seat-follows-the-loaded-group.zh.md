# Agent Note: Family plugin cards resolve their seat from the loaded settings group

Status: implemented

## Problem

全新安装的 dsh-web 里，「Web 插件」设置页只渲染出标题、描述，其余一片空白。该分区声明了自己的子槽位 `web-ui.plugin.item`，槽位树里也确实有这个槽位，但槽位里一条 entry 都没有——家族配置卡片（任务看板、远程访问、梁神模式等）在界面里完全不可达，且没有任何报错。

两个各自看起来正确的既往决定叠加，产出了这个空页面：

- [Issue batch 1587-1600 fixes](2026-09-16-issue-batch-1587-1600-fixes.md) 让每张家族卡片先问宿主「哪个插件卡席位存在」，并在官方 keyed 槽 `settings.plugin.item` 已声明时优先选它。这条规则来自 issue #1589：只装家族插件、不装 `dsh-web-settings` 的 profile 当时没有任何可达的卡片。
- harness 的 web bundle 内建了 `ui-settings-plugins`，其 `configurable` 标签页无条件声明 `settings.plugin.item`，且早于任何外部插件的 `apply()` 执行。

于是在家族分组唯一存在的那个部署里，探测回答「官方席位已声明」，每张卡片都去了官方「插件」页，而分组自己的分区永远没有内容可渲染。卡片并没有丢失——它们在 设置 → 插件 → 插件配置 里渲染正常——但那个唯一目的就是承载它们的分区永远填不满。任何插件顺序都得到同一结果，因为官方声明必然先于外部插件代码。

## Decision

席位选择以设置分组**已加载**为判据，而不是以官方席位**已声明**为判据。`installPluginCard`（`shared/client/settings/plugin-card-seat.ts`）在 `ctx.get('webUiSettings')` 返回有效值时注册进家族 list 槽 `web-ui.plugin.item`，否则注册进官方 keyed 槽 `settings.plugin.item`。

`webUiSettings` 是 `dsh-web-settings` 加载期间发布的服务，每个家族插件本就为读取设置作用域而访问它，因此该探测不引入新的耦合，也不会被「harness 改动了官方席位的声明方式」这类变化误导。

判据在每次 `slots/changed` 时重新求值，因为分组可能在本插件之后应用（聚合把它排在前面，单独安装分组的 profile 则不然）。初始贡献进官方席位，分组注册分区后立即迁到家族席位；替换注册前先释放原 entry。迁移带重入闩锁：registry 在 `register` 内部与上一条 entry 的 disposer 内部都会同步发出 `slots/changed`，无保护的重算会在迁移途中重入自身，把卡片重复注册进它正要离开的席位。

## Alternatives considered

- **用 `slots.inject('web-ui.plugin.item', …)` 探测家族席位的实时声明**（#1589 之前的家族做法）：否决。它重新引入 #61/#62 报告过的加载顺序缺陷——插件先于分组分区应用时回调永不触发、静默不贡献任何卡片；而且 `inject` 观察不到「声明塌缩后又重建」。
- **用家族席位的 entry 数量作为「分组是否在渲染」的信号**：否决。分组的分区先注册 entry、后声明子槽位，因此数量为零同时也描述了「分组正在加载中」，该探测会在它本要检测的那个部署里回答「没有分组」。
- **同时注册进两个席位，交给渲染器选择**：否决——槽位只能有一个父级，第二次注册必然抛错；且侧栏/对话框会在已经列出内置卡片的标签页里重复显示家族卡片。
- **把 `web-ui.plugin.item` 改名回去／去掉家族席位只保留官方席位**：否决。这等于删掉分组自己的一级分区，而那是文档化的产品面；分区、导航项与家族文案都是为承载这些卡片而存在的。
- **让 `dsh-web-settings` 在必然早于外部插件的时点声明家族席位**（#1589 之前的家族设计），作为唯一机制：否决。只装家族插件、不装分组的 profile 就完全不可达卡片——正是 #1589 报告的空缺。

## Consequences

- 全新安装下「Web 插件」分区重新渲染出家族卡片，官方「插件」页只保留自带卡片与插件管理标签页。
- 只装家族插件、不装 `dsh-web-settings` 的 profile 仍可经官方 keyed 席位触达每张卡片，#1589 的结论得以保留。
- 卡片跟随分组适应任意应用顺序：后装分组会把卡片迁进分区，无需刷新。
- 五个已发布插件（remote-web-ui、task-board、doctor、tool-describe-image、liangshen）经同一份生成的共享模块一起改变席位行为。
- 席位每张卡片只判定一次，仅在席位变化时重新判定；因此「分组已加载但分区始终未注册」会把卡片留在官方席位，而不是来回抖动。

## Testing

- `packages/dsh-remote-web-ui/tests/plugin-card-seat.spec.ts` 钉住：分组已加载时（即便官方席位也声明了）注册进家族席位、分组缺席时注册进官方席位、分组后到时从官方席位迁到家族席位、席位不变时重算为空操作、被拒注册的告警，以及两个探测的回落分支。
- `packages/dsh-remote-web-ui/tests/remote-entry.spec.tsx` 断言分组服务存在时卡片落进 `web-ui.plugin.item`，并保持侧栏入口的生命周期断言不变。
- 在已发布的 web profile 上做真实 GUI 验证：设置 → Web 插件 列出 远程访问设置 / 任务看板 / 梁神模式，且卡片可展开出完整表单；设置 → 插件 → 插件配置 只列出 上下文 / 终端 / Agent 循环 / Subagent / 网页搜索；浏览器控制台没有被拒注册的告警。
