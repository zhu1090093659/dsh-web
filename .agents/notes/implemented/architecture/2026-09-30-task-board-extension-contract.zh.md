# Agent Note: Task Board external provider extension contract

Status: implemented

可选的提供方来源分组由 [Task board source grouping](2026-10-31-task-board-source-grouping.zh.md) 扩展进客户端能力面。

本决策部分替代 [GitHub Issues as Task Board work items with controlled write-back](../feature/2026-09-30-task-board-github-issues-integration.md)：该 Note 关于 GitHub 端点侧的决策（入站 Issue 发现、受控标签写回、执行不可变、停用不丢历史、Host 侧凭据、PR 生命周期、故障隔离）依然有效，但它记录的依赖方向与存储耦合被下面的契约取代。

## Problem

看板过去把 GitHub 内联在自己身上，每一处内联症状都是边界缺陷，第二个提供方会把它们放大。

- **依赖方向反转**：看板 import GitHub 并在自己的 host 入口里 new `GitHubApiClient`，于是看板知道了提供方词汇，离开它就无法构建、也无法推理。
- **存储层被穿透**：`GitHubSyncService` 直接持有 `HostTaskLedger`，账本长出了提供方专用 API（`findTaskByGitHubIdentity`、`updateTaskIntegrations(Partial<GitHubTaskMetadata>)`），提供方得以绕过看板自身的权威。
- **不变量被复制**：提供方的 `shouldRefreshContent` 漏了 `archivedAt`，而看板的 `canEditTaskContent` 才是正解；同一条规则的两份实现会漂移。
- **看板硬编码提供方策略**：卡片可见性直接检查 `integrations.github.deactivated`，提供方的浏览器 UI（详情区、设置摘要、过滤索引）住在看板文件里。

## Decision

一份外部提供方契约是唯一事实源。提供方包按契约实现，绝不 import 看板内部；GitHub 是它的第一个实现，落在 `packages/dsh-task-board-github`，看板自身不出现任何提供方名字。

1. **服务**：host 与浏览器半区各发布一份 cordis 服务，名 `taskBoard`；API 版本常量为 `TASK_BOARD_API_VERSION = 1`。提供方声明自己编译所依据的版本；任何其他版本都被可见地拒绝（记录并抛出），且不打扰看板。宿主服务另外承载一个给**宿主进程内消费者**用的窄读写面——`snapshot()`、`apply(requestId, action, initiator?)`、`subscribe(listener)`、`verificationOptions()`，每一个都是宿主同名方法的转发——远端面正是经它驱动看板，而不走 HTTP 跳转；见[经两道增量扩展缝把看板搬到远端面](2026-10-17-task-board-on-the-remote-surface.zh.md)。它不属于提供方契约：提供方仍只通过本记录定义的能力面到达看板。
2. **子席位**（看板声明、提供方注册）：`task-board.detail.section`，props `{ task, dispatch }`；`task-board.settings.section`，props `{ dispatch }`；`task-board.card.decoration`，props `{ task }`。看板注册组件在 `register` 的 `children` 选项声明这三个键，并用 `renderSlot` 消费；renderSlot 经内部 React context 穿透到 `TaskDetail`、卡片与设置卡。跨包提供方不得 value import 看板；各自在自己包内用同形 `declare module` 重新声明这三个键。
3. **宿主能力面**（交给提供方的 `TaskBoardExtension`）：`tasks.{ list, get, create(draft, { payload, hidden }), patchContent(taskId, { title, description, prompt }), setStatus(taskId, status, initiator), linked() }`；`integration.{ read(taskId), write(taskId, payload) }`；`events.{ onStatusChanged, onExecutionSettled, onTaskDeleted }`（各返回取消订阅函数）；`publish(summary)`（只读摘要，经 `snapshot.extensions[id]` 回传给该提供方的 client 半区）；以及 `registerTool(definition)`（模型可见工具，随「看板 enabled x 扩展 enabled」收放）。同一能力面以可选成员、同一 `TASK_BOARD_API_VERSION = 1` 再提供两项能力，因此提供方先探测再使用，按早先形状编译的提供方无需任何改动：`sessions.followUp(taskId, text)` 把一条后续用户消息投递到卡片当前执行所在的会话，没有执行在跑时投递到它最近一次的会话，且不重新声明该次执行的权限、模型或预设；`tasks.rework(taskId, instructions, initiator)` 在同一个会话里重跑一张已执行过的卡，把返工指令作为本次运行的附加输入，并记录在它开启的那条执行记录上。返工要经过看板既有的每一道运行门禁——运行锁、权限确认、验收契约、花费上限——并且绝不改写已冻结的标题、描述与 Prompt。两者遇到下列情形都以可诊断的拒绝返回看板自己的理由：卡片不存在、卡片已归档、卡片从未执行过、返工一张正在运行的卡、卡片的历史执行没有记录会话、宿主已无法到达该会话，以及文本为空或超长。`create` 接收的 draft 是 `title`、`description`、`prompt` 加可选的 `status`、`parentId`、`workspaceId`，以及三个执行目标 `mode`（agent preset）、`model`（`provider/model`）与 `reasoningEffort`，原样转交看板自己的建卡路径：调用方给的值在那里优先，父卡的钉子补齐其余，看板的新建默认值不参与（这道面从不 opt in），未知的 preset 或模型也不在建卡时判死——它在运行时按既有规则 fail closed，与任何别处建出来的卡一致。draft 刻意不含 `permission`：这样建出来的卡照旧要先过看板自己的人工确认门才能跑。
4. **客户端能力面**（看板浏览器半区提供）：`dispatch({ extensionId, action, taskId?, payload? })` 经看板同源 action 通道投递（提供方不新增 HTTP 面）；`registerVisibility(predicate)` 卡片可见性谓词（取代看板硬编码的 deactivated 判断）；同一 API 版本的可选 `registerGrouping(selector)` 提供方来源分组，支持 pending 重放与挂接后注销；以及 `subscribe(cb)` / `snapshot()` 订阅看板任务镜像与已发布摘要。
5. **Wire 与账本**：`TaskRecord.integrations` 是不透明 `Record<string, unknown>`，只校验为纯 JSON 对象且单条不超过 64 KiB；三个 `github-*` action kind 收敛为 `{ kind: "extension-action", extensionId, action, taskId?, payload? }`；快照专用 `github` 字段是 `extensions?: Record<string, unknown>`。不做账本 schema 迁移。**凭据不出网**：出站投影（`src/core/wire-projection.ts`）会把每条扩展载荷里凭据形状的键剥掉——按整键、大小写不敏感、任意深度匹配 `leaseToken`、`lease_token`、`token`、`secret`、`password`、`apiKey`、`credential`——HTTP `state`、`action` 应答与远端桥 `board.snapshot` 序列化的是剥过的副本，账本则原样保留，供提供方进程内 `integration.read` 取回。因此需要凭据的扩展只能在 Host 侧读取，不能指望它从看板快照回传。
6. **不变量上收**：`patchContent` 复用 `canEditTaskContent`（执行过或已归档的卡保留已记录内容）；`setStatus` 走看板既有门禁（运行中锁与手动列规则）；事件回调失败以 try/catch 加记录隔离，绝不打断执行；身份索引归提供方（看板不提供 `findTaskByGitHubIdentity`）。
7. **开关三态优先级**：loader 行禁用（需重启，最重）高于扩展 `enabled`（volatile，默认 true，即时惰性：停轮询、停写回、注销工具、隐藏席位、不清数据）高于看板总开关（随之静默一切）。
8. **看板（含共享副本）不出现提供方词汇**：扩展的提示词段落 order 取家族通用的 `EXTENSION_TOOL_SECTION_ORDER` 槽位，排在它所依附的插件之后，而不是 `PLUGIN_TOOL_SECTION_ORDERS` 里的逐包条目。看板同步到的家族 tool-surface 副本因此不含任何提供方名字，`grep -rn github packages/dsh-task-board/src` 为空。这一点部分替代 [Family tool-surface conventions](../feature/2026-10-02-family-tool-surface-conventions.md) 记录的逐包 order 表。

## Context & Efficiency Impact

契约新增一个小小的共享类型模块，加一个 host 注册表与一个浏览器服务；看板快照多一个可选的不透明映射、少一个提供方形状的字段，所以 wire 载荷体积不变。提供方不再复制看板规则，看板自身的 context 也不再出现提供方名字。注册表会缓存提供方的工具定义，因此晚到的工具注册表仍能领养它们，代价是每个提供方一个数组。

## Alternatives considered

**用提供方信封加宽 wire，并把账本迁移到分布提供方的类型化 schema。** 被拒：为一个可以用加法表达的边界重写用户的耐久数据，而且账本里的类型化提供方槽位会把看板重新耦合到提供方词汇——正是本契约要消除的缺陷。

**让每个扩展自持存储，看板只保存任务 id。** 被拒：看板必须对任务生命周期与执行保持权威（Host 执行、结算与删除必须对每个提供方可见，GUI 也只镜像一本账），扩展自持存储无法承担这个唯一权威。

**让每个扩展注册自己的 HTTP 路由，浏览器直接与其通信。** 被拒：这会成倍增加同源面及其访问控制，而看板已经拥有一条受保护的同源 action 通道可供 `dispatch` 复用。

**把三个席位声明成固定的组件 props，而不是 slot 注册。** 被拒：那样看板必须在构建期枚举提供方，安装一个提供方包无法把它加进来；子席位注册让提供方集合在运行时保持开放。

## Consequences

- **契约不是 GitHub 形状**：消费全部能力的假 provider 通过 `packages/dsh-task-board/tests/extension-fake-provider.spec.ts`，迁移后的 `github-*` 套件归提供方包并保持全绿。`packages/dsh-task-board/tests/extension-contract.spec.ts` 的契约测试证明：注册按 id 幂等；`apiVersion` 不匹配以可诊断错误被拒且看板继续服务；看板 x 扩展开关门禁能启动与停止提供方；工具随其注册与注销；一个抛错的事件回调被隔离，健康回调照常运行；`patchContent` 拒绝已执行过的卡；`setStatus` 拒绝运行中的卡；非 JSON 与超限载荷被拒；建卡时给的执行目标按调用方给的值原样存下，不传即不钉任何目标、传空值则被清除；提供方 action 带着不透明载荷原样路由回来。`packages/dsh-task-board/tests/extension-sessions.spec.ts` 对同一套真实注册表与宿主服务证明这两项可选能力：后续消息进入运行中执行所在的会话，也进入已结算卡片最近一次的会话；返工在已记录的会话里继续而不新开会话，且已冻结的卡片内容保持原样；卡片不存在、卡片已归档、卡片从未执行过、卡片仍在运行、会话不可达与文本为空各自被拒。第二个提供方只需新增一个包，看板不变。
- **席位会随看板自身的面板注册一起塌缩**，所以提供方必须在看板每次重新启用时依据 client 镜像重建席位；因此提供方必须把席位注册视为幂等且廉价。
- **不透明 integrations 把提供方校验推给提供方**：畸形的提供方载荷不再导致账本行被丢弃，提供方必须在读取时校验自己的条目。
- **可见性谓词会在看板每次渲染时运行**，所以 `registerVisibility` 谓词必须保持为对任务的廉价纯函数。
- **看板只在注册、看板总开关与工具注册表重绑时重新求值「看板 x 扩展」这道闸**，因此自行翻转自己 `enabled` 开关的提供方仍需自行释放自己的表面——参考实现正是通过 dispose 掉自己的注册来做到这一点（连同它的工具与已发布摘要一并释放）。
- **最重的那一档开关需要重启**：被禁用的 loader 行不在看板的触及范围内，因此运行时对账的提供方无法撤下 loader 从未插入的行。
