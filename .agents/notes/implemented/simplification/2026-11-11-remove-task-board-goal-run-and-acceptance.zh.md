# Agent Note: 移除任务看板的 /goal 运行与任务验收

Status: implemented

取代[任务执行以 dsh 内置的 /goal 起步](../feature/2026-09-27-task-board-goal-run.zh.md)与[任务看板目标验收](../feature/2026-09-30-task-board-goal-acceptance.zh.md)，并收窄[任务看板设置以折叠主题卡打开](../feature/2026-10-01-task-board-settings-disclosure-cards.zh.md)中的内置主题卡数量。由于磁盘上的 v7 账本旧行与历史 profile 配置补丁仍保留加载期兼容剥离行为而非破坏性迁移，两篇被取代的功能记录留在活跃树中作为历史档案，不再代表当前行为。

## 问题

`packages/dsh-task-board` 围绕多轮自治执行维护了两套紧耦合子系统：两级原生 `/goal` 开关（设置卡上的 `goalRunEnabled` 与卡片上的 `TaskRecord.goalRun`，默认均关闭）以及端到端的任务验收子系统（`goalVerification`、`goalVerificationModel`、`goalVerificationReasoningEffort`、`goalVerificationCallTimeoutSeconds`、`goalVerificationBudgetSeconds` 五个配置键；`TaskRecord.skipVerification`；`ExecutionRecord.verification` 契约、尝试记录、适用性与通过后明细清理；`tools/pre-execute` 上的 `update_goal(action: complete)` 拦截门；六次调用的裁判模型执行器与工作区差异证据渲染；`task_board_manage` 的 `reset-verification` 动作；执行记录里的 `VerificationReport` 组件；以及设置卡「任务验收」分区）。

这两套机制占据了包内最大的配置面、协议面、账本结构与界面复杂度，却在默认单卡执行路径上完全静默。多步骤看板任务已经由父卡在单个根回合内通过 `liangshen` 派发预设与 `subagent` 子任务编排承接，而 `/goal` 续跑既把看板结算绑在 `session/projections` 阶段读取上，又在每个执行周期额外消耗至多 12 次裁判模型请求，并引入需要人工调用 `reset-verification` 解卡的异常与无效挂起状态。

## 决策

- **执行形态统一为普通单回合。** 手动执行、定时触发与 `rework` 返工一律按普通单回合运行：`HostExecutionRunner` 应用钉住的 workspace、agent preset、`/permission` 与模型/思考档位后将组合 Prompt 入队，不再经 `commands` 派发 `/goal`，不再读取 `session/projections` 判定目标阶段，结算只看该回合的 `turn/end` 结果。
- **整体移除 `/goal` 开关与任务验收子系统。** 从插件配置 schema 与设置卡移除 `goalRunEnabled` 及全部五个 `goalVerification*` 配置键；从任务与执行记录、协议动作、`task_board_create` / `task_board_update` 参数、`NewTaskModal` 与 `TaskDetail` 复选框以及 `ExecutionLog` 中移除 `TaskRecord.goalRun`、`TaskRecord.skipVerification` 与 `ExecutionRecord.verification`（含 `ExecutionVerification`、冻结契约、尝试记录、适用性标记与通过后清理）；删除 `tools/pre-execute` 上的 `update_goal` 拦截门、裁判调用器、工作区差异证据渲染、`VerificationReport` 组件以及 `task_board_manage(action: 'reset-verification')`；宿主模型目录读取接口与路由去掉验收包装，改为 `modelCatalogOptions()` 与 `GET /api/task-board/model-catalog`。
- **旧账本与旧配置无损兼容，不升 schema。** 权威账本 `$DSH_HOME/task-board/ledger-v2.json` 保持 `schemaVersion: 7` 不变。旧任务行残留的 `goalRun`、`skipVerification` 与旧执行记录残留的 `verification`（历史 schema v5 引入）在加载时直接忽略并丢弃，绝不因此拒绝整行，也不再写出新值，卡片与历史执行记录保持完整。非严格插件配置加载同样忽略旧 profile 补丁中残留的 `goalRunEnabled` 与 `goalVerification*` 键。
- **远端桥表面同步收敛。** `packages/dsh-task-board-remote` 从 `board.options` 的 `meta`（`META_KEYS`）移除 `goalRunEnabled`，经 `modelCatalogOptions()` 返回 `{ catalog, meta: { sessionDefaultPermission?, cardDefaults?, maxSubtaskDepth? } }`。
- **其余看板契约保持原样。** 会话复用（`reuseSession`）、失败即关闭的钉住字段、交接包与高权限人工确认门、5 段 cron 与单次计划及次数预算、子任务层级与 `liangshen` 父卡自治派发、卡片附件、每日 token 花费上限（`spendBudgetTokens`）以及外部提供方扩展（`dsh-task-board-github`、`dsh-task-board-team`）的行为与文案一律不变。

## 考虑过的替代方案

- **保留 `/goal` 运行，只移除裁判验收门。** 否决：去掉完成拦截门后，`/goal` 多轮续跑只能无条件相信 agent 自报的 `update_goal(action: complete)` 或一路空转到宿主轮次上限——这正是当初迫使看板补上验收门的根源；而跨步骤拆解已由单回合内的 `liangshen` 子任务编排覆盖。
- **将已废弃的配置键、勾选框与工具参数保留为空操作占位。** 否决：在设置卡、任务对话框和模型可见工具 schema 中保留不再起效的开关会误导运维与模型配置无效偏好；旧数据只需加载期静默剥离即可平滑过渡。
- **将账本 schema 升至 v8 做主动重写迁移，或拒绝带旧字段的行。** 否决：忽略可选遗留属性无需改变账本结构；升版会强制所有部署做无收益的迁移写盘，而拒行则直接违反旧账本不可失败的升级契约。
- **直接整合并删除 2026-09-27 与 2026-09-30 两篇功能记录。** 按 `.agents/notes/implemented/AGENTS.md` 否决：功能新增记录只有在功能已同时退出持久格式、迁移链路与兼容行为且无现行文档将其视为可用时才允许合并删除；由于 schema v5 仍留在 v2 至 v7 迁移历史中，且加载器明确保留对持久化 `goalRun`、`skipVerification`、`verification` 字段的兼容剥离行为，两篇旧记录保留在树中并与本记录双向交叉链接。

## 后果

- 每次卡片执行均凭单回合 `turn/end` 判定结算，不再产生额外裁判模型调用；需要多步拆分的任务走 `liangshen` 子任务树，或在交互式聊天会话内直接使用原生 `/goal`。
- 设置卡内置折叠主题缩减为两项（基础、新建卡片默认值；原「运行行为」与「任务验收」分区一并移除）加外部扩展贡献区块；任务详情「高级设置」折叠行仅承载会话复用。
- 既有 `$DSH_HOME` 原地升级不丢卡、不报错；残留的 `goalRun`、`skipVerification`、`verification` 字段在下一次账本正常落盘时自然剥离。
- 对 `task_board_manage` 传入 `reset-verification` 将按未知/非法动作拒绝；已配对远端客户端读取 `board.options` 获得 `{ catalog, meta }`，不再含验收契约与 `goalRunEnabled`。

## 测试与验证

- 删除已移除子系统的专属测试套件（`tests/goal-run.spec.ts`、`tests/goal-verification-gate.spec.ts`、`tests/goal-verification-service.spec.ts`、`tests/goal-verification-view.spec.tsx`、`tests/settings-goal-run-switch.spec.ts`、`tests/verification-cleanup.spec.ts`、`tests/verification-core.spec.ts`、`tests/verification-runner.spec.ts`、`tests/verification-validity.spec.ts`）。
- 更新账本、存储、协议、runner、agent 工具、远端桥方法、设置卡、新建对话框与详情页测试，覆盖普通单回合结算、已退场控件与 `reset-verification` 动作移除，以及 v7 账本加载包含 `goalRun`、`skipVerification`、`verification` 旧行时的无损忽略与剥离。
- 包级与仓库门禁：`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck`、`pnpm --filter @linxin666/dsh-client-ui-task-board test`、`pnpm docs:check`、`pnpm i18n:check` 与 `pnpm emoji:check`。
