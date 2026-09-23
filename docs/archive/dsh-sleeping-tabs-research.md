# DSH Web GUI "类 Chrome Sleeping Tabs" 休眠机制 — 可行性研究与设计方案

> 研究任务，不含产品代码。结论先行：**可行，且官方在客户端已经内置了"休眠"所需的全部重建机制（drop + lazy rebuild + 历史回填），只是没有暴露为会话生命周期 API，也没有任何策略触发它；服务端有现成的 idle 判定（agent.status/agent/status/whenIdle）与完整 teardown 原语（AgentHandle.dispose → flush 排空），缺的只是"按闲置策略主动调用"的入口。推荐"分层冻结"方案 C。**
>
> 证据路径基线：安装目录 /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/（下文简写 <pkg>），浏览器侧源码引用编译产物 lib/client.js 与类型 lib/types/…（.d.ts 保留了全部语义注释，是权威说明）。

---

## 1. 现状

### 1.1 浏览器侧：单共享 SSE 流 + 常驻会话实例

- 传输不是"每会话一个 socket"：客户端只打开**两条共享流**（mux + host），由 ConnectionController 统一重连（dsh-client-connection/lib/client.js:38-63；流开启 :94；退避参数 :9-11）。mux/host 类型见 dsh-host-apiproxy/lib/types/api/events.d.ts:44-61（EventsApi），帧联合见 :66-212。
- **mux 是"全量广播"**：服务端 events.mux 为每个连接建立 FrameQueue 后，向**每个连接推送所有 live 会话的所有事件**（dsh-host-apiproxy/lib/index.js:3524-3608，事件转发 :3556-3575），无任何按会话过滤；since 续传钩子 v1 未实现（events.d.ts:50-55："reconnection = reopen the stream + refetch history"）。host 流同理全量（:3609-3700）。
- 客户端按会话路由：SessionManager.handleMuxEnvelope 只把帧交给**已实例化**的 Session（dsh-client-runtime/lib/types/client/sessions/manager.d.ts:226-232；实现 lib/client.js:8294-8354）。未实例化会话的帧：仅 answerable 帧（approval/question/queue）进入 pendingBuffers 缓冲（client.js:8329-8352），其余丢弃，靠 open 时历史回填。
- **Session 实例"一次实例化、终身常驻"**：
  - SessionManager.get(id) 惰性构造（client.js:7933-7957），drop(id) 只做 this.sessions.delete(sessionId)（client.js:7924-7926，注释：宿主日志是持久真相，之后的 get() 惰性重建、open() 回填历史）。
  - Session.dispose() 是**显式空操作**（"No-op because session instances remain resident"，types/client/sessions/session.d.ts:246-247、client.js:7561-7562）。
  - SessionRuntime 的 scope/实例生命周期谓词是"**host-listed 或 current**"（client.js:9211-9215 eligible()）；pruneScopes() 只清理"不在列表"的会话（client.js:9286-9297），dropScope() 才是完整拆除（fiber/dispose + unbindScope + slots.pruneStoreScope + manager.drop，client.js:9305-9310）。列表不回收到头（见 2.2），所以**凡被打开/访问过的会话永远驻留**。
  - followCurrent() 只对 current 开户（client.js:9168-9182："Staging IS the open signal — the window opens ⟺ the session is on stage"），且**切走时从不关闭旧窗口**：旧 Session 保持 openState="open"，events/views 数组继续被 appendLive 无限追加（client.js:7631-7643），只有重开/resync/gap-repair 的 installWindow 才会把窗口重置回 50 条尾部页（client.js:7617-7629）。
- **这是内存与 CPU 的主要归因**：
  1. 每个"开过"的会话持有无上界的 events+views（session.d.ts:48-51），外加 ConversationNodeAssembler 派生图、queueMirror、liveBuffer、pending 等待、snapshot 缓存。窗口只随 open/resync 重置（client.js:7617-7629）。
  2. 每次事件 scheduleConversation → Notifier.markDirty/markFrameDirty（client.js:7669-7673）→ flush 时 buildSnapshot() 折叠**整棵** conversation（client.js:7695+，snapshot 携带 nodes）——每帧 O(n)，事件越多越贵（114% CPU 的合理解释）。
  3. manager 级对每条 user/message 都做 recordMutation({kind:"activity"})（client.js:8297-8301）→ 列表快照重建 → 侧边栏/useSessions 组件重渲染，与哪个会话无关。
  4. 列表无上限：session.list "v1 returns everything; cursor is a reserved seat, unimplemented"（api/sessions.d.ts:231-236；listVisibleSessionSummaries dsh-host-apiproxy/lib/index.js:2160-2205：live + 全部冷会话，updatedAt 倒序）。
- 订阅释放情况（"卸载会话后 UI/ws 订阅是否释放"）：全部**会**释放。scope fiber dispose 级联所有 actx 注册效果（输入壳、slash 控制器、弹层、插件 store、监听器）（client.js:9305-9310）；React useSession 订阅随组件卸载 unsubscribe（Notifier subscribe 返回卸载函数，types/client/sessions/notifier.d.ts:12-16）；连接是共享 SSE，无按会话资源；manager 有意保留 projectionStores（列表标题需要）与 pendingBuffers（answerable 帧）——都很小（manager.d.ts:45-53,62-66；client.js:7980-7990，client.js:8329-8352）。
- 无任何页面可见性处理：浏览器侧仅有的 interval 是会话视图内的 1s 时钟与相对时间、jobs 弹层 1s 时钟、subagent 菜单 1s 时钟——均只在对应组件挂载/打开时运行：dsh-client-ui-conversation/lib/client.js:5181,5600、dsh-client-ui-jobs/lib/client.js:129、dsh-client-ui-subagent/lib/client.js:525。

### 1.2 服务端：live 会话/agent 只会增加、不回收；on-demand 恢复已存在

- SessionStore（ctx.sessions）＝内存 Map + 事件发布钩子（dsh-session/lib/index.js:1584-1888）：prepare/enter/announce（:1648-1723），enter 返回 detach 闭包（:1693-1724），detach 时发 session/disposed（:1726-1777），list() 全量 live（:1827-1829），get()（:1819-1822）。**无任何 GC/闲置回收**（全库搜索 evict/gc/idleTimeout/expire 无命中）。
- AgentRegistry（ctx.agents，dsh-agent/lib/index.js:415+）：create/resume 返回 AgentHandle；**通过 API 创建的 agent 以 root ctx 为 owner**（:543-548），即生命周期＝宿主进程，且 registry **没有按 id 主动 dispose 的公开方法**（只有 owner fiber 卸载/工厂卸载两条拆除路径：:580-585、dsh-agent/types/index.d.ts:141-158 API 注释且 AgentHandle.dispose 描述完整拆除：停 loop→等退出→注销→删除 session→展开 scoped world）。
- **Agent 空闲判定已存在**：ReactLoopAgent phase 机 idle | running | maintenance（dsh-agent-loop/lib/index.js:372-491），get status()（:380-382，maintenance 对外显示 idle）、agent/status 事件（:384-389，类型 dsh-agent/lib/types/runtime-types.d.ts:38-45）、whenIdle()（:460-465）、runMaintenance(job)（:412-435，idle 时可跑维护任务而不置 running）。
- **持久化 flush 时机（dsh-session-persistence）**：
  - 每 live 会话 write-behind，默认 writeBatchMaxDelayMs: 200（dsh-session-persistence/lib/index.js:786-795；控制器 types/write-behind.d.ts:19-61 + 实现 :299-420，含 automaticPaused 预算控制）；session/event → enqueue（:1155-1157）。
  - 显式 flush：session/flush（:1158）、会话 dispose 的 retire（排空后清 live 状态，:1159-1184）、后端 dispose（:1132-1151）；checkpoint 策略在 **模型请求前 / 顶层工具执行前 / 每步 pre-step 前** 强制 flush（dsh-session-checkpoint-policy/lib/index.js:60-76，fail-closed）。
  - 冷读有界：SessionPreparations LRU 默认 5（:787）。
- **服务端已有"按需恢复"语义（这是休眠的天然 wake 路径）**：
  - ensureSession（dsh-host-apiproxy/lib/index.js:2079-2138）：prompt/create 时 live 有则用，persisted 则 ctx.agents.resume，否则 create；preset/cwd 校验齐全。
  - **history 读永不恢复 agent**（historySourceFor :1991-2003；api/sessions.d.ts:288 "Reading history uses an attached Session or persistence inspection and never resumes or publishes an Agent"）——休眠会话的浏览/搜索零唤醒成本。
  - resume 会走 announce 从而发 session/created（dsh-session/lib/index.js:1741-1763）→ host 流 session-added → 客户端 mergeSummary 重新上架（client.js:8362-8376）。
- **子代理**：continuable 子会话的 activation 在处置前常驻（dsh-subagent/lib/index.js:646-657,1285+），处置随父拆除/stopContinuableDescendants（:1006-1077）——子会话树同样"只增不减"，但处置路径完整存在。

### 1.3 服务端"降载"的真实收益点

1. **停事件洪流**：mux 对每个连接、每个 live 会话全量推事件（dsh-host-apiproxy/lib/index.js:3556-3575）。浏览器侧"休眠"只减少**客户端处理**，SSE 流量不变；真正的流量/序列化收益在服务端——让 agent 不再 live。
2. **释放宿主内存**：每个 idle agent 持有完整 session log（Session log+surfaceManager+deriveMessages 缓存，dsh-session/lib/index.js:1307-1568）、scope 注册表、inbox；dispose 后全部可回收，持久化仍在盘中（事件已 flush 排空，1.2 的 retire 保证）。
3. **减少 live 会话数量**：宿主 ctx.sessions.list()、mux 的 session/subscribed 基线（:3527）与 foreach 广播都会线性下降。

---

## 2. 问题 1：前端 SessionManager/Session 生命周期 API

**结论：没有公开的 close/detach/reap/discard，但官方已有等价的内部原语（drop/dropScope）与完整的"重建即恢复"机制；缺的只是把它挂到对外接口并把策略交给控制器。**

| 能力 | 公开面（ISessions contract/sessions.d.ts:20-127） | 内部原语 | 证据 |
|---|---|---|---|
| 卸载会话实例 | 无 | SessionManager.drop(id) | manager.d.ts:124-130；client.js:7924-7926 |
| 拆除 scope/插件/实例 | 无 | SessionRuntime.dropScope(id, record) | client.js:9305-9310（fiber.dispose + unbindScope + slots.pruneStoreScope + manager.drop） |
| 主动回收空闲实例 | 无（pruneScopes 只在列表移除时跑） | SessionRuntime.pruneScopes | client.js:9286-9297；谓词 eligible :9212-9215 |
| 关闭窗口 | 无（切走不关窗） | installWindow 重置（open/resync/gap-repair） | client.js:7617-7629 |
| 会话自身销毁 | dispose() 是空操作 | — | session.d.ts:246-247；client.js:7561-7562 |
| 重建（= 唤醒） | 已有：open(id) → select → staged → resolve()（惰性 mint）→ get()（惰性构造）→ open()（回填 50 条尾页） | 全部现成 | client.js:8967-8969、:9168-9182、:9189-9210、:7933-7957、session.d.ts:188-189 |
| 插件观察会话状态 | useSessions（列表快照）、binding(id)、sessionOf(ctx)、provide(descriptor) | — | contract/sessions.d.ts；service.d.ts:108-146（SessionBinding/SessionProvideDescriptor） |

**卸载后释放情况**：
- scope fiber（actx 全部插件效果/监听）+ 会话槽 store（slots.pruneStoreScope）→ **释放**（client.js:9305-9310）。
- Session 实例的 events/views/conversation/pending/liveBuffer/queueMirror → **释放**（随对象被 GC）。
- React 订阅 → 组件卸载即 unsubscribe（Notifier subscribe，notifier.d.ts:12-16）；快照仅在有监听者时重建（ensureFresh :26-30）。
- 共享 SSE 连接 → **无按会话资源可释放**（dsh-client-connection/lib/client.js:94 单一流）。
- manager 有意保留的：每会话 projectionStores（标题/列表投影）与 pendingBuffers（approval/question/queue 帧，重开时回放）——小而必要（manager.d.ts:45-53,62-66；client.js:8329-8352；回放任：get() :7938-7942）。
- **drop 后帧不再路由**：handleMuxEnvelope 对无实例会话只做 manager 级处理（列表活动、projection、jobs、subscribed 截断，:8296-8323），事件直接丢弃、由历史回填——这就是"休眠"语义已内建的直接证据。

---

## 3. 问题 2：服务端空闲判定与 flush 时机，空闲时如何降载

**结论：空闲判定完备（phase/status/whenIdle）；持久化按 200ms 写后批 + 模型/工具/步边界强制 flush；降载原语完备（AgentHandle.dispose + 惰性 resume），唯一缺口是"按策略主动调用"的公开入口，以及 dispose 会让行在客户端消失的联动。**

1. **空闲判定**：agent.status（idle|running）、agent/status 事件、whenIdle()（dsh-agent-loop/lib/index.js:372-491；类型 runtime-types.d.ts:38-45,69-97）。maintenance 相位对外是 idle 且可从 idle 起动（:380-382,412-435），所以"空闲"判据用 status === 'idle' && inbox 无 pending 为稳妥（避免把挂起的 inbox 当空闲而冻结）。
2. **flush 时机**：
   - 事件到达后 **200ms** 批量写盘（writeBatchMaxDelayMs: 200 dsh-session-persistence/lib/index.js:786-795）。
   - **语义强制 checkpoint**（fail-closed）：llm/stream（模型请求前）、顶层 tools/execute、agent/pre-step 之前 ctx.sessions.flush(session)（dsh-session-checkpoint-policy/lib/index.js:60-76）——即任何副作用发生前，日志已持久化。
   - 会话 dispose → retire：先 flush 再清 live 状态（dsh-session-persistence/lib/index.js:1159-1184）——**这条链保证了"服务端休眠=断电安全"**：dispose 前必有排空。
   - 宿主退出 → 全部 live 会话 flush（:1132-1151）。
3. **降载手段**（现阶段可用/缺失）：
   - 可用：AgentHandle.dispose()：cancel(disposed) → whenIdle() → scope.dispose() → detachAgent/detachSession（dsh-agent-loop/lib/index.js:1132-1152）→ session/disposed → 持久化 retire 排空 → host/session-removed 帧（dsh-host-apiproxy/lib/index.js:3624-3629）。
   - 可用（唤醒）：任何 prompt → ensureSession → ctx.agents.resume（dsh-host-apiproxy/lib/index.js:2098-2102）→ announce → session/created → host/session-added → 客户端重新上架（client.js:8362-8376）。历史/搜索/导出路径**不唤醒**（:1991-2003；api/sessions.d.ts:288-289）。
   - **缺口 A（服务端 API）**：AgentRegistry 无 dispose(id)（只有 owner/工厂拆除路径，dsh-agent/lib/index.js:580-627；API 创建物归 root ctx，:543-548）。需要新增（如 abiproxy RPC session.sleep/session.wake，或 agents.reap(id) + 暴露 handle 生命周期）。
   - **缺口 B（客户端联动）**：dispose → host/session-removed → 客户端**从列表删除行**（client.js:8377-8394，非 subagent origin 的普通会话走 remove），直到下一次 resume（session-added 重新上架）才回来——休眠行会闪动消失。需要客户端配合（识别"已知 id 的移除"为休眠态，或新增 host/session-sleeping 帧）或接受"冷会话在列表恢复"的语义（连接级 session.list 重拉后行自然回来：listVisibleSessionSummaries :2170-2175）。

---

## 4. 问题 3：dsh-perf 插件可行性 — 公开面缺口与本方案接口

插件写法参照 dsh-doctor/dsh-remote-web-ui（@linxin666/dsh-doctor 客户端入口 src/client/index.ts、harness-send.ts:53-88 展示了插件经 ctx.sessions（ISessions）取列表快照、binding(id) 取会话面、session.prompt 发送；ctx.on('connection/reset') :116 观察连接代际）。**现状下插件可做的事**：

| 能力 | 插件内可用？ | 说明 |
|---|---|---|
| 观测列表/current/running/待交互 | 可用：ctx.sessions.list（contract/sessions.d.ts:20-24） | 排序、LRU 候选、徽标都能做 |
| 观测连接状态 | 可用：ctx.on('connection/reset') | 重连兜底 |
| 手动休眠某会话实例 | 仅内部：(ctx.sessions as any).dropScope(id, record) 需要 record；manager 是 private | TS private 运行时可达但耦合内部实现（版本漂移风险） |
| 唤醒 | 语义自动：sessions.open(id)（:35）→ 现有 staged/resolve/get/open 链 | 无需新代码 |
| 防止某个会话被休眠 | open(id) 驻留（current 恒最优） | — |
| 服务端降载 | 需新增 host API（缺口 A） | 插件 host 半侧可用 ctx.agents.get(id) 读 status，但无 dispose 入口 |

因此推荐的最小侵入路径：**上游微补丁（client-runtime + 可选 apiproxy）+ 插件负责策略**。上游改动面：

1. ISessions 增加 sleep(id) / touch(id)（或 setResident(ids)），SessionRuntime 实现：把"驻留谓词"从 eligible()（listed||current，client.js:9212-9215）细化为 current || 被 pin || LRU 驻留集，sleep 即 dropScope（复用 :9305-9310），wake 即隐式 resolve()（已存在）。行、投影、pending 帧、jobs、pendingInteractions 全在 manager 级，不受影响。
2. 防抖/唤醒守卫（anti-thrash）放在 runtime 侧（minSleepDurationMs、current 与"正在打开中"排除）。

现有源码已经保证了 sleep 后的每一条正确性（这些就是验收口径）：
- get() 重建时回放 pendingBuffers（client.js:7938-7942），session/subscribed 投影截断（:8313-8323）；
- 重建后 open() 拉尾页 + projections 块 + 缝合 liveBuffer（session.d.ts:188-189、client.js:7580-7609,7617-7628）；
- 未实例化期间 answerable 帧持续缓冲（client.js:8329-8352），管理器级 pendingInteractions 照亮侧边栏（:8324-8327）；
- 重连仅 resync **驻留**实例（client.js:8447-8454）——已休眠的不会白拉。

---

## 5. 三个候选方案（最小侵入）

### 方案 A — 客户端 LRU"软休眠"（最小侵入，推荐主体）

**机制**：dsh-perf 客户端插件维护"驻留集"（默认 = current + pin + LRU 最近 N 个 idle 会话）；超出阈值的空闲会话调 sleep(id)（上游暴露后）→ dropScope；行、标题、running 点、待交互、jobs 全部保留（manager 级）。唤醒＝用户 open(id)，走 100% 现有路径（惰性重建 + 尾页回填），无需任何额外状态机。

- 纯浏览器收益：释放每个被休眠会话的 events/views/conversation/snapshot/scope/插件存储；停止该会话每事件的 append+buildSnapshot 热路径（对照 1.1 的 CPU 归因）。
- 不碰服务端；不影响其他标签页/窗口（每 tab 独立实例状态）。
- 开销：唤醒时一次 tail 页拉取 + 一次重建（毫秒级）；SSE 流量不减（事件仍在流上，只是被路由丢弃或 manager 级处理——但每个用户消息的列表 activity 更新仍在，这是对的：侧边栏要新鲜）。
- 上游改动：仅 client-runtime 那个小接口（第 4 节）。插件可全部实现：策略、参数、徽标、菜单、指标、可见性联动（L1）。

### 方案 B — 服务端 agent 闲置"真降载"

**机制**：host 侧插件（或 abiproxy 新 RPC）在 agent/status → idle 且超时后 AgentHandle.dispose()；whenIdle 保证不撕运行中 turn；retire 保证 flush 排空后下盘；唤醒＝下一次 prompt（ensureSession 现成）；历史/搜索零唤醒（现成）。
- 收益：宿主内存（log+surface+scope）与 mux 广播/序列化线性下降；**这是唯一能减少服务端 CPU/内存与 SSE 流量的方案**。
- 上游改动：缺口 A（按 id dispose 的公开入口）+ 缺口 B（客户端对 session-removed 的"休眠意会"：行保留/徽标，或新帧 host/session-sleeping；否则行会闪消失再出现）。参数：reapIdleAfterMs、maxLiveAgents、保护 running/pendingInbox/父代理存在性（子代理不能独立于父）。

### 方案 C — 分层冻结（推荐）

L1（页面可见性）→ L2（会话级 LRU，即 A）→ L3（服务端 agent 闲置回收，即 B）。可见性为触发条件，LRU 为常规策略，服务端为兜底（仅当宿主是约束时开启，默认关或阈值很大）。L2 是默认行为（开箱即用、零风险窗口），L3 是可选增强（需要上游缺口 A/B 两个补丁 + 灰度参数）。

---

## 6. 推荐方案

**C 的分层实施顺序（每层可独立上线）**：

1. **第一步（纯插件可先行，零上游）**：dsh-perf 客户端插件监控与可视化——按第 4 节"插件内可用"项采集：每个会话的空闲时长、驻留实例数、events 长度、每帧耗时、列表大小、事件吞吐；提供"休眠/驻留"菜单与徽标（状态数据不依赖上游）。这一层同时完成"性能证明"与"策略冒烟"。
2. **第二步（上游 micro-patch A，唯一必须的改动）**：ISessions.sleep(id)/touch(id) + 驻留谓词细化。约 30-50 行；行为与现有 pruneScopes/dropScope 完全同构，风险低。之后方案 A 全量生效（默认参数：idleThresholdMs=10min、maxResident=8、minSleepMs=30s 防抖、current+running+pendingInteraction 恒驻留、autoSleepOnHidden=true，见第 9 节）。
3. **第三步（可选上游 patch B）**：服务端 session.sleep（host）或 agents.reap(id) + 客户端休眠行联动；默认关闭，参数 reapIdleAfterMs（如 2h）、maxLiveAgents（如 16）。

**为什么不推荐纯 B**：行消失/重上的闪烁 + 每唤醒一次 agent 重建（preset mounting、上下文重放）有可感知延迟；B 单独上对"页面 1.2GB"这个现象无直接帮助（那是浏览器进程）。**为什么不推荐"只调浏览器节流"**：Chrome 只节流 timer/rAF，SSE 处理与微任务 flush 依然满速，治标不治本。

---

## 7. 与官方分页窗口（50 条）的交互

PAGE_MESSAGES = 50（session.d.ts:11；open() 拉 {maxMessages: 50} client.js:7585；服务端 historyPage 页边界按 append-origin 整消息对齐，api/sessions.d.ts:273-286）。休眠与此窗口的交互**设计上自洽**，逐项核实：

| 关注点 | 机制 | 证据 |
|---|---|---|
| 休眠丢事件？ | 事件是追加式日志（Session.append，dsh-session/lib/index.js:1444-1484）；客户端未实例化时事件帧被路由丢弃（client.js:8329-8352），重开由 tail 页回填 | 无丢失：日志即真相（manager.d.ts:128-130） |
| 窗口重置 | installWindow 用最新 tail（50 条 + hasMore + projections 基线块）替换，baseSeq/hasMore 重算 | client.js:7617-7629；api/sessions.d.ts:282-298 |
| 唤醒时并发到达的事件 | 在 open/repair 期间进 liveBuffer，安装后按 seq 缝合（唯一去重键） | client.js:7580-7609,7617-7628,7649-7668 |
| 流内缺口 | seq 跳变（event.seq > tailSeq+1）→ repairGap（重拉尾页）或 open 后 subscribedLastSeq > tailSeq 二次拉取 | client.js:7593-7598,7657-7665,7677-7690 |
| 未完成的流式回复（partial） | tail 页携带 in-flight partial（chunk 已发但未 finalize 的消息），唤醒即见 | api/sessions.d.ts:276-282 |
| queue（未入日志的 work） | session/queue 全量快照帧：无实例时由 manager 缓冲（单槽 last-wins），重开 get() 回放；session/subscribed 还触发 queueMirror.reset 与 jobs 基线清理 | client.js:8313-8322,8329-8352,7938-7942；dsh-host-apiproxy/lib/index.js:3537-3544 |
| projection（标题等） | tail 块种子 + session/projection 帧 higher-seq-wins；subscribed 按 lastSeq 截断旧值 | client.js:8313-8316；api/sessions.d.ts:70-84 |
| approvals/questions | answerable 帧：manager 级 pendingBuffers+pendingInteractions 使休眠会话仍能"被发现并被回答"（侧边栏灯）；resolve 帧按 key 剪除 | client.js:8324-8352；events.d.ts:72-96 |
| loadOlder 翻页 | 唤醒后窗口从最新 tail 重建，loadOlder 按 beforeSeq 向前翻（服务端页边界整消息对齐），无重复/缺口 | session.d.ts:190-191；api/sessions.d.ts:290-298 |
| 窗口与 LRU 的矛盾？ | sleep 恰恰是要丢窗口（内存大头）；唤醒成本＝1 次 tail 请求。若需要"秒开"体验，可选 wakePrefetch（预选/悬停时提前 open） | 可选参数，非默认 |
| 会话列表刷新 | session.list 仅连接代际刷新（refreshList client.js:8071-8124 由 handleConnected :8447-8453 触发）；休眠不影响；重连后行从 cold 摘要恢复 | dsh-host-apiproxy/lib/index.js:2160-2205 |

**与"官方 50 条窗口"唯一需要确认的交互**：方案 B（服务端 dispose）期间事件停止推送（agent 已死），窗口自然完整；方案 A 期间事件继续广播但客户端丢弃——因此 SSE 照旧承担全部 live 会话的字节（唤醒时这些事件都在 tail 里）；对"页面内存"无影响，对"网络"有小浪费——这正是 L3 要解决的问题。

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 丢消息/状态不一致 | 日志为真相，事件永不丢；风险集中于**瞬态**（partial、queue、projection、approval） | 均有既有机制覆盖（第 7 节表）；验收须覆盖"休眠中被审批/被 question 后唤醒"与"休眠中用户从 doctor 插件 prompt 该会话"（binding() 会隐式重建实例，harness-send.ts:78-80 是现成路径） |
| 与 50 条窗口交互错误 | 唤醒后窗口错/缺 | installWindow+liveBuffer 缝合+repairGap+subscribedLastSeq 二次拉取（第 7 节） |
| LRU 误冻运行中会话 | 用户看不到进行中的工作 | current 恒驻留；running、pendingInteraction、有 live jobs、有 open catalog 的会话不参与淘汰；父代理 running 时其子代理不淘汰 |
| 防抖不足（快速切换造成重建风暴） | 唤醒频繁、UI 闪 | minSleepDurationMs（刚唤醒的会话 30s 内不再入睡）；wake 走 dedup：open 幂等（session.d.ts:188-189） |
| 多 tab/多窗口 | 每 tab 独立实例状态，互不干扰；服务端 sleep 则影响全局 | L3 默认关闭并设置 maxLiveAgents；客户端侧每 tab 独立策略，文档说明 |
| 与服务端子代理树交互 | 子会话由父拥有（dsh-subagent），父活则子活；客户端行以 origin: subagent 保留 | 淘汰时跳过"有存活父代理"的子孙；host/session-removed 对 subagent 行只置 running=false 不移除（client.js:8377-8394）——服务端 dispose 的子会话行不消失，风险面比普通会话小 |
| 重连（resync）期间休眠 | handleConnected 只 resync 驻留实例（client.js:8447-8454），休眠实例无窗口可 resync；下次 open 走完整尾页 | 已自然规避；验收含"休眠中断开+重连"用例 |
| 内存测量失真 | 峰值波动大 | 用 performance.memory（Chrome）＋任务管理器堆快照做 A/B；以"每会话 events 数组长度 × N"作为确定性代理指标 |
| 上游补丁被拒/版本漂移 | 插件回退 | 方案 A 的指标/可视化层（第一步）完全独立可交付；sleep 缺失时策略自动降级为"仅展示" |

---

## 9. 参数设计（dsh-perf 插件 Config）

| 参数 | 默认 | 语义 |
|---|---|---|
| sessionIdleThresholdMs | 600000 (10min) | LRU 判定空闲时间（自上次活动/打开起） |
| maxResidentSessions | 8 | 驻留实例上限（current 不计入） |
| minSleepDurationMs | 30000 | 防抖：唤醒后最短驻留时间 |
| autoSleepOnHidden | true | L1：页面隐藏时立即执行一次 LRU（current 除外） |
| pinSessionIds | [] | 永久驻留白名单 |
| excludeRunning | true | 运行中/有 pendingInteraction/有 live jobs/open catalog 者不淘汰 |
| wakePrefetch | false | 预选/悬停时提前 open（成本＝一次 tail 拉取） |
| serverReap | false（默认关） | L3：启用服务端闲置 agent 回收 |
| serverReapIdleAfterMs | 7200000 (2h) | L3 闲置阈值 |
| maxLiveAgents | 16 | L3 宿主 live agent 上限（超出回收最老 idle） |

---

## 10. 验收标准

**A. 功能（每一条对应一个可执行用例）**
1. 驻留会话空闲超过阈值：JS 堆（performance.memory）+ 该会话 events 长度下降；侧边栏行、标题、running 点、updatedAt 均保留；出现"休眠"徽标（插件层）。
2. 休眠期间同级会话活跃：页面 CPU 不随该会话事件增长（对照：驻留时每事件都 append+buildSnapshot）。
3. 选中休眠会话 → 尾页正确：最后消息、partial、queue、标题（projection）一致；无重复、无缺口；loadOlder 翻到底无错序。
4. 休眠中（a）收到 approval/question（侧边栏亮、可回答）；（b）另一插件（如 doctor harness）prompt 该会话成功；（c）用户从侧边栏重命名/归档会话成功（binding 隐式重建路径 dsh-client-ui-workspace/lib/client.js:2396-2398）。
5. 快速往返切换 5 个会话：无闪烁、无重复拉取（观察 api.events.mux 与 session.history 网络面板）、minSleepDurationMs 防抖生效。
6. 页面隐藏：隐藏 5s 后 maxResident=8 生效，所有非 pinned 的非 current 空闲会话被冻结；恢复可见后交互正常。
7. 重连：休眠中断开 SSE → 重连 → 列表/工作正常 → 唤醒后窗口正确。

**B. 策略正确性**
8. current/running/pendingInteraction/pinned 永不入睡；子代理在其父代理 running 时永不入睡。
9. 驻留集大小恒 ≤ maxResidentSessions(+1 current)；被淘汰者按 LRU（updatedAt/最近 open 时间）。

**C. 服务端（L3，若启用）**
10. reap 只作用于 agent.status==='idle' 且无 pending 的会话；turn 进行中永不触发；dispose 前 retire 排空（重启宿主后日志完整、无 torn tail——dsh-session-persistence/lib/index.js:1159-1184 与 commitRepair 逻辑）。
11. 被回收会话：历史/搜索可用且零唤醒（Net 面板无 agent resume 痕迹）；发送消息后 agent 恢复，preset/model/inbox 与回收前一致（ensureSession 的 preset/cwd 校验 dsh-host-apiproxy/lib/index.js:2085-2102）。
12. 行联动：客户端行不闪失（或按设计以"冷会话"语义出现）。

**D. 性能对比（作为上线门禁，非猜测）**
13. 同负载 A/B：N=20 会话（1 活跃、19 空闲），页面 JS 堆峰值与 10s 平均帧 CPU 在"全驻留 vs 方案 C"下分别下降（登记数据，如 heap −60%、事件处理 CPU −80%）；SSE 峰值带宽在 L3 开启后下降（按 live agent 数线性）。

---

## 11. 附录：关键证据索引（文件 + 行）

### 浏览器侧（@deepseek-ai/dsh-client-runtime）
- lib/types/client/sessions/manager.d.ts:40 SessionManager；:124-130 drop（惰性重建注释）；:226-232 帧只路由已实例化会话；:45-66 pendingBuffers/projectionStores 有意保留。
- lib/client.js:7924-7926 drop；:7933-7957 get 惰性构造+缓冲回放；:8294-8354 handleMuxEnvelope；:8313-8323 subscribed 截断/缓冲清理；:8377-8394 session-removed（普通会话移除行/子代理只改状态）；:8434-8454 断连/连接处理（resync 仅驻留实例）。
- lib/types/client/sessions/session.d.ts:11 PAGE_MESSAGES=50；:42；:188-191 open/loadOlder；:246-247 dispose 空操作；:273-278 组装器调度。
- lib/client.js:7156-7173 Session ctor；:7461-7498 帧分发；:7580-7609 doOpen（含 subscribedLastSeq 二次拉取）；:7617-7629 installWindow；:7631-7643 appendLive（无界）；:7649-7668 acceptLiveEvent；:7677-7690 repairGap；:7695+ buildSnapshot（整树折叠）。
- lib/types/client/sessions/notifier.d.ts:2-30 批量通知原语；lib/types/client/sessions/conversation.d.ts、conversation-assembler.d.ts。
- lib/types/client/contract/sessions.d.ts:20-127 ISessions（无 sleep/close）；contract/session.d.ts:26-96 ISession/SessionFace（行为面）；sessions/service.d.ts:108-146 SessionBinding/ProvideDescriptor。
- lib/client.js:8850-8949 SessionRuntime；:8967-8969 open；:9168-9182 followCurrent（open 信号=stage）；:9189-9215 resolve/eligible；:9286-9310 pruneScopes/dropScope；:10488-10532 运行时接线（单流 sink）。
- lib/types/client/workspace/… Rows.d.ts/tree.d.ts（行只吃列表快照：tree.d.ts:12-26）。dsh-client-ui-workspace/lib/client.js:2390-2398（open/rename 才 binding）。

### 传输
- dsh-client-connection/lib/client.js:9-11,38-63,77-98（单 mux+host 流、退避、泵）；:130 stream/error 断流。
- dsh-host-apiproxy/lib/types/api/events.d.ts:44-61（EventsApi 双流）、:50-55（since 未实现）、:66-212（MuxFrame/HostFrame）。
- dsh-host-apiproxy/lib/index.js:4895（/api/events.mux SSE 路由）。

### 服务端
- dsh-session/lib/index.js:1307-1568 Session（log/surface/deriveMessages 缓存）；:1444-1484 append；:1584-1888 SessionStore；:1648-1723 prepare/enter（detach 闭包）；:1726-1777 detach/announce/disposed；:1791-1808 flush 入口；:1820-1829 get/list。
- dsh-agent/lib/index.js:415+ AgentRegistry（:543-548 create 以 root ctx 为 owner；:580-627 register/enter）；lib/types/index.d.ts:141-158 AgentHandle.dispose 语义；lib/types/runtime-types.d.ts:38-45 AgentStatus；:146-172 agent/created|disposed|status 事件。
- dsh-agent-loop/lib/index.js:372-491 phase 机（status/whenIdle/runMaintenance）；:1132-1152 dispose 链；:1180-1194 publish（enter/announce）；:1240-1283 createAgent/resume；:1027-1051 配置驱动 agents 常驻。
- dsh-host-apiproxy/lib/index.js:3524-3608 mux 全量广播（:3527 基线、:3556-3575 session/event 推送、:3604-3607 清理）；:3609-3700 host 流；:2396-2398 session.list；:2160-2205 全量汇总（无上限）；:2079-2138 ensureSession；:1991-2046 历史（detached 读、零唤醒）；:3624-3629 disposed→session-removed。
- dsh-host-apiproxy/lib/types/api/sessions.d.ts:231-236（list 无分页）；:273-289（history 页边界/partial/projections/零唤醒）。
- dsh-session-persistence/lib/index.js:786-795（200ms 批 + LRU 5）；:1132-1163 写路径安装；:1159-1184 retire（dispose 排空）；:1303-1313 flush；lib/types/write-behind.d.ts:19-61。
- dsh-session-checkpoint-policy/lib/index.js:60-76（模型/工具/步边界 flush，fail-closed）。

### 插件示例
- @linxin666/dsh-doctor/src/client/harness-send.ts:53-88（经 ctx.sessions: ISessions 取列表/绑定/prompt）；src/client/index.ts:116（ctx.on('connection/reset')）；src/client/doctor-controller.ts:186-210（可观察 store 模式）。
- @linxin666/dsh-remote-web-ui/src/client/remote-channel.ts（浏览器侧注入/补丁式插件技术，可作参考，不用于本方案）。

*（本文档为研究结论；第 5-9 节的接口形态均为建议，最终以上游维护者确认为准。）*
