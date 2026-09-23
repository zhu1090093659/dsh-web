# Agent Note: 任务看板可归档所有非 running 状态的任务

Status: implemented

## Problem

Issue #1447：用户在定时任务里选择"修改并新建副本"，并保持勾选"创建后归档原任务"，结果原任务没有归档，也没有任何报错。

归档转换原本只接受已结算状态（`ARCHIVABLE_STATUSES = ['done', 'failed']`），而"有执行历史"正是详情按钮变成"修改并新建副本"的条件；带 cron 的任务每次成功执行后又会回到 `todo`。于是客户端 controller 在发出任何 host 请求之前就拒绝，两个调用点（`TaskDetail` 的 `onDuplicateSuccess` 与 `NewTaskModal` 的回退分支）都丢弃了 `false` 返回值，弹窗照常关闭，看起来像成功。host 账本共用同一个函数，所以只改客户端也不可能修好。

## Decision

- `ARCHIVABLE_STATUSES` 改为 `['backlog', 'todo', 'done', 'failed']`：除 `running` 外全部可归档；`running` 的执行生命周期仍归 runner 所有，直到执行结算。`applyArchiveTask` 是 controller 与 host 账本共用的唯一闸门，两侧同时放开。
- `task-archive.ts` 与 `controller.ts` 的文档注释同步更新；归档仍会解除排程，并保留状态、执行历史与 transcript 引用；恢复仍只清除归档标记。

## Testing

- `tests/task-archive.spec.ts` 覆盖新的拒绝范围与报告场景：定时 `todo` 任务可归档且 cron 被解除（`enabled: false`、`nextRunAt: undefined`、cron 文本保留）。
- `tests/archive-controller.spec.ts` 走真实 controller：`done`、`failed`、`todo` 均归档并持久化，`running` 被拒。
- `pnpm --filter @linxin666/dsh-client-ui-task-board test` 与 `typecheck` 通过。

## Alternatives considered

- 只做"诚实失败"：保留仅结算可归档，让 UI 显示拒绝（新增 locale key、保持弹窗打开）。否决作为主修复——它没有兑现勾选框对定时任务的承诺；下面 `running` 的静默情形是该行为剩余且更罕见的实例。
- 把归档标记随创建动作一起发送，而不是后续单独的归档调用。否决：归档刻意是独立的同源 action，有自己的账本转换；并入创建会让一个动作产生两次持久化写入。
- 允许包括 `running` 在内的任意状态归档。否决：运行中任务的生命周期归 runner 所有，账本调度状态机也假定它不会在执行中途消失。

## Consequences

- 勾选后复制定时任务会真正退役原任务：它离开看板列、保留历史、cron 被解除，直到用户恢复并重新启用（恢复不会自动重新武装排程）。
- `running` 来源仍会被客户端闸门拒绝，且详情/弹窗依旧不报错直接关闭；这一残留的静默 no-op 尚无跟踪项，要关闭它需要"诚实失败"那套设计（locale key 加 UI 状态）。
