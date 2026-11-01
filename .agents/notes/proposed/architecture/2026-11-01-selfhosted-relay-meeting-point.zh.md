# Agent Note: relay.chatwithai.icu 自建中继会合点

[English](2026-11-01-selfhosted-relay-meeting-point.md) | 中文

Status: proposed

本文承接 [relay transport v2](2026-10-23-relay-bridge-transport.zh.md) 中关于 Cloudflare Worker 会合点的选型。本文全量延续其多路复用 bridge 帧契约与容量建模思路，将会合点从 Cloudflare Workers / Durable Objects 迁移至部署在 `relay.chatwithai.icu` 的独立 Go 语言中继服务。

## 问题

手机远程控制协议 v1 通过 `/ios/v1` 上的 WebSocket 连接将客户端接入本地 DSH 实例。当前该源的全部流量均经由第三方 Cloudflare Worker 代理转发（`market/worker/src/relay.js:8-12`），租约管理与汇合桥则依赖 Cloudflare Durable Objects（`market/worker/src/relay-bridge.js:145-180`）与顶层 API 端点（`market/worker/src/relay-control.js:18-28`）。宿主侧插件（`packages/dsh-remote-bridge`）深度硬编码了 market 顶层控制面端点（`packages/dsh-remote-bridge/src/host/relay-control.ts:17-18`）与固定主机名后缀（`packages/dsh-remote-bridge/src/host/relay-registry.ts:24-30`），且连接器出站拨号固定指向 Cloudflare 端点（`packages/dsh-remote-bridge/src/host/relay-bridge-connector.ts:109-113`）。

该部署拓扑面临两项关键运维瓶颈：

- **Cloudflare Workers 平台 API 持续 429 限流。** Cloudflare 管理面在 `workers/services` 部署接口上频繁返回 HTTP 429，导致部署流水线反复失败，阻塞紧急热修与版本发版。
- **数据面全量字节 100% 依赖第三方边缘服务。** 全部协议实时帧经由第三方 Worker 与 Durable Object 运行时中转，将实时交互延迟、长连接保活与并发承载完全绑定在外部平台的配额、维护窗口与计费策略上。

## 不可协商的约束

五项边界受现有客户端契约、安全模型与线上运行不变量严格锁定：

- **手机 App 客户端代码完全不改。** `RemoteKit` 内部的 iOS 客户端实现（`iphone_remote_use_dsh` 仓库的 `Remote/Sources/RemoteKit/ProtocolV1.swift:377` 中 `wsPath = "/ios/v1"`，以及 `Remote/App/AppModel.swift:354-367` 中 `normalise()` 剥离一切路径前缀只保留协议/主机/端口）不作任何改动。
- **现存 dsh-market 中继保持双轨并行。** Cloudflare Worker 中继不停用；新老两个数据面长期并存，未配置自定义中继的桌面宿主与旧版实例行为不受任何影响。
- **宿主侧缺省行为逐字一致。** 配置解析函数（`packages/dsh-remote-bridge/src/index.ts:503-517`）在省略配置项时，对 `relayControlUrl` 补齐 `https://dsh-market.com/api/relay`、对 `relayPublicSuffix` 补齐 `.dsh-market.com`，保持零配置体验完全一致。
- **租约重试与退避语义完全不变。** 重试决策函数 `relayClaimRetryOf`（`packages/dsh-remote-bridge/src/host/relay-control.ts:217-229`）必须严格保持 403 彻底终止、`invalid-params` 与 `unknown-id` 触发 `refreshIdentity`、`retryAfterMs` 抬高重试下限，以及 5 秒（`CLAIM_RETRY_BASE_MS = 5_000`）至 300 秒（`CLAIM_RETRY_MAX_MS = 300_000`）的退避上限区间。
- **浏览器远程控制模块保持不动。** 已退役的 Web UI 包 `dsh-remote-web-ui` 零改动，宿主桥接插件保留现有入站网关的所有安全与鉴权边界。

## 选型比较

围绕部署可行性、家庭宽带环境约束与独立可控性评估了三类实现路径：

| 选型 | 架构设计 | 可行性与推翻条件 | 判定 |
| --- | --- | --- | --- |
| 反向代理穿透至宿主回环 | VPS 直接反代入站请求至宿主网络端口 | 家庭宽带普遍缺乏公网 IPv4 与入站端口映射，NAT 穿透无法保证可用性 | 否决 |
| 仅迁移控制面 | 租约控制面迁至 VPS，数据面仍留 Worker | 数据面依然 100% 滞留在 Cloudflare Worker，部署 429 故障与流量配额问题完全未解 | 否决 |
| Go 自实现 WSS 会合点 | Mac 宿主主动向 VPS 出站建连，手机连 VPS | 出站建连天然穿透各类 NAT，彻底摆脱第三方依赖，复用成熟多路复用帧契约 | 选定 |

## 选定方案

选定方案在 `iphone_remote_use_dsh` 服务端代码库中新增独立 Go 语言 WebSocket 汇合桥守护进程，部署于自建 VPS（`43.153.135.11`），由现有 Nginx 统一反代入站。

### 进程与端口拓扑

服务端已按本设计实现并部署：进程为独立二进制 `whale-relay`（命令 `cmd/relayservice`，位于 `iphone_remote_use_dsh` 仓库 `Server/go`），由独立 systemd 单元 `whale-relay-go.service` 托管，监听本地回环地址 `127.0.0.1:18789`，状态落在独立 SQLite 数据库 `/var/lib/whale-go/relay.db`。该服务与既有账号服务（`whale-account-go.service`，监听 `127.0.0.1:18787`）完全物理隔离，账号服务的发布或重启绝不影响中继长连接与隧道通信。

### 服务端环境变量契约

服务端定义了以下环境变量契约：

| 环境变量 | 必填 / 缺省值 | 说明 |
| --- | --- | --- |
| `DATABASE_PATH` | 必需 | SQLite 租约数据库文件的存储路径（`/var/lib/whale-go/relay.db`）。 |
| `HOST` | 缺省 `127.0.0.1` | 服务进程绑定的本地监听地址。 |
| `PORT` | 缺省 `18789` | 接收反代流量的本地 TCP 监听端口。 |
| `BUILD_REV` | 可选 | 二进制文件的构建版本标识或提交 SHA。 |
| `RELAY_PUBLIC_SUFFIX` | 缺省 `.relay.chatwithai.icu` | 拼接在中继实例标识后的公网域名后缀。 |
| `RELAY_CONNECTOR_URL` | 缺省 `wss://relay.chatwithai.icu/__relay/connector` | 控制面在 claim 响应中返回给宿主连接器的出站 WebSocket 会合端点 URL。 |

### Nginx 反代与证书拓扑

在域名解析中配置灰云（DNS only）A 记录，将 `relay.chatwithai.icu` 与 `*.relay.chatwithai.icu` 均解析至 `43.153.135.11`。Nginx vhost 的 `server_name` 为 `relay.chatwithai.icu` 与 `*.relay.chatwithai.icu`，证书 SAN 同时包含两者，在 443 端口统一切割并终止 TLS。上游 Host 头原样透传（`proxy_set_header Host $host`），因为实例 ID 仅从主机名提取。Nginx 将所有匹配请求反代至 `127.0.0.1:18789`：

- 顶层域名 `relay.chatwithai.icu`：承载 HTTP 控制面请求（`/v1/relay/*`）与宿主连接器出站拨号（`/__relay/connector`）。
- 泛二级域名 `<id>.relay.chatwithai.icu`：承载手机客户端下行 WebSocket 连接（`/ios/v1`）。必须采用二级子域名，因为 `iphone_remote_use_dsh` 仓库的 `Remote/App/AppModel.swift:354-367`（`normalise()`）会丢弃一切路径前缀并固定追加 `/ios/v1`。

### SQLite 租约账本

中继守护进程持有独立的 SQLite 数据库文件 `/var/lib/whale-go/relay.db`。租约表结构定义如下：

```sql
CREATE TABLE IF NOT EXISTS relay_leases (
  id TEXT PRIMARY KEY,
  secret_sha256 TEXT NOT NULL,
  hostname TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'bridge',
  created_at INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  released_at INTEGER,
  plugin_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_relay_leases_claimed_at ON relay_leases(claimed_at);
```

后台定时任务每 24 小时执行一次租约回收，清理活跃时间满足 `claimed_at < unixepoch() - (90 * 86400)` 的 90 天冷租约。

## 控制面契约

控制面在顶层域名 `https://relay.chatwithai.icu` 下提供租约申领与释放接口。

### 端点规范

提供两处生命周期控制端点：

- `PUT /v1/relay/claim`：申领或刷新中继实例租约。
  - 请求体（JSON）：
    - `id`（字符串，必填）：16 位十六进制实例标识，匹配正则 `/^[a-z0-9]{16}$/`。
    - `secret`（字符串，必填）：43 位 base64url 实例密钥，匹配正则 `/^[a-zA-Z0-9_-]{43}$/`。
    - `new_secret`（字符串，可选）：初次申领或重置密钥时携带。
    - `origin`（对象，必填）：`{ "port": number }`，声明宿主本地端口。
    - `plugin`（对象，可选）：`{ "version": string }`，声明插件版本。
  - 响应体（JSON，200 OK）：
    ```json
    {
      "mode": "bridge",
      "hostname": "<id>.relay.chatwithai.icu",
      "bridge": {
        "endpoint": "wss://relay.chatwithai.icu/__relay/connector",
        "instance": "<id>",
        "credential": "lease-secret"
      }
    }
    ```
- `POST /v1/relay/release`：宿主正常停机或插件卸载时的温和释放端点。
  - 请求体（JSON）：`{ "id": "<id>", "secret": "<secret>" }`。
  - 响应体（JSON，200 OK）：`{ "ok": true }`。服务端更新 SQLite 中对应行的 `released_at = unixepoch()`。

### 错误码与退避决策对照

控制面错误响应与宿主侧 `relayClaimRetryOf`（`packages/dsh-remote-bridge/src/host/relay-control.ts:217-229`）的处理决策保持严格映射：

| 状态码 | 错误应答 | 触发原因 | 宿主处理行为 |
| --- | --- | --- | --- |
| 400 | `{"error":"invalid-params"}` | 参数格式错误或正则不匹配 | 触发 `refreshIdentity: true`，重新铸造凭据申领 |
| 403 | `{"error":"auth-failed"}` | 密钥哈希与数据库已存租约不符 | 判定为终态拒绝（`retry: false`），彻底停止重试 |
| 404 | `{"error":"unknown-id"}` | 未知实例且未携带 `new_secret` | 触发 `refreshIdentity: true`，按初次申领重建 |
| 429 | `{"error":"rate-limited"}` | 触发 IP 或 ID 速率限制 | 按指数退避区间（5 秒至 300 秒）重试 |

### 接口范围边界

服务端明确不实现 `/v1/relay/register` 与 `/v1/relay/unregister` 端点。快速隧道（quick tunnel）的代理注册机制继续保留在 `dsh-market.com`；自建中继服务专职承接 `mode: 'bridge'` 架构。

## 数据面契约

数据面在手机端与宿主连接器之间提供低延迟、多路复用的双向字节流中继。

### 下行握手与路径过滤

手机客户端在 `wss://<id>.relay.chatwithai.icu/ios/v1` 发起 WebSocket 建连。服务端执行严格的路径白名单：

- 仅接受精确路径为 `/ios/v1` 的 HTTP Upgrade 握手升级。
- 任何其他 HTTP 路径、非 `/ios/v1` 的请求直接返回 HTTP 404 Not Found，绝对不触发向宿主建立流连接。
- 服务端对手机侧完全不设业务鉴权：服务端充当透明管道，设备令牌（deviceToken）与一次性配对引导码（bootstrapToken）完全在宿主侧端到端检验（`packages/dsh-remote-bridge/src/index.ts:6-12`），订阅档位不决定传输路径（`iphone_remote_use_dsh` 仓库的 `docs/account-and-subscription.md:24,226-238`）。

### 上行宿主连接器桥接

桌面宿主连接器向 `wss://relay.chatwithai.icu/__relay/connector?id=<id>` 发起出站 WebSocket 建连。认证与进程隔离遵循以下规范：

- **凭据请求头：** 连接器仅使用 `Authorization: Bearer <secret>` 请求头携带明文租约密钥（`packages/dsh-remote-bridge/src/host/relay-bridge-connector.ts:141-149`），宿主握手请求头与今天线上完全逐字一致，仅切换拨号端点 URL。
- **内部标记头彻底消除：** 标记头 `x-relay-bridge-attach`（`market/worker/src/relay.js:31` 与 `market/worker/src/relay-bridge.js:171,570`）在自建架构中不再使用。在原 Worker 体系中，该标记头由 Worker 门口完成鉴权后在转发给 Durable Object 时私有附加，用于对象侧信任门禁；而在自建 Go 进程模型中，「门口与会合点」同属单个进程，两者之间不存在跨服务信任边界。连接器入站与手机客户端通过不同主机名（`relay.chatwithai.icu` 与 `<id>.relay.chatwithai.icu`）、不同路由（`/__relay/connector` 与 `/ios/v1`）及密钥鉴权实现强隔离，无须依赖标记头。

服务端从 query 参数提取 `<id>`，计算密钥的 SHA-256 并与 `relay_leases` 中的 `secret_sha256` 进行常量时间比对。校验通过后予以升级，否则返回 HTTP 403。

### 多路复用帧契约

帧协议与 `market/worker/src/relay-bridge.js` 逐字对齐，在单条 WebSocket 链路上按流 ID 多路复用：

- **控制帧（JSON 文本）：**
  - 双向控制动词：`req`（HTTP 请求头）、`res`（HTTP 响应头）、`fin`（响应流正常结束）、`fail`（响应流异常终止）、`ws-open`（手机 WS 握手发起）、`ws-accept`（宿主确认接受 WS）、`ws-fail`（宿主拒绝 WS）、`ws-close`（关闭 WS）、`close`（取消单条流）、`end`（请求体发送结束）。
- **载荷帧（二进制）：** 结构为 `[kind:u8][streamId:u32be][payload]`
  - `kind = 1`：HTTP 消息体分块。
  - `kind = 2`：WebSocket 二进制数据帧。
  - `kind = 3`：WebSocket UTF-8 文本数据帧。
- **超时阈值：** 响应头超时上限为 60 秒（`HEAD_TIMEOUT_MS = 60_000`）；WebSocket 握手应答超时上限为 15 秒（`WS_OPEN_TIMEOUT_MS = 15_000`）。
- **响应头清洗：** 逐跳首部（`connection`、`keep-alive`、`transfer-encoding`、`upgrade`、`content-length`）在转发给客户端前全部剥离。
- **传输标识：** 转发响应头部注入 `x-relay-transport: bridge`。

帧契约里 HTTP 那一半（`req`、`res`、`fin`、`fail` 控制帧与二进制 `kind = 1` 载荷分块）在服务端已实现，但生产路由只放行 `/ios/v1` 的 WebSocket 升级，HTTP 直通没有入口——它由测试驱动，是给未来非手机客户端留的契约能力，不是现存能力。这条在此必须明确写出，避免读者误以为存在 HTTP 直通。

### 断线重连语义

当宿主重启或网络闪断重连时：

- 同一 `id` 的最新连接器建连直接生效（newest attach wins）。
- 原有旧连接立即被服务端以 WebSocket 状态码 `1000 replaced` 正常关闭（`market/worker/src/relay-bridge.js:200`）。
- 原旧连接所归属的在途中继流全部立即失败，错误原因标记为 `connector-replaced`（`market/worker/src/relay-bridge.js:198`）。
- 新连接上已建立的流完全不受干扰，稳定运行。
- 宿主侧按 1 秒（`BRIDGE_RETRY_BASE_MS = 1_000`）至 30 秒（`BRIDGE_RETRY_MAX_MS = 30_000`）区间指数退避拨号，无需换发新票据，沿用租约密钥。

### 限流与流并发保护

为防范恶意刷量与连接泄露，服务端执行以下风控限制：

- **申领频次限制：** 新服务为申领请求配置专有频次窗口，量级沿用控制面既有实现（`market/worker/src/relay-control.js:453-454`）：单 IP 60 秒内上限 30 次，单 ID 60 秒内上限 6 次。
- **连接频次限制：** 宿主 connector 拨号建连单 IP 60 秒内上限 30 次，单 ID 60 秒内上限 6 次，为自建服务专设以保护 socket 资源。
- **单实例并发流保护（本设计新增门禁）：** 单个 connector 实例最多同时挂载 64 条并发流，为本自建设计全新引入的容量保护闸，超出阈值的新流直接拒绝（返回 HTTP 429 或 ws-fail），防止内存缓冲区被挤占。

## 容量与资源硬顶

将会合中继迁移至自建 VPS，意味着全量会话的网络出网带宽与计算负荷由单台主机完全承载。

### 资源基线假设

基于线上遥测数据设定以下容量基线假设：

| 维度 | 保守基线假设 | 预警与推翻指标 |
| --- | --- | --- |
| 峰值并发在线实例 | 50 至 100 台桌面宿主同时在线 | 18789 端口活跃 TCP 连接数突破 500 |
| 单空闲长连接内存占用 | Go 协程与 socket 缓冲占用 15 KB 至 25 KB | `whale-relay` 进程常驻内存突破 512 MB |
| 单活跃会话流式吞吐 | 模型打字机输出时占用 20 KB/s 至 100 KB/s | VPS 综合出网带宽持续突破 80 Mbps |
| 数据库读写频度 | 全网每分钟写事务低于 5 次 | SQLite 写入等待耗时超过 50 ms |

### 容量硬顶与瓶颈分析

针对 VPS 硬件边界评估瓶颈顺位：

- **出网带宽是首要瓶颈。** 典型 100 Mbps 共享带宽下，50 个会话同时流式推断消耗约 20 至 30 Mbps，处于安全水位；但会话历史突发拉取可能推高瞬时带宽，流式应答需避免过大突发。
- **CPU 与内存开销处于极低水位。** Go 基于 epoll 的网络协程模型承载千级空闲连接仅消耗数十兆内存；SQLite 仅在启动申领与停机释放时交互，常规数据帧交互零数据库 I/O。

## 迁移与上线路径

迁移按照严密隔离的工序推进，杜绝意外连带故障。

### 切流步骤

1. **VPS 部署中继守护进程：** 编译 `whale-relay`，安装 `whale-relay-go.service` 单元，初始化 `/var/lib/whale-go/relay.db`，并配置 Nginx 泛域名证书反代。
2. **宿主插件暴露配置字段：** 在 `packages/dsh-remote-bridge/src/index.ts` 中新增 `relayControlUrl`（默认 `https://dsh-market.com/api/relay`）与 `relayPublicSuffix`（默认 `.dsh-market.com`）。
3. **独立探针宿主灰度验证：** 启动带独立环境变量 `DSH_HOME=/tmp/dsh-verify-relay` 的测试宿主，配置指向 `relay.chatwithai.icu`，全链路测试配对、流式会话与审批。
4. **更新用户正式配置：** 在正式宿主 profile 配置中写入 `relayControlUrl: https://relay.chatwithai.icu/v1/relay` 与 `relayPublicSuffix: .relay.chatwithai.icu`。
5. **重启 DSH 宿主服务：** 重启桌面端 `dsh web` 宿主进程以加载全新配置。
6. **更新手机端连接地址：** 在手机 App 连接设置中，将连接地址修改为 `wss://<id>.relay.chatwithai.icu` 并重新连通。

### 回退策略

若自建中继发生异常，回退过程只需两步轻量配置变更：

- 宿主侧将 `cordis.patch.yml` 中的中继配置删除，恢复默认值（回退至 `dsh-market.com`），并重启 `dsh web`。
- 手机侧打开连接设置，将 origin 改回 `wss://<id>.dsh-market.com` 并点击重新连接。

### 不可逆步骤说明

本方案**不存在任何不可逆步骤**。自建中继与现有 `dsh-market.com` 保持完全并行运行状态；不删除任何域名解析，不改动 Cloudflare 现有路由，随时可通过配置字符串与 App 输入框双向秒级切换。

## 验收与灰度验证

验证严格在独立环境中先行展开，严禁直接在生产实例上盲切。

### 探针宿主灰度步骤

所有验证工作均在独立的 `DSH_HOME=/tmp/dsh-verify-relay` 探针宿主上运行。这确保当前会话的看板账本与正在运行的桌面宿主不受任何干扰。

### 三条核心链路验证

灰度验收必须完整通过以下三条核心链路：

- **配对引导链路：** 通过 `http://127.0.0.1:<port>/remote-bridge/pair/token` 签发一次性 bootstrap token，并在手机端发起配对，验证通过自建中继成功完成 `pair.begin` 与 `pair.finish` 握手。
- **会话流式链路：** 发起模型问答，验证 `session.snapshot` 基准快照与 `session.prompt` 增量 delta 帧平稳传输，打字机流式输出无卡顿、无丢包、无乱序。
- **审批推送链路：** 触发带工具权限审批的调用（`approval/request`），验证权限弹窗能够穿透自建中继推送至手机，手机端点击授权后宿主即刻放行。

### 切换用时记录指标

验证过程中严格测量并记录以下两项运维时间开销：

- **切换耗时：** 从宿主应用配置并重启，到手机端通过 `relay.chatwithai.icu` 成功完成首帧交互的全部耗时。
- **回滚耗时：** 从宿主还原默认配置并重启，到手机端切换回 `dsh-market.com` 并恢复连接的全部耗时。

## 影响与权衡代价

本架构方案引入以下运维责任与设计权衡：

- **VPS 成为单点故障源。** 自建服务器（`43.153.135.11`）成为迁移实例的唯一中继汇聚点。若 VPS 宕机或网络中断，已迁移实例的中继将受阻。兜底方案为长期保留 `dsh-market.com` 作为随时可切换的热备。
- **泛域名证书运维负担。** `*.relay.chatwithai.icu` 泛域名证书需定期通过 Let's Encrypt DNS-01 验证续期，必须维护自动化续期脚本与监控告警，避免证书过期引发连接拦截。
- **手机端连接地址需手动修改。** 由于 iOS 客户端只持久化单个连接 origin，已配对用户切换至自建中继时需在 App 设置中手动修改主机名。

## 运维安全与已知危险

在工程落地次序中必须高度规避一项已知危险：

- 修改宿主 profile 配置后，必须重启 `dsh web` 宿主进程方可使中继参数生效。
- 正在运行当前任务的会话本身正是由该宿主进程承载的；重启宿主会立即终止当前会话，导致执行上下文丢失。
- 因此，修改用户真实 profile 配置与重启宿主的操作，必须严格安排在服务端上线、代码落地与探针验证完全通过之后的最后一步。

