# Agent Note: Task board source grouping

Status: implemented

本决策以可选浏览器能力扩展 [Task Board external provider extension contract](2026-09-30-task-board-extension-contract.md)，并部分替代 [Task Board Card Scanability](../feature/2026-10-03-task-board-card-scanability.md) 只按列分组的呈现方式。

## Problem

看板接入多个仓库后，每个状态列都混合了不同来源的卡片。仅按时间分组无法表达仓库归属；即使已有密度切换和最早时间组折叠，几百张同步卡片堆在已完成列里仍然难以浏览。

## Decision

浏览器客户端契约新增一个 API v1 可选能力：

```ts
interface TaskBoardSourceGroup { id: string; label: string }
type TaskBoardGroupingSelector = (task: TaskRecord) => TaskBoardSourceGroup | undefined
registerGrouping?(selector: TaskBoardGroupingSelector): () => void
```

- 看板 controller 与 client service 会重放 attach 前的注册，在注册和注销时通知，并保证 disposer 在 attach 后仍能撤下已生效注册。第一个返回有效分组的 selector 认领卡片；selector 失败时回退到本地组。这些函数只存在浏览器内存。
- GitHub 解释自己的 payload，返回大小写稳定的 `github:owner/repository` id 与原始完整 `owner/repository` 标签。看板只消费通用 id/label，不学习 GitHub 词汇。
- 五个主列与归档按来源分组，来源组按完整标签和 id 排序，未认领卡片进入本地化的「本地任务」组并排最后；空组不渲染，拖放仍是列级操作。
- 待规划、待办、进行中在来源组内保持卡片顺序；已完成、已失败与归档在来源组内保留时间分组，超过 30 张时最早时间组的折叠按列和来源隔离。
- `dsh.taskBoard.sourceGroupFolds.v1` 保存视图/来源布尔覆盖。已完成的来源组默认折叠，其他主列与归档默认展开；文本或标签搜索强制展开所有含命中卡片的组，并禁用时间组折叠。
- 来源容器复用 `card-group` 与 `card-group-toggle`；只有内层时间组携带 `data-group=today/week/earlier`，因此不修改语义属性枚举或卫星仓契约。

## Alternatives considered

**让看板直接读取 `integrations.github.owner` 与 `repository`。** 否决：这会把通用看板重新耦合到一个提供方，破坏 opaque payload 边界。

**在账本或 Host snapshot 中增加类型化来源字段。** 否决：这是浏览器可以推导的展示元数据，持久化迁移和更宽的 wire 契约并不能带来正确性收益。

**只提供仓库筛选或虚拟滚动。** 否决：筛选无法同时比较多个仓库，虚拟滚动仍要求读者翻过相似卡片，而不能折叠整个来源。

## Consequences

- 提供方无需提升看板 API 版本或修改 Host 即可增加来源分组；旧看板只是缺少可选方法，提供方的其他席位照常工作。
- 已完成初始只渲染来源标题与数量，搜索则绝不会把命中藏在折叠里；偏好仍按浏览器保存。
- 分组在渲染期间执行，因此 provider selector 必须廉价、纯函数，并使用带提供方命名空间且稳定的 id 供折叠持久化。

## Testing

纯来源分组测试覆盖排序、本地回退、异常 selector、默认值与持久化；客户端能力测试覆盖 pending 重放、首个认领者与挂接后注销；看板视图测试覆盖五列、归档、已完成折叠、搜索展开、按来源隔离的时间折叠与既有拖放；GitHub 测试覆盖大小写稳定的仓库分组和缺少可选方法时的运行。
