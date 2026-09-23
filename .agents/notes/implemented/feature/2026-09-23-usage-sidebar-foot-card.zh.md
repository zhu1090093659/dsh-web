# Agent Note: Usage sidebar foot card

Status: implemented

部分被 [用量速览卡移到「设置」行上方](2026-09-23-usage-foot-card-above-settings.md) 取代：卡片现在位于「设置」行上方；DOM 挂载的决定不变。

部分取代 [用量侧栏面移除](../simplification/2026-09-18-usage-sidebar-surface-removed.md)：侧栏入口行、其可折叠面板与 entry-core `actions` API 保持移除，但侧栏重新拥有用量面——一张落位在 shell「设置」行下方的紧凑速览卡，应用户明确要求加入。

## 问题

2026-09-18 的移除让用量 overview 只能从设置分区到达：侧栏里再无价格信号，而用户要求卡片回归——重新设计、放在左下角设置下方。难点在于回应这一诉求时不重新引入移除所否决的东西：一行重复设置页的永久导航位、一套常驻可折叠面板，以及只为该行存在的 entry-core `actions` 机制。

## 决策

1. 新面新形态：`packages/dsh-usage/src/client/UsageFootCard.tsx` 渲染一张安静的卡片，两个跨刷新保持的状态——展开（默认）：价格优先的头条（今日消费估算 CNY；今日无可计价用量时回落为 tokens 总量；再否则零值行）、tokens/调用次数行、最多两个已配置 provider 的余额（超出折叠为 +N 标记），以及更新时刻页脚；折叠：一行摘要条（仪表盘 glyph、消费提供方解析后的名称、标签与头条值；提供方取今日 cost 所在行，否则当前会话路由）。右上角箭头经单一 `dsh-usage.foot-card.collapsed` localStorage 键切换状态。卡片主体是单个 `<button>`；点击重放用户自己的设置路径（`foot-card-mount.tsx` 的 `openUsageSettings`：激活侧栏「设置」触发器，再点击携带本分区本地化标签的导航行——已打开的面板永不被反向关掉，找不到行时面板停留在默认分区）。细节只活在设置分区：卡片不带刷新钮、不带页签。主体按钮与箭头是兄弟节点——按钮套按钮是非法 HTML，正是退役入口行的复合 actions API 长出来的那个坑。
2. 落位设置下方（部分被取代：容器现在插在设置座正上方）：shell 底栏在 `sidebar.settings` 之下没有槽位（`sidebar.footer.action` 只叠在其上方），因此 `foot-card-mount.tsx` 把容器追加为底栏末位子节点，并经共享 body-mutation 枢纽自愈——shell 重渲染后归位、整栏重建后重新锚定。容器是带自有 React 根的纯 DOM，从不干扰 shell  reconciliation；DOM 级幂等保证重复 apply 只挂一份。dsh-usage 的 `body-mutations.ts` 目标回到 sync-shared 清单（sidebar-entry-core 目标不回归——入口行不存在）。
3. 共享数据、宽松节奏：卡片读 apply 体为设置分区接好的同一 store 与轮询路径（序号守卫吸收交错调用），并运行自己的 30 秒可见标签页轮询，因为侧栏底部是常驻挂载。`enabled` 为 false 时、以及 overview 端点回答 404（宿主半区关闭）时渲染 null；其他传输失败保留上一份快照，首次成功前则显示一行安静的错误文案。
4. 折叠 56px 栏轨经 `data-sidebar-collapsed` 祖先门隐藏卡片，与旧摘要条的栏轨行为一致。
5. 语义属性：卡片输出 `data-dsh-plugin="usage"` / `data-dsh-part="foot-card"`，外加裸值 `foot-card-main` / `foot-card-toggle` / `foot-card-strip` / `foot-card-usage` / `foot-card-balances` 部件行；契约增加这些行，usage 插件行中已过时的 `data-dsh-usage-entry` / `data-dsh-usage-view` 锚点随之移除。
6. 文案：新增五个 zh 键（`usage.foot.cost`、`usage.foot.noData`、`usage.foot.open`、`usage.foot.collapse`、`usage.foot.expand`），en 镜像与 ru 语言包同步；其余复用既有键。

## 备选方案

- 注册进 `sidebar.footer.action` 槽（设置上方）。按落位否决：用户要求的是设置下方，而该槽只叠在设置座上方；DOM 挂载还让卡片独立于槽注册顺序，代价是自带自愈逻辑。
- 以 git revert 复活被移除的入口行加可折叠面板。否决：那正是移除记录退役的设计——一个重复设置页的永久导航位，外加 entry-core `actions` 机制。速览卡回应同一诉求而不带回重复面。
- 在卡片上放刷新动作（旧行有）。否决：正是这个控件让 entry core 长出复合 actions API；整卡点击直达设置分区（刷新钮在那里）加上 30 秒轮询已覆盖需求。折叠切换不受此规则约束，因为它与主体按钮是兄弟节点而非子节点。
- 复用退役面板的 `dsh-usage.sidebar.collapsed` 存储键作为摘要条开关。否决：移除记录已宣告该值惰性，复用会把九月的折叠选择静默继承到语义不同的新面上；新键 `dsh-usage.foot-card.collapsed` 从零开始。
- 栏轨态渲染紧凑徽标而不是隐藏。按噪音否决：56px 栏轨放不下可读的价格文字，且栏轨已把每个插件挤成图标。

## 后果

- 侧栏重新承载用量，形态是速览加入口：宽栏在设置上方，栏轨缺席。移除记录的「无入口行」事实仍然成立；其「分区关闭时零轮询」的后果终结——插件启用期间，速览卡在页面可见时以 30 秒轮询。
- `openUsageSettings` 是 shell-DOM 重放（触发器点击加本地化导航行匹配），不是 SDK API：shell 若改掉设置座类名或导航结构，点击退化为无动作，永不报错。
- 插件停用或宿主关闭期间卡片容器保持挂载但为空；重新启用无需刷新即可重绘。
- README 双语对、包描述、语义属性契约与 ru 语言包随本改动一并更新。

## 测试

- `packages/dsh-usage/tests/foot-card.spec.tsx`：内容规则（消费头条、tokens 回落、零用量日行、余额上限与溢出、未配置 provider 排除）、点击直达、语言切换、折叠往返（摘要条内容、消费提供方名称与其在 tokens 回落态的不出现、持久化开关、重挂载恢复、摘要条点击直达、折叠态加载占位），以及可见性门（停用、404、错误行、保留旧快照）。
- `packages/dsh-usage/tests/foot-card-mount.spec.tsx`：落位于设置座上方、重复挂载空操作、卡片与设置之间插入节点及整栏重建后的自愈、dispose，以及设置导航重放（打开面板并选中用量行；永不反向关闭已打开的面板；不点外部行）。
- 实机 GUI 证据：记录在本改动的交付报告中。
