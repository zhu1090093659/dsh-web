# Agent Note: dsh-usage 移除宠物气泡，折叠摘要条承接会话用量

状态：implemented

部分取代 [usage 统计插件](../feature/2026-08-29-usage-statistics-plugin.md)（其宠物联动决策）与 [DeepSeek 峰谷计价与公告修复](../feature/2026-08-29-usage-peak-pricing-and-announce-fix.md)（其公告/气泡部分；适配器身份与折叠时刻计价两项决策仍然有效）。保留 [宠物公告契约](../feature/2026-08-29-pet-announcement-bubble.md) 本身，但它不再有内置消费方。其折叠摘要条随后由 [usage 侧栏面移除](2026-09-18-usage-sidebar-surface-removed.md) 一并删除，该记录亦更新了 [issue 批次 1587-1600](../bug-fix/2026-09-16-issue-batch-1587-1600-fixes.md) 中的 #1592 事实。

## 问题

dsh-usage 通过 `ctx.pet.announce(...)` 向宠物公告当前会话提供方的状态——消费/余额/套餐气泡外加用量回落，由 `bubbleMode` 设置调节。这使 dsh-usage 成为宠物契约唯一的内置消费方，把两个插件耦合在一起：usage 服务背着一整套公告管线（载荷构造、色调映射、TTL 计算、家族消费解析、变更检测签名），设置界面背着宠物气泡下拉框，每次公告修复都要跨包。用户要求解耦：宠物气泡不再显示用量事实，改为在侧栏用量区折叠状态下展示当前会话提供方的今日用量。

## 决策

1. 公告管线整体移出 dsh-usage：`USAGE_ANNOUNCE_SOURCE`、`buildAnnouncement`、`buildLedgerAnnouncement`、`planTone`、`formatMoney`、宿主侧中文计数习惯的 `formatTokens`、`announceCurrent`，以及 `bubbleMode` 配置（schema、`resolveConfig`、设置下拉框、zh/en/ru 文案）全部移除。dsh-pet 不动：其 `pet.announce` 契约继续对任何兄弟插件可用，文档与代码注释不再把 dsh-usage 指名为消费方。
2. overview 文档携带摘要条就绪的当前视图：`current.displayName`（快照优先，其次路由推导）与 `current.today`——该提供方适配器家族的今日台账合计，同一账户的别名路由（`deepseek` / `deepseek-official`）合并计算；今日无用量时缺省。两个字段均可选，旧宿主文档照常渲染；缺字段时客户端从 providers 列表与今日行推导同样的事实。
3. 折叠态下，侧栏面板在入口行下方渲染一行摘要条——提供方名、今日 tokens（沿用分区的 k/M/B `formatTokens`）、调用次数，计价家族附带费用——取代原来的什么都不渲染。无会话提供方或今日无用量时摘要条保持沉默，56px 收缩轨内隐藏。新增的 `sidebar-summary` 部件已登记进语义属性契约。
4. 轮询节奏随表面放松：展开 10 秒、折叠 30 秒，页面隐藏时一律暂停（此前：仅展开且可见时轮询）。折叠瞬间立即刷新一次，让摘要条落在新鲜数据上。
5. 携带 `bubbleMode` 的旧配置无害：schemastery schema 丢弃未知键，无需迁移。

## 备选方案

- 把气泡保留为默认关闭的可选项。否决：耦合本身就是问题——公告管线、它的测试与跨包修复面会为一个默认死去的功能整体保留。
- 把摘要塞进入口行的标签区。否决：入口行是单行导航惯例；摘要条是其下方的独立行，与展开面板同一锚位。
- 摘要条沿用气泡的中文计数习惯（万/亿）。否决：侧栏与设置分区同口径（k/M/B），且宿主不再产出任何展示文案——摘要条由结构化字段与 locale 键渲染。

## 影响

- dsh-usage 与 dsh-pet 不再共享运行时契约，各自独立演进。宠物保留公告契约但失去唯一内置发布方——在下一个插件发布公告前，气泡栈只渲染会话驱动的气泡。
- 会话用量事实从 TTL 限制的临时气泡搬到侧栏的稳定位置，宠物被禁用时也照常可见；代价是折叠且可见时每 30 秒一次 overview 拉取。
- `deepseekPeriodAt` 失去最后一个宿主消费方（分区在客户端自行计算时段），只留在 core pricing 供折叠时刻计价使用。

## 验证

- `packages/dsh-usage/tests/usage-service.spec.ts`：公告相关 describe 移除；新增 current-view describe 覆盖摘要条就绪字段、适配器家族合并、无用量缺省与无会话裸视图。
- `packages/dsh-usage/tests/sidebar-panel.spec.tsx`：折叠摘要条（名称、tokens、调用数、费用）、无用量沉默、旧宿主推导、客户端家族合并，以及放松后的折叠轮询契约。
- `packages/dsh-usage/tests/apply.spec.ts`：`resolveConfig` 不再含 `bubbleMode`。
