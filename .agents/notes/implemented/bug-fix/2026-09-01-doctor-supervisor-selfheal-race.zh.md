# Agent Note: Doctor Supervisor 启动自愈时序与测试等待加固

Status: implemented

## 问题

在 CI 负载较高环境下，`packages/dsh-doctor/tests/agent-supervisor-selfheal.spec.ts` 偶发失败于 `expect(patch).toContain('# dsh-doctor')`。由于 `DoctorSupervisor` 中的 `selfHealBootFailure` 采用 detached 异步执行，测试中此前硬编码的 150ms 等待在慢速 CI runner 上容易在文件持久化尚未写入前提前断言，导致竞态失败。

## 决策

1. 在 `DoctorSupervisor`（`packages/dsh-doctor/src/agent/supervisor.ts`）中增加 `lastSelfHeal: Promise<void> | undefined`，记录最近触发的自愈后台任务。
2. 在 `tests/agent-supervisor-selfheal.spec.ts` 中，优化 `settle()` 优先等待 `supervisor.lastSelfHeal` 并对 patch 文件内容进行轮询确认。

## 后果

自愈单测在本地与各 CI 负载环境下均能确定性等待完成，消除了固定超时引发的测试抖动与竞态。

## 测试

`pnpm --filter @linxin666/dsh-doctor test`（43 个测试文件，389 项单测全部通过），全仓 `pnpm test`、`pnpm typecheck`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm test:scripts`（234 项通过）。
