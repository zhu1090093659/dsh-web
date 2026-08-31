# Agent Note: Task board SDK 0.1.2-alpha.1 migration

Status: implemented

## Problem

已批准的 SDK cohort 移除了旧 Host API proxy 与 client runtime 表面。任务看板的执行、设置和客户端选项接线因此必须改用替代契约，才能在目标 runtime 上通过类型检查并正常工作。

## Decision

仅将 `packages/dsh-task-board` 迁移到批准的官方 SDK cohort `0.1.2-alpha.1`。Host 执行使用注入的 `TypertGateway` 与 `workspaceRegistry`；浏览器侧执行目标数据使用组装后的 Client Remote、Session 与 Workspace client service，以及官方 store/settings 模块。

Host runner 通过 gateway namespace 分发 unary 方法并消费直接业务结果。它通过 `TypertGateway.stream()` 打开 `session/follow`，消费 opening snapshot 后关闭这个短生命周期 iterator，再使用返回的 cursor 向后分页以结算执行。

## Alternatives considered

保留 `@deepseek-ai/dsh-host-apiproxy` 或 `@deepseek-ai/dsh-client-runtime` 不可行，因为这些模块已从批准的 cohort 删除。

通过 `invoke()` 调用 `session/follow` 不可行，因为 stream remote 会被 unary carrier 拒绝；runner 改用 `stream()`。

新增 workspace list RPC 不可行，因为批准的 Host workspace API 没有该 RPC；注入的 `WorkspaceRegistry.list()` 才是权威来源。

## Consequences

Session create、rename、prompt、list 与 page 调用以 `{ namespace, method, args: { request } }` 分发；`agentPresets/list` 使用空 args 对象并返回直接 roster。

Workspace 校验在 Host registry 本地完成，其行使用 `id`；浏览器 workspace 行继续使用 `workspaceId`。

由于本次迁移明确不修改 `shared/`，包内生成的 settings-form 副本直接适配；本次变更不能从旧 shared source 重新生成它。

客户端 preset roster 使用 `remote.agentPresets.list()`，该调用返回 `RemoteResult`；读取失败时保留已有 picker 选项。

## Testing

任务看板 typecheck、完整 Vitest 套件、tsdown 构建以及作用域内 `git diff --check` 均通过。完整套件报告 25 个测试文件通过、1 个跳过；239 个测试通过、1 个跳过。
