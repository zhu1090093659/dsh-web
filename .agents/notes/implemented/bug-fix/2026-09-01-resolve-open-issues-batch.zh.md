# Agent Note: 批量解决多插件未决 Issue

Status: implemented

## 问题

社区与 CI 反馈了涉及多个插件的缺陷与体验问题：
1. Issue #1341：Node 22 环境下 CI 门禁失败，`packages/dsh-session-archive` 报错 "Cannot bundle Node.js built-in 'node:sqlite'"，原因在于其 Vitest 配置使用了 `environment: 'jsdom'`。
2. Issue #1331：在 DSH 内核 `0.1.2-alpha.1`（DSH Desktop 2.0.4）下，`settingsCtx.settings.installSection` 在插件树装载时抛出 TypeError，导致 `dsh-git-graph` 无法挂载。
3. Issue #1344：大模型调用 `describe_image` 时由于长 Markdown 引用转录产生微小语法噪声（如尾部多余冒号），导致严格 JSON 解析失败无法识图。
4. Issue #1346：在 `dsh-task-board` 中，`settleExecution` 无条件将执行成功的状态置为 `done`，导致带有 cron 的周期任务每次执行完自动被移出「待办」列进「已完成」。

## 决策

1. 在 `packages/dsh-session-archive/vitest.config.ts` 中，将测试运行环境由 `jsdom` 修正为 `node`（该包全为 Host 侧持久化与存储逻辑）。
2. 在 `packages/dsh-git-graph/src/index.ts` 中，为 Settings 注册添加防御性降级兼容：优先调用 `installSection`，若不存在则降级至 `register`，并做异常隔离。
3. 在 `packages/dsh-tool-describe-image/src/attachment-reference.ts` 与 `attach-routes.ts` 中，引入 `repairImageRefJson` 清洗模型转录结构噪声，并在引用解析异常时降级回退至 `attachmentId` 注册表兜底。
4. 在 `packages/dsh-task-board/src/core/tasks.ts` 中，更新 `settleExecution`：当 `task.schedule?.enabled` 为 true 时，执行成功保持在 `todo` 列。

## 后果

- 全仓 CI 在 Node 22 和 Node 24 环境下均稳定通过，解除 `node:sqlite` 打包阻塞。
- `dsh-git-graph` 在不同内核版本下均可安全平滑挂载。
- `describe-image` 对大模型参数转录微瑕疵具备高鲁棒性，同时对非法输入保持 fail-closed。
- 看板中的周期定时任务在成功执行后继续常驻待办列，便于持续追踪。

## 测试

- `pnpm --filter @linxin666/dsh-session-archive test`（8/8 通过）
- `pnpm --filter @linxin666/dsh-client-ui-git-graph test`（10/10 通过）
- `pnpm --filter @linxin666/dsh-tool-describe-image test`（21/21 文件，385 项全部通过）
- `pnpm --filter @linxin666/dsh-client-ui-task-board test`（33/33 文件，314 项全部通过）
- `pnpm test` 全仓测试绿灯，`pnpm docs:check` 与 `pnpm i18n:check` 通过。
