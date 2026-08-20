# dsh-git-graph

[English](README.md) | 中文

外部 dsh Web GUI 插件：**git 分支选择器**与**Git 图谱**面板。分支选择器只在空白会话显示，挂在官方输入选择器行的 context 洞（`conversation.input.selector.context`，session-maybe list 槽位）中，与官方工作区选择胶囊并排。若运行 shell 未声明该槽位（npm SDK rc.6 删除了它），等待 `CONTEXT_FALLBACK_MS` 后回退到 `conversation.input.dock`；在其空白会话 hero 相位，chip 会提升进官方 hero 行，紧贴 agent-preset 座位右侧，采用与官方工作区/预设胶囊一致的透明 28px 胶囊配方和 `--dsw-*` 主题 token。active 会话不提供分支选择控件。git 能力在 host 进程执行（磁盘工作树 `git switch`），UI 在浏览器 React；工作区选择保留官方入口。

行为对齐 ZCode 的 `GitBranchSwitcher`：可搜索弹层、当前项打勾、「创建并检出新分支… / Git 图谱」底部操作、切换守卫（未解决冲突 / 进行中操作 / 目标分支被其他 worktree 检出）与可读报错。

## 仓库布局与构建

与 DeepSeek Harness 主仓保持同级（sibling checkout，turtle-ui 同款布局；路径任意，以下仅为示例）：

```text
~/code/deepseek-harness   # deepseek-harness checkout（sibling）
~/code/dsh-git-graph      # 本仓库
```

peer APIs 全部来自 sibling checkout 的源码（tsconfig 通过 `../deepseek-harness/tsconfig.base.json` 的 paths 解析；sibling 目录名不同时把 tsconfig 各文件里的 `../deepseek-harness` 相对路径换成实际目录即可），类型门是 `pnpm run typecheck`（`tsc -b`，会连带构建 references 指向的 sibling 包，向 sibling 的 `lib/` 写声明产物——与 turtle-ui 相同的设计）。

```sh
pnpm install
pnpm run typecheck   # tsc -b（含 sibling 引用项目）
pnpm test            # vitest（core 纯函数 / 真实 git 服务 / jsdom 组件）
pnpm run build       # tsc -b && tsdown（lib/index.js + lib/invariant.js + lib/client.js）
```

`lib/client.js` 是浏览器 bundle（闭包工厂产物，`window.__ModuleLoader__.load`），由 host 的 client-modules 按 `/plugins/<id>/client.js` 伺服；构建预设 `build/tsdown.client.ts` + `build/web/src/platform.ts` 是从主仓 `packages/client/tsdown.client.ts` / `packages/client/web/src/platform.ts` 复制的副本，主仓版本变更时需同步。

git 安装（无 sibling checkout 的消费者机器）走 `prepare` 脚本：`tsdown --config tsdown.prepare.config.ts` 从 src 直接 transpile，不做类型检查（`tsconfig.prepare.json` 自包含）。

## 激活

本包是 dsh profile bundle（`package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`）。激活后，下次启动 `dsh web`（或对应 profile）时，bundle patch 的 insert 行把 `ui-git-graph`（host half：git 服务 + `/git/*` 路由）与浏览器 half（dsh.client 声明）一起装进 Web 组合；页面刷新后，空白会话的分支胶囊显示在 hero 行的 agent-preset 座位右侧，active 会话不显示该控件。

### 通用安装（任何机器）

本插件已并入 dsh-web-ui 全家桶仓库（`github.com/zhu1090093659/dsh-web-ui`）。插件已发布到 npm，推荐一行安装：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-git-graph@latest
```

或直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all` 一次到位（同样一行 `dsh plugin --profile web add @linxin666/dsh-web-ui-all@latest`）。

需要改代码调试时再从仓库安装：

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-git-graph
```

> `github:` 安装方式适用于包位于仓库根部的独立仓库（`prepare` 脚本自包含构建；pnpm ≥10 首次会被拒绝，需按报错提示把包 key 加进 profile 的 `pnpm-workspace.yaml` `allowBuilds` 后重试）。monorepo 内的子包请用上面的 `link:` 方式。

### 本地开发循环（本仓库 checkout）

```sh
dsh plugin --profile <name> add link:/absolute/path/to/dsh-git-graph
```

`link:` 安装直接引用本地目录，重建后立即生效、无需重装（改完 `pnpm run build` 后刷新页面即可）。注意 `link:` 后跟的是绝对路径（`~` 由 shell 展开，不是 pnpm 语义）。

## 卸载

```sh
dsh plugin --profile web remove @linxin666/dsh-client-ui-git-graph
```

## 设计要点

- 边界与加载链调研、关键决策见 [docs/ADR-001-plugin-boundary.md](docs/ADR-001-plugin-boundary.md)。
- host half 的 `/git/*` 只接受已注册 workspace 的路径（realpath 校验）与受信任客户端（loopback socket + loopback Host，与 dsh-ssh 相同的 fence，同时装了 `dsh-remote-web-ui` 时有效的已配对设备 cookie 也是放行路径）；浏览器无法对任意目录执行 git，LAN 暴露的 dsh web 对未配对的非 loopback 客户端返回 403。
- 切换语义是工作区级：`git switch --no-guess <branch>` 作用于 repoRoot 磁盘树，影响该工作区所有会话；项目切换 = 激活目标工作区并打开其（复用或新建的）空白会话，不给既有会话换 cwd。
- 挂载 seam：`conversation.input.selector.context`（官方声明的 session-maybe list 槽位）是输入选择器行的 context 洞，与官方工作区胶囊并排。分支胶囊只在空白会话显示；无会话 cwd 或非 Git 工作区时自行隐藏。声明感知回退会等待该槽位声明 `CONTEXT_FALLBACK_MS`（npm SDK rc.6 的 shell 已删除此声明）；超时未声明时，改在 `conversation.input.dock` 的空白会话 hero 相位挂载。此时 chip 重新定位到官方 hero 行 agent-preset 座位右侧（官方 2px 行间距、垂直居中，胶囊尺寸与 token 对齐官方工作区/预设胶囊），弹层向下打开、对齐官方工作区菜单。active 会话没有分支选择控件。只挂一个座位，回退后迟到的 context 声明被忽略。
- 工作区选择不在此插件内：官方工作区胶囊（`conversation.input.selector.workspace`）是唯一入口，本插件只提供 git 分支上下文。
- 分支状态刷新：空白会话 chip 挂载、弹层打开、切换成功后拉取，加上 host SSE（`/git/events`，订阅期间每 30s 轮询 workspace 状态，单次探测有 15s 超时兜底，挂起的 git 不会卡死推送流）推送外部变更和 window focus 刷新（5s 节流）。active 会话不订阅。SSE 流经跨标签页选主中继共享（Web Locks + BroadcastChannel），同一 URL 全浏览器只保留一条流，多开标签页不会挤占同源 HTTP 连接池（#383）。

## 检查链

```sh
pnpm run typecheck
pnpm test
pnpm run build
```
