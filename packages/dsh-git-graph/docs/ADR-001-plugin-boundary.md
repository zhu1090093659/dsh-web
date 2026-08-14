# ADR-001 — dsh-git-graph 插件边界与加载链调研结论

状态：已实现。日期：2026-08-09。

> 修正（2026-08）：分支 chip 挂载槽位为官方声明的 `conversation.input.selector.context`（list、session-maybe 作用域），与官方工作区选择胶囊并排。此前 acbcf80 曾把 chip 迁到 `conversation.input.dock`，理由是「selector-context 洞在 rc.6 从未声明」——该前提不成立：随发行 shell 的 apply.ts 同时声明了 selector-context（session-maybe）与 dock（session），selector-context 才是分支 chip 的正确席位，现已回迁。hero（空白会话）与 active 会话相位都挂载；见 README 挂载 seam。

## 背景

需求：在 dsh Web 常驻会话 header 行提供「git 分支选择器 + Git 图谱」，紧跟官方工作区选择器旁。git 能力必须在 host 进程执行（磁盘工作树真实 `git switch`），UI 在浏览器 React（`packages/client/*`）。需要先回答两个问题：外部插件能否向 Web 客户端注入模块、host 侧 RPC 是否可扩展。

## 问题 1：Web 客户端的外部插件加载链 —— 可行，且已有生产先例

- `packages/client/modules`（`@deepseek-ai/dsh-client-modules`）node half 扫描 host Loader 条目中声明了 `dshClient: { platform: 'web' }` 的包，组成 `window.__DSH_BOOT__` 条目图，并伺服 `/plugins/<id>/client.js`（bundle 是闭包工厂产物，交给 `window.__ModuleLoader__.load({ id, factory })`）。
- 条目解析锚点是配置树的 `ctx.baseUrl`（cordis.yml 所在目录的 package 依赖）。任何能由 Loader 解析、`package.json` 声明 `dshClient` + `exports["./client"]` 的包都能成为 Web 插件行——不要求包在主仓。
- 生产先例（本机 `~/.dsh/profiles/node_modules` 与 `~/.dsh/cordis.patch.yml`）：`dsh-client-ui-task-board`、`dsh-client-ui-skin-center`、`dsh-client-ui-subagent-tree`、四个 `skin-*` 皮肤全部是外部包，走同一条链。
- 浏览器 half 的 `apply(ctx)` 在 client-side cordis ctx 上运行，`inject` 按服务名等待（`slots`/`sessions`/`workspaces`/`connection`/`locale` 均为运行时服务）。外部 bundle 只能做 type-only 的 `@deepseek-ai/*` 导入（构建期纯度门），跨插件协作走 cordis 服务——无需主仓改动。
- 槽位注册：`ctx.slots.register` 可注册进别家声明的槽位；对 `conversation.input.selector.context` 这类无 waitable 服务的槽位，用「检查 `slots.spec(name)` 否则 `slots.subscribe(name)` 延迟注册」范式（`ui-goal` 的 GoalDock 是现成模板，`ctx.inject(['slots','conversation',...])` 以 conversation 服务在作为注册安全信号）。

## 问题 2：host RPC 可扩展性 —— RPC map 静态封闭，但 HTTP 载体面开放

- `packages/host/apiproxy/src/api/rpc-map.ts` 是编译期签名表，`toFetchHandler` 的 method 分发与 zod schema 均为静态；外部插件**不能**向 `/api/*` 增加类型化 RPC 方法（改主仓 rpc-map + schema + api-proxy 是唯一途径）。
- 但 `dsh-host-webserver` 的 `ctx.httpServer.register({ kind: 'prefix'|'exact', path, handler })` 是通用路由注册表（`client-modules` 的 `/plugins`、`client-connection` 的 `/api` 都注册在它上面）。**外部 host 插件可以注册自己的路由**，与页面同源，无需鉴权（localhost 工具形态）。

## 边界决策：方案 (a) —— 全部功能在 dsh-git-graph，主仓零改动

- host half（node half，`exports["."]`）：`GitService`（workspace 门卫 + 守卫 + 真实 git 操作）+ `/git/*` JSON 路由 + `/git/events` SSE 变更推送，全部经 `ctx.httpServer`/`ctx.subprocess`/`ctx.workspace` 服务接入。
- browser half（`dshClient` bundle，`exports["./client"]`）：注册进 `conversation.input.selector.context`（list、session-maybe、`order: 100`），自带中英文案词典（`ctx.locale.register`）。
- 激活：`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` + `dsh plugin --profile <name> add github:dsh-external/dsh-git-graph`（git 安装 + prepare 构建 + reconcile 进 `dsh.profile.bundles`）；本地开发用 `add link:<绝对路径>`。
- 主仓需提供输入选择器洞契约（`conversation.input.selector.workspace`/`.context`）与官方工作区选择器；本 ADR 的「主仓零改动」前提随产品决策（自研工作区选择器下线、分支选择器并入官方选择器行）作废，主仓契约变更走主仓验证链。

## 关键设计决策

1. **git 数据通道**：自有 `/git/*` 端点（拉取）+ `/git/events` SSE（host 每 2s 轮询一次已订阅 workspace 的 `rev-parse`/`symbolic-ref` 状态，变化即推送）。不用 session-projection：投影 seam 是纯 session 事件折叠，git 外部状态（如另一会话的 bash 工具切换分支）不产生 session 事件，放不进折叠模型；`useProjection('permissions')` 先例不适用。
2. ~~工作区语义~~：项目（工作区）选择已下线（产品决策：自研 WorkspaceChip 整体移除，工作区选择与 placeholder 由官方 header 入口全权负责）；本插件不再携带任何工作区动词。
3. **git 操作语义**：`git switch --no-guess <branch>` / `git switch --no-guess -c <name>`，在 repoRoot 执行，作用于磁盘工作树，影响该工作区所有会话。守卫（对齐 ZCode branchSwitcher 错误码）：未解决冲突（`conflicts-present`）、进行中操作（`operation-in-progress`，检查 MERGE_HEAD/CHERRY_PICK_HEAD/REVERT_HEAD/BISECT_LOG/rebase-merge/rebase-apply/sequencer 标记）、目标分支被其他 worktree 检出（`branch-in-other-worktree`，`git worktree list --porcelain`）、切换失败按 stderr 归类（tracked/untracked overwrite + 文件列表、target-branch-not-found、internal）。创建分支：客户端镜像 `check-ref-format --branch` 规则即时反馈 + host `git check-ref-format` 权威门 + 重名拒绝。
4. **安全边界**：`/git/*` 只接受「realpath 后等于某已注册 workspace.path」的路径（`ctx.workspace.list()`），浏览器无法对任意目录执行 git。
5. **输入选择器席位**：`conversation.input.selector.context` 是 session-maybe 洞——分支 chip 从冷启动到 active 全程挂载，与输入卡 dock 在一起（与卡片同款宽度配方）；无会话 cwd（pathOf 解析失败）或非 git 工作区（status 返回 null）时 chip 自行隐藏。hero（空白会话）有 cwd，分支胶囊照常显示——与官方工作区胶囊并排，两个相位一致。
6. **非 git 工作区降级**：分支 chip 隐藏（status 返回 null 即不渲染）。隐藏优于禁用：不产生死控件，且工作区变仓库后自动出现（SSE/打开弹层时刷新）。
7. **刷新策略**：chip 挂载时拉取、弹层打开时重新拉取、切换/创建成功后刷新、SSE 推送与 window focus 触发刷新。
8. ~~「远程连接」占位~~：随项目选择器一并下线（`WorkspacePopover` 移除）。
9. **包结构**：外部单包不按主仓三包缝拆分（interface/impl/consumer 是主仓能力缝约定）；内部按 core（纯函数）/host（服务+路由）/client（组件）分层，`GitRunner` 缝使测试用普通 child_process 替代 subprocess 服务。
10. **Git 图谱**：`git log --branches --tags --remotes --topo-order --parents --format=…` 数据 + 客户端泳道算法（`computeLanes`，首父续道、旁支开道、合并汇入），等宽字体渲染 lane 列 + ref 标签；只读，分页加载。

## 代价与限制

- `/api` RPC 通道封闭意味着 git 端点不走类型化 RPC（无 zod schema、无 RpcError 词汇），但本地工具形态下同源 JSON 端点足够。
- 分支状态不是 session 投影，切分支不会写 session log——符合「UI 触发的宿主操作不进入模型可见面」。
- 打开文件夹流程随项目选择器下线；工作区切换（含 draft 搬运）由官方 header 入口承担。
