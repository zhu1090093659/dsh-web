# AGENTS.md — dsh-task-board

dsh Web GUI 的 Host 权威多列任务看板。任务通过真实 DSH 会话执行，浏览器只负责异步展示与提交动作。

## Host 账本、执行与调度

- 权威账本固定为 `$DSH_HOME/task-board/ledger-v2.json`（文件名为历史沿用），当前 schema 为 `{ schemaVersion: 3, revision, tasks, scheduler }`；旧 v2 文档在 Host 启动时逐字段无损迁移为 v3 写回，迁移失败必须明确报错且保留原文件（不静默清零）；写入必须保持临时文件加原子 rename、损坏文件隔离和 revision 单调递增。
- 浏览器 `dsh.taskBoard.v1` 只用于一次性导入且必须保留；导入 marker 只能在 Host 确认后写。所有生产变更走 `protocol.ts` 的严格同源 action 协议，UI 不得先写未确认状态。
- 手动与 cron 统一走 `HostExecutionRunner`。钉住的 workspace、agent preset、permission 任一失效都在任务 Prompt 前 fail closed；默认每次 execution 创建独立会话，任务开启 `reuseSession` 后可复用上一次会话——复用条件由 `core/session-reuse.ts` 唯一裁定：上一执行已结算、该 session 仍在名册中且空闲（名册未知一律不复用），复用时重新应用钉住的 permission/model 再入队 Prompt，不重命名、不新建。
- 交接包三元组在执行时覆盖普通钉住字段；有效权限高于 `sessionDefaultPermission`（默认 `read-only`）的绑定必须先经 `confirm-permission` 动作人工确认（变更即重新武装），未确认卡片手动执行拒绝、cron 跳过并滚动 `nextRunAt`。
- cron 使用 Host 本地时区和标准日期/星期 OR 语义。Host 首启或长暂停后的过期出现全部跳过；同任务 running 时不排队、不并发，只滚动下一触发点。
- 重启恢复时，有 session id 的 running execution 继续观察；无 session id 的启动中断标为 cancelled，禁止自动重发。
- 子任务层级由 Host 唯一裁定：`TaskRecord.parentId` 的深度上限是配置项 `maxSubtaskDepth`（1..3，默认 1），创建、`set-parent` 关联与导入修复共用 `src/core/subtask.ts` 的存在性/环/深度判定，浏览器只据此启停控件。执行一个任务会在同一 run group 内并发开启整棵子树的 execution；父任务在自己的回合与全部直接子任务都结算后才结算，任一成员失败则父任务失败，已在运行的任务不进入新的 run group（cron 同样），且运行中的参与者不能被 `set-parent` 改挂或解除关联——它的链接可能仍是该 run group 的父指针。子任务未单独设置的权限/模型在启动时按祖先链解析继承，继承来的权限连同提供它的祖先的人工确认戳一起生效；权限绝不在创建时复制到子任务卡片上（否则解除关联后会残留一张已确认的高权限根任务），workspace/模式/模型按用户看到的预填值存卡。

## Agent Team 执行（opt-in）

- 任务级 `teamRun` 开关（默认关，详情页勾选；服务缺失时禁用）把一次执行从「每个成员各开一个会话」切换为「只开一个 Lead 会话 + 每个子任务一个 teammate」：Host 用 `ctx.agents.get(leadSessionId)` 取到 live Lead，调 `ctx.agentTeams.spawnTeammate(lead, { name, description, prompt, context: 'fresh', provider: teamProvider, signal })`，再把 teammate 会话 id 挂到该子任务的 execution 上，结算仍交给既有会话监视器。`agentTeams` 按可选服务解析（不注入）：缺失时手动执行直接拒绝（而不是静默退回级联），cron 路径把成员标为失败并写明原因。
- 子树在这个模式下被压平成一个 Team（只有 Lead 能派生），teammate 名字取「标题 slug + run group 前 8 位 + 成员 task id 摘要 8 位」以保证同一 Team 内唯一：run group token 区分同一棵树的多次执行，成员摘要区分同一次执行内的不同成员（纯中文标题 slug 为空串时这是唯一区分量，否则第二个成员会被 `TEAM_MEMBER_NAME_TAKEN` 拒绝）；团队执行永远新建 Lead 会话，不复用旧会话。子任务自己钉住的（高于 `sessionDefaultPermission` 的）权限会被拒绝：teammate 运行在 Lead 会话环境里，无法承载该钉住值；继承自 Lead 的绑定仍按 Lead 的确认门判定。
- 两种模式的 Prompt 都会说明本次运行的形态（哪些成员、各自名字/任务 id、可用工具），普通级联说「并发开启 N 个独立会话」，团队模式说「本会话是 Lead，以下成员是 teammate」。

## Agent 工具面

- 八个模型可见工具 `task_board_list` / `task_board_get` / `task_board_create` / `task_board_update` / `task_board_set_parent` / `task_board_run` / `task_board_manage` / `task_board_schedule` 定义在 `src/host/agent-tools.ts`，经 `ctx.tools.register` 注册。它们只调用同一个 `TaskBoardHostService`（账本 action + 快照），不复制业务规则：fail closed 钉子、权限确认门、子任务深度门禁、运行中任务锁在工具面全部照旧生效。
- 注册跟随 `enabled` 主开关（关闭时不注册）；工具注册表按可选服务解析而不写入 `inject`，因此运行时不提供注册表的部署仍会挂载看板，只失去工具面（与可选 `llm` 的容忍度一致）。
- 刻意不提供 `confirm-permission`：高于会话默认权限的绑定只能由人工在界面确认。工具面同样不接受命令、可执行路径或 shell 文本。
- 工具描述是面向模型的英文文案（含中文触发词），不进 locales 字典；领域拒绝以 `ok:false` 值返回，便于模型自行纠正。

## 电源保护

- `preventIdleSleep` 默认 `false`。开启后，全部 DSH running session、任一已启用 cron 或未知 session 状态都构成持锁理由；仅在已确认无运行会话且无计划时释放。
- macOS 只允许 `/usr/bin/caffeinate -i -w <pid>`；Windows 只允许从 `SystemRoot` 解析的 Windows PowerShell 固定 helper 和 `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`。Linux 只允许绝对路径 `systemd-inhibit` 的 `idle`/`block` lock，不得请求 `sleep`、显示器或 lid-switch inhibitor。
- helper 必须 `shell: false`、固定参数、不依赖 PATH、失败有界退避，并在设置关闭、插件卸载和 Host 退出时清理；不得修改电源计划或要求管理员权限。无 systemd-logind 的 Linux 和其他平台只报 `unsupported` 或可见错误。

## 文件归属与测试

- Host 协议、账本、runner、scheduler 编排和 power 状态机放 `src/`；浏览器 transport 与 UI 放 `src/client/`；纯 cron、任务转换与子任务层级规则（`src/core/subtask.ts`）留 `src/core/`。
- Host 功能只依赖官方 `@deepseek-ai/*` NPM SDK，不得导入 DSH 源码。`src/dsh-home.ts` 与 `src/loopback.ts` 是 `shared/host/` 经 `scripts/sync-shared.mjs` 生成的副本，禁止手改。
- 变更账本、协议、runner、cron 或 power 时补对应单测；原生 helper 只在 `DSH_POWER_SMOKE=1` 且平台为 Windows/macOS/Linux 时运行 smoke，Linux 无可用 logind system bus 时显式跳过原生部分。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm --filter @linxin666/dsh-client-ui-task-board build
pnpm docs:check
```
