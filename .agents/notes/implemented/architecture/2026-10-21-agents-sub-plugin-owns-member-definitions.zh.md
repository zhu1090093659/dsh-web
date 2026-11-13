# Agent Note: 智能体小队作为独立子插件

Status: implemented

## Problem

家族里原本只有一个地方能描述「我会一遍遍启动的那个智能体」：任务看板的一张卡片。卡片已经带着这种智能体需要的启动目标——agent 预设、权限、模型、思考档位——看板的 runner 也已经负责创建会话、钉住这些目标并记录执行。把卡片直接当定义是最省事的做法：不新增包、不新增账本、只有一个界面。

但它站不住。卡片是有状态生命周期的执行单元：它在列之间移动，可以被 cron 排期，会开出子任务树，并把执行结果结算进账本。成员定义没有这些状态——它是可复用的启动目标，生命周期只有建、改、删——把定义挂在一条字段全在描述执行的记录上，之后每一次账本迁移都得继续携带定义根本不读的字段。一次运行还会出现两个主人：看板的 runner 写入执行记录，成员列表又要写入「这个会话属于哪个成员」，两份记录在每个重启边界上都会互相矛盾。

第二个问题随第一个成员会话一起到来：成员的简报放在哪里——首条用户消息，还是会话的系统提示词？

## Decision

`packages/dsh-agents` 是独立的家族子插件。它拥有自己的账本（`$DSH_HOME/dsh-agents`）、`/dsh-agents/api` 下的八个路由、`src/host/service.ts` 里的启动顺序，以及通过 `slots.inject` 注册的一条侧栏行和一个主区页面；浏览器半区走自己的 loader 条目。定义与运行之间的接缝是 `src/host/run-gateway.ts`，换启动器不必动账本、路由和界面。包自带展示元数据——`icon.svg` 与带 `meta.title` / `meta.description` 的 `locale/{en,ru,zh}.json`——因为家族行直挂真实包名，宿主读取器要经这个包的 exports 才解析得到它们（[包 README](../../../../packages/dsh-agents/README.zh.md)）。

成员简报是系统提示词的一段，不是首条用户消息。证据写在[成员简报判定](../../../../packages/dsh-agents/docs/member-prompt.md)：装配上下文只暴露 `Agent`，而它的身份就是会话 id，所以简报是在装配时刻按会话去成员账本里查出来的；段的 `text` 是函数，提示词装配每次都会调用它，因此改简报改的是下一轮而不是那次启动；空段在渲染时被丢弃，非成员会话的系统提示词因此一个字节都不变。这一段服务的是本包自己启动的成员运行；teammate 是队长起的普通子代理，没有运行记录，因此这一段永远查不到它，它的简报改由队长的 spawn 提示词带过去。

首条用户消息做不到其中任何一条。它在会话创建时被冻结进对话记录，改简报就得开新会话；它每轮都以用户自己的指令身份重发，可以被编辑、被引用、被当成一条命令；它也无法条件化，于是启动器必须替用户判断这条消息是不是用户写的。同一份文件还写明这一节唯一失效的地方——预设把自己的 persona 段标成 `complete` 时该段被还原为唯一段——以及那种情形下的兜底：为每个成员物化预设。

协作运行期归部署，不归本包：base bundle 挂载 `agent-team` 与 `tool-agent-team`，由它们提供 `agentTeams`、`team_task_*` 任务板、`team:policy` 段与 `agentTeam` 投影，因此本包不持有任何团队服务、团队工具或投影。它加在这之上的只有整队编排：告诉 Lead 成员是谁的名册上下文，以及让原生任务板可用的 Team 模式开关。teammate 就是普通子代理，它的权限是委派那一刻从父会话捕获的父会话权限——原生 subagent 工具没有 permission 参数——因此成员的权限对整队运行只是向 Lead 陈述的需求，只对本包自己创建的成员运行才是钉住。

家族归属沿用[家族行决策](2026-10-19-remote-bridge-in-family-aggregate.md)：`packages/dsh-web-all/aggregate.yml` 在 `patchFrom` 与 `deps` 里各列 `../dsh-agents`，生成器因此产出 insert 行 `web-ui-agents`，`name` 为 `'@linxin666/dsh-agents'`，并写入 `workspace:*` 依赖。`familyIds` 从第一版就把行 id 从子包带前缀的 `dsh-agents` 钉成家族短名 `web-ui-agents`，与 `dsh-win-bash` 记录的是同一笔取舍。这个家族没有 tombstone 子路径，也没有 `shellNotes` 条目：行直挂真实包名，老 profile 里没有 `web-all/<family>` 形式的导入需要解析，聚合的 `shell-metadata` 树因此只负责兼容子路径。这份清单落在运行中应用的必经路径上，而不是一条可选的发布步骤：桌面 profile 的 bundle 行指向仓库根包 `dsh-web`，而它的 `dsh.bundle.patch` 就是本聚合的 `cordis.patch.yml`。

## Alternatives considered

- **原样复用 `@deepseek-ai/dsh-experimental-agent-team-profile`。** M1 不采用：它是规定好一种团队形态与自有角色文本的 profile bundle，家族的「小队」会变成套在固定角色外面的别名；它既不建模成员简报，也不建模成员各自钉住的预设、权限和模型，而这些正是本仓成员定义的全部内容。它的 experimental 名号也不提供稳定性契约，而 M2 要的是它的源码，不是它冻结的形态。
- **让运行继续留在任务看板卡片上。** 不采用：运行会由看板 runner 结算，并作为一张卡片出现在看板列里，而成员列表会保留 Problem 一节说的第二份说法。卡片的排期与子任务语义会被任何经它运行的东西继承，而成员启动不该继承这些。
- **把简报注入成首条用户消息。** 不采用，理由就是 Decision 里那四条性质：启动后改不动、与用户指令无法区分、做不到「只对非成员会话为空」、并且会逼运行网关伪造一条用户从未输入的用户回合。
- **预先为每个成员物化一个预设。** 不作为默认，只留作已记录的兜底：一人一预设会把「保存定义」变成一次落盘写加一次预设注册表刷新，把「删除成员」变成清理落盘资产，而它解决的只有预设把 persona 段标成 `complete` 这一种情形。

## Consequences

- 看板与智能体插件各自持有账本与 id 空间。成员会话不是看板卡片，看板卡片也不是小队成员；两个界面都不列出对方。
- 聚合的 `lib/` 不再内联本插件的浏览器半区，改 `packages/dsh-agents/src/client` 只需重建这个包，聚合自己的 bundle 继续只做兼容层。
- 部署里缺少可选的 agent 预设注册表、workspace 注册表、命令派发器或 live agent 名册时，行照常挂载；真要用到那一面时按具名错误码 fail closed，而不是静默降级。行的 `enabled` 开关同时决定账本、路由、模型可调用工具、成员简报段、名册上下文与 Team 模式开关。
- 协作运行期是宿主自己的：`@deepseek-ai/dsh-base` 挂载 `agent-team` 与 `tool-agent-team`，由它们提供 `agentTeams` 服务、`team_task_*` 任务板、`team:policy` 段与 `agentTeam` 投影（`stateVersion` 7，wire 形状 `{ enabled, tasks, failure? }`）。那 2,991 行 fork 代码与它们的共存闸门之所以存在，只因为本包也想占用同一个服务名；运行期既由部署提供，就没有第二次注册要仲裁、没有闸门要维护、没有上游基线要重放、也没有要不要卸载的判断要做，于是 fork 与闸门一起消失。这里留下的是运行期不做的那部分：账本、面板、成员运行，以及下文这层编排。
- 整队 Lead 的 Team 模式由本包打开，因为原生服务给新根会话的默认是关闭（`defaultEnabled` 为 false），除非部署改掉这个默认；没有它的 Lead 开局既没有任务板也没有团队策略。开关在整队运行记录落盘之后、Lead 首条消息入队之前触发：宿主是在会话创建过程内部发出 `agent/created` 的，那一刻本包还没有运行记录，靠 announce 判断永远看不到刚启动的这次运行；`agent/created` 监听因此保留为之后才被 announce 的 Lead 的兜底。两条路径都不碰别处：teammate 不是根会话，用户自己开的会话也不会被记录成 Lead。部署没有 `agentTeams` 服务时其余一切照旧，并报出它少了这一项能力。
- 名册与目标以本包注册在 order 125 的 `team:squad` 系统提示词 context 送达 Lead，位置在 subagent 委派上下文与 harness 源段之间。context 不会被登记 `complete` 段的成员预设丢掉，而这个位置由本包自持，因为宿主的中央表不再命名任何 Team context。每行带成员名、预设、写明「继承」的权限、模型与完整简报，其后是派出契约——`description` 成为 teammate 的 label，`agent_preset` 是预设，`provider`/`model`/`reasoning_effort` 是模型钉住，prompt 以简报开场——以及任务板契约（`team_task_*`、`blockedBy`、`send_message`、`wait_agent`）。
- 成员权限对整队运行是声明，只对成员运行才是钉住。调用原生 subagent 工具的是 Lead 自己，而那个工具没有 permission 参数：子会话的权限在委派时从父会话捕获。本包不在这条路径上，因此它没有任何属于自己、可以施加钉住的时刻，名册改为陈述继承关系；本包自己创建的成员运行仍在首条消息之前经命令派发器施加钉住的权限。
- 实时队伍视图从共享的客户端会话仓库读取宿主的 `subagentCatalog` 投影（`stateVersion` 6）：Lead 的直接子会话，形状为 `{ id, createdAt, mode, label?, name? }`。`agentTeam` 投影做不了这个来源——`stateVersion` 7 上它只装保存下来的 Team 模式与任务板，wire 形状里没有成员行。Lead 行由小队自己的 `leadPreset` 渲染，成员行按名册要求 Lead 设置的那个 label 与目录 join，一行的状态优先取宿主上报的 `running`，没有上报时用它被启动的方式。空目录是还没派出任何人的 Lead，部署没有会话目录时读作不可用，两种情况都不轮询。
- 提案路由 `GET /dsh-agents/api/squad/team` 与浏览器轮询兜底随它们喂养的 fork 运行期一并消失：`subagentCatalog` 由宿主发布，因此没有宿主侧的提案要提供，也没有第二个实时队伍来源会与它漂移。`DSH_AGENTS_ROUTE_PATHS` 仍是契约冻结的八条路由，`/squad/team` 不在其中。
- 另有一组与团队运行无关的工具管定义本身：十个模型可调用工具（`squads_list`、`squads_read`、`squads_create`、`squads_update`、`squads_delete`、`squad_member_add`、`squad_member_update`、`squad_member_remove`、`squads_run_member`、`squads_run_squad`）跟随 `enabled` 全局注册进每个会话，在进程内直达同一个 `AgentsHostService`，因此普通对话不开页面也能读、改、跑小队（[定义工具](../feature/2026-10-21-agents-definition-tools.zh.md)）。
- `GET /dsh-agents/api/state` 带上本部署提供的 agent 预设 id（`presets`），小队页据此提供 Lead 预设。这份清单只经「每个预设钉住都会走的那一面」读一次注册表，并排除注册表标记为不可用的预设；部署没有注册表、或注册表出错时该字段整体缺省，而不是给一个空列表。
- 会话入口的两个可选面按实例实时解析。GUI 的会话导航（`uiWorkspace`）与共享会话目录（`sessions`）分属其他官方插件，因此浏览器半区用 `ctx.inject` 加 `inner.effect` 清理把它们桥接进同一份实例级快照（`packages/dsh-agents/src/client/session-faces.ts`），而不是在行 apply 时 `ctx.get` 探测一次；页面订阅该快照，后续出现的面会让它重渲染。本行之后挂载的提供方会启用这些动作，提供方卸载会撤回它们，两者都不提供的部署则保留可见但置灰的动作并写明原因——此前的隐藏让一次加载顺序事故读成「这个成员从未运行」。这两个服务都不进本行自己的 `inject` 列表，因为页面必须在两者都缺席的部署上挂载；两个官方客户端包只声明为 `dsh.client.inject` 的加载顺序提示，以及为这两个服务的 type-only 声明补的 devDependencies。
- 已知且按现状交付的限制：预设把 persona 段标成 `complete` 时其会话拿不到简报，上文的兜底是已记录的出路。

## Testing

`packages/dsh-agents/tests/member-prompt.spec.ts` 钉住注入判定——身份提取及其字段改名兜底、按会话取最新运行、定义删除后不再注入、非成员会话为空段、每次装配读一次账本。`packages/dsh-agents/tests/squad.spec.ts` 钉住 `team:squad` 名单文本、整队运行记录先于首条消息落盘、Lead 预设被拒，以及未钉工作区的整队照常运行——Lead 会话照样开启，且 `createSession` 入参不带 `workspaceId`。两条工作区拒绝下沉一层：`packages/dsh-agents/tests/service.spec.ts` 与 `packages/dsh-agents/tests/agent-tools.spec.ts` 都覆盖 `workspace-unavailable` 与 `workspace-unknown`，`packages/dsh-agents/tests/routes.spec.ts` 覆盖路由级的 409。`packages/dsh-agents/tests/apply-inject.spec.ts` 在真实 cordis 树上钉住 Team 模式开关——对账本记录的 Lead 调用一次 `setEnabled(lead, true)`，普通会话与 teammate 永不触达，且本行不注册任何会话投影——以及强制 inject 上下文下五个运行期服务全缺与全在场两种挂载。`packages/dsh-agents/tests/client-squad-team.spec.tsx` 钉住目录读取：teammate 无需刷新页面即出现、空目录读作还没派出任何人的 Lead、没有会话目录的部署只说一次、成员运行保留自己的卡片。路由清单在 `packages/dsh-agents/tests/protocol.spec.ts` 与 `packages/dsh-agents/tests/squad.spec.ts` 里被钉成八条且不含 `/squad/team`。`packages/dsh-agents/tests/routes.spec.ts` 钉住服务的 state 正文，含预设清单与注册表缺失时该字段的缺省。`node scripts/aggregate.mjs --check` 钉住产出的行、`workspace:*` 依赖，以及这个家族不生成 `shell-metadata` 目录。`packages/dsh-agents/tests/client-session-faces.spec.tsx` 在真实 cordis 树上钉住实时解析——行 apply 时两个面都缺、提供方 fiber 挂载后提供、fiber 卸载后再次撤回——以及面板在同一份快照上的启用、打开与重新置灰。`packages/dsh-agents/tests/apply-inject.spec.ts` 另钉住行 apply 之后才激活的 workspace 注册表同时到达选择器与钉住运行。
