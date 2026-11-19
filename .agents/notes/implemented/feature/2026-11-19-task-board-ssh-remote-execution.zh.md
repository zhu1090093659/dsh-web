# Agent Note: 任务看板 SSH 提供方：卡片交给远程主机上的 Agent 执行

[English](2026-11-19-task-board-ssh-remote-execution.md) | 中文

Status: implemented

本决策给 [Task Board external provider extension contract](../architecture/2026-09-30-task-board-extension-contract.zh.md) 增加一个可选的宿主成员；契约仍归那篇 Note 所有，那道缝的形状也写在那里。

## Problem

任务看板把每张卡片都放在本机 DSH 会话里执行（`HostExecutionRunner.launch`，`packages/dsh-task-board/src/host-runner.ts`）。有四类需求没有被覆盖：代码在另一台机器上；长任务期间本机应当可以离线；多台机器应当能并行干活；远端机器上已登录的 Agent 账号（dsh、Claude Code、Codex）应当能用上。

现有两个提供方（`dsh-task-board-github`、`dsh-task-board-team`）都是把外面的活拿进来、在本机执行，没有任何东西把本机卡片送出去。缺两道缝：提供方契约没有启动成员（`packages/dsh-task-board/src/core/extension.ts`）；`dsh-ssh` 不向其他插件提供主机列表与连接池（`packages/dsh-ssh/src/index.ts` 只注入 `webServer`、`tools`、`systemPrompt`，自己什么都不提供）。

## Decision

第三个提供方包 `packages/dsh-task-board-ssh`（npm `@linxin666/dsh-client-ui-task-board-ssh`，独立安装行 id `ui-task-board-ssh`，聚合行 id `web-ui-task-board-ssh`，扩展 id `ssh`）。已与维护者定下的决策：

- **每张卡两种执行模式。** `direct`（默认）：提供方在远端拉起无头 Agent CLI，本机不开会话。`proxy`：卡片照常开本机会话，由它用 `ssh_*` 工具指挥远端。`proxy` 撑不过本机离线，文档里明说。
- **工作区：两套机制覆盖三种用法。** `in-place` 在远端已有目录里执行。`git` 在每次执行独立的工作树里执行，来源可以是远端可达的仓库地址，也可以是本机工作区仓库；结果以分支取回。非 Git 的本机目录不支持。
- **direct 模式的交互：** 可回放日志、追问与返工，靠续接远端 Agent 会话实现。
- **权限：** 远端执行一律无人值守全自动（各 CLI 的跳过确认开关），不设按主机上限。
- **调度：** 卡片钉一台主机；每台主机有并发上限（默认 2）与先进先出队列。

### 缝一：`dsh-ssh` 宿主服务

`dsh-ssh` 提供 cordis 服务 `dshSsh`，`DSH_SSH_API_VERSION = 1`，是 `SshEngine` 的薄转发：`hosts.list()`、`hosts.find(alias)`、`exec(alias, command, { timeoutMs, signal })`、`upload(alias, localPath, remotePath)`、`download(alias, remotePath, localPath)`。不设流式成员：日志靠 `exec` 按字节偏移轮询。该面永不返回主机机密与 `proxyCommand` 原文。

### 缝二：看板启动拦截

`TaskBoardExtensionHost` 在不变的 `TASK_BOARD_API_VERSION = 1` 下新增一个可选成员（沿用 `tasks.rework` 与 `sessions.followUp` 的先例）：`launch?.intercept(handler)`，返回取消订阅函数。runner 在唯一的启动入口、创建任何会话之前，对每一种触发（手动执行、重跑、定时、`task_board_run`）询问这些 handler。`handler(task, { trigger })` 是同步的，返回三者之一：

- `undefined`：不归我，看板照旧。
- `{ kind: 'local', promptPreamble }`：本机执行，前言与标签前缀走同一条路径注入到 Prompt 之前（proxy 模式）。
- `{ kind: 'external' }`：看板不建会话、不写执行记录，把卡片移入运行列，提供方之后用既有的 `record-external-outcome` 动作收口。

handler 抛错被隔离，按 `undefined` 处理。没有 handler 注册时，启动路径与没有这道缝时逐字节一致。

### 远端执行协议（direct 模式）

- 状态落在远端 `~/.dsh/task-board-ssh/` 下：`runner-<hash>.sh`（经 `exec` 安装的 POSIX `sh` 启动器），以及 `runs/<runId>/{spec.json, prompt.txt, stdout.log, stderr.log, pid, exit, session}`。
- 启动器动词：`start <runId>`、`status <runId>`、`tail <runId> <offset>`、`cancel <runId>`。`start` 对 `runId` 幂等，因为 `dsh-ssh` 连接池重连时可能重放命令。Agent 用 `setsid nohup` 脱离，所以 SSH 连接断开或本机离线都不影响它。
- 提供方在定时器席位上轮询 `status` 与 `tail`（测试里时间确定）。启动时对每张带活动执行的卡片对账：本机离线期间结束的执行在此时落账。
- 账本载荷（`integrations.ssh`）保存目标、活动执行与有界的执行历史；永不保存日志字节（64 KiB 上限）。日志按需从远端文件读取。
- 执行进行中把卡片移出运行列即视为取消请求：远端执行被取消，不写结论。

### Agent 适配器

`src/core/adapters/` 里的纯函数把 `{ agent, promptFile, cwd, resumeSessionId }` 映射成命令行，并从输出里解析会话 id 与最终摘要。

| Agent | 启动 | 续接 | 核实情况 |
| --- | --- | --- | --- |
| dsh | `dsh headless --json --permission-mode danger-full-access` | `--session-id <id>` | 真实 CLI 录制；预设名取自该 CLI 自己的报错文本 |
| Claude Code | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions` | `--resume <id>` | 真实 CLI 录制 |
| Codex | `codex exec --json --sandbox danger-full-access --skip-git-repo-check` | `codex exec resume <id>` | 仅按文档书写：本机没有装 Codex 的主机 |
| custom | 用户命令模板，占位符 `{prompt_file}`、`{cwd}`、`{session}` | 可选 | - |

录制的输出流与逐字录制命令在 `packages/dsh-task-board-ssh/tests/fixtures/RECORDING.md`。续接不可用的 Agent，追问与返工降级为带上前次摘要的全新执行。

### 工作区策略

一个接口：`prepare(run) -> { cwd }` 与 `collect(run) -> { branch? }`。

- `in-place`：`cwd` 即钉住的远端目录；`collect` 为空操作。
- 来自地址的 `git`：`~/.dsh/task-board-ssh/repos/` 下的裸仓缓存，每次执行一个工作树、分支 `dsh-task/<runId>`；有提交时 `collect` 把分支推到该远端。
- 来自本机工作区的 `git`：对 `HEAD` 做 `git bundle`（已跟踪的未提交改动经 `git stash create` 一并带上），经 `dshSsh.upload` 上传；`collect` 把结果分支打包、下载，并以 `dsh-task/<runId>` 取回本机仓库。本机工作树里的任何文件都不会被覆盖。未跟踪文件不会发送，卡片会说明留下了多少个：`prepare` 数出数量，该数字进入执行摘要。

### 卡片界面

详情区：目标表单（模式、主机、Agent、工作区）、执行状态、日志查看、追问输入、取消。卡片徽标：主机与执行状态（排队、运行、失联）。看板设置卡内的配置区块：开关、默认值、每主机上限、Agent 命令覆盖。三个模型可见工具：`task_board_ssh_target`、`task_board_ssh_status`、`task_board_ssh_follow_up`。

## Context & Efficiency Impact

direct 模式不消耗本机模型 token。提供方新增三个工具与一小段提示词，任一开关关闭时都会释放。每张带目标的卡片让账本多一条有界载荷。`dsh-ssh` 与看板各多一个可选面，不用时没有成本。

## Alternatives considered

**远端对等看板。** 远端机器跑 `dsh web` 加看板，执行镜像过去的卡片。被拒：只服务 dsh，而目标包含没装 DSH 的机器上的 Claude Code 与 Codex。

**提供方自带执行按钮、不动看板。** 被拒：原生执行按钮、定时与 `task_board_run` 仍会为用户已钉到远端的卡片开本机会话。

**为外部执行新增一种未结算的执行记录。** 它能把远端执行纳入运行中锁。暂时被拒：这要重写账本恢复逻辑，而今天的恢复会取消每一条没有会话 id 的未结算执行；只占运行列加 `record-external-outcome` 能得到同样的历史，且不改账本。

**在 `dsh-ssh` 服务上加流式 exec 成员。** 被拒：本机离线后仍要能回放的日志，本来就只能是按偏移读取的远端文件。

**用 `tmux` 或 `systemd-run` 脱离。** 被拒：两者在远端都不保证存在，`setsid nohup` 保证存在。

**用 `git push ssh://` 或 rsync 同步本机工作区。** 被拒：系统 `ssh` 不共享 `dsh-ssh` 的凭据（密码、跳板机）；rsync 在回拉时回答不了以哪一侧为准；bundle 走连接池传输，并以分支落地。

## Consequences

- 原生执行按钮、定时、`task_board_run` 与返工都走同一个启动闸口，因此钉到主机的卡片在那台主机上执行，本机不为它创建会话。
- 执行期间停掉再启动本机宿主不丢任何东西：日志能从头回放，结论只落账一次。
- 对同一 `runId` 重放 `start` 不会拉起第二个 Agent。
- 对已结束卡片的追问或返工，在 dsh 与 Claude Code 上续接同一个远端 Agent 会话；不能续接的 Agent 降级为带上前次摘要的全新执行。
- 超出主机上限的执行在队列里等待，并按先进先出启动。
- 三种工作区用法各自产出结果：原地的文件、推上去的分支、取回本机仓库且工作树未被触碰的分支。
- proxy 模式开出本机会话，其 Prompt 带有目标前言。
- 提供方关闭或缺席时，看板与 `dsh-ssh` 行为不变，且看板源码里没有提供方词汇：`grep -rn "ssh" packages/dsh-task-board/src` 只命中一行，即 `src/tool-surface.ts` 里共享提示词段落排序表的 `ssh` 键（该文件是 `shared/host/tool-surface.ts` 的生成副本，早于本特性），它只是那个插件的排序条目，与这个提供方无关。
- 覆盖它的仓库门禁通过：`pnpm typecheck && pnpm test && pnpm test:standards && pnpm docs:check && pnpm i18n:check`，以及 `aggregate:check` 与 `libs:check`。
- **远端无人值守全权限**是维护者的决定，也是接受下来的最大风险：被提示词注入的卡片能做远端账号能做的任何事。
- **运行列里的卡片没有运行中锁**，所以手动移动被读作取消。误拖会停掉远端执行。
- **Codex 未核实**，直到在装有它的主机上跑过。
- **远端输出不脱敏**地进入卡片日志，与 `ssh_exec` 同一信任模型。
- **看板这道缝改动了每张卡片的启动路径**；无 handler 的路径必须逐字节不变，并由契约测试钉住。
- **未跟踪文件留在本机**，因为 bundle 只带提交；该数量写进执行摘要，而不是被静默忽略。
