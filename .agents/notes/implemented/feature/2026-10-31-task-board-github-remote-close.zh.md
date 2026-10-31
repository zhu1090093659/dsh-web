# Agent Note: GitHub remote close cycles

Status: implemented

本决策部分替代 [GitHub Issues as Task Board work items with controlled write-back](2026-09-30-task-board-github-issues-integration.md)：Issue 发现、受控标签、执行不可变、凭据与 PR 生命周期仍归该 Note；这里引入的有界入站关闭映射取代此前「远端状态绝不驱动本地列」的选择。

## Problem

GitHub 同步已经保存 issue 的 open/closed 状态，却只有新建卡片会按 closed 投影到已完成。既有卡片在 Issue 关闭后仍留在活动列；若不做区分地镜像远端状态，又可能中断真实的本地执行，或覆盖用户有意选择的列。

## Decision

提供方通过可选的 `integrations.github.remoteClose` 元数据为每张卡片持有一个显式关闭周期，并始终经过看板既有的 `tasks.setStatus` 门禁：

- 新发现的关闭 Issue 以已完成建卡并写入 `auto-done` 来源。既有的非 running、未归档卡片先以 `github:remote-close` 移入已完成，再持久化该来源；不创建执行记录。没有来源的既有已完成卡片仍视为人工或历史完成。
- running 卡片记录 `deferred` 与未结算 execution id。执行结算入口在任何网络 await 之前记录实际 `settledStatus`；后续关闭同步只在当前列仍等于该结算列时迁移。缺少 execution 或结算证据时采取保守策略，绝不强制移动。
- Issue 重开会清除本周期。只有仍是已完成且带 `auto-done` 来源的卡片才以 `github:remote-reopen` 回到待办；人工完成、延迟与覆盖状态都不会反转本地列。
- `auto-done` 卡片被移出已完成后，下一次关闭同步转为 `overridden`，在 Issue 重开前保留本地列。之后再次关闭会开启新周期，可以重新自动完成。
- 归档卡片保持归档，停用卡片保持隐藏。列迁移被拒绝时来源保持真实并记录 `lastSyncError`；列迁移后来源写入失败则回滚该迁移，供后续同步重试。重复同步幂等，出站标签与 PR 安全规则不变。

标记在提供方自己的 opaque payload 内归一化，不新增账本 schema 版本、agent 工具字段、Host wire 字段或看板内的 GitHub 专用逻辑。

## Alternatives considered

**把每种远端状态直接镜像到全部五列。** 否决：GitHub 无法表达本地执行会话与权限门，远端编辑绝不能中断 running 卡片。

**总是让最新一次 closed 轮询压过本地移动。** 否决：这会让有意恢复本地工作流的卡片无法留在活动列，用户也无法覆盖过期的远端关闭。

**只凭当前已完成列推断自动完成。** 否决：重开时会误移人工完成的卡片；执行结算事件缺失时，还可能移动已经再次改列的卡片。

## Consequences

- 远端关闭可以收敛看板，同时不削弱 Host 对运行中工作的权威。人工覆盖恰好持续一个关闭周期，而不是永久隐藏标记。
- 既有已完成卡片默认安全，因为只有显式 `auto-done` 来源参与重开迁移。
- 轮询与手动刷新保持既有节奏；本决策不新增 webhook、远端关闭/重开写入、调度变化或执行结果。

## Testing

`packages/dsh-task-board-github/tests/remote-close.spec.ts` 以契约级 fake board 和远端后端驱动真实同步服务，覆盖新建与既有关闭 Issue、幂等、人工完成、覆盖与新关闭周期、三种结算结果、结算后人工移动、结算前重开、证据缺失、归档与非法来源；既有投影和标签安全套件同时运行。
