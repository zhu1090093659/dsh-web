# dsh-git-graph · DeepSeek Harness (DSH) 可视化 Git 提交图谱与多 Agent Worktree 隔离插件

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-git-graph?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--alpha.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）官方 Web GUI 与桌面客户端专属 Git 可视化与多任务工作区隔离系统</strong><br>
  <em>交互式 Git 提交图谱 · 空白会话分支快速切换 · Git Worktree 隔离防冲突 · 零侵入代码隔离 · 安全冲突守卫</em>
</p>

外部 DeepSeek Harness（DSH）Web GUI 与官方桌面客户端插件：**Git 分支选择器**与**交互式 Git 提交历史图谱**面板。分支选择器只在空白会话显示，挂在 shell 的 composer dock（`conversation.input.dock`，每个随发行 shell 都声明的 seam）上；在其空白会话 hero 相位，chip 会提升进官方 hero 行，紧贴 agent-preset 座位右侧，采用与官方工作区/预设胶囊一致的透明 28px 胶囊配方和 `--dsw-*` 主题 token。active 会话不提供分支选择控件。Git 能力在 host 进程执行（磁盘工作树 `git switch`），UI 在浏览器 React；工作区选择保留官方入口。

行为对齐 ZCode 的 `GitBranchSwitcher`：可搜索弹层、当前项打勾、「创建并检出新分支… / Git 图谱」底部操作、切换守卫（未解决冲突 / 进行中操作 / 目标分支被其他 worktree 检出）与可读报错。

## 仓库布局与构建

本包是 dsh-web 全家桶仓库内的自包含 cordis 插件包（见下文「通用安装」），不涉及 DeepSeek Harness 源码 checkout。所有 peer API 来自 devDependencies 声明的官方 `@deepseek-ai/*` NPM SDK、由 node_modules 解析，类型门是 `pnpm run typecheck`（`tsc -b`，只构建本包自己的 host 与 client program）。

```sh
pnpm install
pnpm run typecheck   # tsc -b（host + client program）
pnpm test            # vitest（core 纯函数 / 真实 git 服务 / jsdom 组件）
pnpm run build       # tsc -b && tsdown（lib/index.js + lib/client.js）
```

`lib/client.js` 是浏览器 bundle（闭包工厂产物，`window.__ModuleLoader__.load`），由 host 的 client-modules 按 `/plugins/<id>/client.js` 伺服；`tsdown.config.ts` 与 `tsdown.prepare.config.ts` 都 import 唯一的共享客户端预设 `shared/tsdown.client.ts`（及其读取的浏览器平台种子表），包内不保留副本。

git 安装走 `prepare` 脚本：`tsdown --config tsdown.prepare.config.ts` 从 src 直接 transpile，不做类型检查（`tsconfig.prepare.json` 自包含）。

## 激活

本包是 dsh profile bundle（`package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`）。激活后，下次启动 `dsh web`（或对应 profile）时，bundle patch 的 insert 行把 `ui-git-graph`（host half：git 服务 + `/git/*` 路由）与浏览器 half（dsh.client 声明）一起装进 Web 组合；页面刷新后，空白会话的分支胶囊显示在 hero 行的 agent-preset 座位右侧，active 会话不显示该控件。

### 通用安装（任何机器）

本插件已并入 dsh-web 全家桶仓库（`github.com/zhu1090093659/dsh-web`）。插件已发布到 npm，推荐一行安装：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-git-graph@latest
```

或直接安装全家桶聚合包 `@linxin666/dsh-web-all` 一次到位（同样一行 `dsh plugin --profile web add @linxin666/dsh-web-all@latest`）。

需要改代码调试时再从仓库安装：

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-git-graph
```

> `github:` 安装方式适用于包位于仓库根部的独立仓库（`prepare` 脚本自包含构建；pnpm ≥10 首次会被拒绝，需按报错提示把包 key 加进 profile 的 `pnpm-workspace.yaml` `allowBuilds` 后重试）。monorepo 内的子包请用上面的 `link:` 方式。

### 本地开发循环（本仓库 checkout）

```sh
dsh plugin --profile <name> add link:/absolute/path/to/dsh-git-graph
```

`link:` 安装直接引用本地目录，重建后立即生效、无需重装（改完 `pnpm run build` 后刷新页面即可）。注意 `link:` 后跟的是绝对路径（`~` 由 shell 展开，不是 pnpm 语义）。

## Worktree 隔离

分支弹层底部有两个 worktree 入口（worktree 是共享仓库历史、但文件与分支各自独立的链接检出，并行会话互不触碰对方的工作树）：

- **在 worktree 中开始新会话…** 打开对话框：命名 worktree 并选择基线分支（默认预填当前分支）。host 在 `$DSH_HOME/worktrees/<repo-key>/<名称>/` 创建 worktree，携带新分支 `wt/<名称>`（git 不允许同一分支两处检出），随即注册为 workspace 并打开其空白会话。当前检出不受影响。
- **管理 worktree…** 列出仓库的全部链接 worktree（分支/HEAD）。托管的 worktree 可删除：有未提交更改时先拒绝一次，随后给出行内强制确认；`wt/` 分支默认保留，勾选该行的“同时删除分支”才会一并删除。主检出行只读。

插件设置卡里有两个开关（默认都关闭）：

- **自动隔离**（`autoIsolate`）：git 工作区的“新会话”动作会静默创建全新托管 worktree 并在其中开会话——Claude 桌面版式的自动形态。`autoBaseline` 选择基线：当前检出 HEAD（`current`）或远程默认分支（`default`，解析为 `origin/HEAD`，无远程时回退 HEAD）。已在托管目录下的工作区不会被二次隔离；任何失败都降级回官方新会话行为。实现上是浏览器半区对 workspaces 服务的运行时包装（形状探测过的 patch，不改 DSH 源码）——SDK 升级若改变该服务形状，功能自动关闭并打印诊断，不会硬崩。
- **Agent 工具**（`agentTool`）：注册模型可见的 `git_worktree` 工具（对同一托管目录做 create/list/remove，以调用会话的 cwd 做工作区门卫）。这是对“git 能力不进模型可见面”既定规则的有意豁免，仅对开启者生效。注意沙盒边界：会话 cwd 不可变，当前会话无法迁入 worktree；workspace-write 沙盒下 agent 也不能写会话根之外——所以 `create` 会同时把 worktree 注册成 workspace，工具回复会提示模型在其上开新会话。danger-full-access 模式下 agent 可直接在返回路径里工作。

删除只针对仓库托管目录的直接子级（双侧 canonical 路径包含校验），且在磁盘删除成功后才注销关联的 workspace。
## 卸载

```sh
dsh plugin --profile web remove @linxin666/dsh-client-ui-git-graph
```

## 设计要点

- 边界与加载链调研、关键决策见 [docs/ADR-001-plugin-boundary.md](docs/ADR-001-plugin-boundary.md)。
- host half 的 `/git/*` 只接受已注册 workspace 的路径（realpath 校验）与受信任客户端（loopback socket + loopback Host，与 dsh-ssh 相同的 fence，同时装了 `dsh-remote-web-ui` 时有效的已配对设备 cookie 也是放行路径）；浏览器无法对任意目录执行 git，LAN 暴露的 dsh web 对未配对的非 loopback 客户端返回 403。
- 切换语义是工作区级：`git switch --no-guess <branch>` 作用于 repoRoot 磁盘树，影响该工作区所有会话；项目切换 = 激活目标工作区并打开其（复用或新建的）空白会话，不给既有会话换 cwd。
- 挂载 seam：`conversation.input.dock`，即 shell 为自己的队列 dock 与 todo dock 声明的 composer dock。注册经 `slots.inject` 等待该声明（裸 `register` 对未声明槽位会被拒绝），没有第二个座位。分支胶囊只在空白会话显示；无会话 cwd、非 Git 工作区或会话不再空白时自行隐藏。此时 chip 重新定位到官方 hero 行 agent-preset 座位右侧（官方 2px 行间距、垂直居中，胶囊尺寸与 token 对齐官方工作区/预设胶囊），弹层向下打开、对齐官方工作区菜单。React 会把 portal 子节点追加到该行末尾，因此 chip 随后把自己插到行尾 options 组之前——该组以 `margin-left: auto` 顶到右边缘；没有这一步，chip 会落在输入卡片右上角而不是预设胶囊旁边。active 会话没有分支选择控件。
- 工作区选择不在此插件内：官方工作区胶囊（`conversation.input.selector.workspace`）是唯一入口，本插件只提供 git 分支上下文。
- 分支状态刷新：空白会话 chip 挂载、弹层打开、切换成功后拉取，加上 host SSE（`/git/events`，订阅期间每 30s 轮询 workspace 状态，单次探测有 15s 超时兜底，挂起的 git 不会卡死推送流）推送外部变更和 window focus 刷新（5s 节流）。active 会话不订阅。SSE 流经跨标签页选主中继共享（Web Locks + BroadcastChannel），同一 URL 全浏览器只保留一条流，多开标签页不会挤占同源 HTTP 连接池（#383）。

## 检查链

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。
