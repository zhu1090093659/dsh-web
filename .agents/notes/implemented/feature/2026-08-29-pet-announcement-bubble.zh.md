# Agent Note: 宠物公告气泡（pet.announce 契约）

Status: implemented

## Problem

宠物的气泡表面全部由内部驱动：互动反馈、按会话活动投影、碎碎念。兄弟插件没有任何途径把一条事实放上宠物——唯一可携带外部文案的钩子是遗留的 `activity/status` 会话事件，它与真实会话活动争抢、受活动词表约束，且机器落定后即消失。使用统计插件恰好需要这个能力：一只专用、特别设计的气泡展示当前提供方的余额或套餐用量（见[使用统计插件](2026-08-29-usage-statistics-plugin.md)）。

## Decision

`dsh-pet` 长出一个面向插件的进程内公告契约：

- **宿主**：`ctx.pet.announce(input)`（`PetService` 的服务方法，而非 HTTP 路由）经 `src/announce.ts` 把载荷校验成有界的 `PetAnnouncement`——必填 `source`/`kind`/`title`，`balance` 必填 `amount`，`plan` 必填 `percent`（收敛 0-100），文本截断、未知字段丢弃、TTL 收敛 1-60 秒（默认 10 秒）；畸形载荷返回 `{ ok: false }` 且什么都不渲染。仅保留最新一条公告，只存内存；`view()` 在新鲜期内带上它，过期公告在下一个轮询周期自然消失，无需定时器。
- **客户端**：公告以自有样式气泡（`styles.bubbleUsage`）挂在会话气泡栈顶部——宠物同族的玻璃样式、色调描边（`ok`/`warn`/`low`）、套餐百分比带微型计量条，并在 TTL 内长驻而不走 2.6 秒反馈气泡的淡出轨道。它与会话气泡共存（column-reverse 使其离精灵最远），并让位于互动反馈。打 `data-dsh-pet-announcement` 标记（semantic-attrs 契约已更新）。

## Alternatives considered

- **遗留 `activity/status` 事件**：合成一条带余额文案的会话事件。落败：它需要附着在真实会话上，机器落定（idle/done/failed）后气泡消失，还会给宠物自己的声线重新调色——账户事实不是会话碎语。
- **HTTP 路由（`POST /api/pet/announce`）**：能让浏览器半区插件也推公告。暂弃：当前没有消费者，回环/配对守卫会为单行功能引入新的鉴权面，且家族规则把跨插件协作归到 cordis 服务；日后补路由是纯增量。
- **通用 slots 气泡槽位**（`pet.bubble` 列表槽）：更通用，但单一事实表面不值得引入槽位生命周期与排序问题。announce 方法让宠物对自己的表面保持权威；若出现第二个消费者，再叠加槽位不迟。

## Consequences

- 公告按尽力而为设计：宠物服务缺失时 `ctx.get('pet')` 为 undefined，调用方静默跳过；畸形载荷永远不会表现为宠物故障。
- 单公告槽意味着第二个公告插件会顶掉第一个的气泡；届时应先升级为按键 map 或槽位，而不是叠补丁。
