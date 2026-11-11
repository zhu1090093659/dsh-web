# Agent Note: 任务执行以 dsh 内置的 /goal 起步

Status: implemented

已被[移除任务看板的 /goal 运行与任务验收](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.zh.md)取代：两级 `/goal` 开关（`goalRunEnabled` 与 `TaskRecord.goalRun`）、`/goal` 命令派发及 `session/projections` 目标阶段结算均已移除；看板每次执行现均为普通单回合运行，v7 账本旧行中的 `goalRun` 字段在加载时被忽略并丢弃。下文保留 2026-09-27 当初的设计档案，不再代表当前行为。

## 问题

看板的一次执行就是一条 DSH Prompt：runner 新建（或复用）会话、应用钉住的权限与模型、把任务文本入队，会话只跑一个回合，看板就凭该回合的 `turn/end` 结算。因此需要多轮推进的长任务——正是 dsh 自带 goal 能力的适用场景——在第一个回合力竭时就此半途而废：看板上没有任何机制让工作继续，卡片却把才刚起步的任务报成成功。

dsh 已把缺失的机制作为内置 `/goal` 命令提供（持久目标 + 目标轮次驱动器：agent 一旦空闲就排入下一轮，直到 agent 标记目标完成或被阻塞）。看板此前从未使用它。

## 决策

历史上（已于 2026-11-11 移除；旧行残留的 `goalRun` 现已在加载时忽略并丢弃），任务行曾携带可选字段 `goalRun?: boolean`，由原新建任务对话框与详情页复选框编辑；最初设计默认开启（后改为默认关闭并最终整体移除）。

### 启动

- `HostExecutionRunner.pinAndPrompt` 先入队任务 Prompt，再在其后武装 `/goal <objective>`，新建会话分支与复用会话分支都如此。指令回合因此与改动前的 Prompt 逐字节一致，目标是在其上续跑，而不是取代它。
- 目标文本就是会话收到的同一份组合 Prompt（`promptText`，含各种前言），续跑轮次推进的正是卡片写明的那件事。
- `goalObjective` 规避命令自身的语法：`/goal` 解析器会把恰好为 `clear`/`pause`/`resume`/`edit`（不区分大小写）或形如 `edit <...>` 的开头当作目标操作，因此这类目标会加上中性前缀。任务 Prompt 为「edit the README」时武装的是 `Goal: edit the README`，而不是去编辑一个无关目标。
- 目标命令被拒绝或未被确认时在宿主控制台告警，本次执行照常作为单回合普通运行继续。武装是对用户已请求执行的修饰，不是 fail closed 的钉住：因为目标模式不可用就丢掉整次执行，会连同 Prompt 已承载的工作一起作废。

### 结算

- `HostExecutionRunner.inspect` 即将凭一个已完成回合结算某次执行时，会读取 `session/projections`：目标为 `active` 表示目标轮次驱动器仍持有该会话，执行保持 `pending`；目标 `blocked` 则以记录的原因判为失败；`complete`、`paused` 或根本没有目标时沿用回合判定。
- 没有这道门，第一个完成的 `turn/end` 就会在会话仍在工作时把卡片结算为 `done`，而定时的卡片会回到 `todo` 并为同一目标再开一个并发会话。
- 该读取只发生在结算判定处，不进入每轮轮询。读取失败（例如网关撤回了 `session/projections` 定义的平台）会告警并回退到回合判定，避免一次读失败把所有执行永久挂住。

- 任务验收（见 [Task-board goal acceptance](2026-09-30-task-board-goal-acceptance.zh.md)）为这个闭环的「结束」加上门禁：`update_goal(action: complete)` 在该 execution 取得看板验收通过记录前一律被拒绝，因此目标完成只有在「工作」被判定后才会结算卡片。该 Note 拥有验收规则、按 execution 的额度与结算守卫；本 Note 仍拥有武装 goal、命令被拒的回退，以及结算时读取目标阶段。

### 协议、账本、工具与界面

- `create` 输入与 `update` 补丁接受该布尔值；更新补丁是三态的（true 或 null 让卡片回到默认，false 钉住单回合）。`parseLedger` 保留 `false`，并把多写的 `true` 归一为缺席，因为缺席才是开启状态的规范写法。无需 schema 升级：字段是可选且增量式的。
- 导入路径保留退出选择（`importedTask` 像 `reuseSession` 一样复制该字段），安全门不变：导入永不携带确认戳。
- 历史上（已于 2026-11-11 移除），`task_board_create`/`task_board_update` 曾暴露该选项，任务视图曾把 `goalRun: false` 作为对当时默认值的偏离上报。
- 历史上（已于 2026-11-11 移除），详情页复选框曾按 `task.goalRun !== false` 回显并经 update 动作写入，新建任务对话框仅在取消勾选时发送 `goalRun: false`。

## 考虑过的替代方案

**在任务看板设置卡上加插件级开关。** 否决：设置卡是部署级界面，而「这个任务要跑到完成、那个不必」是用户在写任务时逐卡作出的判断；全局开关还会静默改变所有已存在的定时卡片，且无法单独豁免。

**把 `/goal ` 前缀直接写进 Prompt 文本。** 否决：Prompt 里开头的斜杠是数据而非命令。dsh 通过命令服务派发斜杠命令（`/permission` 走的正是这条路径），因此一条「`/goal ...`」消息只会作为字面文本到达 agent，什么也不会武装。

**只武装目标而不发 Prompt（纯目标执行）。** 否决：目标轮次 Prompt 会把目标以 JSON 字符串形式内嵌，agent 首次读到的多段任务会是一行转义文本。先入队 Prompt 可保证指令原文到达，并让目标只承担续跑职责。

**`/goal` 被拒绝时判定启动失败。** 否决，理由同上：卡片已被要求执行，且 Prompt 已经入队。

**按第一个回合结算，让目标在看板背后继续跑。** 否决：卡片会把未完成的工作显示为 `done`，定时卡片还会为一个仍有活跃会话在做的目标再开第二个会话。

**把「会话空闲但目标仍 active」视为已完成（停滞超时）。** 否决：目标轮次驱动器在 agent 一空闲就排入下一轮，而看板每五秒轮询一次，因此「空闲且 active」更可能是轮询恰好落在两轮之间，而非驱动器停滞。真正的停滞会以 dsh 自身的 `blocked` 阶段出现（轮次上限、入队失败、Prompt 被拒），看板已把该阶段报为失败。

## 后果

- 一次目标执行可能在同一会话中跑很多轮，每一轮都消耗 API 额度；始终未达成的任务会让会话一直忙到目标自身的轮次上限，之后 dsh 阻塞该目标，卡片以该原因失败。
- 目标 active 期间执行保持 `running`，因此会话复用、cron 与运行中任务锁的行为与任何长任务一致。
- 历史上，`goalRun: false` 用于恢复单回合行为（2026-11-11 移除 `goalRun` 后，单回合已成为所有执行的唯一形态）。
- 运行时未提供 `/goal` 命令（或没有命令派发器）的部署照常执行每张卡片；目标模式在宿主日志中报为不可用，而不是让执行失败。
- 必需验证：`tests/goal-run.spec.ts` 覆盖目标守卫、先 Prompt 后目标的顺序、目标携带组合 Prompt、退出选择、两种拒绝容忍度，以及四种结算判定；`tests/tasks.spec.ts`、`tests/store.spec.ts`、`tests/protocol.spec.ts`、`tests/agent-tools.spec.ts`、`tests/task-detail-edit.spec.tsx` 与 `tests/new-task-run.spec.tsx` 覆盖字段、账本修复、wire 门禁、工具面与两个复选框。包门禁：`pnpm --filter @linxin666/dsh-client-ui-task-board test` 与 `pnpm i18n:check`。

参见 [task-board-session-reuse](2026-09-08-task-board-session-reuse.md)（本次扩展的启动分支）、[inspect-head-probe-memo](../bug-fix/2026-08-26-inspect-head-probe-memo.md)（结算门接入的巡检循环）与 [issue-batch-1707-1708](../bug-fix/2026-09-23-issue-batch-1707-1708-sub-path-routes-and-failed-reuse-executions.md)（`turn/end` 如何变成判定）。
