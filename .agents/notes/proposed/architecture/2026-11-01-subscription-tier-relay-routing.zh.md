# Agent Note: 中继按订阅档位分流

[English](2026-11-01-subscription-tier-relay-routing.md) | 中文

Status: proposed

本文承接 [自建中继会合点](2026-11-01-selfhosted-relay-meeting-point.zh.md) 及更早路由契约中关于未设档位门禁的设想。本文确立按账号订阅档位对中继传输路径分流的控制面与数据面规则：免费档实例走 `dsh-market.com` 的 Cloudflare Worker 会合点，Plus 与 Pro 付费档实例路由至 `relay.chatwithai.icu` 的自建 Go 中继服务。

## 问题

线上同时运行着两套会合点体系：Cloudflare Worker 中继（`<id>.dsh-market.com`）与自建 Go 会合点（`<id>.relay.chatwithai.icu`，见 [自建中继会合点](2026-11-01-selfhosted-relay-meeting-point.zh.md)）。然而当前缺乏任何依据用户订阅档位分流客户端与宿主流量的规则。

宿主的中继身份是本地磁盘匿名铸造的 ID 与密钥（`packages/dsh-remote-bridge/src/host/relay-registry.ts:71-103`），基础后缀缺省为 `RELAY_BASE_SUFFIX`（`packages/dsh-remote-bridge/src/host/relay-registry.ts:37`），与用户账号及订阅档位零绑定。

手机客户端（`iphone_remote_use_dsh` 仓库的 `Remote/App/AppModel.swift:23,305`）仅持久化保存单一连接源（origin）。

缺省情况下全部宿主均拨号连接 Cloudflare 中继（`packages/dsh-remote-bridge/src/index.ts:533-534`）。一旦宿主切换配置的会合点地址，免费档与付费档实例将无差别涌入自建 VPS，缺乏准入控制、额度隔离与按账号档位的分流规则。

## 提案

在不破坏宿主侧匿名性且不信任客户端自述的前提下，引入基于订阅档位的中继分流机制。手机客户端在账号登录后向账号服务换取专用于中继准入的短期授权凭据（`grant`），并通过加密协议帧交付给已配对的桌面宿主。宿主持该凭据向自建中继申请租约。自建中继通过环回调用向账号服务实时核验瞬时档位，将资源额度写入租约，但不持久化用户身份。桌面宿主通过 `hello` 响应广播建议会合点，手机端据此维护主候选与备用候选源站，并在降级时自动回落至 Cloudflare 中继。

## 上下文与效率影响

- **零大模型上下文开销：** 中继分流、租约协商与源站寻址完全在传输层与连接层通过轻量 JSON 及二进制控制帧完成，不消耗任何大模型上下文 token。
- **极小模式扩展成本：** 宿主设备名册模式版本由 3 升级至 4（`packages/dsh-remote-bridge/src/core/devices.ts:27,81`），仅纯追加可选的 `relay` 元数据块。手机故障转移账本针对同一宿主 ID 最多两个会合点候选，局域网快速路径另算（`Remote/Sources/RemoteKit/OriginFailover.swift:30-72,104-118`）。
- **受控上下文与网络预算：** 凭据拥有 30 天有效期，租约每 6 小时刷新一次，档位判定仅在 claim 触发时瞬时执行。出口带宽计数保存在中继内存中并在 UTC 零点归零，避免频繁写入数据库或引入侵入式流量整形。

## 架构与信任边界

### 凭据签发与宿主交付

手机客户端在登录账号后，向账号服务申请一枚中继授权凭据（`grant`，TTL 30 天，端点 `POST /v1/relay/grant`）。该凭据仅用于中继准入：不包含设备指纹、设备令牌或硬件唯一标识。

在已认证配对的连接上，手机客户端通过新增的 `relay.grant` 协议帧将凭据交给桌面宿主。宿主将其存入本地持久化的设备名册中（`packages/dsh-remote-bridge/src/core/devices.ts:27,81`）。

### 环回判定与匿名性保留

桌面宿主持该凭据向自建中继控制面发起租约 claim 请求（`POST /v1/relay/claim`，`packages/dsh-remote-bridge/src/host/relay-control.ts:24,38-40,100-108`）。自建 Go 中继本身不维护或解析订阅档位业务逻辑，而是通过环回接口（`POST /internal/relay/grant`，`Server/go/internal/api/server.go:334-345`，`Server/go/internal/api/relaytoken.go`）向账号服务发起判定，调用受共享密钥保护。Nginx 反向代理严格拦截外部对 `/internal/` 前缀的请求。

账号服务返回瞬时档位结论（free、plus 或 pro）。中继据此决定准入并分配并发流与带宽额度，且仅将额度写入 `relay_leases`。关键在于：**中继绝对不把 `userId` 写入租约表**。

订阅档位从不作为事实进入宿主业务逻辑：宿主对账号身份毫无感知，仅依据手头是否持有有效自建租约这单一布尔状态运转。

## 双源候选路由机制

### 会合点偏好与公告广播

宿主根据手中持有的租约决定首选会合点。持有有效自建租约时首选 `<id>.relay.chatwithai.icu`；否则依然首选 `<id>.dsh-market.com`（`packages/dsh-remote-bridge/src/host/relay-registry.ts:37`）。

在协议 v1 握手过程中，宿主 `hello` 响应追加可选键 `relay: {origin: string}`（`packages/dsh-remote-bridge/src/core/connection.ts:1135-1156`）。手机客户端**仅在已配对的连接上采信该公告**。

### 客户端候选账本与故障转移顺位

客户端启动时因当前订阅档位未知，首次拨号始终走 `WhaleOrigin`／部署缺省地址（即 `dsh-market.com`），绝非启动即拨打自建地址。公告账本仅在客户端通过 `GET /v1/me` 确认自身为 plus 或 pro 档位后，才采信宿主在 `hello` 中公告的自建会合点，并将其录入候选账本（`Remote/Sources/RemoteKit/OriginFailover.swift:30-72,104-118`）。该变动在**下一轮连接纪元**生效（用户在设置页点击 Reconnect 可立即触发新纪元生效）；在生效后的连接纪元中，手机将公告的自建地址作为首选中继候选，并将同 ID 的 Cloudflare 域名作为第二候选。

在冷启动窗口内客户端会自己起该纪元：首个活跃链接建立 8 秒内一旦 `GET /v1/me` 确认付费档位，账本中已持有公告的手机每次启动自体重建一次 socket，无需手动点击 Reconnect。该决策收敛在 `RelayRelaunchSwitch`，在启动参数通道、免费档或已写过提示词后永不触发。

第二候选仅在收到有效公告且档位确认后才会被创建。局域网（LAN）快速路径保持既有位置与评估顺位，排在两套中继会合点候选之后。

### 不中断现有会话与零重新配对

切换会合点无需重新配对：跨两个中继域名的宿主 ID（`<id>`）与 `deviceToken` 均保持一致，变更的仅为主机名后缀。配对二维码继续且仅提供 `dsh-market.com` 地址，确保 30 秒窗口的引导配对始终走全局永远可达的 Cloudflare 路径。

已建立的活跃连接不会因收到新公告而强行中断：公告仅影响下一轮连接纪元。用户在手机设置页点击 Reconnect 可立即生效。

## 降级宽限期与确定性回落路径

### 租约到期与宿主重试语义

租约 TTL 为 24 小时。宿主每 6 小时发起一次 claim 刷新，自建中继每次均通过环回向账号服务实时重新核验凭据。发生订阅降级（如 Plus/Pro 到期）后，宿主最迟在 6 小时内失去自建租约（宿主离线则在下次启动时失效）。

宿主侧 `relayClaimRetryOf`（`packages/dsh-remote-bridge/src/host/relay-control.ts:250`）当前将全部 HTTP 403 视为终局错误。本设计为其新增 `403 tier-required` 分支：释放自建租约、停止在 `hello` 中公告自建地址，并按 6 小时长冷却重试（`retry: true, refreshIdentity: false`）。宿主并行的 `dsh-market.com` 租约与连接器链路保持完全不动。

### 客户端回落与记忆作废

当手机端仍保存自建地址但遭遇地址类故障（`Server/go/internal/relay/server.go:177` 返回的 502 connector-offline、HTTP 404、TLS 握手失败或 TCP 连接超时，见 `Remote/Sources/RemoteKit/LinkFailure.swift:43-46`）时，立即自动回落至同 ID 的 `dsh-market.com` 地址。

通过 Cloudflare 连通后，若宿主的 `hello` 响应未携带 `relay` 公告，手机端立即作废已记忆的自建候选地址。该回落无需服务端推送回退地址，亦无需用户手动调整设置。

降级带来的开销确定且受控：降级后手机首次重连多一次失败拨号尝试，延迟代价约为一次连接超时时长。

## 鉴权与额度分配

系统容量、限流阈值与准入规则按订阅档位严格划分：

| 档位 | 自建准入 | 并发流 | attach 限流 | 日出口额度 |
| --- | --- | --- | --- | --- |
| free | 拒绝 `tier-required` | – | – | – |
| plus | 准入 | 64 | 6/60s/id、30/60s/IP | 2 GB 每租约 |
| pro | 准入 | 128 | 6/60s/id、30/60s/IP | 8 GB 每租约 |

- **超额拦截规则：** 超过并发流或日带宽额度时，仅对新建流请求返回 HTTP `429 quota-exceeded`（`req` 或 `ws-open` 控制帧；并发流上限在 `Server/go/internal/relay/bridge.go:152`，attach 限流窗口常量在 `Server/go/internal/relay/server.go:273-276`），绝不中断已建立的活跃流。
- **日出口流量统计：** 流量按租约 ID 在内存中统计，UTC 零点自动清零，不做细粒度数据包整形。
- **免费档配额规则：** 免费档在自建中继的额度为 0；其远程控制能力原样保留在 Cloudflare Worker 中继链路上。

## 协议增量

全部协议增量保持协议主版本 1、次版本 21 不变（不升级次版本）：

1. `hello` 响应追加可选字段 `relay?: {origin: string}`（`packages/dsh-remote-bridge/src/core/connection.ts:1135-1156`），表明宿主建议下次连接使用的会合点地址。
2. 新增能力标识 `relay.tier.v1`：该能力不进入 `SERVED_CAPABILITIES`，仅在配置了第二会合点时条件出现在 `hello.r.capabilities` 中；协议保持 `proto: 1`、`minor: 21` 不变。此处为明确的工程取舍：本卡的硬边界要求不配置第二会合点时握手逐字节不变，而 `core/protocol.ts` 将进入 `SERVED_CAPABILITIES` 视为 minor 增量——二者不可兼得，此处取前者并将此偏差明示，不作隐瞒。客户端仅在看到该能力公告后才发送 `relay.grant` 帧；未配置第二会合点的宿主上 `relay.grant` 回 `unknown-method`（未配对时回 `unpaired`）。
3. 新增请求 `relay.grant`：载荷 `{grant: string}`，应答 `{ok: true}`；未配置第二会合点的宿主返回错误 `unknown-method`，未配对连接上的请求返回错误 `unpaired`。
4. 宿主租约 claim 请求体追加可选 `grant` 字符串（`packages/dsh-remote-bridge/src/host/relay-control.ts:100-108`）；中继控制面引入错误码 `tier-required`、`grant-invalid` 与 `lease-stale`。自建中继在连接器附挂时要求租约 `claimed_at` 在 24 小时内，过期回 `403 {"error":"lease-stale"}`；宿主据此立刻重新 claim（通过即恢复连接，被拒则进入 6 小时冷却）。
5. 宿主设备名册模式版本由 3 升至 4（`packages/dsh-remote-bridge/src/core/devices.ts:27,81`），纯追加 `relay` 数据块。
6. 账号服务新增两个 REST 接口：`POST /v1/relay/grant`（基于会话签发凭据）与 `POST /internal/relay/grant`（基于内部共享密钥环回判定凭据，`Server/go/internal/api/server.go:334-345`、`Server/go/internal/api/relaytoken.go`）。
7. 宿主重试决策函数 `relayClaimRetryOf`（`packages/dsh-remote-bridge/src/host/relay-control.ts:250`）新增 `403 tier-required` 分支，返回 `{ retry: true, delayMs: 21_600_000, refreshIdentity: false }`。这个分支刻意不受 `CLAIM_RETRY_MAX_MS`（300 秒，`relay-control.ts:96-97,248-252`）夹取，那条上限继续只约束限流那条路。

## 缺省行为与灰度边界

- **零配置兼容性：** 在未配置新选项时，宿主仅申请 Cloudflare 租约（`dsh-market.com`），配对二维码保持 dsh-market 域名，`hello` 不携带 `relay`，手机端行为完全保持原样。
- **配置项定义：** 第二会合点由 `relaySecondaryControlUrl` 与 `relaySecondaryPublicSuffix` 控制（`packages/dsh-remote-bridge/src/index.ts:533-534`），缺省均为 `undefined`（关闭状态）。
- **分阶段灰度范围：** 本规范仅授权在开发者本机 profile 中开启第二中继配置。将缺省值全面翻转为全量宿主携带自建中继属于后续里程碑卡片。

## 考虑过的备选方案

- **将中继租约长期绑定至用户账号。** 已否决。在 `relay_leases` 中持久化 `userId` 会形成关联用户账号与物理宿主机硬件 ID 的审计日志。由于准入仅需在 claim 时刻做一次瞬时判定，在租约表记录用户 ID 违背数据最小化原则。
- **客户端自述订阅档位。** 已否决。客户端自述的请求头或参数不构成安全信任边界；篡改后的客户端可随意伪造档位规避配额。档位判定必须由账号服务密码学签发并由中继在带外核验。
- **每档分配不同入口且换档重新配对。** 已否决。用户在升级或降级时被迫重新扫码并重新协商 `deviceToken` 会带来极高的使用摩擦。在不同域名后缀间复用相同宿主 ID 实现了网络路由与设备认证的解耦。
- **单一入口服务端按档位反代上游。** 已否决。全量流量经由单一 Cloudflare 顶层入口并在服务端将付费流量转交 Go VPS，仍会导致 100% 的数据面字节穿透 Cloudflare Workers，彻底抵消了摆脱供应商依赖与规避边缘平台限流的目标。

## 验收标准

- **探针实例验证：** 隔离的 DSH 测试实例（`DSH_HOME=/tmp/dsh-verify-relay-tier`）验证无凭据宿主 claim 被拒并返回 `403 tier-required`，进入 6 小时退避而不终止；持 Plus 凭据宿主成功获取租约并建立连接器 WebSocket；降级凭据在下次 6 小时刷新时被收回租约。
- **真机双向验证：** 在实体 iOS 设备上分别执行一次升级与一次降级，记录升级时的地址切换用时与降级时的故障转移回退用时。
- **跨仓库文档对齐：** `iphone_remote_use_dsh` 仓库内的文档（`docs/account-and-subscription.md:24,226-238` 与 `docs/protocol-v1.md`）在同一次变更中完成同步更新。
- **机械门禁检查：** `pnpm docs:check` 与 `pnpm i18n:check` 命令执行通过，无任何报错或警告。

## 风险与已知边界

- **VPS 成为付费档单点故障：** 免费档流量继续走 Cloudflare，而 Plus 与 Pro 付费流量经由专用 VPS（`relay.chatwithai.icu`）。若 VPS 发生硬件或网络故障，付费实例将暂时失去自建中继优势，直至自动回落到 `dsh-market.com` 路径。
- **通配符 TLS 证书维护风险：** `*.relay.chatwithai.icu` 域名依赖 Let's Encrypt DNS-01 挑战定期续期。必须配置自动化续期脚本与监控告警，防范证书过期导致阻断。
- **多设备混合档位配对非对称性：** 当同一宿主与多台不同订阅档位的手机配对时，只要有一台设备提供有效 Plus 或 Pro 凭据，宿主即可获得自建租约。配对在同一宿主上的免费档手机由于自身无凭据，仍按自身档位走 `dsh-market.com`。此种非对称双源路由属于已确认的正常运行边界。
