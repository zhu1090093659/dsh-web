# @linxin666/dsh-client-ui-task-board-ssh

[English](README.md) | 中文

任务看板的外部提供方扩展：把钉住目标卡片作为无头 agent 会话，跑在经 dsh-ssh 触达的远端主机上，让卡片的工作发生在持有代码的机器上，并且在本机离开时继续运行。

## 是什么

- 向任务看板登记 `ssh` 提供方扩展，并在看板唯一的启动闸口接管钉住了远端目标的卡片，因此原生运行按钮、定时调度与 `task_board_run` 走同一条路径。
- 通过一个 POSIX `sh` 启动器在主机上运行 dsh、Claude Code、Codex 或自定义命令，优先用 `setsid nohup` 脱离（主机无 `setsid` 如 macOS 时回退到 `nohup`），使一次运行活过 SSH 连接与本机。
- 运行的账目留在卡片自己的载荷里，输出留在远端文件里按有界字节偏移分页读回，因此日志随时可以从头回放。
- 新增三个模型可见工具（`task_board_ssh_target`、`task_board_ssh_status`、`task_board_ssh_follow_up`）与一个任务详情席位，席位上放目标表单、运行状态、日志视图、追问框与取消。
- 新建弹窗的「运行方式」区块里也提供同一套目标选择，卡片可以在建出来之前就钉住主机。默认是不指定：这样的卡片建出来时不带目标，建好后仍由详情席位设置，与以前完全一样。
- 从任务详情席位取消一次运行会停掉远端进程并把卡片放回待办列，不写任何结论。

## 执行模式

- `direct`（默认）经 dsh-ssh 在主机上直接起一个无头 agent。看板不建本地会话、不写本地执行记录，只把卡片放进运行中列，随后由本提供方经看板的外部结果动作结案。
- `proxy` 把卡片作为普通本地会话运行，其 Prompt 以钉住的远端目标开头，由该会话用 dsh-ssh 的 `ssh_*` 工具驱动主机。

proxy 模式撑不过本机离线：会话、它的工具调用与它的令牌开销都在本机，停掉本机就停掉工作。会继续跑的是 direct 模式，本机下次启动时，本提供方会把本机离线期间结束的运行逐一对账。

## 工作区

- `in-place` 在主机上一个已经存在的绝对路径里运行，不回传任何东西。
- `git` 用仓库地址时，在主机 `~/.dsh/task-board-ssh/repos/` 下按来源各留一份裸缓存，在 `workspaces/<runId>` 下为每次运行加一个工作树，在 `dsh-task/<runId>` 分支上提交，并把该分支推回这个地址。
- `git` 用本机仓库时，把 `HEAD` 与已跟踪的未提交改动打成 git bundle 送出，在主机上加同样的按次工作树，最后把 `dsh-task/<runId>` 取回本机仓库，且不动它的工作树、索引与 `HEAD`。

未跟踪文件不同步：bundle 只带提交，未跟踪与被忽略的文件留在本机。本机仓库来源的运行会数出自己没有收到多少个未跟踪文件，并把该数字写进卡片渲染的运行摘要。

## 安装

宿主半区用同一个 cordis 依赖作用域同时取看板与 dsh-ssh：任一服务缺席时不注册任何东西，任一服务撤走时整块卸载。聚合包里 `dsh-ssh` 那一行（`web-ui-ssh`）出厂默认关闭，需要先在插件管理里启用；在此之前，卡片详情只显示「需要先在插件管理里启用 SSH 插件」，新建弹窗里不出现任何 SSH 行。

### 从 npm 安装

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board-ssh@latest
```

### 从仓库安装

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board-ssh
```

## 配置

### 按卡片

卡片的目标在新建弹窗的「运行方式」里选，也可以建好之后在详情席位里设置。两处编辑的是同四个字段；建卡时没有指定目标的卡片也就没有目标，直到其中一处说出了它在哪运行。

- `mode`：`direct` 或 `proxy`，差别见执行模式一节。
- `host`：这次运行要用的 dsh-ssh 主机别名。
- `agent`：`dsh`、`claude`、`codex` 或 `custom`；自定义 agent 需要一条带 `{prompt_file}` 的启动命令模板，可选一条续跑模板。
- `workspace`：`in-place` 配一个远端路径，或 `git` 配仓库地址与可选起始分支，或 `git` 配一个本机工作区标识。

### 扩展设置

- `enabled`：总开关；关闭即撤下详情席位、卡片徽标、新建弹窗里的那一行、三个工具与启动拦截器，并停掉对所有在跟运行的轮询。
- `defaultMode`、`defaultAgent` 与 `defaultHost`：卡片在还没钉目标时打开的默认值。
- `perHostCap`：一台主机同时跑几张卡，1 到 16，默认 2；超出的按提交顺序排队。
- `agentCommands`：按 agent 覆写的命令模板，替换内置命令行。

## 安全模型

- 每次远端运行都是无人值守的。dsh 用 `--permission-mode danger-full-access`，Claude Code 用 `--dangerously-skip-permissions`，Codex 用 `--sandbox danger-full-access`：一张卡就是对 agent 的指令，而这个 agent 从不向本机请示，因此 Prompt 里带敌意的卡片能对该远端账号做任何事。
- 本包发往主机的每个值都过同一个 POSIX shell 转义函数；远端命令行不由裸文本拼接。
- dsh-ssh 不向本包交出凭据、私钥路径或 proxy 命令文本，卡片载荷也不含日志字节。
- 远端日志原样回到卡片，与 `ssh_exec` 同一套信任模型。

## 已知限制

- Codex 未核实。它的开关与事件名来自 OpenAI 的非交互模式文档，适配器只对那份文档描述的流做夹具测试；第一次在装有 Codex 的主机上运行时必须确认或修正。
- 启动器需要主机上有 POSIX `sh`（有 `setsid` 时优先使用，缺失时如 macOS 回退到 `nohup`）；没有 POSIX `sh` 的主机跑不了 direct 模式卡片。
- 运行中的卡片被移出运行中列即视为取消请求，因此误拖一次会停掉远端运行。
- git 工作区需要某一侧有仓库：本机上一个不是 git 仓库的目录无法送到主机。
- 主机上 `~/.dsh/task-board-ssh/runs/<runId>/` 的运行目录是该次运行输出的唯一副本，卡片里不保留任何一份。

## 许可证

Apache-2.0。
