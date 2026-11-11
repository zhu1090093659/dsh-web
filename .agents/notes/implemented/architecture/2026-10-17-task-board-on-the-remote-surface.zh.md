# Agent Note: 经两道增量扩展缝把看板搬到远端面

Status: implemented

## Problem

远端桥（协议 v1）此前只服务会话、提示词、审批与宿主提问。任务看板——宿主权威的任务账本、调度与执行——完全没有远端面，于是一台手机可以发起回合，却看不到也驱动不了决定哪些回合会跑的那块看板。

有三条事实决定了这次修法的形状：

- **桥不能学看板的词。** 它的方法表与主题表由父卡冻结（§1–§11）；把 `board.*` 塞进去，等于把一个插件的业务放进每个客户端都要讲的协议里。
- **看板的 HTTP 面在宿主进程内够不到。** 它的路由按浏览器形状的请求守卫（`packages/dsh-task-board/src/host-routes.ts` 的同源与 `sec-fetch-site` 判定），进程内 `fetch` 去 `/api/task-board/*` 会被拒绝。而看板自己的能力面只是 `TaskBoardHostService` 实例上的方法，没有任何 cordis 服务发布它。
- **当时唯一发布的 `taskBoard` 服务只有提供方登记那一对方法**（`registerExtension`、`isExtensionEnabled`），它给提供方的是 `tasks.*` / `integration.*` / `events.*`——够 GitHub 式提供方用，离带 `scheduler` 与 `power` 的快照差得远，也没有施加任意动作的路径。

## Decision

看板经两道增量扩展缝和一个新包到达远端面，两道缝彼此都不认识对方的词。

1. **桥提供一道通用扩展缝。** `packages/dsh-remote-bridge` 发布 cordis 服务 `remoteBridge`，含 `registerMethods({ capability?, methods })`（返回 disposer）与 `broadcast(topic, payload, capability?)`。桥在自己的闸门之后派发已注册的名字——未注册的名字最先回 `unknown-method`，未配对连接回 `unpaired`（与协议方法一致），从未声明该表能力的客户端被告知方法不存在——并把插件的 `{ok, r}` 或 `{ok:false, code, msg}` 原样穿过。`hello` 回 `minor: 1`，主版本 1 与全部冻结字段、方法名、主题名都没有变化。同一道缝也决定握手公告什么：插件早已注册 `board.v1` 与其方法，而 `hello` 只回桥自己的静态 `SERVED_CAPABILITIES`，于是从握手读自己 `board.v1` 能力的手机判定这台宿主不提供 Tasks。现在答案取 `SERVED_CAPABILITIES` 与 `RemoteBridgeRegistry.capabilities()` 的并集——后者是注册表里各表所门控的去重、非空能力名，升序——每次握手现算，因此桥建好之后才挂载的插件对下一条连接也可见，而撤下的表会把它的能力名一起带走，除非还有别的方法要求它。
2. **看板多一个窄的进程内面。** `taskBoard` 服务增加 `snapshot()`、`apply(requestId, action, initiator?)`、`subscribe(listener)` 与 `modelCatalogOptions()`（随[移除任务验收](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.zh.md)与远端 seam 的 `BoardFace` 同步由 `verificationOptions()` 改名），每一个都是宿主同名服务方法的**转发**。发布出去的对象里没有闸门、没有归一化、没有状态，因此经这条路到达看板的消费者，被拒绝的规则与浏览器完全相同。原有两个成员一字未动。
3. **一个绑定包。** `packages/dsh-task-board-remote` 拥有看板的线路词表（`board.v1`、`board.snapshot`、应答 `{catalog, meta:{sessionDefaultPermission?, cardDefaults?, maxSubtaskDepth?}}` 的 `board.options`、`board.apply`、`board.changed`、`board-unavailable` / `board-refused`），结构化解析两个席位（`ctx.get` 加 `ctx.inject`，不 import 任何一方），只做形状转发、按连接的 `requestId` 重放与一波合并。所有业务判定——运行中锁、权限确认门、子任务深度、调度次数预算——留在账本里。

线路契约由 `iphone_remote_use_dsh/docs/protocol-v1.md` §12 冻结；本记录说明两道缝为何存在，不重复帧长什么样。

## 拒绝本版本没有实现的动作种类

能力面逐字转发调用方的 action 对象，于是开了个洞：HTTP 路由一直只是碰巧挡住了它。`parseActionEnvelope`（`packages/dsh-task-board/src/protocol.ts`）在动作到达账本之前就拒掉联合之外的 kind，所以账本自己的 `apply()` switch 从没见过未知 kind——而那个 switch 没有 `default`。一旦进程内调用方能把上游谁都没校验过的 action 交给 `TaskBoardHostService.apply()`，未知 kind 就直接落进 switch 末尾的 commit：revision 动了，文档没变，调用方收到 `ok`。代价不只是假的成功：每个在线客户端都会被 `board.changed` 叫醒并重取一次全量快照，因为线路上没有分页。

拒绝写在动作自己的地盘上——不放桥，也不放绑定插件，因为第二份规则正是本仓库反复付代价的那种缺陷：

1. `TaskBoardHostService.apply()` 用 `ACTION_KINDS`（`Record<TaskBoardAction['kind'], true>` 全量记录）校验 kind。联合新增成员而这里没登记就编译不过，因此这张表不会落后于协议。未知 kind 抛 `unknown task board action kind: <kind>`，它带着原文以 `board-refused` 穿过远端面（§12.3），且什么都不改。
2. `HostTaskLedger.apply()` 的 switch 补上了它一直缺的 `default`，作为纵深防御，防止将来出现一条绕过服务层直接到达账本的调用路径。

`tests/host-face.spec.ts` 固定三件事：经发布面的拒绝不动 revision、不动任务表、不触发任何订阅；直接持有的账本同样拒绝该 kind；遍历联合全部 kind 证明没有一种被当成未知——每一种要么被处理，要么按它自己的理由被拒。

## Context & Efficiency Impact

桥多了一张按方法名的注册表和一个每条连接的可选字段；没挂任何扩展时，`KNOWN_METHODS` 之外的名字只多一次 `Set.has`。看板在自己已经创建的服务对象上多四个转发，插件多一张按连接有界（128 键）的重放表和一个微任务合并器。账本 schema、看板自己的 HTTP 面与浏览器 bundle 都没有增加（插件是纯宿主半区）。为 `board.changed` 读一次 revision 要付一次完整 `snapshot()`，因为看板不提供只读 revision 的入口；合并器因此把它压成每波一次深拷贝，而不是每次变更一次。

## Alternatives considered

**让远端插件走 loopback 调看板 HTTP API。** 在动手之前就否决了：看板路由守卫只认浏览器形状的请求（同源或 `sec-fetch-site`），进程要做到就得假装成浏览器，而给一个消费者另开一套访问控制的故事，正是那道守卫要防的东西。宿主进程本来就有进程内通道——服务——用它才能只有一套授权模型。

**把整个 `TaskBoardHostService` 实例当服务值抛出去。** 否决：那个实例暴露账本、执行 runner、调度器与电源抑制器，消费者可以绕过本任务要保住的闸门，而且它的形状会变成每个消费者的承重契约。四个具名转发才是契约，其余保持私有。

**让插件自建传输（自己的 WebSocket 或自己的 HTTP 路由），而不是扩展桥。** 否决：第二条连接面会重复设备令牌、配对与能力判定——那正是远端面可信的来源——而手机还得带两个客户端。

**把 `board.v1` 写进 `SERVED_CAPABILITIES`。** 否决：那个常量说的是这座桥自己服务什么，而桥不是看板的作者——没挂看板的宿主会照样公告 `board.v1`，其背后的方法却回 `unknown-method`，这正是能力清单唯一不能说的一种谎。它还会让下一个面（计划、日志、第二个插件）继续变成同一个常量的又一处编辑，而这恰恰是这道缝要消掉的耦合。

**把并集算一次、存成进程级常量。** 否决：桥对象在任何插件注册之前就已存在，那时注册表还是空的，清单会在那一刻被截住，上面的症状会原样留下——看板在桥之后挂载，它的能力名永远不会被公告。并集只是每次握手走一遍集合，且随这条连接那次握手结束。

**把 `board.*` 写进 `KNOWN_METHODS`，让桥直接服务看板。** 否决：桥从此持有看板词表，看板的任何变化（新动作种类、新 meta 字段）都会变成协议变更，而且桥再也不能和一块它不认识的看板一起挂载。

## Consequences

- 增加一个远端能力不再需要动桥：插件注册一张表和一条主题，桥的义务只剩保持派发与投递的通用性。将来要暴露别的面（计划、日志）应当走同一道缝。
- 看板发布的面现在是兼容面。四个转发必须持续跟随它们所转发的宿主服务方法；宿主方法改名会变成可见的类型断裂，而不是静默错位。
- 手机发起的动作不传 `initiator`。看板把该字段定义为发起动作的 DSH 会话 id，而手机不是会话；塞一个替身会以从未存在过的会话 id 进入执行审计与工作区继承查询。代价是手机建的卡片拿不到会话工作区钉子，执行时回落到看板的「最近工作区」规则。
- 全量快照没有分页。任务多到超过协议 v1 的 10 MiB 帧上限时只回 `board-unavailable`；§12 记下这条限制，本记录不解除它。
- 公告的能力清单是一份桥并不完全拥有的并集。`MINOR` 仍然只数协议 v1 自己的追加，插件的能力名出现是因为有已注册的表要求它、而不是桥认领了它，因此读 `hello` 的客户端看到的是那一刻注册表的状态——会话中途被卸下的插件不会出现在下一次握手里。
- 这里没有做手机端的端到端验证：桥扩展缝、看板面与插件各自有自己的测试，真机往返仍是人工步骤。
