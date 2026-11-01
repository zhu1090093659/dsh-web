# Agent Note: 中继传输 v2——Durable Object 汇合桥，Worker 留在门口

Status: proposed

本文取代[命名隧道中继提案](2026-10-23-relay-named-tunnel-data-plane.zh.md)：那份设计的传输选型被 2026-10-23 的三条生产读数推翻，本文重做选型，并把它已经落地的控制面契约（租约、claim/release/retire）当作可复用资产而不是废稿。

本文的落地记录见[汇合桥的附加式实现](2026-10-23-relay-bridge-additive-implementation.zh.md)：按实例 `mode`、长活凭据与对象侧换 socket 已落成可合并的代码，尚未部署。

会合点归属在[自建中继会合点](2026-11-01-selfhosted-relay-meeting-point.zh.md)中改到自建 relay.chatwithai.icu，帧契约与容量模型由新笔记承接，本文其余结论仍作数。

## 问题

已配对的手机通过 `https://<id>.dsh-market.com` 访问自己的 DSH 实例，而这个源上的每个字节都由 market Worker 送出（`market/worker/src/relay.js`）：Worker 读一行 D1 拿到该实例当前的 `*.trycloudflare.com` quick tunnel 主机名，再把请求转发过去。回源传输因此是 quick tunnel，而官方文档把 quick tunnel 定性为测试用途：没有可用性保证，每条隧道最多 200 个在途请求（超出回 `429`），不支持 Server-Sent Events，主机名每次重建都变（[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)）。

这不是洁癖式的不满。插件自己的远端通道就在产出 SSE（`packages/dsh-remote-web-ui/src/routes.ts` 的 `text/event-stream`），也就是说今天的流式路径跑在一条官方明说不支持 SSE 的传输上，而手机侧唯一的兜底是 Worker 的离线页。

## 三条读数如何改写目标

2026-10-23 的三条生产读数是硬约束，不是待验证假设。它们否掉的不止上一版的手段，还包括上一版的目标句。

| 读数 | 观测 | 它否掉了什么 |
| --- | --- | --- |
| 规模 | `relay_registrations` 24 小时活跃 3 390、7 天 6 641、30 天 10 366、总计 12 215（本次只读复核见第 6 节） | 任何「一次部署同时切换全部实例」的切换动作：会在同一秒切断全部活跃实例，手机必须回桌面重扫 |
| 配额 | 账户 Cloudflare Tunnel 配额 1 000 条（[Account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/)，本次只读查询见账户内现有 1 条） | 「每实例一条命名隧道」：6 641 个活跃实例装不下；买配额的价格见第 6 节的算术 |
| 优先级 | 把 `<id>.dsh-market.com` 建成指向 `<uuid>.cfargotunnel.com` 的精确 proxied CNAME 之后，请求仍由通配 Worker 自定义域应答（返回宿主的 401） | 「数据面不再经过 Worker」这个目标本身：在 `<id>.dsh-market.com` 上，只要保住这个主机名，应答者就是那条通配自定义域 |

于是目标句改写为：**Worker 留在门口，做一层无状态薄代理；回源传输换成不占账户配额、有可用性承诺的汇合桥。** 想把 Worker 从数据面拿掉的唯一已知手段是收窄通配路由，而那正是读数一判死的一步；因此本设计不碰路由、不碰 DNS、不碰证书，一个实例的迁移只是一行状态位。

## 不可协商的约束

- 稳定主机名 `<id>.dsh-market.com` 保持不变：手机存的就是它，换源等于全部重新配对。
- 安全模型不变：插件首跑铸造 id 与 secret，服务端只存 secret 哈希并做常量时间比较；注册来源受限；Worker 不终止配对逻辑。
- 现网不能断：任何一步都不得让 3 390 个 24 小时活跃实例失去主机名，回退窗口以单个实例为粒度。
- 目标用户两端都在美国：落点与跨洋不作为设计依据，本文不引用任何以「距离」为理由的取舍。
- 本次零生产写：不部署、不建或改隧道、不写 DNS、不改路由与证书、不创建 API Token。

## 选型比较

四类候选，按代价、容量上限与推翻条件比较。

| 选型 | 代价 | 容量上限 | 推翻条件 | 判定 |
| --- | --- | --- | --- | --- |
| A 插件出站 WebSocket 打到 Durable Object，Worker 把手机的 HTTP 与 WSS 与该桥配对 | 自持一套最小帧协议（请求头、请求体、响应头、响应体、手机 WS 事件），约两处各数百行 | 账户内 DO 对象数不限、单对象 1 000 rps 软限、WS 接收帧 32 MiB、每对象存储 10 GB（[Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)） | 若 DO 不能在持有插件 socket 的同一对象上承接 HTTP 流式响应，或单对象可持 socket 数有未公开硬顶 | 选定 |
| B 自建或多机中继（VPS 或自控边缘），彻底离开 Cloudflare Tunnel | 运维值守、DDoS 暴露面、出网账单（第 6 节的 Band A 约 3.6 TB/月） | 单机 socket 数与带宽；要可用性就得多机加任播 | 若能接受 7x24 值守与出网流量 | 否，作为独立于厂商的退路保留 |
| C 保留 quick tunnel 但加固（守护、协议、可观测） | 零新增基建 | 每条隧道 200 在途、无 SSE、无可用性保证、主机名每次变（同上 quick tunnel 文档） | 若官方给 quick tunnel 一个可用性承诺与 SSE 支持 | 否，降级为永久兜底 |
| D 命名隧道加购买 Tunnels for Platforms 配额（上一版的补票方案） | 6 641 个活跃实例需额外 5 641 条隧道，每条 $4.50/月（[Tunnels for Platforms](https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/)） | 1 000 条免费加购买量 | 若每实例隧道的单价降到分币量级 | 否，见第 6 节算术 |

支撑上表的读法，逐条取自官方文档：DO 的 WebSocket 接收帧上限 32 MiB、单对象 1 000 rps 软限、账户内对象数不限、单类存储 10 GB；Workers 侧接收帧同是 32 MiB，超大帧以 `1009` 关闭（[Workers WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)）；Workers Paid 每月含 1 000 万请求、超出每百万 $0.30，且不收取任何出网或带宽费用（[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)）；DO 每月含 100 万请求、超出每百万 $0.15，含 400 000 GB-s、超出每百万 GB-s $12.50，按每个活跃对象 128 MB 计费，WebSocket 入站消息按 20:1 折算为请求，出站消息与协议层 ping 不收费，空闲且可休眠的对象不计时长（[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)）；休眠 API 让对象在保持 socket 的前提下被逐出内存，时长费在此期间不累积（[Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)）；同一份 Limits 文档还写明，HTTP 与 RPC 调用在调用方保持连接期间没有硬性 wall time 上限，因此一条长 SSE 流不会被时长上限切断（[Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)）。

## 选定方案

一个 Durable Object 命名空间，每个中继实例一个对象，对象名由实例 id 派生（`idFromName(id)`），因此 Worker 不需要为桥接查表。

### 请求路径

手机请求照旧落在 `<id>.dsh-market.com`，由那条通配路由送进 market Worker。Worker 把今天已有的那一行 D1 读扩展成 `target, mode`；`mode` 为 `bridge` 时把整个 Request 交给 `env.RELAY.get(idFromName(id)).fetch(request)`，为 `quick` 时走今天的 quick tunnel 分支。DO 侧：没有活着的插件 socket 就回 `409 no-connector`，Worker 在同一次请求内退回 quick 分支；有 socket 就分配一个流 id，把请求头当一帧发给插件，把插件的响应体分块写成 `ReadableStream`，再作为 Response 返回给 Worker。

### 帧契约

控制帧是 JSON 文本，体块是二进制，同一 socket 上按流 id 多路复用。

| 方向 | 帧 | 载荷 | 语义 |
| --- | --- | --- | --- |
| DO 到插件 | `req` | `id`、`method`、`url`、`headers` | 一个 HTTP 请求的起始 |
| DO 到插件 | `body` / `end` | `id` 加二进制块，或只有 `id` | 请求体分块与结束 |
| 插件到 DO | `res` | `id`、`status`、`headers` | 响应头，先于任何体块 |
| 插件到 DO | `chunk` / `fin` | `id` 加不超过 256 KiB 的块，或只有 `id` | 响应体分块与结束 |
| 双向 | `ws-open` / `ws-frame` / `ws-close` | `id` 加帧内容 | 手机 WebSocket 的三类事件 |
| 双向 | `close` | `id`、`reason` | 任一侧取消或上游断开 |

保活走 WebSocket 协议层 ping，不走应用层帧：协议层 ping 不计费，应用层消息按 20:1 计费。背压以每流在途字节上限（初值 1 MiB）实现，超限时插件侧停止读取回源 socket，DO 侧按 `desiredSize` 暂停入队。

### 回退与鉴权

桥接 socket 在升级前就用与注册端点同一套 id/secret 校验（哈希比较、按 IP 与按 id 的窗口、来源限制），校验通过后 Worker 才把这条 Upgrade 请求转给该实例的对象，因此对象只见到已被 Worker 认可的连接，且对象名只由 id 派生，跨实例不可达。手机侧的一切鉴权（配对 cookie）端到端穿过桥，不被 DO 接触，与今天 Worker 转发时相同：信任边界没有移动，Cloudflare 今天就已经终止手机的 TLS 并看到请求。

**不可协商的约束：连接器永不改写 `Host`。** 桥必须把手机请求的 `Host` 原样送到宿主，保持公网 origin 字面量。宿主把本地控制面建成「socket 地址 + `Host` 都指向本机」两个条件，而经隧道进来的请求其 socket 地址本来就是回环，唯一的判别项就是这个头。影子飞行实测：连接器把 `Host` 改写成 `127.0.0.1:55220` 时，`/remote-bridge/pair/token` 从公网 origin 返回 `200` 和一枚可用的 30 秒配对令牌，而现网中继在同一路径返回 `403`（`the request names a Host that is not this machine`）；改回原样转发后复测 `403`。同一条门禁护住的不止令牌端点，而是整块本地控制面：`/remote-bridge/pair/token`、`/api/pair/*`、`/api/update/*`、`/api/plugin-manager`。因此「信任边界没有移动」这句话只在连接器不改写 `Host` 时成立，这一条属于实现约束而不是实现细节。

**重连凭据的形态必须在设计里点名，不能留给实现。** 若桥 socket 的升级用一次性票据，而对象把「票据已用」写进自己的持久存储，那么一次重连需要换一张票**并且**换一个对象（新实例 id）：影子飞行的探针正是如此，换票不够，还得换实例。这与「发布等于全网 socket 滚动重连」直接冲突。设计只能二选一：每次上线签发一张新票（票据与实例生命周期解耦，重连前必须拿到新票，因而需要一个签发通道），或者升级时用长活凭据并在对象侧替换旧 socket（同一对象接受新连接、关掉旧的）。两条都还没验，影子飞行**没有测到重连**，这是本设计的缺口。

回退分三层，全部以单实例为粒度：DO 无 socket 时同请求内退 quick；`mode` 翻转即整实例回 quick；插件没装桥或桥连不上时 quick 连接器照旧运行，因为迁移期内两条连接器并存。

### 观察面

每个经桥的请求带 `x-relay-transport: bridge` 与转发的 `cf-ray`，回退时带 `x-relay-fallback: no-connector`；插件侧把状态、实例、端点、本地上游与最近一次拨号错误写进 `$DSH_HOME/remote-web-ui-relay-bridge.json`，因为桌面宿主把插件跑在一个没人读得到 stdout 的进程里（2026-10-23：一个从未认领的宿主整条命期都答 `no-connector`，没有任何可读痕迹）；对象每 60 秒用 `getWebSockets().length` 采样一次在线连接数；断开原因（`deploy`、`network`、`evicted`）写进结构化日志，沿用 `wrangler.jsonc` 已开的 observability。Workers 每次发布都会在宽限期后断开存量 WebSocket（[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) 的运行时更新宽限一节），所以桥必须假定「发布等于全网 socket 滚动重连」，重连退避沿用插件已有的 `RelayRegistrar` 策略。

## 容量与成本算术

### 实测读数

本次只用只读查询，命令与结果在第 8 节，这里给出建模要用的四个数：24 小时活跃 3 390、7 天活跃 6 641、总计 12 215，D1 24 小时读查询 6 167 775。

### 假设

| 假设 | 取值 | 推翻条件 |
| --- | --- | --- |
| 峰值并发在线实例 | 1 200，夜间 300 | 阶段 3 采样 `getWebSockets().length`；若峰值超过 3 390（24 小时活跃上界）说明模型错了 |
| 中继请求量 Band B | 每天 150 万（全部实例合计约 17 rps） | 用分析 API 按 hostname 取 relay 请求数；今天 6.17M 读查询里含遥测面板 |
| 中继请求量 Band A | 每天 600 万（约 70 rps，等于把全部 D1 读查询算给中继） | 同上 |
| 每请求 DO 唤醒时长 | 0.20 s（两次边缘与插件往返） | 阶段 3 用 `wrangler tail` 与对象内计时实测 |
| 每请求的入站 WS 消息 | 3 帧（`res` 加两块 `chunk` 加 `fin` 取整） | 同上 |
| 每个响应平均字节 | 20 KB（资产已被 Worker 盖 immutable 缓存） | 抽样的响应体大小分布 |
| 大体积响应的额外跳代价 | 过桥的每次响应多一跳（对象到连接器）：300 KB 响应实测 +345 ms（457 变 803 ms） | 该实例的响应体大小分布；若资产缓存把大响应留在 Worker，该项只作用于 `/ios/v1` 的大帧 |

### 两档流量

| 项目 | Band B：每天 150 万 | Band A：每天 600 万 |
| --- | --- | --- |
| DO 请求（含 20:1 折算与连接建立） | 每月约 5 200 万，计费 $7.66 | 每月约 2.073 亿，计费 $30.95 |
| DO 时长（0.20 s × 128 MB） | 1 152 000 GB-s，计费 $9.40 | 4 608 000 GB-s，计费 $52.60 |
| Worker 请求（今天已经在付） | 4 500 万，计费 $10.50 | 1.8 亿，计费 $51.00 |
| 月度合计 | 约 $28，量级十美元 | 约 $135，量级百美元 |

对照上一版补票方案：6 641 个活跃实例要额外 5 641 条隧道，$4.50 × 5 641 = **每月 $25 385**；把 12 215 个历史实例全算上是 **每月 $50 468**。也就是说桥接方案在 Band A 的增量成本（$83.55/月）比补票方案便宜约 300 倍，Band B 的增量成本（$17.06/月）便宜约 1 500 倍。

上面两档都按「请求数 × 唤醒时长」建模，这个模型管延迟但不含吞吐：过桥的每一次响应都比 quick 路径多一跳（对象到连接器），代价落在搬响应体上而不是往返上。影子飞行同一小时、同一工具的对照是纯往返只差 7 到 11 ms（hello 151.6 对 144 ms、`session.titles` 150.3 对 139.6 ms），而约 300 KB 文本的 `session.list` 从 457 ms 变成 803 ms（+345 ms）。因此除了 Band A/B 的账单，还要一条「大体积响应过一次额外跳」的吞吐项：它不改变 DO 请求数与时长，却决定大帧（会话基线、名册）上的用户可见延迟，压缩率与资产缓存都影响它。

### 第一个撞上的上限

对象数等于已迁移实例数：7 天活跃 6 641 个实例最多对应 6 641 个对象，而账户内对象数不限，因此「每实例一个对象」这一维没有压力。分片之后，单类上限 500 个类我们只用 1 个、单对象 1 000 rps 软限在 70 rps 下不会碰到、单对象 10 GB 存储只存几百字节、32 MiB 帧上限远高于 256 KiB 块、每请求 6 条出站连接我们只用 1 条，因此**第一个真正会撞上的不是任何硬配额，而是时长账单**：它随「请求数 × 唤醒时长」线性增长，Band A 的时长费已经是每小时约七美分。第二个是今天已经在付的 Worker 请求费，不是新增。唯一需要在阶段 3 实测的是**单对象可持 WebSocket 数**这条文档未给数字的软约束：本设计每对象 1 条插件 socket 加少量手机 socket，若实测 2 条就抖动，这条会先咬人。

## 迁移路径

### 切换排序

1. 附加式部署：DO 命名空间、`/api/relay/bridge` 升级端点、`relay_registrations` 增加 `mode` 列且缺省 `quick`。Worker 的请求处理只多读一列，行为逐字节不变。
2. 发布带桥连接器的插件：它开一条出站 WebSocket，同时照旧启动 quick 连接器；服务端只记录桥的存在，不切换任何实例。携带桥接授权的认领归传输层所有：只要中继开启且 web 服务端口已绑定就执行，不再等快速隧道启动，因此由桥接服务的实例在 `autoTunnel` 关闭时也能连到自己的对象（2026-10-23：一个 profile 解析出 `autoTunnel: false` 的桌面宿主从未认领，对象没有套接字，边缘一直答 `x-relay-fallback: no-connector`，直到认领与隧道解耦）。若这一步用的是「一次性票据 + 对象把已用写进存储」，第一次发布后全部连接都会失去且回不来（见「回退与鉴权」），所以重连凭据的形态必须在第 1 步之前定下来。
3. 按实例翻 `mode`（先 1%，再按 `last_seen_at` 分批），Worker 在 `mode=bridge` 且对象有 socket 时走桥，其余走 quick。每一批都是一个 D1 UPDATE，秒级生效。
4. 新版本插件默认不开 quick 隧道，只在桥不可用时按需拉起；老版本插件不受影响，永远继续用 quick 路径。
5. 可选且最后才做的收尾：删除 quick 路径——`relay_registrations` 行、`relay.js` 的代理分支、`--http-host-header` 接线、插件的 quick 连接器。

### 回滚

把 `mode` 翻回 `quick` 就是回滚，粒度可以是单实例、单批或全量：一行 D1 UPDATE，不需要重新部署、不需要重启插件、不改 DNS、不改路由、不碰证书，手机侧无感。插件侧的第二重回滚是关掉桥连接器，它只影响自己那条 socket，quick 连接器仍在跑。

### 不可逆的那一步

只有第 5 步不可逆：删掉 quick 路径之后，跑着老版本插件、或所在网络封掉出站 WebSocket 的实例就没有传输了。这也是它被排在最后、并以「老版本占比低于可接受阈值」为门槛的原因。相比之下，上一版设计里的收窄路由是不可逆的**全局**动作，本设计把它整个移除——数据面上没有一步是不可逆的。

## 最小可证伪实验

### 阶段 0：只读读数（已跑）

| 探针 | 命令 | 读数 | 它判定了什么 |
| --- | --- | --- | --- |
| zone 的路由表 | `GET /zones/{zone_id}/workers/routes` | 一条 `*.dsh-market.com/*` 指向 `dsh-market` | 应答中继主机名的是一条路由，收窄它就是全局切断 |
| 账户内隧道 | `GET /accounts/{account_id}/cfd_tunnel?is_deleted=false` | 1 条 `dsh-relay-…`，状态 inactive | 配额剩 999 条，与 6 641 个活跃实例差一个数量级 |
| 活跃窗口 | D1 `SELECT count(*) … last_seen_at` 按毫秒窗口 | 24 小时 3 390、7 天 6 641、30 天 10 366、总计 12 215 | 规模读数复核通过；「一次切换」不可能安全 |
| 启动速率 | 同上，5 分、15 分、1 小时、6 小时窗口 | 139、303、591、1 018 | 这是隧道启动次数，不是在线数（表只在启动时写），并发必须另测 |
| D1 24 小时量 | `wrangler d1 info dsh-market` | 读查询 6 167 775、写 318 640、行读 171 987 137、库 5.13 GB | 给了 Band A 的量级上界：全部读查询都算给中继也只有 600 万/天 |
| 分析 API | GraphQL `workersInvocationsAdaptive` | 返回 `code: budget`（限流，不是鉴权拒绝） | relay 专属请求数还没取到；这是 Band B 的待补读数 |

### 阶段 1：本地汇合桥（已跑）

零生产写：本机 `wrangler dev --local` 起一个只含 DO 与一个工作进程的临时工程，插件侧用 Node 脚本扮演，三个读数全部通过。

| 检查 | 命令 | 读数 | 失败意味着 |
| --- | --- | --- | --- |
| 流式响应穿过 DO | `node client.mjs` 打 `/probe` | 分块到达 12、211、507、611 ms，`content-type: text/event-stream` | 若一次性到达，DO 把 SSE 缓冲掉了，方案作废 |
| 持有插件 socket 时仍能承接 `stub.fetch` | 同上 | `200`，不是 `503 no-connector` | 若回 `503`，请求会驱逐持有 socket 的对象，方案作废 |
| 手机 WebSocket 穿过 DO 与插件往返 | 同上 | `phone received: pong:ping-1` | 若收不到，手机的 WS 通道无法桥接，方案作废 |

这一步证明的是机制成立，不是边缘行为：帧上限、唤醒时长、发布重连都要到阶段 3 才能在真边缘上验。

### 阶段 2：配额不变式（只读，可随时重跑）

| 断言 | 命令 | 期望读数 |
| --- | --- | --- |
| 桥不新增任何 Cloudflare Tunnel | `GET /accounts/{account_id}/cfd_tunnel?is_deleted=false` | 条数不变（当前 1） |
| 桥不改任何路由 | `GET /zones/{zone_id}/workers/routes` | 仍然只有一条 `*.dsh-market.com/*` |
| 桥不写 DNS 与证书 | `GET /zones/{zone_id}/dns_records?type=CNAME&name=<id>.dsh-market.com` | 中继主机名下没有逐实例记录 |

### 阶段 3：非生产影子飞行（已跑，2026-10-23）

零生产写：`*.workers.dev` 上一个探针 Worker、一个按实例 id 分片的对象和本机连接器，代码在 `probe/relay-bridge/`（分支 `probe/relay-bridge-shadow`，提交 `a453b6118`），飞行结束即 `wrangler delete`。真机是 iPhone 17，同构建、同 DEBUG 驱动、同一小时与现网路径对照。

| 读数 | 采集方式 | 读数 | 它判定了什么 |
| --- | --- | --- | --- |
| Host 门禁 | 连接器把 `Host` 改写成回环字面量后 `GET /remote-bridge/pair/token` | `200` 加一枚可用令牌，现网中继同路径 `403` | 连接器必须原样转发 `Host` |
| 大响应吞吐 | 真机与桌面 `session.list`（约 300 KB 文本） | 457 变 803 ms | 额外一跳的代价在吞吐，不在往返 |
| 流式响应 | `curl -N` 打 `/_probe/stream` | 5 块，间隔 121 ms 到达 | 对象没有缓冲响应 |
| 真机往返 | DEBUG 驱动 | dial 763 ms、hello 200 ms、请求 rtt 中位 152.5 ms（现网 1176 / 152 / 147） | 与现网同口径持平 |
| 单对象 socket 数 | 一个对象同时持 1 条连接器与 1 条手机 socket | 稳定 95 s，单帧最大 1.45 MB，未驱逐 | 2 条 socket 不抖动 |
| 首次请求 409 | 部署后第一次 `GET /` | 1 次 `409 no-connector`，其后 5/5 `401` | 未解释，见「风险」 |
| 发布重连 | 本轮不可测 | 未测 | 缺口：一次性票据挡住重连，见「回退与鉴权」 |
| 32 MiB 帧边界 | 最大实测帧 1.45 MB | 未逼近 | 仍待测 |

下表是设计要求的读数与门槛，已跑的四项按上表，其余仍按它验收。

| 指标 | 采集方式 | 期望读数 | 失败意味着 |
| --- | --- | --- | --- |
| 每请求唤醒时长 | 对象内计时加 `wrangler tail` | 中位 0.15 到 0.25 s | 超过 0.5 s 时时长费翻倍，Band A 变两百美元级 |
| 单对象 socket 数 | `getWebSockets().length` 每 60 秒采样 | 稳定 1 条插件 socket 加手机 socket | 若 2 条就抖动或驱逐，分片策略要改成每对象一条连接 |
| 发布重连 | 部署一次新版本，观察插件重连 | 宽限期内断开，退避后 30 秒内全部回来 | 若大量实例不回来，桥需要一个重连期保险丝 |
| 32 MiB 帧边界 | 插件发送接近上限的块 | 大于上限时收到 `1009` 关闭 | 若远早于 32 MiB 被拒，块大小要下调 |

## 备选方案

**自建多机中继**是唯一真正独立的退路：它把汇合点从 Cloudflare 挪到自己的机器上，代价是运维值守、DDoS 暴露面与 3.6 TB/月量级的出网账单，而且要可用性就至少两机加任播。它的协议成本与选定方案相同（同样需要一套帧契约），因此在成本与运维上输掉，只在「必须不依赖单一厂商」时重新成为答案。

**加固 quick tunnel** 不是活着的候选，而是本设计保留的永久兜底：它的成本是零，而三条官方限制（200 在途、无 SSE、主机名每次变）没有任何一条能在不换传输的前提下消除。保留它才是「老实例不断」在工程上成立的原因。

**命名隧道加购买配额**在容量上能成立，价格上不成立：$25 385/月是最便宜的补票，而且它仍然要面对读数三的优先级问题——精确 CNAME 压不过通配自定义域，所以它还得叠加一次全局路由收窄，那正是最危险的一步。

**把 Worker 里的 D1 读换成 KV 缓存**能省掉每请求一次 D1 读，但它不改变传输选型，属于本设计之外的优化，等桥落地后再按读数决定是否值得。

## 验收标准

- 迁移后的实例，请求头带 `x-relay-transport: bridge`，且响应不再来自 quick tunnel（无 `trycloudflare` 回源日志）。
- 同一个实例在 `mode` 两次翻转之间，手机用同一书签打开无须重新配对。
- `relay_registrations` 每行都保留可用的 `target`，直到该实例至少一周稳定走桥；任一时刻都能整批回 quick。
- `GET /accounts/{account_id}/cfd_tunnel` 的条数在整个迁移期间不因桥而增长。
- 桥的每请求唤醒时长中位数不超过 0.25 s，且 Band A 的月度账单不超过 $200。
- SSE 与手机 WebSocket 两种流式路径都在桥上工作：`curl -N` 能看到增量事件，手机侧长连接不掉线。

## 风险

- 自持帧协议是本设计的主要新建负担：分帧、背压、取消、重连都由我们自己维护，错误会直接表现为手机上的白屏或半截响应。缓解手段是把帧契约压到上表那几类，并按仓里的测试纪律给每条路径写合同测试。
- 每次发布 Workers 都会在宽限期后断开存量 WebSocket，桥必须假定全网重连；重连期的兜底是 quick 路径，这要求它一直保留，与第 5 步的清理相冲突，因此清理只能等到老版本占比足够低。
- DO 时长账单随流量线性增长，Band A 与 Band B 相差约 5 倍；没有自动刹车，只有 `mode` 回退与告警。第一个需要盯的指标是每请求唤醒时长，不是请求数。
- 单对象 socket 上限没有官方数字，若它在真边缘上低于「1 条插件加若干手机」，分片策略要改，而分片改动会牵动 Worker 的路由逻辑。
- 桥让插件必须长期保留一条出站 WebSocket，公司网络封 WSS 的场景只能落到 quick 兜底；这既是风险也是它比上一版安全的原因。
- 部署后第一个请求回了 `409 no-connector`，而对象当时明确持有连接器 socket（它前一个请求刚被宿主应答，其后的 4 个请求也都正常）。同请求内的 quick 回退兜住了结果，但原因未查明：目前的首要怀疑是边缘上对象被重建而 socket 仍在，因此它是待测项，不是已解释的行为。

## 需要批准的生产改动

1. 新增 DO 命名空间与 `/api/relay/bridge` 升级端点，`relay_registrations` 增加 `mode` 列（附加式，不改任何既有行为）。
2. 发布带桥连接器的插件版本，两条连接器并存。
3. 按批翻 `mode`，每批一个 D1 UPDATE，可用同一手段回滚。
4. 在非生产主机名（`*.workers.dev`）上跑一次阶段 3 的影子飞行，把唤醒时长与 socket 上限测出来，再决定批次规模。
5. 只有在老版本占比降到阈值以下之后，才谈删除 quick 路径；它不在本文的批准范围内。
