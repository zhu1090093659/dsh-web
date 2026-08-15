# dsh-task-board — DSH web GUI 任务看板插件

[English](README.md) | 中文

一个可热插拔的 DeepSeek Harness (DSH) 客户端 GUI 插件：在侧边栏「新会话」下方增加 **任务看板**入口，点击后中间列整体切换为多列看板视图；任务以 DSH 自身的会话机制 **真实执行**（`session.prompt`），执行状态实时回写卡片。

- 不修改 DSH 源码：以 cordis 插件 + 浏览器 DOM 扩展挂载（外挂形态与 `dsh-web-ui/packages/skins/skin-center` 一致）。
- 卸载即恢复原状，其它 managed 段（dsh-skin / skin-center / 个人配置）互不干扰。
- 任务数据本地持久化，刷新页面、重启 DSH 均不丢失。

## 功能

- **侧边栏入口**：侧边栏列（旧版 `[data-pane="sidebar"]`，DSH 0.1.0-rc.6 AppFrame 布局为 `[class*="sidebarCol"]`）内、新会话按钮下方注入「任务看板」入口行（宽栏显示图标+文字，折叠 rail 显示纯图标，随 DSH 皮肤 token 自适应）。
- **多列看板**：待规划 / 待办 / 进行中 / 已完成 / 已失败 五列；卡片显示标题、描述、状态、更新时间、执行次数；顶部支持搜索过滤、新建任务、返回对话。
- **任务详情**：点卡片打开详情（标题/描述/执行 Prompt/执行记录），**不会**一点就执行；详情内提供「执行 / 重新执行」「删除（带确认）」「查看会话（跳转到执行 transcript）」以及手动移到待规划/待办。
- **真实执行**：点「执行」后，插件通过客户端 runtime 连接工作区会话（`workspaces.connectWorkspace`，空白会话复用或 host 新建），把任务标题设为会话名，以任务 Prompt 调用 `session.prompt([{ type: 'text', text }], 'queue')` 驱动真实 agent；随后订阅该会话快照，轮次真实结束后把卡片置为 已完成/已失败 并记录执行结果。执行会话会出现在会话列表，可点进对话查看真实 transcript。
- **任务级执行目标**：任务可钉住「在哪跑、怎么跑」——**工作区**（执行会话落在指定工作区）、**模式**（会话以指定 agent 预设组合，趁会话仍为空白时走 `agentPresets.select` 切换）、**权限**（经 `/permission <id>` 斜杠命令应用的沙箱预设：read-only / workspace-write / danger-full-access）。留空即回退运行时默认（最近工作区 / 部署预设 / 会话默认）。钉不住的目标会在发 Prompt **之前**失败，任务绝不会悄悄按没要求过的设置运行。
- **状态回写**：卡片状态（进行中 → 完成/失败）由真实会话状态驱动；刷新页面/重启后，遗留的 running 任务会按会话现状自动对账（reconcile）。
- **定时任务**：详情面板可为任务配置定时执行——启用开关 + 5 段 cron 表达式（分 时 日 月 周，支持 `*` / `*/n` / `a-b` / 逗号列表）+ 常用预设（每天 09:00、每小时、每 10 分钟、每周一 09:00）；启用即计算并持久化「下次运行时间」，卡片显示定时标识；到点自动走真实执行链路（同手动执行），执行会话照常可跳转。
- **系统提示词注入**：host 半边（`src/index.ts`）通过 `SystemPrompt.section` 注册 `plugin:task-board` 段（order 200），向每个 agent 声明本插件存在、能力与限制——插件在组合中（mount 后重启 DSH）即注入，移出组合（unmount 后重启）即消失，agent 无需任何外部文档就能知道如何与本看板协作。

## 目录结构

```
package.json / tsconfig.json / tsdown.config.ts   # 独立仓库构建
build/tsdown.client.ts + build/web/src/platform.ts # 从 DSH checkout 复制的 client bundle 预设（与运行版本保持同步）
src/index.ts / src/invariant.ts                    # host 半边：仅注入 SystemPrompt section（其余无行为）
src/client/index.ts                                # apply(ctx)：接线 runtime 服务 + 挂载 DOM
src/client/sidebar-entry.ts                        # 侧边栏入口注入（自愈式 MutationObserver）
src/client/board-mount.tsx                         # 中间列看板挂载 + 显隐切换
src/client/board/*.tsx                             # React 看板视图（列/卡片/详情/新建/确认）
src/client/board.module.css                        # 样式（--dsw-* token，随主题/皮肤自适应）
src/core/tasks.ts                                  # 任务模型 + 状态机（纯函数）
src/core/schedule.ts                               # cron 解析 + 下次运行时刻（纯函数）
src/core/scheduler.ts                              # 浏览器调度器（每分钟 tick 触发到期任务）
src/core/store.ts                                  # 持久化（TaskStore 接口 + localStorage 实现）
src/core/execution.ts                              # 真实执行服务（会话连接/prompt/结算观察）
src/core/controller.ts                             # 控制器（台账状态、视图状态、导航感知）
tests/*.spec.ts                                    # 存储/状态流转/执行触发/cron/调度 自动化测试
scripts/dsh-task-board.js                          # 一键挂载/卸载/状态 CLI
```

## 为什么这样接（调研结论）

- **侧边栏没有可用的外挂槽位**：侧边栏壳只声明 `sidebar.workspaces` / `sidebar.settings` 两个 single 槽位，且已被 ui-workspace / ui-settings 占用；外部插件无法注册新槽位（声明即占有，重复声明抛错）。因此入口行走 skin 先例的 **DOM 注入**，并用 MutationObserver 自愈（React 重渲染波及该节点时同帧内重新插入，无闪烁）。
- **中间列无法通过槽位替换**：`conversation` 槽位是 single 且已被 ui-conversation 占用。看板视图以 DOM 方式挂在中间列（旧版 `[data-pane="conversation"]`，DSH 0.1.0-rc.6 AppFrame 布局为 `[class*="centerCol"]`；挂载选择器两者都保留）内（React 不管的尾部子节点），通过 `<html data-dsh-taskboard-active>` 属性切换显隐，底下的对话子树保持挂载有状态。
- **持久化用浏览器 localStorage**：客户端插件跑在浏览器里，DSH 没有浏览器可写的文件通道（与 skin-center 对 `cordis.patch.yml` 的调研结论一致）；localStorage 也是 DSH 客户端自身快照存储（`createSnapshotStore` persist）的持久化方式。
- **执行走客户端 runtime**：`ctx.sessions.list` 订阅会话状态（`running` / `byId`），`ctx.workspaces.connectWorkspace()` 创建/复用会话，`session.prompt()` 真实驱动 agent，`ctx.sessions.open()` 跳转 transcript。
- **执行目标走同样的 runtime 脸**：工作区钉子把任务指定的 id 传给 `workspaces.connectWorkspace()`（先对照工作区列表校验，失效的钉子就地失败）；模式钉子通过 `api.agentPresets.select` 重组仍为空白状态的执行会话——只有首轮之前合法，所以排在 `session.prompt` 之前执行，`sessions.noteAgentPreset` 让会话列表标签即时更新；权限钉子经 `session.command` 提交 `/permission <id>` 斜杠命令——与壳自带权限选择器同一机制。提交被拒或没有命令认领该行时，在发 Prompt 前失败。
- **后台结算靠列表对账**：未打开的会话没有对话快照窗口（cold），所以执行结算以会话列表为准——每次列表变化都对账 running 任务；结果判定依次取「列表缺失→已取消 / 仍在跑→等待 / 对话快照可见→按 lastAgentError / 原始历史尾部→turn-error 节点证明失败 / 否则按成功」，对账幂等。
- **定时任务在浏览器端调度**：插件是纯客户端（无服务端通道），所以「到点执行」由标签页内的调度器完成——每分钟 tick 一次，页面从后台恢复可见时立即补 tick；到点触发前先把「下次运行」顺延到下一个 cron 匹配点再执行，同一 tick 不会重复触发；页面加载早期（会话列表基线未就绪）不触发，避免误执行。限制：需要标签页保持打开（关闭期间错过的调度按「错过即跳过」处理，下次打开时只补跑已顺延的到期任务）；任务处于「进行中」时到点跳过本次，等下一个 cron 匹配点。
- **多标签页同源共享同一份台账**：任一标签页的增删改通过 storage 事件同步到其他标签页（`LocalStorageTaskStore.subscribeExternal`），删除的任务不会在其他标签页的内存副本里残留触发，也不会被其他标签页的后续持久化写回复活。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board

```

安装后**重启 `dsh web`**，侧边栏「新会话」下方出现「任务看板」入口即生效；页面刷新不够，需重启进程。

## 构建

前置：Node ≥ 20，官方 NPM SDK 可访问（若仍使用私有 scope 认证则配置 `NPM_TOKEN` 环境变量 + 项目 `.npmrc`，见仓库 `docs/plugins.md`）。类型与运行时 API 全部来自官方 NPM SDK（`@deepseek-ai/*` devDependencies），**无需任何 DSH 源码 checkout**。

```sh
cd ~/code/dsh-web-ui/packages/dsh-task-board
pnpm install        # 首次（workspace 根执行 pnpm install）
pnpm run build      # 产出 lib/index.js + lib/client.js（tsdown + shared/tsdown.client.ts 预设）
pnpm run typecheck  # 类型检查（node_modules 的 SDK 包类型）
pnpm test           # vitest：存储读写 / 状态流转 / 执行触发
```

## 挂载 / 卸载

本插件采用官方 profile-bundle 形态（package.json 声明 `dsh.bundle.patch` + `dsh.client`，见 `cordis.patch.yml`）。挂载 = 在 web profile 清单（`~/.dsh/profiles/web/package.json`）注册依赖与 bundle 行并安装：

```sh
# 挂载（dependencies + dsh.profile.bundles 注册，pnpm install；重启 GUI 后生效）
node scripts/dsh-task-board.js mount

# 查看状态
node scripts/dsh-task-board.js status

# 卸载（移除注册行；重启 GUI 后恢复原状；任务数据保留）
node scripts/dsh-task-board.js unmount
```

profile 清单中注册的行：

```json
{
  "dependencies": { "@linxin666/dsh-client-ui-task-board": "link:/Users/zcl/code/dsh-web-ui/packages/dsh-task-board" },
  "dsh": { "profile": { "bundles": [ "...", "@linxin666/dsh-client-ui-task-board" ] } }
}
```

> 注意：profile 层（bundle 行、`dsh.client` 元数据）在 dsh web 进程启动时读取，挂载/卸载后需要**重启 dsh web GUI** 才生效（页面刷新不够）。

## 数据存储位置

- 任务台账存于浏览器 localStorage，键 `dsh.taskBoard.v1`（来源为 `http://127.0.0.1:<dsh web 端口>`，同一来源跨刷新/重启持久）。
- 卸载插件后数据保留；如需清除，浏览器控制台执行 `localStorage.removeItem("dsh.taskBoard.v1")`。
- 存储层是 `TaskStore` 接口（`src/core/store.ts`），后续可换成 IndexedDB 或 host 文件通道而不动上层逻辑。

## 手动验证步骤

1. `npm run build` → `node scripts/dsh-task-board.js mount` → 刷新 `http://127.0.0.1:3080`。
2. 侧边栏「新会话」下方出现「任务看板」入口行；点击 → 中间列切换为五列看板。
3. 「+ 新建任务」填标题/描述/Prompt → 卡片出现在「待办」；对话框同时提供 工作区/模式/权限 三项钉子，留空即运行时默认。
4. 在对话框或详情里给任务钉上工作区/模式/权限 → 执行 → 执行会话落在指定工作区下，列表行显示指定预设，会话的权限选择器显示指定权限。
5. 点卡片 → 详情可见内容与 Prompt；点「执行」→ 卡片变「进行中」（会话列表出现以任务标题命名的会话）；agent 跑完后卡片落「已完成」或「已失败」，详情执行记录有结果与时间，可「查看会话」跳转到真实 transcript。
6. 定时任务：详情 →「定时运行」勾选启用，选预设「每 10 分钟」（cron `*/10 * * * *`），卡片出现定时标识；等待下一个整 10 分钟点，观察卡片自动进入「进行中」并最终完成，详情「上次触发」出现时间、执行记录新增一条（会话可跳转）。
7. 刷新页面/重启 DSH → 任务仍在；卸载插件 → GUI 恢复原状。

## 验收对照

- 挂载后侧边栏出现「任务看板」入口；点击切换看板，点会话项返回对话视图
- 新建任务（标题+描述/Prompt）；刷新/重启后任务仍在（localStorage 持久化）
- 点卡片开详情（内容 + 执行记录）；详情内有「执行」「删除」按钮
- 执行真实启动会话（会话列表可见 transcript）；卡片状态随真实执行进度变化；详情可跳转到执行会话
- 删除有确认环节，删除后本地存储同步移除
- 定时任务：cron 配置/预设/校验、下次运行时间、到点自动真实执行、状态回写、定时卡片标识、刷新后调度恢复（浏览器端调度，标签页需保持打开）
- 任务级执行目标：工作区/模式/权限 钉子刷新后仍在，驱动执行会话；钉不住的钉子（工作区缺失、预设被锁、权限命令无人认领）在发 Prompt 前失败，执行记录可见原因
- 一键挂载/卸载；卸载后 GUI 恢复原状，其它 managed 段不受影响
- README + 覆盖存储读写/状态流转/执行触发/cron 解析/调度器的自动化测试
