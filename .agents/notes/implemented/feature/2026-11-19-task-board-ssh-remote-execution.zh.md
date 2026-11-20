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

- 状态落在远端 `~/.dsh/task-board-ssh/` 下：`runner-<hash>.sh`（经 `exec` 写入按 PID 隔离的临时文件再原子改名安装，同主机并发安装去重），以及 `runs/<runId>/{spec.json, prompt.txt, stdout.log, stderr.log, pid, exit, session}`。每次调用启动器均显式钉住 `TASK_BOARD_SSH_STATE=<stateDir>`；Prompt 过大导致单次命令行超过 32 KiB 时自动走 `dshSsh.upload` 上传 `prompt.txt`，避免触发 `ARG_MAX` / `E2BIG`。
- 启动器动词：`start <runId>`、`status <runId>`、`tail <runId> <offset> [limit]`、`stderr <runId> [limit]`、`cancel <runId>`。`start` 在原子锁目录内复核 `exit`/`cancelled`/`pid`，避免重放或并发启动拉起第二个进程；`run_exec` 先挂 `EXIT` trap 再写 `pid`，确保瞬时退出的命令结算为 `exited` 而非 `lost`。Agent 优先用 `setsid nohup` 脱离（主机无 `setsid` 如 macOS 时回退到 `nohup`）。自定义命令模板原样执行，不追加 `< /dev/null`，保留管道与重定向语义。
- 提供方在定时器席位上轮询 `status` 与有界 `tail` 分页（测试里时间确定）。每次 `publish()` 递增看板的 `extensionsRevision` 并推送 SSE 事件，使实时日志窗口立即送达浏览器。结案时只按尾部 `PARSE_WINDOW` 读取日志（避免超过 `dsh-ssh` 2 MiB 输出上限时丢失结尾最终事件），非零退出时补充读取有界 `stderr.log`，工作区回传失败时显式以 `failed` 结案并提示远端保留分支，且在 `collectWorkspace` 期间防重入并在 `await` 后复核取消/手动移列/删除状态。
- 账本载荷（`integrations.ssh`）保存目标、活动执行、可选排队中的 `pending` 指令与有界执行历史；永不保存日志字节（64 KiB 上限）。日志按需从远端文件读取，详情页支持超过 8 KiB 自动续页。
- 执行进行中把卡片移出运行列即视为取消请求：通过 `AbortSignal` 中止在途 `prepareWorkspace` / `ssh.exec` 并停止远端进程，不写结论。删除卡片时清理该卡所有已知运行目录与 Git worktree。
- 看板定时调度把 `task.status === 'running'` 同样视为 `busy`，避免对外部远端运行中的定时卡重复触发；提供方动作返回 `{ ok: false, error }` 时看板 `/action` 显式报错传回浏览器。插件宿主入口经 `mountOnce` 防重复挂载，`dsh-web-settings` 白名单收录 `task-board-ssh` 且设置表单改用结构化相等比较（使 `agentCommands` 数组字段读回通过）。

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

一个接口：`prepare(run) -> { cwd }`、`collect(run) -> { branch? }` 与可选 `cleanup(run) -> void`。同一 `(host, cacheDir)` 上的并发操作通过每缓存异步锁串行化，所有远端 git 命令带 300 s 超时，报错文本对 URL 凭据脱敏。Git 工作区卡片的追问与返工通过 `reuseWorktreeRunId` 复用上一轮的 worktree 与分支。

- `in-place`：`cwd` 即钉住的远端目录；`collect` 为空操作。
- 来自地址的 `git`：`~/.dsh/task-board-ssh/repos/` 下的裸仓缓存，每次执行基于不可变的按次基准 ref 创建独立工作树与分支 `dsh-task/<runId>`；有提交时 `collect` 把分支推到该远端。
- 来自本机工作区的 `git`：对 `HEAD` 做 `git bundle`（已跟踪的未提交改动经 `git stash create` 一并带上），经 `dshSsh.upload` 上传后用 `git bundle unbundle` 解包进裸仓（避免 `HEAD` 未变时二次脏工作区运行触发非快进 fetch 拒绝）；`collect` 把结果分支打包、下载，并以 `dsh-task/<runId>` 取回本机仓库。本机工作树里的任何文件都不会被覆盖。未跟踪文件不会发送，卡片会说明留下了多少个：`prepare` 数出数量，该数字进入执行摘要。

### 卡片界面

详情区：目标表单（模式、主机、Agent、工作区；`proxy` 模式隐藏仅远端生效的 Agent/日志/追问控件；运行中或归档卡片禁用目标编辑）、执行状态、支持超过 8 KiB 自动分页的虚拟化日志查看、追问输入、取消。新建弹窗「运行方式」席位：同步回报草稿载荷与摘要/阻断错误（防止未填完 SSH 目标时静默退回本机执行）、折叠展开保留状态，并预填复制卡片的目标。卡片徽标：主机与执行状态（排队、运行、失联）。看板设置卡内的配置区块：开关、默认值、每主机上限、Agent 命令覆盖（编辑时保留 `resumeCommand` 与 `custom` 条目）。全部四个席位均通过 `slots.inject` 跟随看板槽位声明生命周期。三个模型可见工具：`task_board_ssh_target`、`task_board_ssh_status`、`task_board_ssh_follow_up`。

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
- **挂载没齐备时卡片上看不到任何本提供方的界面**：宿主半区要等看板与 `dsh-ssh` 都在才登记，而 `dsh-ssh` 在聚合包里是一行默认关闭的插件，因此刚装好的全家桶里，卡片详情只显示「需要先在插件管理里启用 SSH 插件」，直到那一行被打开。
