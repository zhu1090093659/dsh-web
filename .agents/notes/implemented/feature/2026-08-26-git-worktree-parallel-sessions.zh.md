# Agent Note: dsh-git-graph 的 git worktree 并行会话

Status: implemented

## Problem

DSH 一个工作区的所有会话共享同一棵检出树，并行会话改同一仓库必然互相踩踏（dsh-parallel-dev 纪律只是缓解）。成熟的 agent 桌面产品用 git worktree 解决这个问题：Claude Code 桌面版为每个新会话自动建 worktree，Codex 桌面版提供 worktree 会话与 Local/Worktree 移交。问题是：dsh-git-graph——一个自带 host git 服务、/git/* 路由与分支胶囊的自包含 cordis 插件——能否在**不改动 DSH 本体**的前提下长出同样的能力。

## Decision

四层全部落在 packages/dsh-git-graph 内：

- **托管 worktree 动词（host）**：`GitService.worktrees/addWorktree/removeWorktree` 复用既有 runner 与 workspace 门卫，暴露为 `/git/worktrees`、`/git/worktree-add`、`/git/worktree-remove`，外加无路径的 `/git/config`。托管 worktree 一律落在 `$DSH_HOME/worktrees/<repo-key>/<名称>/`（repo-key = 清洗后的仓库名 + 规范根路径 sha1 前 8 位），且永远检出新分支 `wt/<名称>`——git 禁止同一分支两处检出，基线分支绝不复用。客户端只给名字、永不提供路径，目标路径由 host 自行构造，workspace 门卫的安全边界零改动。删除时双侧 canonical 路径包含校验（DSH_HOME 可能穿越符号链接：macOS /var -> /private/var），脏 worktree 未带 force 一律拒绝，`wt/` 分支只在显式要求时删除。
- **手动入口（client）**：分支弹层底部新增「在 worktree 中开始新会话」（名称 + 基线分支对话框）与 worktree 管理面板（列表、脏守卫删除 + 行内强制确认、可选删分支）。新建的 worktree 通过公开的 `ctx.workspaces.create` 注册为 workspace、用 `startSession` 打开——「worktree 即工作区」映射让隔离会话零 host patch 成立。注册失败自动回滚 worktree。
- **自动隔离（client，设置开关，默认关）**：`autoIsolate` 在运行时包装浏览器侧共享 WorkspacesService 的 `startSession`——探测过的 monkey-patch，不改源码——git 工作区的「新会话」动作落入全新托管 worktree（基线由 `autoBaseline` 决定：当前 HEAD 或 `origin/HEAD`，无远程回退 HEAD）。只包装 `startSession`；`connectWorkspace` 的空白会话复用与启动选择永远不会喷 worktree。形状探测在 client-runtime 内部变化时降级回官方行为并打印诊断；已在托管目录下的工作区不会被二次隔离。路由流程会把目标放入在途集合，快速双击「新会话」只会建一个 worktree（侧栏按钮没有 disabled 态，官方 `startSession` 是即发即忘）。官方启动在注册成功之后抛错时，回滚先经可选的 `workspaces.delete`（`IWorkspaces.delete`——"Delete a Workspace registration without deleting Sessions or files"）撤销注册，再删除 worktree 目录，不会留下指向已删除路径的工作区条目（issue #1507）。
- **Agent 工具（host，设置开关，默认关）**：`agentTool` 通过官方 `ctx.tools.register` 缝注册模型可见的 `git_worktree` 工具（create/list/remove），以调用会话的 cwd 做门卫。这是对本包「git 能力不进模型可见面」原始规则的有意豁免，仅对开启者生效。由于会话 cwd 不可变、workspace-write 沙盒以会话 cwd 为写入根，`create` 会同时把 worktree 注册为 workspace（host 侧 `workspaceRegistry.create`），并在回复中引导模型在其上开新会话——「环境预备」语义让工具在沙盒下依然有用；danger-full-access 下 agent 可直接在返回路径里工作。

设置走 `installSettingsSection`（共享设置卡）+ schemastery schema；浏览器每次「新会话」动作经 `/git/config` 读实时配置，开关免刷新生效。SSE 轮询 key 并入 worktree 成员摘要，外部 `git worktree add/remove` 也会推送变更，不新增轮询节奏。

## Alternatives considered

- **host 侧拦截 `session/create`**：cordis 有 `connection.rpc.intercept('/api', ...)`，但频道只允许一个 interceptor 且已被 dsh-api-gateway 占用，且该缝没有 delegation 语义（无法改完 payload 再交还原 handler）。不改主仓则不可行，否决。
- **Codex 式 handoff（已有会话在检出间迁移）**：需要给会话换 cwd，而不可变的 SessionHeader 禁止此事，也没有任何客户端 API 提供。待 DSH 长出 cwd rebind 缝后再议。
- **Claude 式按调用的子代理隔离**：模型可见的 subagent 工具没有 cwd 参数（子代理 cwd 是插件加载期配置），agent 无法把子代理弹进指定 worktree。同样搁置。
- **仓库内 worktree（`.claude/worktrees` 式）或仓库同级目录**：设计阶段都考虑过；用户最终只保留 `$DSH_HOME/worktrees/` 集中管理，它让 workspace 门卫的 realpath 等值语义保持干净，且不污染仓库及其父目录。
- **detached HEAD worktree（Codex 式）**：否决；具名 `wt/<名称>` 分支让提交有锚点，并复用既有 branch-in-other-worktree 守卫词汇。

## Consequences

- 本包的模型可见面不变量改写为「默认关闭」；包级 AGENTS.md 携带豁免条款，本 note 承载理由。
- 自动隔离依赖未公开的 client-runtime 内部（WorkspacesService 单例形状），明确标记为实验性，且失败安全。
- worktree 会话以一等 workspace 身份出现在侧栏（Codex 永久 worktree 模型）；生命周期由用户经管理面板管理——删会话不会自动删 worktree，孤儿 worktree 经管理面板 reconcile（git worktree list 是事实源）。
- 六个新的稳定错误码进入 wire 词汇：invalid-worktree-name、worktree-already-exists、worktree-dirty、worktree-not-found、worktree-is-main、base-ref-not-found。

## Testing

core 单测覆盖 porcelain 解析、名称清洗、argv 构建；host 集成测试在临时仓库 + 临时 DSH_HOME 上跑真实 git（创建、基线选择与 origin/HEAD 回退、重名/非法名、脏拒绝与 force、包含校验拒绝、删分支）；路由测试覆盖新端点（含无路径 /git/config 与非 loopback 围栏）；client 测试覆盖对话框流程与自动隔离路由矩阵（关/非 git 透传、改道、防嵌套、失败降级、形状不匹配拒绝）。
