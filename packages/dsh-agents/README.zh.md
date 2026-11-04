# @linxin666/dsh-agents

[English](README.md) | 中文

DSH Web GUI 的 Agent 小队：可复用的成员定义（agent 预设、权限、模型钉住、思考档位、成员简报），简报进入该成员会话的系统提示词，由 Host 用真实 DSH 会话执行。

## 功能

- **小队**是有序定义：名称、可选描述、可选钉住工作区、可选排序值，以及一份成员列表。
- **成员**是可复用定义：显示名、可选 DSH agent 预设 id、权限、模型钉住、思考档位，以及一段简短简报。
- 成员绑定的是预设 id，不是提示词。本机运行的桌面 profile 已内置 `@local/dsh-siji-research-squad`，其中的 `xundong`（寻冬）、`michun`（觅春）、`zhixia`（知夏）、`luoqiu`（落秋）就是用户已有的研究小队预设，因此第一批小队无需另写预设。
- 简报进入**该成员会话的系统提示词**，绝不写进首条用户消息；普通会话不受影响，其它装配收到的是空段，由 Host 丢弃。
- 运行成员时经宿主 agent 预设注册表解析预设、经宿主网关创建会话、把会话改名为 `<小队名> / <成员名>`、钉住权限与模型路由，并记录一条运行记录。

## Agent Teams 运行期

- 整队运行是小队页上的一个动作：可选目标加可选 Lead 预设。目标随运行请求上送；Lead 预先是小队自己的字段（`TeamDefinition.leadPreset`），因此这次选择跨过这次请求、跨过页面刷新、也跨过下一台设备，而不是随一次运行消失。
- Lead 预设选择器只提供 `GET /state` 在 `presets` 里报出的 id，注册表标记为不可用的预设不会出现。部署没有预设注册表、或注册表出错时该字段整体缺省；注册表里没有一个可用预设时同样缺省。页面改为陈述小队自己钉住的值，而不是给一个空列表。
- 启动顺序就是契约：先校验小队钉住的工作区，再在任何会话存在之前向注册表解析 Lead 预设，把会话改名为 `<小队名> / Lead`，并在首条消息入队之前写入整队运行记录，因此 Lead 的第一次装配就知道自己带的是哪支小队。
- Lead 的模型工具按成员派出 teammate。每个 teammate 都按该成员定义的钉住值组装：预设先于子会话存在解析，权限与模型路由在 teammate 首条提示被 checkpoint 之前落到该会话。本部署兑现不了的钉住会让这次派出以具名错误失败，绝不悄悄退回部署默认值。
- 小队成员名单与目标以 `team:squad` 系统提示词 **context**（不是 section）送达 Lead，因此登记了 `complete` 段的成员预设也无法把它们丢掉。
- 实时队伍视图从共享的客户端会话仓库读取 fork 运行期的 `agentTeam` 会话投影（`stateVersion` 4）：Lead、它派出的每个 teammate、每行的角色与阶段，以及没能启动的成员的失败文字。该投影能作答期间，页面不做任何轮询。
- Team 工具只安装到本 Host 自己启动的整队运行会话里。普通会话（日常对话、普通协调回合）看不到任何 Team 工具，并继续保留原生 subagent 工具——本包从不关闭它们。
- 运行记录同时覆盖两类：带 Lead 会话与目标的整队运行，以及带成员名与「打开会话」动作的成员运行；最新在前，上限是 Host 保留的 200 条。
- 页面把每一种失败变成一句话：传输层失败读作 not-mounted、unauthorized、forbidden、timeout、unreachable 或 unexpected；Host 拒绝在 unknown-preset、no-workspace、squad-missing、lead-create-failed、lead-prepare-failed、ledger-unavailable 上保留自己的类别；其余 code 一律读作普通拒绝，引用 Host 那句有界原文。
- 运行结算不在此处观察：已启动的运行保持 `running`，直到后续里程碑接管其结果。
- 部署自带官方 Agent Teams 运行期（`agentTeams`：旧的实验 profile bundle 或新的 `@deepseek-ai/dsh-agent-team` 都算）时，本包保留账本、路由与成员运行，但 fork 运行期与其 Team 工具整块不挂载：一个服务名只留一个所有者，因此不会出现第二个 `TeamService`、也不会再注册一次 `agentTeam` 投影。实时队伍视图照旧可用，因为官方运行期发布的是同一个 `agentTeam` 投影（`stateVersion` 4）。

上述每一处差异，以及它偏离的精确上游基线，都记录在 [docs/fork-provenance.md](docs/fork-provenance.md) 与 [docs/runtime-deltas.md](docs/runtime-deltas.md)；两者是维护者契约，不是建议。

## 模型可调用工具面

每个会话都拿到 host 半区提供的十个定义管理工具。它们在进程内直接调用 `AgentsHostService`：不新增路由、不发 HTTP 请求、不复制业务校验，因此一次工具调用与浏览器页面走的是同一个账本、同一套规则。

| 工具 | 参数 | 成功值 |
| --- | --- | --- |
| `squads_list` | `{}` | `{ ok: true, squads }`——每个小队及其成员数与精简成员名册 |
| `squads_read` | `{ squadId }` | `{ ok: true, squad }`——完整定义，含成员简报与时间戳 |
| `squads_create` | `{ name, description?, workspaceId?, leadPreset?, members? }` | `{ ok: true, squad }` |
| `squads_update` | `{ squadId, name?, description?, workspaceId?, leadPreset? }` | `{ ok: true, squad }` |
| `squads_delete` | `{ squadId, confirm: true }` | `{ ok: true, deleted: { id, name } }` |
| `squad_member_add` | `{ squadId, name, preset?, permission?, model?, reasoningEffort?, brief? }` | `{ ok: true, squad, member }` |
| `squad_member_update` | `{ squadId, memberId, name?, preset?, permission?, model?, reasoningEffort?, brief? }` | `{ ok: true, squad, member }` |
| `squad_member_remove` | `{ squadId, memberId, confirm: true }` | `{ ok: true, deleted: { id, name, squadId } }` |
| `squads_run_member` | `{ squadId, memberId, firstMessage? }` | `{ ok: true, run }` |
| `squads_run_squad` | `{ squadId, goal? }` | `{ ok: true, run }` |

两个运行工具走的是页面自己用的那两个方法——`AgentsHostService.run` 与 `AgentsHostService.runSquad`——所以启动顺序、fail-closed 的钉住行为和运行记录同样归页面所有。`squads_run_squad` 只收一个目标：目标经 `team:squad` 系统提示词 context 送达 Lead，绝不塞进首条用户消息。

### 门控与公告

- 工具跟随 `enabled` 全局注册，与任务看板同一形态：整个宿主注册一次，关掉设置即撤销。它们不是只装进整队运行开启的那些会话。
- 另有一段独立的 `plugin:agents` 系统提示词段负责公告，order 取家族段位表里的 220，由本插件设置卡上的 `announceToAgent` 开关控制（默认 `false`，volatile，无需重启）。公告文案经家族的 `visibleToolText` 生成，只列当前对该装配作用域真实可见的工具名：关掉设置，或在该作用域里限制掉某个工具，公告随之消失。

### 破坏性调用与局部合并

- `squads_delete` 与 `squad_member_remove` 必须 `confirm: true`。其它取值在触碰账本之前就返回 `{ ok: false, code: 'invalid-request' }`；成功值带上被删对象的名字，调用方因此能说清自己删了什么。
- `squads_update` 与 `squad_member_update` 是局部合并：省略的字段保留现值，空串清除该可选字段，`name` 不接受空串。只改一个字段时不必重述其余字段。

### 与 team_* 工具的区别

这十个是跨会话的定义管理，因此每个会话都看得到。team 工具——`spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`——只装进本 Host 自己启动的整队运行会话，它们协调的是一支正在运行的队伍，而不是一份存下来的定义。两者互不替代，也都不撤下原生 subagent 工具。

### 失败面

领域拒绝是返回值，不是抛异常：`{ ok: false, code, message }`，`code` 取自本包既有的错误码——参数非法是 `invalid-request`，其余如 `team-not-found`、`member-not-found`、`preset-registry-unavailable`、`preset-unknown`、`preset-unavailable`、`workspace-unavailable`、`workspace-unknown`、`ledger-corrupt`。工具面不新增任何码；只有本插件之外的失败才会被抛出。

## 安装

```sh
pnpm add @linxin666/dsh-agents
```

经 profile patch 挂载插件行；bundle 自带一行 host 半区，行名与包名完全一致。

## 配置

- `enabled`（默认 `true`）：挂载账本、路由、模型可调用工具与成员简报段；关闭时该行不注册任何东西、不持有锁，也不注册任何工具。
- `announceToAgent`（默认 `false`）：向 agent 系统提示加入 `plugin:agents` 的工具面公告。volatile，改动作用于下一条提示词；保持关闭时提示词一字不改，agent 只能从自己的工具清单认识这些工具。
- 账本目录为 `$DSH_HOME/dsh-agents`，与本家族每个插件解析自身存储的方式一致。
- `announceToAgent` 开关在本插件于设置页的设置卡上，写的是运行时配置：拨动它即时生效，无需重启。`enabled` 不在那张卡上，而在 bundle 的 profile 行上，因此关掉插件要改那一行并重新加载；卡上只有一段只读说明指出这一点，并说明总开关会停掉什么。

## HTTP 接口

```text
GET  /dsh-agents/api/state
POST /dsh-agents/api/team
POST /dsh-agents/api/team/delete
POST /dsh-agents/api/member
POST /dsh-agents/api/member/delete
POST /dsh-agents/api/run
POST /dsh-agents/api/squad/run
POST /dsh-agents/api/describe
```

- 浏览器半区去掉前导斜杠，与任务看板的前缀处理一致；页面挂载期间轮询 `state` 刷新。
- `state` 还会带上本部署提供的工作区与 agent 预设（各自没有可提供项时省略该字段），小队表单的工作区、Lead 预设两格因此是下拉选择而不是手打 id。
- `describe` 用本部署自己的模型路由（优先目录默认，否则目录第一条）起草一段小队简介，只回正文：没有模型服务或没有可用路由时以稳定 code 拒绝，表单退回可编辑模板，而不是存下一段空简介。
- 失败一律是 JSON：稳定 code 加一句有界文字；协议上不出现堆栈、账本内容或会话文本。

## 存储

- 单个 JSON 账本 `$DSH_HOME/dsh-agents/ledger.json`，以 fsync 临时文件加 rename 写入，经 `ledger.json.lock` 由唯一 pid 占有。
- 不可读、损坏或代次不符的账本会被明确报出并原样保留：本插件从不重置、隔离或覆盖用户的定义。

## 安全模型

- 路由围栏拒绝跨站标记、非 loopback 套接字，以及完全不带浏览器同源信号的请求。
- id 与时间戳由 Host 铸造；带未知字段的草稿直接拒绝而不合并，调用方无法给自己的行盖戳。
- 成员简报是用户自写文本：只送达本插件为该成员开启的会话，且只经系统提示词。

## 已知限制

- 工作区钉住是可选的：未钉住的小队直接在宿主默认会话目录里运行；已钉住的工作区不会被忽略——本部署没有可用来校验它的工作区注册表时以 `workspace-unavailable` 拒绝，注册表里没有这条 id 时以 `workspace-unknown` 拒绝。
- 钉住的预设必须由宿主注册表提供；未知或损坏的预设会在任何会话存在之前 fail closed。
- 注册了 `complete` 系统提示词段的预设独占提示词，成员简报会被丢弃；该例外与兜底设计见 [docs/member-prompt.md](docs/member-prompt.md)。
- 思考档位只随它所属的模型钉住一起下发，因此只钉档位未钉模型的成员按会话默认运行。
- 运行历史保留最新 200 条；更早的记录随其引用到的定义一并丢弃。
- 工具发起的运行与页面发起的运行消耗同样的 API 配额，且整队运行可以在一扇浏览器窗口都未打开时启动。
- 整队运行工具只带目标、不带首条消息，因此必须从用户指令开场的 Lead 要从页面启动；`squads_run_member` 接受 `firstMessage`。
- 创建并运行定义的 agent 是在自行消耗配额：工具由模型驱动，每次运行都是一个真实会话。
- `squads_create` 带 `members` 时不是一次原子写入：参数先全部校验，随后建队并逐个加成员，因此只加进部分成员的中间态只可能在账本写入本身失败（例如磁盘错误）时出现。再调一次 `squad_member_add` 即可补齐。

## 测试

```sh
pnpm --filter ./packages/dsh-agents test
pnpm --filter ./packages/dsh-agents typecheck
```
