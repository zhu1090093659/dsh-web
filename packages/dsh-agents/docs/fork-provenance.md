# Agent Teams 运行期 fork 来源与改动清单

本文件归属 `packages/dsh-agents`：记录 M2 把官方 Agent Teams 运行期 fork 进本包时使用的**固定基线**、逐文件映射、未 vendor 的部分及原因，以及本包对上游代码做的**每一处**改动。除本文件列出的差异外，`src/team/` 与 `src/tools/` 的行为与上游一致。其中不可回退的几条另列在 [runtime-deltas.md](runtime-deltas.md)：那里的「为什么必须保持」是维护契约，改代码前先读。

## 基线

| 事实 | 值 |
|---|---|
| 上游仓库 | https://github.com/deepseek-ai/deepseek-harness |
| tag | `dsh-v0.2.2-alpha.3` |
| commit | `05b1cae8db6e674c5685101494d4eec24652424a` |
| agent-team **src/** 树哈希 | `08322f8f03faad9b0ee04c7e72d1b119b0158977`（`git rev-parse dsh-v0.2.2-alpha.3:packages/experimental/agent-team/src`） |
| tool-agent-team **src/** 树哈希 | `e8af5edce18085dce4ad2e6ec3946e0da3422190`（`git rev-parse dsh-v0.2.2-alpha.3:packages/experimental/tool-agent-team/src`） |
| 许可证 | MIT（上游仓库根 `LICENSE`，Copyright (c) 2026 DeepSeek） |

fork 对照固定在这个发布 tag，不使用持续移动的上游工作树；换基线必须同时更新本文件与本节四个哈希。

## 上游 2026-11-03 复核：spawn 支点已被移除，基线不动

复核上游 master 后确认：**我们 fork 的那一代运行期在上游已经不存在了**。这不是「落后几个提交」，因此基线刻意保持在发布 tag 上。

| 事实 | 值 |
|---|---|
| 上游复核点 | `8bd073392ee`（`dsh-v0.2.2-alpha.3` 之后 555 个提交，尚未发版） |
| 包位置 | `packages/experimental/{agent-team,tool-agent-team}` → `packages/team/{agent-team,tool-agent-team}`（不再是实验内容） |
| 包名 | `@deepseek-ai/dsh-experimental-*` → `@deepseek-ai/dsh-agent-team` / `@deepseek-ai/dsh-tool-agent-team`；两个新名字在 npm 上均为 404（未发布） |
| 上游删除的源文件 | `activity.ts`、`lifecycle.ts`、`persisted.ts`、`roster.ts`、`session-message.ts` |
| 上游删除的能力 | `spawn_teammate`，以及队内 `send_message` / `list_agents` / `interrupt_agent`；`TeamMembership`、`TeamMemberView`、spawn/send 请求与结果类型、`TeamWaitResult` 一并移除 |
| 上游保留的能力 | 四个任务工具 `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update`，加一段 `team:policy`——Team 现在只是原生 `subagent` / `subagent_fork` / `send_message` / `list_agents` 之上的**共享任务板** |

上游自己在 `docs/upgrade-guide/v0.2.1-rc.2/agent-team-subagents/guide.md` 里给出了迁移映射（`spawn_teammate` → `subagent`、`ctx.agentTeams.spawnTeammate` → `ctx.subagents.startActivation`、`tryMembership` → `rootOf`）。

**为什么这次不跟。** 本包的全部增量价值——成员定义的 preset / permission / model / reasoningEffort 钉住，在成员子会话建立之前解析、在首条提示 checkpoint 之前应用——挂在被删除的那条接缝上。上游的替代方案是「队友就是原生 subagent」，于是钉住只剩 `model` / `reasoning_effort` 两个参数，`preset` 与 `permission` 没有落点：跟这个基线不是重新 vendor，而是重写本包的 host 半区（run-gateway、service、squad、agent-tools、member-prompt）与全部运行期测试，并砍掉两个钉住维度。另外新运行期只存在于 master，没有 tag 可钉，对照表无法固定。

**今天怎么共存。** 官方运行期（任一代）在场时本包让位，细节见 [runtime-deltas.md](runtime-deltas.md)：服务名 `agentTeams` 只留一个所有者。新一代目前的装配位置是 base bundle（`packages/bundle/base/cordis.patch.yml` 里的 `agent-team` / `tool-agent-team` 两行），不是 profile bundle，所以「profile 声明了官方 bundle」这条前置判据看不到它；能兜住的是 `agentTeams` 服务探测，以及 `OFFICIAL_TEAMS_BUNDLES` 现在同时认 `@deepseek-ai/dsh-agent-team`（`tests/apply-inject.spec.ts` 两个 generation 各一条用例）。新一代的行为后果是：小队保留成员运行、账本与路由，而 squad 会话里 Lead 看到的 Team 工具面变成官方任务板。

**将来若要跟**，要做的是三件事，而不是同步：把钉住重做到原生 `subagent` 面（preset / permission 需要一个官方接缝，否则本包只能放弃这两个维度）；把 squad 自己的 `squads_*` 工具面与官方 `team_task_*` 的关系写清楚（谁记账、谁派发）；重写 `tests/team-runtime.spec.ts` 里按 legacy 运行期写的门禁断言。

## 逐文件映射

`src/team/`（对应 `packages/experimental/agent-team/src/`）：

| 上游路径 | 本包路径 |
|---|---|
| `src/activity.ts` | `src/team/activity.ts` |
| `src/client.ts` | `src/team/client.ts` |
| `src/error.ts` | `src/team/error.ts` |
| `src/index.ts` | `src/team/index.ts` |
| `src/journal.ts` | `src/team/journal.ts` |
| `src/lifecycle.ts` | `src/team/lifecycle.ts` |
| `src/persisted.ts` | `src/team/persisted.ts` |
| `src/projection.ts` | `src/team/projection.ts` |
| `src/roster.ts` | `src/team/roster.ts` |
| `src/session-message.ts` | `src/team/session-message.ts` |
| `src/task-board.ts` | `src/team/task-board.ts` |
| `src/task-graph.ts` | `src/team/task-graph.ts` |
| `src/task-view.ts` | `src/team/task-view.ts` |
| `src/types.ts` | `src/team/types.ts` |
| `src/validation.ts` | `src/team/validation.ts` |
| （无，本包新增） | `src/team/pins.ts` |
| （无，本包新增） | `src/team/services.ts` |
| 上游仓库根 `LICENSE` | `src/team/LICENSE` |

`src/tools/`（对应 `packages/experimental/tool-agent-team/src/`）：

| 上游路径 | 本包路径 |
|---|---|
| `src/index.ts` | `src/tools/index.ts` |
| 上游仓库根 `LICENSE` | `src/tools/LICENSE` |

每个 vendor 进来的文件头都带一节 provenance banner，指明上游 tag、commit 与上游路径，并把改动指向本文件。

## 未 vendor 的部分与原因

- `packages/experimental/client-ui-agent-team`：浏览器半区由另一个任务承担，本包不碰 `src/client/**`。
- `lib/types/invariant.js`、`lib/types/mailbox.js`：只存在于 app 的构建产物中，该 tag 没有对应源码，属于过期产物，不 vendor。
- `locale/en.json`、`locale/zh.json`：只含设置卡元数据（`meta.title` / `meta.description`），没有面向模型的字符串，因此不 vendor；本包的 locale 字典与第三语言 ru 由既有体系（`dsh-i18n`）承载。

## 我们对上游做的改动

1. **依赖改名（导入重写）**：`src/tools/index.ts` 原先从 `@deepseek-ai/dsh-experimental-agent-team` 取值与类型，改为从本包 `../team/types.ts` 导入 `TeamTaskId` 与 `TeamMemberView`；`src/team/types.ts` 新增 `import type { AgentsPermission } from '../protocol.ts'`，权限钉住的值域与本包既有契约同源。
2. **新增 `src/team/pins.ts`（本包新增文件）**：定义 `TeammatePins` 接缝（`resolvePreset` 与 `applyToSession`）。上游没有成员定义的钉住概念，这是 M2 的行为改动所在。
3. **`SpawnTeammateRequest` 增加四个可选钉住字段**：`preset`、`permission`、`model`、`reasoningEffort`（`src/team/types.ts`）。
4. **`TeamRoster` 注入 pins 并按序应用**（`src/team/roster.ts`）：构造参数新增 `pins`；`spawnAdmitted` 在**成员行与子会话存在之前**解析预设（兑现不了就以具名错误失败，不产生任何账本行或会话），把解析结果作为 `agentPreset` 放进 `startActivation` 的 request；子会话建立之后、`checkpointInitialPrompt` 之前应用权限与模型路由。上游的其余创建、失败回填与 provisioning 对账逻辑未改。
5. **`TeamService` 新增 `TeamServiceOptions`**（`src/team/index.ts`）：第三个构造参数携带 `pins`，传入 `TeamRoster`。
6. **去掉对全局 `Context` 接口的 augmentation**（`src/team/index.ts`）：上游用 `declare module '@deepseek-ai/cordis' { interface Context { agentTeams: TeamService } }`；本包同时看到 agent 与 subagent 的服务声明，再加一项会让任何 `Context` 属性读取的实例化深度溢出（`TS2589`）。改为本地 `TeamServiceContext`（`extends Context`，声明 `agentTeams`），运行时服务名仍是 `agentTeams`。
7. **事件监听返回 `undefined`**（`src/team/index.ts`、`src/tools/index.ts`）：cordis 的 `on()` 对该事件的监听签名要求 `Promise<undefined> | undefined`，上游的 `void` 箭头函数在本包 cohort 的声明下不成立；补 `return undefined`，行为不变。
8. **插件导出改为安装器**（`src/tools/index.ts`）：上游导出 cordis 插件三件套（`name` / `inject` / `Config` / `apply`）；本包是一个 bundle 行，改为导出 `installTeamTools(ctx, options)` 返回 `TeamToolInstallation`（`refresh()` / `dispose()`）。`Config` 的字段与默认值原样搬进 `TeamToolOptions`（`interrupt` 默认 `true`，`freshProvider` 默认 `'spawn'`，`forkProvider` 默认 `'fork'`）。
9. **工具安装门禁改为 Host 台账**（`src/tools/index.ts`，**与上游的行为差异，见下一节**）：除 `ctx.agentTeams.tryMembership(agent) !== undefined` 外，还必须 `options.isTeamSession(agent)` 为真。
10. **`spawn_teammate` 新增四个可选参数**：`preset`、`permission`、`model`、`reasoning_effort`，透传为 `SpawnTeammateRequest` 的钉住字段。工具名、描述与 `team:policy` 策略文本保持上游原文。参数对象提取为模块常量 `SPAWN_PARAMETERS`（见第 12 条）。
11. **`jsonOutput` 帮助函数的 render 参数类型放宽为 `unknown`**（`src/tools/index.ts`）：类型注解里带 `InferValue<S>` 时，`tsc` 在 `defineTool` 推断输出 schema 时会比较两个未解析的条件类型并触发 `TS2321`（栈深溢出）。运行时仍用同一份 `schema` 校验取值，模型可见的 JSON Schema 一字未改。
12. **`spawn_teammate` 的参数 schema 提取为 `SPAWN_PARAMETERS` 常量**：与第 11 条同因，避免在调用点被 const 泛型重新推断八个属性。
13. **文件头 banner**：所有 vendor 文件加 provenance banner（纯注释）。
14. **五个 Host 服务在挂载时经 `ctx.get` 解析一次**（`src/team/services.ts`，本包新增文件；`src/team/index.ts`、`src/team/journal.ts`、`src/team/roster.ts`）：上游把运行期当作 cordis 插件挂在它自己的 `inject` 行上，`agents` / `sessions` / `sessionPersistence` / `sessionProjections` / `subagents` 因此可以按属性直接读取。本包在插件行自己的 fiber 上 `new TeamService(ctx)`，该 fiber 的 `inject` 只有三个服务，而 cordis 对**未注入**服务的属性读取会抛 `cannot get property "<name>" without inject`——整个 `apply` 失败，页面随即报「Host API 未挂载」。因此 `TeamService` 在构造时把五个面解析一次（`serveTeamFaces`）、存进 `this.faces`，`TeamJournal` 与 `TeamRoster` 改为读同一份面对象；投影注册从 `ctx.root.sessionProjections` 改为读该面（同一个服务实例，注册位置不变）。上游的其余逻辑、`ctx.on` 事件监听与 `ctx.logger` 未动。
15. **手动挂载显式等待异步投影注册**（`src/team/index.ts`、`src/team/journal.ts`、`src/team/projection.ts`）：上游在类插件的 `Service.init` 中等待 `sessionProjections.register()` 并把 `ProjectionHandle` 交给 `TeamJournal`，同时移除 `SessionProjectionStateMap` augmentation；本包重放这三处变化。手动 `new TeamService` 不会触发类插件的 init 钩子，因此新增 `TeamService.create()` 显式等待同一个 init，pins 保存到初始化时交给 `TeamRoster`，挂载方在工厂完成后再安装 Team 工具。

## 行为差异：Team 工具只进「本 Host 启动的整队运行会话」

上游的 `TeamRoster.tryMembership` 对**任何**没有父会话的根会话都回答 `{ role: 'lead' }`（`roster.ts` 的两处兜底返回），于是 `tool-agent-team` 会把整套 Team 工具注入每一个普通顶层会话；这也是上游配套关闭原生 subagent 工具（`tool-subagent*`）的原因。

本包不采用这个取舍：

- 工具安装的门禁是**本包台账里确实存在一条整队运行记录**：`AgentsHostService.isSquadSession(sessionId, parentSessionId)` 命中该会话本身，或其父会话。普通会话（用户的日常对话、普通协调回合）看不到任何 Team 工具，也看不到 `team:policy` 段——该段只由安装器注册，不安装即不存在。
- `tryMembership` 仍然作为前置条件保留（`agentTeams` 必须认为它是成员），但不再是充分条件。
- 本包**从不**注册任何关闭原生 subagent 工具的插件行或配置；两套委派面并存。`tests/team-runtime.spec.ts` 里有一条测试遍历 `src/`、`cordis.patch.yml` 与 `package.json`，断言本包没有任何一处出现 `tool-subagent`。

## 投影契约（不得改）

`teamProjectionDefinition` 保持上游的 `key: 'agentTeam'` 与 `stateVersion: 4`：已落盘的投影与读取该 key 的消费方都依赖这两个值。`tests/team-runtime.spec.ts` 断言这两个常量，并断言每次挂载在 `root.sessionProjections` 上恰好注册一次。

## 验证

- `tests/apply-inject.spec.ts`：真实 cordis 树上五个服务由兄弟 fiber 提供、插件 fiber 只注入三个服务时，运行期仍能构造、在 root 上恰好注册一次 `agentTeam` 投影，并对 Lead 会话回答成员身份；同一文件还钉住「部署缺少五个服务时挂载台账路由并跳过运行期」与「安装器经 `ctx.get` 取服务」。
- `tests/team-runtime.spec.ts`：投影 key/stateVersion 与「恰好注册一次」、工具安装门禁（普通会话零工具、整队会话九个工具、`refresh()` 重扫）、pin 顺序（`preset → start → permission → model → checkpoint`）、未知预设与拒绝的模型路由以具名错误失败、以及「本包从不关闭原生 subagent 工具」的源码扫描。
- `tests/squad.spec.ts`：`team:squad` 上下文的两成员渲染（名称 / 预设 / 权限 / 模型 / 简报摘要）、整队运行记录先于首条提示落盘、Lead 预设与工作区的 fail-closed、M1 账本向后兼容。
- 运行：`pnpm --filter ./packages/dsh-agents test`。
