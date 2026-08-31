# Agent Note：任务板花名册轮询跨越启动期服务窗口

Status: implemented

## Problem

在 0.1.2-alpha.1 宿主上，会话树要等 `sessionController` 的九个注入服务全部解析完（`agentDefaultModel`、`agents`、`attachments`、`llm`、`sessions`、`sessionProjections`、`sessionQuery`、`typert`、`workspaceRegistry`）才会激活它，而 `TaskBoardHostService.start()` 在插件启动期间就立即发起首次花名册轮询。于是首次 `session/list` 必然以网关的 `service-unavailable` 失败，每次启动都打印一行带完整堆栈的 `console.error`（"treating the host session roster as unknown"）——尽管 5 秒后的下一次轮询就能自行恢复。

## Decision

`HostExecutionRunner.listRunning` 在网关返回 `code: 'service-unavailable'` 时重试 `session/list`：最多 `SERVICE_UNAVAILABLE_ATTEMPTS`（5）次、每次间隔 2 秒，两者均可通过新增的可选构造参数 `unavailableRetry` 覆盖（供测试与嵌入方使用）。重试只针对该错误码——描述符不匹配等所有其他失败保持原来的单发语义（一次 `console.error`、花名册记为 unknown）。窗口耗尽后同样只记一次错误并返回 `{ known: false }`，降级契约不变；启动抢跑窗口现在会静默恢复为已知花名册。

## Alternatives considered

- 把首次轮询固定延迟若干秒——盲目等待，慢机器上照样抢跑，还拖慢每次启动。
- 在任务板条目上声明对 `sessionController` 的 inject 等待——正是 `remote.agentPresets` 移除过的反模式（见 [client-store-dual-cohort-engine-shim](2026-08-28-client-store-dual-cohort-engine-shim.md)）：硬等待会让整个条目在永不激活该服务的宿主上永久 pend。
- 维持现状——花名册下一轮确实会恢复，但每次启动都打印读起来像故障的堆栈错误。

## Consequences

- 会话树真正不可用时，一轮轮询最多多花约 10 秒才把花名册记为 unknown；轮询在飞标志防止重试重叠。
- 重试窗口通过构造参数可观测，并有单元测试覆盖；非 unavailable 错误绝不重试。

## Verification

- `packages/dsh-task-board` 内 `pnpm test`：243 通过（新增两例：单次 `service-unavailable` 失败后重试转已知；按配置次数耗尽后恰好一行日志），`pnpm typecheck` 干净。
