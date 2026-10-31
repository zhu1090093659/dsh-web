# dsh-remote-bridge · DeepSeek Harness (DSH) 协议 v1 宿主适配包

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-remote-bridge?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

本仓库唯一的远程访问路径：手机 App 通过协议 v1 连上宿主。本包把 DeepSeek Harness（DSH）本体发布成协议 v1，在 `/ios/v1` 提供单个 WebSocket 面，原生手机 App 无需浏览器即可直连并驱动宿主。浏览器远程控制已退役，公网与局域网接入栈能力已迁入本包。

本包在同一进程内消费宿主——会话工作走 Typert gateway，权限请求走审批瀑布——并在仅回环路由上自行签发一次性 bootstrap token，拥有独立的公网中继、Cloudflare 隧道与局域网接入栈。

## 功能

本包发布一套协议，并在它旁边提供一个很小的浏览器面。宿主半区发布的是一套协议：

- **一个面。** 宿主 WebServer 上以精确路径注册的 `/ios/v1` WebSocket；帧为文本帧，一帧一个 JSON 对象，单帧上限 10 MiB（10485760 字节）。
- **会话面。** `session.list`、`session.titles`、`session.snapshot`、`session.prompt`、`session.interrupt` 分别覆盖带工作区、谱系与归档元数据的名册、一批会话标题、完整基线加实时订阅、带幂等键的排队发言，以及回合取消。
- **agent 面。** `presets.list` 转发宿主的 Agent 预设名册，`session.create` 转发一次创建请求，手机因此能像桌面一样从预设实例化一个 Agent；这两个身体在桥里都不被解释。
- **fork 面。** `session.fork` 把一条会话分叉成继承它上下文的新会话；切点与新会话的身份都属于宿主，因此请求与回包逐字穿过。
- **指令面。** `session.commands` 把一个会话的斜杠指令与技能列成同一份目录，`session.command` 执行其中一行并回报宿主是否认出了它；两份表都属于宿主，桥里不缓存任何一条。
- **用量面。** `usage.session` 回一条会话的上下文窗口（宿主自己的数字，且只在宿主广播过时才有）以及它下一次请求由什么构成的估算；`usage.balance` 回某条 provider 路由背后账户还剩多少，只在路由确实指向官方 origin 时才去问供应商自己的余额端点，且每分钟最多一次。`usage.stats` 回宿主自己那份按天记的 token 台账——今天与本月各五个桶，外加按日期升序的一天一行——读的是 `dsh-usage` 插件挂在这台机器回环 origin 上的两条 HTTP 路由，30 秒最多一次；没挂那个插件的宿主回 `no-usage-plugin`，而不是一堆 0。宿主没广播过窗口的会话还可能带上 `modelContextWindow`，那是它那条路由的模型目录自己声明的数字，永不与宿主实测的那个混用。
- **把一整页交给客户端，并把动作收回来。** `ui_present` 收下一整份自包含 HTML，作为 `ui.request` 事件下发到声明了 `ui.v1` 的客户端；
  用户在页面里的第一条动作就是那次工具调用的返回值，所以图表、表单或列表操作都能成为真正的答案，而不是一道带选项的提问。
  `ui.event` 结算它，`ui.list` 对账客户端此刻仍持有的卡。
- **订阅而非轮询。** `session.snapshot` 打开宿主的 follow 流并保持它，基线与其后的每一条增量都走同一条 socket。
- **审批直达客户端，重连的手机还能拿回仍悬着的那些。** 需要授权的工具以 `approval.request` 事件到达，客户端用 `approval.resolve` 作答；无人应答的请求按拒绝处理，而声明了 `approvals.v1` 的连接会在握手之后再次收到所有未结算的审批。
- **配对。** 一次性 bootstrap token 加 P-256 挑战应答产出可吊销的设备令牌；未配对连接只能触达三个方法。
- **一个配对面板。** 同一插件行声明 `dsh.client` 浏览器半区：侧栏底部一个二维码图标（aria-label 为「配对手机（协议 v1）」），点开弹窗展示 30 秒有效的一次性配对二维码与「重新取码」动作。
- **中继无需改动。** 协议搭在实例本来就发布的那个 origin 上，中继这一跳照原样转发它，与其他所有请求无异。

## 传输

| 帧 | 形状 |
| --- | --- |
| 请求 | `{"t":"req","id":<uint>,"m":"<method>","p":{...}}` |
| 响应 | `{"t":"res","id":<uint>,"ok":true,"r":{...}}` 或 `{"t":"res","id":<uint>,"ok":false,"e":{"code":"<str>","msg":"<str>"}}` |
| 事件 | `{"t":"ev","seq":<uint>,"m":"<topic>","p":{...}}` |
| 心跳 | `{"t":"ping","ts":<ms>}` 与 `{"t":"pong","ts":<ms>}` |

`seq` 属于每个连接，自 1 起单调递增：它给的是该连接收到的事件序号，不是宿主自身的历史。帧为文本帧、一帧一个 JSON 对象、单帧上限 10 MiB（10485760 字节）。空闲连接每 20 秒探活一次；客户端以 pong 回应 ping，桥接侧同样如此。客户端在收到 ping 后 10 秒内一帧都没发，连接会以关闭码 4000 关闭；没有对应 ping 的 pong 仍被忽略。

## 方法集

| 方法 | 请求 `p` | 响应 `r` |
| --- | --- | --- |
| `hello` | `{proto:1, minor:17, client:"ios/0.1", cap:["session.snapshot.trim.v1","subagent.thread.v1"]}` | `{proto:1, minor:21, server:"dsh-remote-bridge", capabilities:["session.snapshot.trim.v1","session.snapshot.page.v1","questions.v1","questions.list.v1","subagent.thread.v1","jobs.v1","agents.v1","delta.v1","session.list.omit-archived.v1","session.deep-history.v1","frame.deflate.v1","session.list.compact.v1","session.snapshot.since.v1","session.fork.v1","commands.v1","workspace.v1","session.admin.v1","squads.v1","push.v1","usage.v1","usage.stats.v1","ui.v1","ui.list.v1"], resume:"snapshot", auth:"paired" 或 "unpaired"}` |
| `session.list` | `{since?, cwd?, maxRows?, after?}` | `{mode, token, sessions:[{id, title, updatedAt, agentRunning, cwd?, parentSessionId?, origin?, blank, archived?}]}`；紧凑页为 `{mode:"reset", token:"", compact:true, sessions:[...], nextAfter?}` |
| `session.titles` | `{ids:[<sessionId>, ...]}` | `{titles:{"<id>":"<title>", ...}}` |
| `session.snapshot` | `{sessionId, sinceSeq?, maxBytes?}` | `{turns:[...], lastSeq:<uint>, hasMore?}`；增量另加 `mode:"since", reset:false`，替换客户端副本的基线另加 `mode:"full", reset:true` |
| `session.history` | `{sessionId, before?, maxBytes?}` | `{turns:[...], nextBefore?:<uint>, hasMore:<bool>}` |
| `session.history.deep` | `{sessionId, before?, maxBytes?}` | `{turns:[...], nextBefore?:<uint>, hasMore:<bool>}` |
| `session.prompt` | `{sessionId, text, requestId}` | `{accepted:true}` |
| `session.interrupt` | `{sessionId}` | `{ok:true}` |
| `presets.list` | `{}` | 宿主 `agentPresets/list` 的身体，逐字转发 |
| `session.create` | 宿主自己的 `SessionCreateRequest` | 宿主 `session/create` 的身体，逐字转发 |
| `session.fork` | `{sessionId, atSeq?}` | 宿主 `session/fork` 的身体（`SessionForkValue`），逐字转发 |
| `session.commands` | `{sessionId}` | `{sessionId, items:[{name, description, kind, line}]}`，先全部指令、再全部技能 |
| `session.command` | `{sessionId, line}` | `{matched:<bool>}`——宿主没把该行解析成指令时为 false |
| `workspace.list` | `{}` | `{workspaces:[{id, path, title, createdAt?, updatedAt?}], archivedSessionIds:[...], pinnedSessionIds:[...]}`——注册表自己的顺序，两个集合总是存在 |
| `session.rename` | `{sessionId, title}` | 宿主 `session/rename` 的身体（`SessionRenameValue`），逐字转发 |
| `session.pin` | `{sessionId}` | `{ok:true}` |
| `session.unpin` | `{sessionId}` | `{ok:true}` |
| `session.archive` | `{sessionId, stopActivity?}` | `{ok:true}` |
| `session.unarchive` | `{sessionId}` | `{ok:true}` |
| `squads.state` | `{}` | `{squads:[Squad], runs:[Run], presets?:[string], host:{ownerPid?}}` |
| `squads.list` | `{}` | `{squads:[Squad]}`——同一次 `squads.state` 读取的定义半区 |
| `squads.runs` | `{}` | `{runs:[Run]}`——同一次读取的运行半区 |
| `squads.runMember` | `{squadId, memberId, firstMessage?}` | `{run:Run}`，其 `kind` 为 `"member"` |
| `squads.runSquad` | `{squadId, goal?}` | `{run:Run}`，其 `kind` 为 `"squad"` |
| `usage.session` | `{sessionId}` | `{contextWindow?, modelContextWindow?, composition?:{system, tools, messages, estimated:true}}`；会话存在但两项读数都没有时回 `{}`，会话不存在时回 `unknown-session` |
| `usage.balance` | `{provider}` | `{provider, currency, total, toppedUp, granted, updatedAt}`，或 `{provider, unsupported:"no-credential"|"not-deepseek-route"|"probe-failed", reason?}` |
| `usage.stats` | `{days?}` | `{updatedAt, today:Buckets, month:Buckets, days:[{day:"YYYY-MM-DD", ...Buckets}], observedSpend?:{cny, since}}`，`Buckets` 是那五个 token 桶；或 `{unsupported:"no-usage-plugin"|"probe-failed", reason?}` |
| `pair.begin` | `{token}` | `{nonce, expiresAt}` |
| `pair.finish` | `{devicePubKey, signature}` | `{deviceToken, deviceId}` |
| `approval.resolve` | `{id, decision}` | `{ok:true}` |
| `ui.event` | `{sessionId, callId, event:{type, payload?}}` | `{ok:true}`；第一条即结算那次工具调用，此后再来一条回 `ui-settled`，本桥从未认领过的回 `ui-unknown`，payload 超 8 KiB 回 `invalid-args` |
| `ui.list` | `{}` | `{cards:[{key, sessionId, state, payload}], complete:true}`——只有仍持有的卡；`key` 是 `"<sessionId>/<callId>"`，`payload` 是那张卡 `ui.request` 载荷的逐字副本，而这次读不认领、不改 deadline、不触发任何结算 |

`hello` 无需设备令牌即可调用，并回报本连接自身的 `auth` 状态。`session.snapshot` 把宿主 follow 流的开帧快照映射成 `turns`，把它的 cursor 作为 `lastSeq` 回报，随后保持该流作为本连接对该会话的订阅；`session.prompt` 幂等地确保同一条订阅，因此客户端可以跳过 snapshot。发言模式固定为排队，`clientTimeZone` 由服务端填本机 IANA 时区，`requestId` 是幂等键：同名 `requestId` 在同一会话内只发一次，重复调用直接回 `{accepted:true}` 且不再发送。`session.interrupt` 取消回合，不拆除订阅。

agent 的两个方法什么都不解释。`presets.list` 把宿主 `agentPresets/list` 的身体原样回给客户端——该端点不收请求，所以一行预设就是注册表发布的东西，连它的插件清单一起——`session.create` 把客户端的身体作为该端点唯一的 `request` 参数送出，再把宿主自己的回包原样回给客户端。字段名、默认值与拒绝码都属于宿主：客户端对着宿主自己的 `SessionCreateRequest` 校验创建请求，而不是对着桥里留的一份副本；宿主拒绝时它拿到的是宿主的 `code` 与 `msg`——没有错误码的失败以本桥的 `internal` 穿出，但消息仍是宿主的原文。两个方法只对声明了 `agents.v1` 的客户端存在：没声明时各自回 `unknown-method`，且什么都不发；声明了却从不调用，则宿主一次读取都不会发生。

fork 的方法同样什么都不解释。`session.fork` 把 `sessionId` 与客户端真的点名时才有的 `atSeq`（fork 包含的源事件 seq）作为该端点唯一的 `request` 参数送出，再把宿主自己的 `SessionForkValue` 原样回给客户端。省略的 `atSeq` 就保持省略：宿主把缺席的切点读成最新一个已完成轮，在这里补一个等于悄悄挪动切点。不是正整数的切点在这里以 `invalid-args` 拒绝，因为任何事件日志都没有这样的 seq；宿主拒绝的请求带着宿主自己的 `code` 与 `msg` 穿出，没有错误码的失败以本桥的 `internal` 穿出。该方法只对声明了 `session.fork.v1` 的客户端存在：没声明时回 `unknown-method`，且什么都不发。

指令通道同样什么都不解释。`session.commands` 读出宿主为同一个会话准备的两份表并折成一份目录：`commands/list` 是该 Agent 的有效视图——通过 Agent 作用域子上下文注册的指令会遮蔽全局那一条——`skills/list` 是该会话 cwd 与预设选出的技能表，因此手机列出的就是桌面输入框会为同一会话提供的东西。先全部指令、再全部技能，各自保持宿主的顺序，不重排、不去重、不分页。一行是 `{name, description, kind, line}`：`kind` 取 `command` 或 `skill`，`line` 是能唤起它的整行草稿文本，含分隔空格——两个宿主面都只在名字后面跟着空白或文本结尾时才认这个手势，而技能手势是 `/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/`。这条规则也正是技能行不是指令行的原因：技能从不注册进指令表，因此拿它调 `session.command` 只会回 `matched: false`，什么都跑不起来。`session.command` 把该行原样交给 `commands/execute`，附件列表为空，只回答一个确定的事实：宿主到底有没有认出这一行。认出就执行并回 `matched: true`；解析不出指令——没有前导斜杠、名字不认识、或技能手势——回 `matched: false` 且什么都没跑。两个方法都不缓存、不推送：每次调用都去读宿主，不持任何事件；从未声明 `commands.v1` 的客户端回 `unknown-method`，且不会为它读一次指令表或技能表。一个两端点都不导出的宿主回本桥自己的 `commands-unavailable`，而不是每次调用都失败一次；宿主主动拒绝的一次调用、以及仅仅还在激活中的服务，则带着它们自己的 code 与 msg 穿出。

会话管理通道同样什么都不解释，而它分成两个能力，是因为读与写是两份不同的提供。`workspace.list` 回的是宿主注册表自己的同步投影——每个已注册工作区一行、按注册表自己的顺序、这里不排序、也不带工作区自己的会话账本——旁边是两个全局会话集合；归档是会话级的事实而不是"已归档的工作区"，因此这张表里什么都不被过滤，已归档会话仍保留原槽位，`session.unarchive` 就把它放回那里。置顶是注册表全局集合而不是某个工作区内的排序：新的置顶前插、重复置顶既不写也不重排、对已归档会话置顶被宿主拒绝、归档在同一次持久写里丢掉置顶——因此客户端展示的可见顺序是它自己推导的，与桌面端一致。五个写方法一对一映射到本来就拥有这些语义的端点：`session.rename` 打到 `session/rename`，后者先恢复冷会话再写，并回它归一化后的标题与提交它的 seq，所以客户端不需要自己的 resume 路径；`session.pin`、`session.unpin`、`session.archive`、`session.unarchive` 分别打到 `workspace/pinSession`、`workspace/unpinSession`、`workspace/archiveSession`、`workspace/unarchiveSession`。这里不发明布尔参数、也不在桥里分支：`stopActivity` 只在客户端发来布尔值时透传，不带它而会话仍在跑时由宿主以 `workspace/session-active` 拒绝，正是这条拒绝告诉手机该弹确认。这条通道不推任何事件，因为宿主并不把这些写公告成连接能折进增量的 cordis 事件——改名只追加一条 `session/title` 记录——所以客户端每次写成功后自己重读：置顶集合读 `workspace.list`，名册读 `session.list`，新名字写进自己的副本并等标题缓存过期。代价写在这里而不是藏起来：桌面上做的置顶或归档，要等手机下一次刷新才看得见。从未声明 `workspace.v1` 或 `session.admin.v1` 的连接，其背后的方法一律回 `unknown-method`，既不为它读一次注册表，也不为它写一次。

小队通道是唯一一条不替换任何东西的通道：它读并驱动 `dsh-agents` 插件的小队域，与 `agents.v1` 并排而不是叠在它上面，因此早于它写下的手机仍然拿到当初依赖的预设名册与会话创建。`squads.v1` 背后是五条指令。`squads.state` 回 `{squads, runs, presets?, host:{ownerPid?}}`；`squads.list` 回 `{squads}`、`squads.runs` 回 `{runs}`，两者是同一次读取的两个半区、从同一份应答切出，所以小队名册与运行历史不可能互相矛盾；`squads.runMember` 发 `{squadId, memberId, firstMessage?}`、`squads.runSquad` 发 `{squadId, goal?}`，各自回 `{run}`。`Squad` 是 `{id, name, description?, workspaceId?, leadPreset?, order?, members:[Member]}`，`Member` 是 `{id, name, preset?, permission?, model?, reasoningEffort?, brief?}`；`Run` 是 `{id, squadId, kind:'squad'|'member', memberId?, sessionId, createdAt, status:'running'|'settled'|'failed', failure?}`，其中 `kind` 在这条线上必填，而整队运行出现之前记下的运行（压根不带 `kind`）按它本来就成立的成员运行读。插件留给自己的东西一样都不过线：定义的 `createdAt`/`updatedAt`、成员回指团队的 `teamId`、以及交给 Lead 的 `goal` 都留在宿主那一侧。域是插件自己的域，拒绝也是插件自己的拒绝，带着插件自己的码与那一句有界文案过线——`team-not-found`、`member-not-found`、`preset-registry-unavailable`、`preset-unknown`、`preset-unavailable`、`workspace-unavailable`、`workspace-unknown`、`model-pin-invalid`、`session-create-failed` 及其邻居——桥自己只命名插件命名不了的两种条件：`squads-unavailable`，本宿主没有它能到达的小队域，或者回的应答体本构建读不懂；`squads-run-unavailable`，定义读得到、却到达不了任何运行路由，那时回的是这条码而不是一个从未启动的运行。畸形行被拒绝而不是被修补，空应答从不被发明，所以没装插件的宿主回错误而不回空板。域怎么到达属于本桥唯一那条不引依赖的规矩：优先走插件自己在这台机器 loopback origin 上的路由——`GET /dsh-agents/api/state`、`POST /dsh-agents/api/run`、`POST /dsh-agents/api/squad/run`，地址取自 `webServer` 已经在服务的 origin，并在 `origin` 头里带上同一个 origin，正是插件浏览器围栏读作同源信号的那个头——当 loopback 调用根本连不上时，改为只读地读插件账本 `$DSH_HOME/dsh-agents/ledger.json`，按同一套规则校验，此时 `host.ownerPid` 从旁边的插件自己的锁文件读出。任何状态码的应答都不是兜底：那是插件在说话，只有根本没连上的调用才走到账本。这两个方法都不替任何连接代调，从未声明 `squads.v1` 的客户端五条一律得到 `unknown-method`。

用量通道读的是两件属于宿主、而不属于某台设备的事实，因此一个实例服务所有连接。`usage.session` 点名一条会话并回 `{contextWindow?, composition?}`：窗口是本进程看到宿主广播的最近一次 `request/context` 里的 `RequestContext.contextWindow`，组成则是本桥对「下一次请求由什么构成」的估算，分三格——`tools` 取最近一次 `request/header` 的 tools schema 原文，`system` 取最近一条 `system/message` 的文本，`messages` 取此后观察到的每一条 `user/message`、`assistant/message` 与 `tool/result` 的文本——每一格都是 UTF-8 字节数除以四再向下取整，并恒带 `estimated: true`，因为手机绝不能把估算当成宿主的读数。宿主没广播过的键是缺席而不是 0；会话存在而两项读数都取不到时回 `{}`——存在有三处证词：宿主自己的会话名册（与名册方法服务的是同一个 `session/list`，因此本桥从未观察过、当前也不 live 的会话同样算存在）、活会话存储，以及本进程折过的事件——三处都不认这条 id 时才回 `unknown-session`。名册只在另外两处都答不上时才读，且它的答案在五秒内复用，所以一次开屏连问几条只花一次读取；读不到名册的桥退回活会话存储与折叠两条证词。折叠从这一行挂载时开始，且从不读会话日志：挂载之前广播的事件不算读数，因此整段都跑在挂载之前的会话回 `{}`，而不是回一份全是 0 的组成。`usage.balance` 点名一条 provider 路由，回 `{provider, currency, total, toppedUp, granted, updatedAt}`（元口径的金额，取自 `balance_infos[0]`），或回 `{provider, unsupported, reason?}`，取值 `no-credential`、`not-deepseek-route`、`probe-failed`。这条路由必须是官方 DeepSeek 的 id（`deepseek` 或 `deepseek-official`），并且它配置的 `baseURL` 缺席或落在 `https://api.deepseek.com`：余额端点报的是某一个 origin 的账户，拿它去查一个只是复用了 `deepseek` 这个 id 的转售 profile，会把官方账户的钱印在那条路由名下。凭据按宿主自己用量插件的同一套顺序解析——先 pi-ai 记录 `llm-pi-ai/<provider>`，再 profile 的 `apiKeyEnv`，最后 DeepSeek 适配器自己的引用（默认 `DEEPSEEK_API_KEY`）——OAuth grant 在这里不算凭据，因为官方端点只认 API key。同一条读数按 provider + 凭据缓存 60 秒，并发调用合并成一次上游请求；401、超时与认不出的应答体都回 `probe-failed`，绝不把上一轮的读数当成当前值发出去。从未声明 `usage.v1` 的客户端，这两个方法都回 `unknown-method`，桥也不会替它折一条事件、更不会替它打一次上游请求。`usage.stats` 读的是另一个插件记的台账，所以它是 `usage.stats.v1` 背后独立的一个能力、也是独立的一条读路：一条 `GET /api/dsh-usage/overview`，外加——只在请求的窗口比那份文档自带的 30 天更深时——对台账确实记过的每一天各一条 `GET /api/dsh-usage/day?date=YYYY-MM-DD`。台账里没有条目的日子按真实的 0 过线（宿主自己对那些日期答的也是全 0 的一天），而路由不存在（`no-usage-plugin`）、连接不上、形状不符或太慢都回 `probe-failed` 并带一句短原因，绝不拿上一轮的读数顶上。同一个 `days` 窗口在本桥这一侧缓存 30 秒，并发调用合并进去，所以两台手机同时问只让宿主读一次。`usage.session` 在窗口旁边多了一个可选键：宿主没广播过 `request/context` 窗口时，应答可以带上 `modelContextWindow`，取自这条会话当前路由的 `GET {baseURL}/models`——按模型 id 精确匹配后依次取 `context_length`、`context_window`、`max_input_tokens` 里第一个可用值，按路由缓存十分钟，并带上这条路由自己的凭据。两个数字永不混用：`contextWindow` 恒为宿主实测，`modelContextWindow` 恒为模型声明，后者也永不与前者同时出现。

`hello` 还携带客户端的能力声明，而能力是公告而非协商：无论 `cap` 里是什么，握手都回同一个帧，未知名字被忽略；单帧上限在两个方向上都是同一个常量——约束接收帧的 10 MiB，同时也是拟合快照、以及丢弃超限出站事件的同一份预算。本桥自己服务二十三个能力，并在 `hello` 的 `capabilities` 里公告它们：`session.snapshot.trim.v1`、`session.snapshot.page.v1`、`questions.v1`、`questions.list.v1`、`subagent.thread.v1`、`jobs.v1`、`agents.v1`、`delta.v1`、`session.list.omit-archived.v1`、`session.deep-history.v1`、`frame.deflate.v1`、`session.list.compact.v1`、`session.snapshot.since.v1`、`session.fork.v1`、`commands.v1`、`workspace.v1`、`session.admin.v1`、`squads.v1`、`push.v1`、`usage.v1`、`usage.stats.v1`、`ui.v1`、`ui.list.v1`——插件注册的能力不在其中，因为桥不是它的作者。`ui.v1` 是这里唯一一个「只有真实现了另一半的桥才敢公告」的能力：它背后整页以 `ui.request` 到达，用户的动作以 `ui.event` 回来，而早于这条通道的宿主一帧都不发。`ui.list.v1` 是它的对账读，与 `questions.list.v1` 同一种公告形状：只有标了 `complete` 的应答才允许客户端退休它手里的卡。`approvals.v1` 也不在其中，它由客户端声明、本桥刻意从不公告：它门控的是一次重放而不是通道本身，因此握手对每个客户端都是同一个帧（见下文审批通道）。`questions.list.v1` 是这里唯一「公告一个方法而不是改变一条通道」的能力：`question.list` 回答本桥此刻仍持有的提问，而只有标了 `complete` 的应答才允许客户端退休它手里的卡。第一个就是裁剪基线。未声明它的客户端——包括该能力出现之前写下的所有客户端——拿到的基线与协议 v1 一直以来提供的逐字节一致。声明了它的客户端拿到的是裁剪过的基线：每个回合内部只保留它能渲染的 entry（`user/message`、`assistant/message`、`tool/call`、`tool/result`、`subagent/catalog`），宿主自己的记账记录（`system/message`、`request/header` 之类）在量帧大小之前就被剔除。快照的其余部分不变：保留哪些回合、它们的顺序，以及每个回合的 `seq`、`endSeq`、`reason`、`time` 都是投影自己的取值；一个回合的 entry 若全是记账记录，该回合仍保留为 `entries` 为空的回合；`lastSeq` 仍是宿主游标。帧预算在其后生效——先裁 entry，再丢最旧的整回合，仍然装不下才回 `snapshot-too-large`。

第二个能力 `session.snapshot.page.v1` 给首屏本身加上页预算。不声明时，一次快照仍是整个开帧窗口，逐字节与今天一致。声明之后，`session.snapshot` 只回最新一页，按 `maxBytes`（默认 524288，即 512 KiB；不是可用预算就拒绝，而不是悄悄夹取）衡量，并用 `session.history` 那同一套按 entry 的切片来切：一个回合的 entry 可以跨在这一页与下一页之间，而该回合保留自己的字段；比整页预算还大的单条 entry 独占一页；`snapshot-too-large` 再也不会回给这样的连接。预算按整个编码后的应答计量、从不按回合计量，因此它约束的是页而不是 entry：除最新那条 entry 自己就超过预算的情况之外，一页都在 `maxBytes` 之内，而那种情况下这一页就等于该 entry 的大小——一条 2.2 MB 的最新消息对着 512 KiB 的默认预算，回的是 2.2 MB 的一页，而一窗普通 entry 只回 513794 字节。这是分页快照仍可能付出的唯一代价。这一页带 `lastSeq` 与 `hasMore`，而它继续往回的游标就是它自己最旧那条 entry 的 `seq`——正是 `session.history` 的 `before` 所取的值，所以不再用 `nextBefore` 重述一遍。于是打开一个会话只需一页，`session.history` 以同样的 512 KiB 页把窗口其余部分往回走完。 让重连变便宜的能力是 `session.snapshot.since.v1`，而它要两处声明同时成立才改变任何东西：握手里的能力，以及请求里的 `sinceSeq`；缺任何一处，应答逐字节等于该能力出现之前的协议 v1，且不加任何字段，因此客户端可以先接受这个名字，再逐项依赖它。两处都成立时，客户端报出它已持有的那份快照的持久 `lastSeq`——宿主 cursor，从不是本连接自己的事件序号——桥则对着当前 follow 窗口证明连续性：只有当该窗口最旧那条 entry 的 seq 小于等于 `sinceSeq + 1`，或窗口为空时，应答才是增量 `{turns:[...], lastSeq, mode:"since", reset:false}`，只携带该水位之上被发出的 entry，且每个回合保留自己原本的 `seq`、`endSeq`、`reason` 与 `time`，与基线所呈现的形状一致。客户端从不渲染的 entry 仍是窗口持有的 entry，所以这个证明读的是未裁剪的窗口，只可能更保守。窗口若已经滚过该水位，就无法证明链条没断，此时——以及增量装不进一帧 10 MiB 时——应答是本连接本来就会收到的那份基线，另加 `mode:"full"` 与 `reset:true`，这是唯一让客户端丢弃自己副本的应答。裁剪、分页预算与单帧上限都没有动：增量切自同一份投影，而 reset 应答就是今天的应答加上这两个字段。

`frame.deflate.v1` 改的是帧的形态而不是内容，而它必须存在于这一层：101 响应不公告任何 `Sec-WebSocket-Extensions`，这个承载层拒绝所有 RSV 位，而 WebSocket API 无法提供 `permessage-deflate` 的客户端根本无从协商，因此线上走什么压缩只能在这里决定。声明了该能力的客户端可能会收到 WebSocket 二进制帧，其载荷是本该写成文本的那段 JSON 的裸 DEFLATE（RFC 1951，不带 zlib 头、不带 adler32 尾）：对载荷做 `inflateRaw` 得到的就是那一帧本身，逐字节一致。只有 UTF-8 文本达到 1024 字节的帧才会被考虑；压缩后没有变小的帧仍按文本发送——比原文更大的二进制帧什么也省不下来；方向是单向的，客户端一律继续发文本帧。10 MiB 上限不变，且仍按文本计量，所以本文档里的每一份预算都还是未压缩 JSON 的预算。未声明该能力的客户端拿到的，与协议 v1 一直以来写出的文本帧逐字节一致，握手在两种情况下也完全一样。

`subagent.thread.v1` 让一种 delta 存在：宿主持久事件 `subagent/catalog` 登记一个被委派的子会话，桥据此发 `subagent`，载荷 `{childId, label?, mode?, callId?}`。`callId` 是派生出该子会话的那次 `tool/call`，判定按两级、先问 spawn 自己的结果：某条 `tool/result` 点名了这个 child——`subagent` 工具返回的激活句柄 `{"kind":"activation","subagentId":…}`（单独返回，或嵌在 `run_code` 的答案里），或它打印的 `started subagent …` 通知——就由那次调用决定，哪怕这一步发过多条调用、或一次调用起了一整队子会话。没有任何结果点名该 child 时，退回原有判据：同一个 turn+step 里恰好一条 `tool/call` 时才给；那一步发过两条以上、或该 call 已经关联过另一个 child 时一律省略，因为猜出来的 id 会把线程挂到错的卡片上。spawn 的 catalog 事件可能先于它自己的结果被投影，因此实时 delta 只能用这条流到目前为止带过的内容作答，而基线用整个会话作答——两边是同一条规则、同一个 `SpawnCallIndex`。`subagent/catalog` 因此也成了裁剪基线保留的 entry 类型之一，并在 `data.callId` 里带上派生它的那次调用：在子会话已经被派生之后才打开会话的手机，直接读到标签、模式与造出它们的调用，而不是从 agent 消息反推线程。`user-message` 的 `actor` 不受任何能力约束：delta 与快照里的 `user/message` entry 都带 `{kind, sourceKind, sessionId?, label?}`，机械地取自宿主自己的 `source` 记录——`user` 与 `user-approval` 是 `human`，`agent-message` 与 `subagent-settled` 是 `agent`，其余来源种类一律 `system` 并保留原文——所以一条消息不会因为来源种类没被本协议分类过就被丢弃，而 source kind 不可读的事件干脆不带 `actor`。跟随一个会话需要授权，而不是默认成立：本连接已经打开过的会话、以及名册里作为普通会话列出的会话可以直接跟随；被委派的子会话只有它挂靠的父会话属于这两者之一时才可跟随。父会话无法由任何名册解析出来的子会话回 `session-not-followable`，且不为它打开任何流，因此放宽子会话这道闸门不会变成读取调用方从未被授权会话的通道。普通会话用它自己的 id 寻址；被委派的子会话——名册行带 `origin:"subagent"` 的那些——只能通过它的持久父会话寻址，而把一个子会话当作普通会话来问，宿主会回 `session/agent-busy`。父 id 来自名册——唯一携带谱系的端点——而桥在第一次尝试之前就读它，因此名册指明了父的子会话直接用 `{kind:"subagent", parentSessionId, childSessionId, mode:"unknown"}` 寻址，并拿到自己的真实历史。那次读取没解析出父时，改由宿主自己的拒绝当信号：只对这一个会话用委派地址重试一次。先列会话再打开会话的客户端不会多付一次读取，而每个连接最多读一次名册。普通会话永远不为此付费：它们用自己的 id 第一次尝试就打开。没有内容可看的会话也不等于失败：日志里只有宿主自己记账记录的会话，回的是真实投影加一个空回合；只有拿不到开帧、或宿主自己抛错，才会被拒绝。

`session.list.omit-archived.v1` 是这里唯一不协商任何东西的能力。桥从不传输已归档的会话——宿主归档集在每次列出时读一次，其中每个 id 都在该行构造之前被跳过——无论客户端是否声明该能力，因此那之后写下的客户端拿到的就是它本来要自己过滤掉的较短名册。在它之后：没有任何 `session.list` 行是归档集点名的会话；存活行在不变的 schema 下仍携带 `archived: false`；读不到归档集的那次列出则一行都不丢。已归档父会话的活跃子会话仍是自己的一行，并仍然点出那个父 id：父 id 由子会话自己的行走带，因此父被归档从不会让子会话失去谱系。名册同时也是 delta 机器做差分的那一集，所以两次列出之间被归档的会话以移除的形式到达，被恢复的则以变更的形式到达，两者都不需要任何特例。

`session.history` 以分页方式往回读一个会话的历史，而且它是纯读：既不打开、也不丢弃或改指任何订阅，同一个游标永远给出同一页。它的数据来自 `session.snapshot` 所用的那份开帧基线，因此两者永远不会在某个回合或某条 entry 上给出不同答案——`history` 只是对这份投影做切片。分页按 **entry** 切，不按回合切：一页从调用方游标之下取最新的 entry，直到编码后的页达到 `maxBytes`（默认 524288，即 512 KiB）；因此一个回合的 entry 可以跨页，而该回合仍保留自己的 `seq`、`endSeq`、`reason` 与 `time`；单条 entry 若比整页预算还大，就独占一页，而不是被拒绝。`before` 是持久水位而非下标：这一页取 `seq` 严格小于它的 entry，所以游标跨连接仍然有意义，投影在它之下改变形状也不会让分页跳号或重复。省略 `before` 即取最新一页；`hasMore` 说明下面是否还有更旧的 entry，而下一页的游标 `nextBefore` 恰好在 `hasMore` 为真时出现。裁剪能力在这里的生效方式与快照完全一致。

`session.list` 除名册自身字段外还带上手机用来分组与命名的元数据：`cwd`、`parentSessionId`、`origin` 只在宿主确实上报时才出现，`blank` 始终存在，`archived` 只在本次进程能读到宿主归档集时出现——读不到就省略该键，而不是回 `false`。已归档的会话根本不是一行：归档集每次列出只读一次，其中的 id 在构造该行之前就被跳过，因此真正穿过去的标记永远是 `false`，而手机本来要藏起来的那些行一个字节都不再花。`title` 就是该行自己带来的名字：宿主自己的 `projections.values.title`，冷会话与活跃会话都由它同步从投影缓存里折出；取不到才退回本连接已经通过 `session.titles` 解析过的值，再取不到才是 `""`。因此列名册仍然只是一次调用，不会给每一行挂上一次标题读取；而 `session.titles` 依旧是活跃会话的即时来源——改名之后最先刷新的就是它——手机要给冷会话命名，两个方法都不必调用。`session.titles` 用宿主自己的标题服务回答一批 1 到 100 个 id——读的是本进程的活跃会话，绝不为每个会话各开一条 follow 流——且每个被请求的 id 都是键：本宿主没有活跃持有的 id、或标题尚未落地的 id，一律回 `""`。一个已解析的标题会在 10 秒内被直接复用，之后才再问服务，因此重命名最多要等这么久才可见。与其它会话方法一样，没有设备令牌时两者都回 `unpaired`。

紧凑名册是同一份名册的另一种形态，需要两半同时出现：`session.list.compact.v1` 能力，以及请求里至少一个紧凑参数。`cwd` 是布尔值，决定绝对目录是否过线；`maxRows` 把名册切成每页这么多行；`after` 是上一页最后一行的 id，因此是续页而不是重取。行按最近优先排序、id 作平手判据，这正是 `after` 成为游标而不是位置的原因；`nextAfter` 只在后面还有行时出现，而指不到任何行的游标回第一页——就像本窗口从未签发过的 delta 令牌回 reset。`updatedAt` 只在本连接尚未把该 id 的这个值发给该客户端时出现，因此重复列出时一个都不带；`compact:true` 表明这些行就在这个 schema 下，于是缺失的 `updatedAt` 永远不会被误读成宿主从来没有的值。不带任何紧凑参数的请求，以及未声明该能力的客户端发出的每一次请求，都按上面的 schema 得到整份名册，逐字节相同。紧凑页与 `since` 令牌是两个不同问题各自的答案，同时出现的请求以 `invalid-args` 拒绝。

## 事件

| 主题 | 载荷 |
| --- | --- |
| `session.delta` | `{sessionId, kind, ...}`——某会话某一回合的一条增量（种类见下） |
| `approval.request` | `{sessionId, id, summary}`——有工具正在等待裁决 |

### session.delta 的种类

| 种类 | 附加字段 | 含义 |
| --- | --- | --- |
| `text` | `{text, blockIndex}` | 助手正文增量 |
| `reasoning` | `{text, blockIndex}` | 推理增量 |
| `tool-call` | `{callId, name, argumentsDelta}` | 工具调用增量；`argumentsDelta` 可为空串 |
| `tool-result` | `{callId, output, isError}` | 工具结果 |
| `turn-end` | `{reason}` | 回合结束；`completed` 之外都算异常结束 |
| `user-message` | `{text, messageId?, attachments?, actor?}` | 一条用户消息；`actor` 说明它从哪来 |
| `subagent` | `{childId, label?, mode?, callId?}` | 宿主登记了一个被委派的子会话；需能力 `subagent.thread.v1` |

`approval.request` 的摘要取自宿主按客户端语言给出的显示理由，缺失时回落英文、再回落工具名，并附带工具名本身。客户端用 `approval.resolve` 作答，`decision` 取 `allowed-once` 或 `rejected`；未知或过期的 `id` 会被拒绝，而无人应答的请求在两分钟后按 unavailable 结算，宿主视之为拒绝。工具发起请求的那一刻，每一条已配对连接都会收到该事件——首播不在任何能力名之后——而声明了 `approvals.v1` 的连接会在 `hello` 之后再次收到所有仍在等待的请求，因此重连过的手机、或事后才打开该会话的界面，手里依然有卡片。只有未结算的请求会被重放：已作答、已超时、已撤回的请求早已离开认领表，而重新递一次请求绝不会挪动它的两分钟截止时间。该能力只门控这第二次送达，因此它不出现在 `hello` 的 `capabilities` 里、也不改动 `minor`：握手对每个客户端都回同一个帧。桥只在下游有已配对客户端连接时才认领审批请求：一个都没有时，请求交给下一个应答者，而不是干等一台不在场的手机。

提问通道是唯一一条能比套接字活得久的认领。提问以 `question.request` 事件到达手机，call id 用宿主自己的；阻塞式提问没有 call id，就由本桥另铸一个。手机用 `question.answer` 结算宿主的询问：询问仍然开着时，答案直接解开本桥手里的 promise；宿主自己的截止时间已经放走模型之后，迟到的答案改走宿主的 Remote `answer`。`question.list` 回答本桥此刻仍持有的提问，手机据此与手里的卡对账。没有任何已配对连接在线、但设备名册里有登记过推送令牌时，桥替那台手机认领这道题，推送就是它的送达：在桥自有的一个窗口内，这道题只存在于手机侧，窗口结束即回到宿主自己的应答者链。这个窗口是 `OFFLINE_QUESTION_CLAIM_TTL_MS`，十分钟，可用 `DSH_REMOTE_BRIDGE_OFFLINE_CLAIM_TTL_MS` 覆盖。窗口内重连并声明 `questions.v1` 的手机直接拿到这条仍然有效的认领，窗口到此为止；手机作答即结算，宿主链于是从未启动；而已配对连接完成 `hello` 却没有声明这条通道时，认领立刻被撤回——线上没人能收的认领不留。阻塞式提问（无 call id、无 deadline）同样认领，代价写在明处：它背后的 agent 最多白等这一个窗口。审批沿用上面更严的那条规则：永远不为不在线上的手机持有任何东西。

可交互回复是唯一一条「走一整页而不是走一个问题」的通道。`ui_present` 是本桥自己的模型工具：agent 写一整份自包含文档（以 `<!doctype html>` 开头，UTF-8 最多 256 KiB），它作为 `ui.request` 事件、用宿主自己的 `ToolCallId` 下发，于是这张卡正好挂在转录里那条工具调用行上。随后这次调用阻塞，直到用户在页面里的**第一条**动作为止——那个动作 `{type, payload?}`（`type` 是页面自己的闭集，`payload` 最多 8 KiB）就是这次工具调用的返回值：一张卡结算一个动作，需要继续接受动作就让 agent 再呈现一次。结算时这条卡以 `state:"settled"` 对每个声明了 `ui.v1` 的客户端再公告一次（包括刚作答的那台），所以手机上重复的第二次点击、以及第二台手机都能读到它已结束。`ui.list` 回答本桥此刻仍持有的卡，是手机重启后的对账依据，且只有 `complete` 的应答才允许退休一张卡。卡永不携带 `expiresAt`：工具 schema 不声明 `timeout`，本桥也就不发明超时；它拿的是与提问同一个宽限窗口——再没有人能作答的卡在「最后一次配对设备离开」留下的窗口到期时，以超时交还给 agent，而在这个窗口内声明了通道的手机则被重放活卡、并取消这次释放。没有任何声明了 `ui.v1` 的已配对连接时，`ui_present` 立即回 `{ok:false, reason:"unavailable"}`，不占用宿主的等待。真的到过线缆上的那次呈现，其结果在 `meta.ui` 里带着同一份展示载荷——`{key, title?, html, height?, state}`，`key` 是 `"<sessionId>/<callId>"` 拼法——供从转录渲染、手里没有 `ui.request` socket 的客户端使用；结果正文仍是一句人可读的话。

## 扩展缝

本包只发布一道通用扩展缝，自己的词表里不放任何业务词。已挂载的插件解析 cordis 服务 `remoteBridge`，即可向协议 v1 增加方法与事件，而桥不需要知道它们是什么意思：

| 成员 | 契约 |
| --- | --- |
| `registerMethods({capability?, methods})` | 增加一张客户端可调用的方法表，返回撤回它们的 disposer；`KNOWN_METHODS` 里的名字、空名字或另一张表已占用的名字一律拒绝，且整张表一起拒绝 |
| `broadcast(topic, payload, capability?)` | 向已配对的连接推送一个事件（指名能力时只投给声明了它的连接），返回实际收下该帧的连接数 |

已注册方法的派发排在两道协议闸门之后：没有插件注册的名字最先回 `unknown-method`；没有有效设备令牌的连接回 `unpaired`，与协议方法完全一致；从未声明该表所需能力的客户端同样回 `unknown-method`——方法对它而言不存在，而不是没有权限。处理器收到请求载荷与本连接 id，回 `{ok:true, r}` 或 `{ok:false, code, msg}`；两种都原样穿过，因为错误码归注册它的插件所有。处理器抛错、或两种形状都没回时，以桥自己的 `internal` 穿过。

`hello` 现在回 `minor:21`，起自可交互回复通道落地：它新增两个能力名（`ui.v1`、`ui.list.v1`）、一个主题（`ui.request`）、两个方法（`ui.event`、`ui.list`）与一个模型工具（`ui_present`），因此客户端从线缆上读到两个新名字、一种新事件与两种新应答体，而任何既有帧、方法与键都不改形状。`minor:20` 是用量台账通道落地时：`usage.stats.v1` 背后，客户端可以调 `usage.stats` 读宿主自己的台账，`usage.session` 也多了可选的 `modelContextWindow`（取自那条路由的模型目录），因此它从线缆上读到一个新的应答体和一个新的可选键，并且必须先读到这个名字才敢问——低于这一版的桥回 `unknown-method`、也不带那个键，而任何帧、主题与既有方法都不改形状。`minor:19` 是用量通道落地：`usage.v1` 背后，客户端可以调 `usage.session` 与 `usage.balance`，因此它从线缆上读到两个新的应答体，并且必须先读到这个名字才敢问——低于那一版的桥对两者都回 `unknown-method`。`minor:18` 是「一张实况卡排下几个会话」：`content-state` 可以带 `rows`，最多三项 `{name, status, phase}`，顺序由桥定——先提问中的会话（按提问到达顺序），再正在跑的会话（按最近更新倒序）——因此不新增方法、不新增能力名、也不改动任何既有键，`minor` 只加一。行的 `name` 是宿主自己的标题摘掉尾部路径组的结果，因为线上不许出现路径。`minor:17` 是实况卡推送落地：锁屏卡与灵动岛由 `push.v1` 既有的登记面驱动，桥侧只新增发送路径（`liveactivity` 推送、按会话投影的 `SessionActivityState`）。`minor:16` 是通知推送通道落地：`push.v1` 背后，客户端可以调 `push.register`，让设备表记住自己的 APNs 令牌，于是回合结束或出现待答提问时手机会被叫醒，而它自己的 socket 并没有开着。`minor:15` 是小队通道落地：`squads.v1` 背后，客户端可以调 `squads.state`、`squads.list`、`squads.runs`、`squads.runMember` 与 `squads.runSquad`，因此它从线上读到五种新的应答体，并驱动宿主的小队域而不是从别处推导 agent。`minor:14` 是会话管理通道落地：`workspace.v1` 背后，客户端可以调 `workspace.list` 并读到宿主的工作区与两个全局会话集合；`session.admin.v1` 背后，它可以改名、置顶、取消置顶、归档与取消归档一条会话，因此它从线上读到六种新的应答体。`minor:13` 是待答提问列表落地：`questions.list.v1` 背后，客户端可以调 `question.list`，拿回本桥此刻仍持有的提问——手机据此对账它手里的卡，也是它得知「自己离线时某个提问已经结束」的唯一途径，因为最后一个配对设备离开时，桥会撤回全部认领。`minor:12` 是指令通道落地之时：`commands.v1` 背后，客户端可以调 `session.commands` 与 `session.command`，因此它从线上读到一种新的应答体。`minor:11` 是 fork 通道落地之时（比先一步在集成分支上落地的快照增量通道高一位）：`session.fork.v1` 背后，客户端可以调 `session.fork` 并拿到宿主自己的 fork 结果。`minor:10` 是快照可按请求增量之时：`session.snapshot.since.v1` 背后，带 `sinceSeq` 的 `session.snapshot` 要么只回该水位之上的 entry，要么回一份带 `mode` 与 `reset` 的完整基线，所以这一位是为客户端能从线上读到的应答形状而提的。`minor:9` 是紧凑名册之时：`session.list.compact.v1` 背后，带 `cwd`、`maxRows` 或 `after` 的列出得到更短、且可分页的行，所以这一位是为客户端能从线上读到的行 schema 而提的。`minor:8` 是下行帧的形态本身成为一种能力之时：`frame.deflate.v1` 背后，声明了的客户端可能收到承载裸 DEFLATE 的 binary 帧，所以这一位是为客户端能从线上读到的东西而提的。`minor:7` 是两条通道汇合之时；`minor:6` 是其中任一条单独在位——agent 通道在 dev 上，持久历史分页在它自己的分支上；`minor:5` 时是名册不再携带已归档会话。`agents.v1` 背后，`presets.list` 与 `session.create` 转发宿主的预设名册与一次创建请求；`session.deep-history.v1` 背后，`session.history.deep` 把会话的持久存储一直翻到最早一条 entry；`session.fork.v1` 背后，`session.fork` 把一条会话分叉成继承它的新会话。`minor:4` 加了字节级增量，`minor:3` 是后台作业通道，`minor:2` 是子代理线程，`minor:1` 是本扩展缝。它们都没有改动主版本 1、任何冻结字段、方法名或主题名。唯一对每个客户端都变短的响应体是名册本身，它不再点名已归档会话；其余答案对什么都不声明的客户端仍是协议 v1 自己的。

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `unpaired` | 本连接没有有效设备令牌，而该方法不在未配对白名单内 |
| `snapshot-unavailable` | 读不到该会话的开帧——follow 流没产帧就结束，或 10 秒内没有开帧。宿主自己抛出的失败则带着它自己的错误码穿过 |
| `token-invalid` | bootstrap token 未知、已被用掉，或已超过 30 秒 |
| `nonce-invalid` | `pair.finish` 用的 nonce 从未签发、已被用掉或已过期 |
| `signature-invalid` | ES256 签名无法用所给公钥与 nonce 验证通过 |
| `approval-unknown` | `approval.resolve` 指的审批 id 未知或已过期 |
| `unknown-method` | 方法名不属于协议 v1 |
| `invalid-args` | 载荷与方法形状不符 |
| `proto-unsupported` | `hello` 握手声明的协议版本本桥说不出来 |
| `snapshot-too-large` | 开帧快照无法压缩进单帧：连一个回合都放不下 |
| `squads-unavailable` | 本宿主没有本桥能到达的 `dsh-agents` 小队域：插件 loopback 路由没有应答、旁边没有可读的账本，或者应答体不是本构建读得懂的那一个域。小队读取从不以空板回答，而插件自己抛出的拒绝带着插件自己的码穿过 |
| `squads-run-unavailable` | 定义读得到，但两条运行指令服务不了：到达不了任何 loopback 运行路由，只读账本也启动不了会话。回一个从未启动的运行是这条通道唯一不做的事 |
| `internal` | 桥在服务该调用时自身失败 |
| `frame-too-large` | 该帧超过 10 MiB 上限，未被解析 |
| `malformed` | 该帧不是形状可辨的单个 JSON 对象 |
| `direction-violation` | 客户端发来了只有宿主才发的 `res` 或 `ev` 帧 |

在 DSH 内部产生的失败同样不被改名：它带着 gateway 自己的错误码穿过桥，例如 `service-unavailable`、`invocation-unavailable`、`definition-unavailable`、`arguments-invalid`。`dsh-agents` 插件抛出的拒绝也这样穿过：带它自己的稳定错误码——`team-not-found`、`member-not-found`、`preset-unknown`、`workspace-unavailable` 及其邻居——以及它自己那一句有界文案。只有服务激活窗口会被重试（5 次、间隔 2 秒），因为那是唯一「片刻后即成功」的失败。

## 鉴权

设备令牌随 WebSocket upgrade 以 `Authorization: Bearer <deviceToken>` 携带——这是首选载体——并对不便设置 header 的客户端接受 `?token=<deviceToken>`。比对为定长比较，不会在长度不符时短路。没有有效设备令牌的连接只放行三个方法——`hello`、`pair.begin`、`pair.finish`——其余方法在任何会话工作发生之前一律回 `unpaired`。

### Bootstrap token

配对入口位于侧栏底部的二维码图标，按钮的 aria-label 为「配对手机（协议 v1）」。点击后打开配对面板。该面板只在本机可用：令牌路由 `GET /remote-bridge/pair/token` 受回环门控保护，来源地址与 `Host` header 必须均为本机（非本机或经隧道访问一律返回 403）。

配对码一次性有效且具备 30 秒时效（`BOOTSTRAP_TOKEN_TTL_MS = 30_000`），被首次 `pair.begin` 用掉即失效；在面板中点击「重新取码」会使上一张配对码作废并生成新码。面板中没有「停止」按钮，也没有「吊销所有已连接设备」的操作。同一条链接会打印到宿主日志，配对码本身则渲染在配对面板中供扫码。

```sh
curl -s http://127.0.0.1:3080/remote-bridge/pair/token
# {"token":"...","expiresAt":1760000030000,"url":"ws://127.0.0.1:3080/ios/v1?token=..."}
```

当这台机器能解析出公网或局域网地址时——无论来自实时的中继租约/隧道状态、`DSH_REMOTE_PUBLIC_BASE_URL` 还是正在监听的局域网转发器——同一个响应里会多出地址那一半：

```json
{
  "token": "...",
  "expiresAt": 1760000030000,
  "url": "ws://127.0.0.1:3080/ios/v1?token=...",
  "origin": "wss://<id>.dsh-market.com",
  "originSource": "registry",
  "pairingUrl": "wss://<id>.dsh-market.com/ios/v1?token=..."
}
```

二维码编码一个 `{token, url}` 文档，其中 `url` 形如 `wss://<origin>/ios/v1?token=...`（由 `pairingDialUrlOf` 将 https 转为 wss、http 转为 ws）。手机 App 扫码即同时得到地址与令牌，无需手动输入。查不到可用地址时字段缺省而非盲目猜测，面板退回裸配对码，手机保持已有地址不变。

### 设备令牌

`pair.begin` 应答一个 nonce 及其过期时刻；客户端用 P-256 密钥对 nonce 的原始字节签名，并以 base64url 的 SPKI 公钥与 base64url 的 ES256 签名调用 `pair.finish`。签名必须是 WebCrypto 与 CryptoKit 产出的原始 64 字节 `r||s` 形态，不能是 DER 包装：宿主先校验长度再验签，重新编码过的签名会被拒绝。宿主回一个 32 随机字节的 base64url 设备令牌及其 deviceId。服务端只存该令牌的 SHA-256 哈希，因此名册文件即使被拿走也换不出可用凭据。

## 设备名册

名册落在 `$DSH_HOME/remote-bridge/devices.json`，是一份带版本号的文档，每个已配对设备一行：

```json
{
  "version": 1,
  "devices": [
    {
      "deviceId": "dev_9Qm2r0Tn1Zk4",
      "pubKey": "<base64url SPKI, P-256>",
      "fingerprint": "<sha256 of the SPKI>",
      "createdAt": 1760000000000,
      "lastSeenAt": 1760000000000,
      "tokenHash": "<sha256 of the bearer token>"
    }
  ]
}
```

文件里没有任何可直接使用的明文凭据：一行保留设备的公钥、指纹，以及签发给它的令牌的 SHA-256，从不保留令牌本身。目录为 0700、文件为 0600；写入先落临时文件、flush 后再原子 rename，崩溃不会留下半截名册，解析失败的文件会被改名加上 `.corrupt-<时间戳>` 后缀隔离，而不是被当作空名册。协议 v1 没有吊销方法，所以吊销一个设备就是移除它的那一行（或删掉整个文件）再重启宿主：名册每个进程只读一次，自那次启动起该设备连接即未配对。一行就是一台手机，一枚 APNs 令牌只投一次：重配对是在该设备已有的那一行上换掉 bearer 令牌——deviceId、创建时刻与推送登记原样保留——而读取时会把同一 fingerprint 的多行、以及同一枚令牌落在多行上的情况压缩掉，所以重配对是换凭据而不是加设备，一次事件也不会把同一块锁屏响两遍。

## 中继

把私网实例发布到公网的中继是**全量反代**：它查出实例当前的隧道目标，只重写 `Host` header，其余原样转发 origin 的响应——唯一按路径区分的规则是对内容哈希的 `/assets/*` 加不可变缓存。WebSocket upgrade 走的是同一跳：Workers 运行时在客户端发出 `Upgrade` 请求且 body 为空时，会让该 `fetch` 升级为 WebSocket。因此协议 v1 只是同一 origin 上的又一条路径：Worker 无需改动、不需要第二条隧道、也不需要多发布一个 origin。

这一跳带来两条后果。它看得见请求 URL，所以用 `?token=` 连接等于把设备令牌交给中继、Cloudflare 边缘与 origin 访问日志——优先用 header。而 `GET /remote-bridge/pair/token` 会像其他路径一样被转发，但它的 loopback 门禁会拒掉这条转发请求，因此配对只能从本机发起。

## 接入栈与安全模型

`@linxin666/dsh-remote-bridge` 拥有完整的公网与局域网接入栈：
- **中继身份与租约**：`relay-registry` 在 `$DSH_HOME/remote-web-ui-registry/<profile>.json` 下持久化中继身份（id 与 secret）；改 relay 配置会重挂载插件行，当以 `relay=false` 挂载且盘上存在身份时，挂载时撤销上一次留下的注册行并 `pair.release()` 释放租约各一次（失败各记一行；卸载时不释放也不撤行，保留手机收藏地址由服务端 GC 回收；`relay=false` 挂载绝不铸造新身份，盘上无身份时零副作用、不写盘）。
- **中继连接器**：`relay-connector` 并行维护快速隧道与命名隧道连接器；`relay-bridge-connector` 经 WSS 连接 Cloudflare Durable Object 会合点，并将连接状态记录在 `$DSH_HOME/remote-web-ui-relay-bridge.json`（状态文件写入经行为级验证，缺省落到 `$DSH_HOME`，非源码文本断言）。
- **隧道生命周期**：`tunnel`、`tunnel-plan` 与 `tunnel-orphan` 管理平台原生 `cloudflared` 子进程，具备指数退避重启机制并自动清理崩溃遗留的孤儿进程。
- **命名隧道端口同步**：`ingress-sync` 在宿主监听端口变化时，把 Cloudflare 命名隧道的 ingress 规则原子收敛到本机闸门端口。
- **局域网转发与防火墙**：`lan`、`lan-bind`、`lan-bind-plan`、`lan-forward`、`host-bind-capability` 与 `firewall` 管理局域网边缘转发器与操作系统防火墙规则（Windows Defender 与 Linux firewalld/ufw/iptables），宿主 webserver 本身始终严格保持回环绑定。

本包的安全模型对所有外部接入入口实施严格的白名单隔离：
- **入站网关（`src/host/ingress-gate.ts`）**：仅绑定 `127.0.0.1`，且仅将 `/ios/v1` 的 WebSocket 升级转发到本机协议端口，同时将 `Host` 头改写为回环权威。其余任何普通 HTTP 请求与非白名单升级一律直接返回 `404 {"error":"not-found"}` 并关闭连接，绝不建立上游连接。
- **隧道的目标是入站网关而非 webServer 端口**：cloudflared 快速隧道与命名隧道的目标均指向 `ingress-gate` 的动态回环端口，绝不直连 `webServer` 端口。外界经隧道传入的请求无法触达 webServer 路由、内部 API 或其他插件。
- **中继注册行与公网暴露面**：中继注册行只写入快速隧道的 URL，也就是入站闸门，公网因此只看得见 /ios/v1。计划为 quick 且隧道 running 时把闸门 URL 注册给中继 Worker（`<id>.dsh-market.com` 代理到本机）；卸载时只清本地引用不撤行。二维码公网地址由 `livePublicOriginOf` 裁定：bridge 或 named 租约优先稳定子域名；quick 租约在注册未成功时退回隧道 running URL；无租约用隧道 URL；皆无则无地址。其后退回 `DSH_REMOTE_PUBLIC_BASE_URL`，局域网兜底仅当局域网转发器真的在监听时才按实际绑定的 address 与 port 给出（不猜地址列表首项，转发器停止即无兜底；已彻底移除磁盘 registry 行作为兜底地址，消除了对老插件数据文件的最后一处依赖）。
- **局域网转发器的目标同样是入站网关**：局域网转发器监听本机局域网 IPv4 地址，并将请求严格转发至 `ingress-gate` 端口，因此局域网入口的暴露面同样仅有 `/ios/v1`。
- **中继桥会合点白名单**：`relay-bridge-connector.ts` 对 Durable Object 汇聚的入站流执行完全相同的白名单检查，非 `/ios/v1` 的 HTTP 流直接应答 `404 {"error":"not-found"}`，非白名单 WebSocket 升级直接回复 `ws-fail 404 {"error":"not-found"}`，两条路都不建立上游连接。
- **身份目录沿用历史拼写与并存禁忌**：中继身份目录 `$DSH_HOME/remote-web-ui-registry/` 与状态文件 `remote-web-ui-relay-bridge.json` 有意沿用历史拼写，确保既有 profile 保持身份连续性，已配对设备升级后无需重新配对。**已知风险与并存禁忌**：同一 profile 切勿同时启用本插件与已弃用的 `dsh-remote-web-ui` 的中继——两者按 profile 共用同一份身份文件；若新桥以 `relay=false` 挂载，会撤销该身份下的注册行并释放租约，从而打断老插件正在使用的公网中继；若两侧 relay 同时开启，bridge 传输下两个连接器会拿同一凭据竞争同一个 Durable Object 连接互相顶掉，quick 传输下后注册者覆盖前者。该收尾行为是有意设计的。
- **本插件不含浏览器配对面**：本包不包含配对 cookie 门控、`/api/pair` 路由族、`/remote` 代理通道以及手机浏览器竖屏触控适配层。

## 配置

本插件通过 profile YAML（如 `cordis.patch.yml` 或 profile 配置）进行配置，不提供设置界面。未配置的字段回退到内置默认值：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `relay` | boolean | `true` | 是否申领 relay 租约。默认开启；无隧道时仍 claim 租约，因此默认配置下公网即可用。 |
| `autoTunnel` | boolean | `false` | 是否启动指向入站网关的 Cloudflare 快速隧道。 |
| `lanBind` | boolean | `undefined`（关） | 是否启动监听本机局域网 IPv4 地址的局域网转发器。 |
| `tunnelToken` | string | `undefined` | 运行 Cloudflare 命名隧道所需的隧道令牌。 |
| `publicBaseUrl` | string | `undefined` | 命名隧道的固定公网 HTTPS 基地址。 |
| `ingressSync` | boolean | `false` | 是否自动将命名隧道 ingress 服务端口同步至 Cloudflare。 |
| `cfApiToken` | string | `undefined` | 用于 ingress-sync 的 Cloudflare 账户级 API 令牌。 |
| `cfAccountId` | string | `undefined` | 用于 ingress-sync 的 Cloudflare 账户 ID。 |
| `cfTunnelId` | string | `undefined` | 用于 ingress-sync 的 Cloudflare 命名隧道 ID。 |
| `profile` | string | `'desktop'` | 受管 profile 名称（缺省读取 `$DSH_PROFILE` 或 `'desktop'`）。 |

## Web GUI 配对面板

浏览器半区存在的理由，是让从不开终端的操作者也有一条发起配对的路径。它沿用家族在侧栏底部的惯例：触发器注册进官方 `sidebar.footer.action` 列表槽位（由 ui-sidebar 声明，与 `dsh-update` 的更新器共用该列表槽位），点开后是官方 `Modal`，这张无头卡片由本包填充。它渲染的每个控件都是库里已有的 primitive——弹窗、三个动作与它们的字形——因此遮罩、卡片、焦点圈定、Esc、焦点归还，以及每个 hover/focus/disabled 状态都是官方壳自己的行为，而不是本包的一份复制品。它由同一插件行承载：产物是 `exports["./client"]`，`dsh.client` 声明必须先就位的 client 模块。

面板只做一件事——把活着的那个一次性配对码摆到操作者面前，且只有这一个阅读顺序：

- **二维码本身就是那个码。** 它要么装 43 个 base64url 字符的裸 token，要么在宿主说得出自己公网地址时装 `{token,url}` 文档，扫一次就把手机配好。若放一个宿主没背书过的 URL，手机端的解析器会顺手把 origin 改写成这台机器的 loopback 地址，而那恰恰是手机够不到的地址。编码串只在二维码部件的 `data-dsh-qr-value` 属性里留一份镜像，供 UI 检查不必解码就比对；它从不以文字形式渲染。
- **二维码下方只有一条状态行。** 活着的码在进度条旁倒数那 30 秒；过期的码在同一个固定高度里直说过期，变的只有那句话。
- **一条地址说明。** 宿主定位到中继地址时，这一行就写明手机将要连到哪儿；定位不到时，它直说没找到公网地址、手机里的连接地址得手填公网中继，并点明本页所在的 `127.0.0.1:<端口>` 只有本机能连。
- **一条一次性说明。** 手机一开始配对，这个码就作废；重新取码同样会作废上一张。
- **一行动作。** 复制把二维码里那个字符串原样放进剪贴板，「重新取码」签发新 token 并作废上一张；两者都是同一个库控件、同一个尺寸，交互态不会各走一套。码一旦过期，回到可扫状态的唯一路径就是重新取码：复制被禁用，二维码原地降级变暗，而不是缩小或被移除。
- **失败不静默。** 取码走的就是操作者本可以用 curl 打的那条仅 loopback 路由：`403` 渲染成「这个页面不是从本机打开的」且不给出可点的动作；请求没到达则渲染成它自己的不可达状态并给出重试；宿主回了别的状态就把那个状态码说出来。

开与关是同一段动效的两条腿：卡片保持挂载，把弹窗自己的进场淡入反向播完才卸载；reduced-motion 下这条生命周期换成一段短淡出，而不是干脆没有出场。几何在每种状态里都钉住——二维码的盒子、状态行、地址说明与复制标签都不改高度和宽度——所以倒计时、过期与复制确认都不会挪动它们旁边的元素。

面板对原生路径而言只是显示层。它从不消耗配对码（`pair.begin` 始终是手机那一侧的动作），从不碰名册，也不新增任何 wire 面——信封、方法名、主题名与事件一律不动。本插件不提供任何浏览器配对面或 cookie 门控。

## 会话里的整页卡

`ui_present` 把一整页自包含文档交进会话，浏览器半区把它画在官方工具行里：这份呈现是**一次**按线路工具名 `ui_present` 的 keyed `tool.call.toolview` 注册，因此工具行原有的调用身份、耗时与 dispatch 树照旧由官方渲染，本包没有影子化任何 Chat Node 渲染器。这是可交互回复扩展的桌面落点；没有组合出 Tool 层的客户端没有这个 keyed 格，卡片在那种合成里就是不出现。

这一行从两个来源读卡，且两个都不丢：

- **调用进行中**，线路上只有参数，页面取自这次调用自己的 `html` 参数，卡头标注等人操作。
- **结果落地后**，展示载荷 `meta.ui` 就是这张卡自己的记录——它的 `key`、`title`、`html`、`height` 与 `state`——卡头标注已结算。结果没带这个载荷时回退到参数里的页面，并且照样读作已结算：决定这一点的是阶段，不是那个缺席的字段。
- **画框是 `srcdoc` 加扩展允许的那一个 sandbox 值。** 取值只有 `allow-scripts`，永不带 `allow-same-origin`，因此页面是不透明源，够不到 GUI 的存储、cookie 与 DOM；顶层导航、弹窗与表单一律不授权，相机、麦克风、定位与剪贴板读取由显式的权限策略拒绝。
- **桌面端只渲染，不作答。** 页面发出的操作会到这里变成一句可见提示，让操作者去手机上作答；不转发、不落库、不发任何请求，所以这一半不新增任何 wire 面。
- **高度与主题都由外向内给。** 宿主建议的 `height` 只顶第一帧，注入的报告脚本把文档自身的内容高度发出来、以实测为准；主题的语义令牌从 GUI 根元素读出后交给页面，卡片因此跟随当前明暗，读不到主题时损失的是那几个变量而不是卡片。
- **拒收是可见的。** 超过 256 KiB 的页面不会交给画框，并直说它没有被渲染；一次没带页面的调用保留一行中性说明，而不是留一格空白。


## 客户端脚本

`scripts/client.mjs` 是一个零依赖的协议 v1 客户端——只用 Node 22 的内置全局，不引任何包——用于对活着的桥接做检查，也给没有 Secure Enclave 的测试机配对。它按固定顺序跑一遍，给每帧加方向前缀、把事件按到达顺序编号，整段输出可直接粘进报告；它自身不执行任何模型调用。

```sh
# check a paired connection: hello -> session.list -> session.snapshot -> session.prompt -> session.delta
BRIDGE_URL=ws://127.0.0.1:3080/ios/v1 BRIDGE_TOKEN=<deviceToken> node scripts/client.mjs

# pair this machine with a throwaway P-256 key and print the device token
node scripts/client.mjs --pair --pair-base http://127.0.0.1:3080
```

## 安装

### 从 npm 安装

```sh
dsh plugin --profile web add @linxin666/dsh-remote-bridge@latest
```

### 从仓库安装

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-remote-bridge
```

本插件是家族成员：聚合包 `@linxin666/dsh-web-all` 会把它作为 `remote-bridge` 行连同家族其余内容一起装上，因此装上聚合包就够了。单装本包仍然受支持，且仍是只跟随本插件自身版本、不跟聚合包版本的做法。两条路加载的是同一个 npm 包，所以 profile 里同时存在两行时宿主半区仍只注册一份——`/ios/v1` 与 token 路由归先挂载的那个来源，家族的单实例守卫会在该来源在宿主运行期间被拆除时重放那次被拒的挂载。安装或更新后需重启 `dsh web`——宿主半区在插件行挂载时注册路由，提供服务的就是那个运行中的宿主——随后刷新 Web GUI 页面，浏览器半区在侧栏底部的触发器才会出现。

## 配置

桥接像其他宿主插件行一样挂载。v1 不带任何面向用户的选项：本文中的取值——30 秒一次性 bootstrap token、仅 loopback 的 token 端点、10 MiB 单帧上限、固定的 `/ios/v1` 路径——都是协议常量而非设置项。配对与吊销也不是配置，而是名册里的逐设备事实。桥接唯一依赖的环境事实是 `$DSH_HOME`，因为名册就在它下面。

## 安全模型

- **配对即完全控制凭据。** 已配对设备在同一进程内触达宿主：会话、发言、审批。只配对你掌控的设备，吊销方式是移除名册那一行并重启宿主。
- **进程内调用以 owner 身份发言，且只在桥自己的门禁之后。** 自 DSH 0.2.1 起，宿主网关要求每次调用都指明代表谁发言，桥的回答是自己在挂载时铸造的一个进程内 owner peer（`{kind:'owner'}`），挂到每一次网关调用上。这个声明之所以安全，是因为它只在桥自己的配对检查之后才会被用到——未配对连接在任何网关调用存在之前即被拒——且协议帧的任何字段都不能设定 principal：客户端在载荷里自报的身份会被忽略。该 peer 不接收转发事件交互，因此它也永远收不到宿主转发事件。
- **token 端点仅 loopback 可达，且看两个条件。** 来源地址必须是 loopback，且 `Host` header 必须写本机。经隧道的请求由本机的隧道客户端终结，所以对一条全互联网可达的请求，来源地址也读作 `127.0.0.1`；而中继与普通隧道都会把 `Host` 改写成公网名。任一条件不成立即 403。token 只存内存、30 秒过期、被一次 `pair.begin` 用掉即焚，同一条链接还会写进宿主日志——把那一行日志当作活着的密钥。
- **配对面板渲染的是一份活密钥，也仅止于此。** 它用同源请求读同一条仅 loopback 门禁的路由，所以在 `curl` 够得到的地方它才够得到，别处都不行。它不能签发设备令牌、不能消耗配对码、不能列名册、不能吊销设备：`pair.begin` 始终是手机那一侧的动作，吊销始终是改名册加重启宿主。二维码里装的是裸 token 或宿主自己那份 `{token,url}` 应答，因此本页的 `127.0.0.1` origin 永远不会被交给手机。
- **未配对连接只有三个方法的白名单。** `hello`、`pair.begin`、`pair.finish`；其余方法在分发前即回 `unpaired`，因此没有设备令牌就够不到会话面、审批面与名册面。
- **设备令牌只存哈希。** 名册保留公钥及其 SHA-256 指纹，从不存令牌本身，所以该文件不是凭据库。令牌丢失、轮换或被拒的处置就是重新配对——这是常规流程而非异常路径（重新签发一条 bootstrap 链接，或在桌面配对流程里重扫），且从不需要手工改名册。
- **令牌比对不泄漏长度。** 用的是定长比较而非提前返回的比较，因此错误令牌无法被逐字节逼近。
- **审批在客户端在线时 fail closed。** 只要还有一个已配对客户端在线，桥才认领工具的权限请求；一个都没有时，请求交给下一个应答者而不是卡住。已认领而无人应答的审批会被归一为 `unavailable`，宿主按拒绝处理：手机沉默永远不等于同意。
- **header 是更安全的载体。** `Authorization: Bearer <deviceToken>` 让凭据不进入 URL；`?token=` 是给无法设置握手 header 的客户端的，此时中继、边缘与访问日志都会看到一条以该设备身份鉴权的 URL。

## 已知限制

- **`session.titles` 只回答活跃会话。** 它读的是本宿主进程活跃持有的会话的标题，本宿主没有活跃持有的 id 在那里一律回 `""`；名册自己的行带的是该行投影出的标题，冷会话同样有，不必调这个方法来命名。
- **已服务过的标题最多可能旧 10 秒。** 一个已解析的标题在 10 秒内被直接复用，之后才再问标题服务，因此重命名或刚生成的标题最多要等这么久才出现。
- **读不到归档集时没有 `archived` 键。** 该标记来自宿主的 workspace registry；该服务未挂载时，每一行都省略此键，而不是回 `false`，并且一行都不丢——读不到的桥不会给出更短的名册。
- **已归档的父会话不授权任何东西。** 已归档父会话的活跃子会话仍会被列出、也仍点出那个父，但在父被恢复之前跟随该子会话会回 `session-not-followable`：授权一个会话的是名册，而已归档的那个已不在名册上。
- **`lastSeq` 与 `seq` 是两个计数器。** `session.snapshot` 的 `lastSeq` 是宿主流的 cursor，事件的 `seq` 是本连接自己的事件序号，二者不可比较；续传状态属于客户端。
- **增量只在连续性可证之处存在。** 证明取的是当前 follow 窗口最旧那条 entry，因此重连进一个已经滚过 `sinceSeq` 的窗口、或增量装不进一帧时，应答是带 `reset:true` 的完整基线；本包仍不为断开的客户端缓存任何东西，它读的就是本来也会打开的那个窗口。
- **被委派的子会话每个连接最多付一次名册读取。** 子会话的持久父 id 只有 `session.list` 会发布，所以一个连接在没先列名册的情况下打开的第一个子会话，要付一次名册读取；此后任何父名下的任何子会话都不再付费，而先列名册再打开的客户端一分不付。名册若解析不出该子会话的父，桥回 `session-not-followable`，而不是编造一个地址；父不是本连接已授权会话的子会话同样如此。
- **`session.history` 到不了开帧窗口之下。** 分页走的就是 `session.snapshot` 所用的那份基线，因此最旧可达的 entry 就是那个窗口里最旧的 entry——受宿主自己的 `maxMessages` 窗口（200 条消息）限制。开帧上的 `hasMore` 是宿主对更旧内容的回答，桥不会越过它去取。
- **比一帧还大的单条 entry 无法被塞进预算。** 分页首屏与 `session.history` 都会让这样的 entry 独占一页而不是拒绝，因此承载它的那一页可能超过 10 MiB 单帧上限；其余每一页都留在自己的预算之内。
- **工具调用参数以增量到达。** `tool-call` 增量的 `argumentsDelta` 可以为空串，参数由客户端拼装；整次调用不会被重发。
- **订阅比 interrupt 活得久。** `session.interrupt` 只取消回合；订阅在连接关闭时结束，一个连接名下的 follow 流由同一个 AbortController 一起 abort。
- **`clientTimeZone` 由宿主侧填写。** 桥接用本机 IANA 时区填充它；v1 里客户端无法指定自己的时区。
- **名册改动在下一次宿主启动时生效。** 名册每个进程只读一次，因此移除设备要等 `dsh web` 重启才起作用。
- **面板只显示一个配对码，别的都不做。** 它不能列出、命名或吊销已配对设备，也从不消耗配对码——配对发生在手机上，吊销仍然是改名册加重启宿主。
- **面板的新鲜度只到它上一次取码为止。** 它在打开时取一次码，之后每按一次「重新取码」再取一次；一直开着时过期的码会翻成过期状态，而不会自己悄悄续期。
- **`scripts/client.mjs` 是检查用的工具，不是客户端 SDK。** 它只按固定顺序跑一遍，不保存状态，也没有重连逻辑。
- **卡片自己的子帧在桌面端没有被拦。** 手机端把卡片里的嵌套 `<iframe>` 当作跨文档跳转一律拒绝；这里沙箱化的画框没有等价的拦截点，所以页面自己的子帧仍会渲染，只是每一帧都保持不透明源。
- **keyed 注册经由一条本地缝到达槽位。** 声明 `tool.call.toolview` 的那个 SDK 包不是本包的依赖，因此槽位是经窄化后的 `ctx.slots` 端口到达的，端口里镜像了 owner 的阶段联合；把那个包收作 devDependency 后，这条缝会被 SDK 自己的类型替掉。
