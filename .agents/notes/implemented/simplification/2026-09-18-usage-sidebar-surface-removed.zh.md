# Agent Note: Usage sidebar surface removed

Status: implemented

取代 [用量侧栏控件落位入口行](2026-09-17-usage-sidebar-controls-on-entry-row.md) 与 [issue 批次 1587-1600](2026-09-16-issue-batch-1587-1600-fixes.md) 中记录的 #1592 侧栏面：用量侧栏入口、其可折叠面板，以及专为它建立的 entry-core 机制全部移除。用量仍可从设置页一级分区访问。

## 问题

侧栏用量面从未挣得自己的位置。它长期占据一个导航席位——在新会话按钮下方的窄条里与家族插件入口、工作区浏览器争位——只为重复设置分区已经完整渲染的一份 overview。用户对已上线行的判决就是「可以直接移除了」。继续保留它还有超出自身文件的成本：共享 entry core 为承载这一行的刷新与折叠控件，长出了 `actions` 数组、复合容器/主按钮结构、`entryAction`/`entryMain` 样式契约与 `data-dsh-entry-action` 钩子。

## 决策

1. dsh-usage 只保留设置面。删除 `packages/dsh-usage/src/client/sidebar-entry.ts`、`sidebar-entry-core.ts`、`sidebar-panel-mount.tsx`、`UsageSidebarPanel.tsx` 及其 `body-mutations.ts` 副本；`src/client/index.ts` 不再挂载入口行与面板。设置页一级分区「使用统计」、宿主服务、台账、路由与家族共享信任围栏均不受影响。
2. 共享 sidebar-entry core 随其唯一消费方一并去掉 `actions` API：移除 `SidebarEntryAction`、`actions` 选项、`createEntry` 的复合分支、`setOpen` 返回值与动作按钮接线，所有行重新回到经典单按钮结构。`active` 桥保留：dsh-ssh 与 dsh-task-board 仍用它做行高亮。
3. 从 sync 清单中移除 dsh-usage 的 `sidebar-entry-core.ts` 与 `body-mutations.ts` 目标；`usage.sidebar.*` 字典键从 zh/en 字典与 ru 语言包中一并删除。
4. 语义属性契约删除 `sidebar-panel` 与 `sidebar-summary` 两行部件（owner 为 `usage`）；`sidebar-entry` 作为家族行部件保留。用量 README 双语对删除其侧栏条目与摘要句。

## 保留自被取代记录的理由

被移除的面经历过一次控件布局修订，其推理在此保留：未来若再有侧栏行，可能面对同样的取舍，即便这一行已经不在。该修订把面板的刷新与折叠控件移到入口行本身，取代了重复行内「用量」标题的面板头部，以及第二条不持久化的折叠路径（点入口行隐藏容器，头部按钮只收起面板体）。该设计否决了：重排重复头部（一个小面留两个标题怎么改都混乱）、把动作按钮塞进单按钮行（按钮套按钮是非法 HTML，点击路由在 shell 重渲染下变脆）、在 dsh-usage 内 fork entry core（生成副本天然漂移）、行内文字按钮（侧栏惯例是图标按钮，文字会挤爆 36px 导航行）。其后果是折叠态 56px 轨道隐藏动作按钮、折叠时刷新控件仍可用、折叠选择经单一 `localStorage` 键跨刷新保持。它记录的一条环境事实随 spec 一并作废：Node >= 23 时运行时自带的 flag-less `localStorage` 会遮蔽 vitest 中 jsdom 的 Storage，触碰 `window.localStorage` 的 spec 必须自装 standards 形态的内存 Storage 才能通过本地、而 CI（Node 22）保持绿。

## 备选方案

- 把该行落位侧栏底栏（页脚动作下方、设置上方）。实现后否决：该行仍是用户已可到达的设置页的永久副本，只是把拥挤从一个席位换到另一个，没有回答投诉本身。
- 删除整个 dsh-usage 包。用户否决：设置分区、台账与 Token 银行仍被需要。
- 保留面板并用设置项隐藏。否决：可选开关会为没有确定用户的面保留行、面板挂载与 entry-core `actions` API 的维护成本。
- 把已无消费方的 `actions` API 留在共享 core 供未来行使用。按 YAGNI 否决：它是在四份同步副本中的死代码，唯一理由就是这一行；未来行可在需要它的那次改动中重新引入。

## 后果

- 侧栏在宽栏与 56px 轨道中都不再有「用量」行；此前「移到设置上方」的改动随之回退。
- 家族行（dsh-task-board、dsh-ssh、dsh-skill-explorer）保留它们现在共享的面板行几何：shell 的 2px 内缩、12px 圆角、8px 内容内边距、36px 行高、14/22 字号、主墨色，以及 16px 图标盒（折叠轨道 18px）。无 `actions` 的行本来就逐字节一致，因此本次移除不改变它们的渲染。
- 用量 overview 轮询现在只由设置分区的挂载周期驱动；该分区关闭时不再有任何轮询。宠物的用量气泡此前已与该面解耦（见 [宠物解耦记录](../simplification/2026-09-17-usage-pet-decoupling-collapsed-summary.md)），不受影响。
- `dsh-usage.sidebar.collapsed` 不再被读写；遗留的 `localStorage` 值成为惰性数据。

## 测试

- `packages/dsh-usage/tests/`：侧栏相关 spec（`sidebar-entry.spec.ts`、`sidebar-entry-layout.spec.ts`、`sidebar-panel-mount.spec.ts`、`sidebar-panel.spec.tsx`）随该面一并删除；其余套件（设置分区、路由、台账、计价、适配器、票券、服务）原样通过。
- `shared/tests/sidebar-entry-core.spec.ts`：覆盖经典单按钮行——落位、语义属性、幂等、语言刷新与 active 高亮——`actions` 用例随 API 一并移除。
- 三个家族包的 `sidebar-entry-layout.spec.ts` 断言四份行样式共享同一套面板行几何。
- 实机 GUI 证据（Playwright 驱动 Edge 连接正在运行的宿主）：`[data-dsh-usage-entry]`、`[data-dsh-usage-view]`、`[data-dsh-part="sidebar-panel"]`、`[data-dsh-part="sidebar-summary"]` 节点数均为 0；任务看板行与官方面板行报告完全相同的 14,124 与 14,160 盒值，`glyphX` 30、`labelX` 46、16px 图标、12px 圆角、`7px 8px` 内边距、`0px 2px` 外边距、14px/22px 字号；折叠轨道报告 36px/12px 盒值与同 x 的 18px 图标。
- 门禁：`pnpm typecheck`、`pnpm build`、`pnpm libs:check`、`pnpm aggregate:check`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm emoji:check`、`pnpm test:standards`（基线下调重录）与 `node scripts/sync-shared.mjs --check`。
