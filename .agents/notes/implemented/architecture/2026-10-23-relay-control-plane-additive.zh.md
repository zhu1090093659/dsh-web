# Agent Note: 中继控制面先附加式落地，数据面切换仍未发生

Status: implemented

## Problem

[命名隧道中继提案](../../proposed/architecture/2026-10-23-relay-named-tunnel-data-plane.zh.md)决定让 market Worker 离开中继数据面、只当中继的控制面。它的迁移分两半：先落控制面与插件的第二条连接器，再用一次部署收窄通配路由并删除自定义域。一次性把整件事推上生产正是提案禁止的做法，所以代码这一半必须能单独落地、单独测试、单独评审，而通配路由、Worker 代理分支与快速隧道注册表保持与今天逐字节相同——所有还没采纳的实例继续通过一条尚未被切断的路径拿到可用源。

## Decision

控制面就是一个附加模块 `market/worker/src/relay-control.js`，配一份 D1 迁移（`0009_relay_leases.sql`）与 market 顶点上的三个端点。它不碰任何 Worker 路由、自定义域、缓存规则、证书、隧道或 API Token；快速隧道那一侧（`relay.js`、`/api/relay/register`、`/api/relay/unregister`、代理分支、离线页与 immutable 资产盖章）除把自己的 JSON、哈希比较与限流辅助函数导出、供两条路径共用一份实现之外，没有任何改动。

一条租约按实例拥有三个账户对象：远端管理的隧道 `dsh-relay-<id>`、该隧道的 ingress（先把实例主机名指向本地回源端口，再接远端管理隧道必需的 catch-all 规则），以及一条精确的代理 CNAME `<id>.dsh-market.com -> <tunnel-id>.cfargotunnel.com`。租约行指向它们，并承载回收时钟。

宿主侧客户端 `packages/dsh-remote-bridge/src/host/relay-control.ts` 与 `relay-connector.ts`（随 ingress 栈一同迁入；参见 [2026-10-31-remote-bridge-owns-ingress-stack.zh.md](2026-10-31-remote-bridge-owns-ingress-stack.zh.md)）在每次快速隧道启动时认领这条租约，并在同一条主机名上把命名连接器跑在快速连接器旁边。控制面应答的 `mode` 指明手机本应由哪一条服务；两条都保持运行，因此切换与回滚都是改一个服务端的值，不需要重启插件。

## Endpoints and failure grading

| 端点 | 方法 | 请求 | 响应 | 账户副作用 |
| --- | --- | --- | --- | --- |
| `/api/relay/claim` | `PUT` | `id`、`secret`、可选 `new_secret`、`origin.port`、`plugin.version` | `mode`、`tunnel.id`、`tunnel.token`、`hostname`、`dns.target` | 找到或创建隧道、写入 ingress、找到或创建 CNAME、取一次 Token、upsert 行 |
| `/api/relay/release` | `POST` | `id`、`secret` | `{ ok: true }` | 无：行标为 `released`，隧道与记录保留 |
| `/api/relay/retire` | `POST` | `id`、`secret` | `{ ok: true }` | 先删记录，再删隧道，最后删行 |

- 每次 claim 在应答前按名字对三件套做一次收敛，所以中途死掉的 claim 会被下一次尝试修复，而不是留下半建的实例。健康租约上的第二次 claim 不创建任何东西，只取一次 Token。
- `400 invalid-params`、`403 auth-failed`、`404 unknown-id`、`429 rate-limited` 沿用注册表的语义，包括首次 claim 必须带 `new_secret`，以及按 IP 与按 id 共用同一组窗口。
- `cfFailure()` 将上游 Cloudflare 故障分级为两种带 `retryAfterMs` 的 502 应答：上游 429（`isCfRateLimited()`，仅按状态码判定）应答 `502 cf-api-rate-limited` 与 300000 ms（`CF_RATE_LIMIT_RETRY_AFTER_MS`），其余上游故障应答 `502 cf-api-unavailable` 与 5000 ms（`CF_RETRY_AFTER_MS`）。`cfCall` 上的 isolate 内冷却闸（`CF_API_COOLDOWN_MS = 60_000`）在撞上 429 后停止向 Cloudflare 发请求，并在冷却期内不发 fetch 直接按 429 分级（bridge 模式 claim 不经 `cfCall`，冷却期照旧成功）。消费端（`packages/dsh-remote-bridge/src/host/relay-control.ts`）通过 `CLAIM_RETRY_BASE_MS = 5_000` 与 `CLAIM_RETRY_MAX_MS = 300_000` 保证 Worker 的 300 秒限流重试提示在封顶退避中不被截断。
- `503 cf-api-unconfigured` 是未配置限定 Token 的 Worker 的失败关闭应答：账户里不创建任何东西，也不写租约行。
- cron 回收按 retire 的顺序（记录、隧道、行）处理 90 天未见的租约，单次 tick 上限为 `LEASE_PRUNE_MAX_PER_TICK = 25` 行（`LIMIT ?2`），因此不存在「主机名仍可解析、指向的隧道已被删除」的窗口。某行撞上 429 时立即 `break` 结束本轮并返回 `{ pruned, rateLimited: true }`，该行及后续行保留 `tunnel_id` 留待后续 tick；行级非 429 失败继续处理下一行，失败行保留 `tunnel_id` 留待重试。在 `CF_API_COOLDOWN_MS` 冷却期内，GC 整 tick 短路跳过（不发起 D1 查询）并返回 `{ pruned: 0, rateLimited: true }`。删不掉隧道的行——未配置 Token——留给下一个已配置的周期，而不是直接丢弃，因为那行是这条隧道唯一的指针。

## Deviations from the proposal

1. 在提案的 `502 cf-api-unavailable` 之外新增了 `503 cf-api-unconfigured`。提案只点名上游故障；没有限定 Token 的 Worker 需要自己的错误码，调用方才能把故障与配置缺失分开，端点也才能在写入任何东西之前失败关闭。
2. claim 的限流在 Cloudflare 往返之前先读，再与租约 upsert 落在同一个 D1 批次里。提案要求窗口与写入走同一个批次，这一点成立；先读额外阻止了已经超预算的请求继续消耗账户调用。
3. `mode` 读自 Worker 变量 `RELAY_MODE`（缺省即 `quick`）。提案固定的是应答，不是它的来源；用一个变量让切换与回滚都是改部署而不是写 D1。
4. `release` 不移动 `last_seen_at`。把租约标为 released 是运维在说这个实例停了，而不是它被看见了，因此 90 天时钟从最后一次 claim 起算，已释放的实例照样会被回收。
5. 空闲的命名连接器关闭了就绪探测。通配路由仍应答中继主机名时，探测那个 URL 只会看到 Worker 的离线页，两轮之后就会把一个健康的连接器判死（issue #1723 在快速隧道上修过的失效模式），于是无限重启。它另外拥有独立的崩溃恢复记录槽（`remote-web-ui-tunnel-child-named.json`），因此任何一侧的启动都不会回收兄弟连接器留下的子进程。
6. 本次刻意不做的部分：收窄路由、删除通配 Workers 自定义域、zone 缓存规则，以及删除 `relay_registrations` 连同代理分支与它的 `--http-host-header` 接线。它们是提案后续的迁移步骤，每一条都改变生产。

## Alternatives considered

**release 时直接删隧道。** 那会让 release 与 retire 变成同一件事的两个名字，并丢掉提案买下的性质：重新开启的实例要走一遍找到或创建，而不是读一次 Token。保留隧道才是「重新开启瞬时恢复」成立的原因。

**把租约当作快速隧道的前置条件。** 这些端点的目的是让实例能迁移，不是让一次控制面故障弄瞎所有未迁移的手机。claim 保持尽力而为，快速隧道这一侧从不等待它。

**两个连接器共用一个隧道管理器。** 两条连接器要的监管正好相反：快速那一条在公网 URL 停止应答时必须被判死，空闲那一条根本不该被探测，而且各自需要自己的孤儿记录，好让一次崩溃只回收它留下的子进程。共用同一个 spawn 路径的两个管理器，比一个管理器里塞两套策略更小。

**把 `relay_registrations` 直接当租约表。** target、TTL 与状态列都不一样，共用一行还会让快速隧道这一侧在切换之前就依赖控制面。独立表让注册表能在提案的最后一步被整体删除。

## Consequences

- 在有人认领之前，账户里没有任何中继资源；在端点带着已配置的 Token 部署之前，也没有任何东西会去认领。在那之前，代码这一半在生产里是不生效的。
- 租约行可能比 D1 未记录的那条隧道活得更久（Cloudflare 调用成功、写入失败）。下一次 claim 会按名字收敛它；而一条再也不会被认领的租约只能由运维处理，因为没有行指向它。
- 插件现在按实例跑两个 cloudflared 子进程，这是提案风险一节已经算过的代价。
- `mode: quick` 下每个实例的行为与之前完全一致：同一个源、同一条代理路径、同一张离线页。

本次改动没有做任何生产写：不部署、不建隧道、不写 DNS 记录、不改 Worker 路由、不碰证书、不创建 API Token。上述每条行为都由注入 Cloudflare 客户端与 D1 的测试钉住。

## Testing

- `node --test scripts/market-relay-control.test.mjs`——32 例离线测试：找到或创建的收敛（第二次 claim 既不建隧道也不建记录）、含 catch-all 规则的 ingress 形状、偏移 CNAME 的修复、共用的鉴权与限流语义、未配置 Token 时失败关闭、502 分级为 `cf-api-rate-limited`（300 秒）与 `cf-api-unavailable`（5 秒）且带 `retryAfterMs`、cron GC 行数上限（`LEASE_PRUNE_MAX_PER_TICK = 25`）、429 立即结束 GC tick、isolate 内冷却闸（`CF_API_COOLDOWN_MS = 60_000`）到期恢复与 `resetCfApiCooldown()`、5xx 不上冷却闸、冷却期不短路鉴权、bridge 模式 claim 不碰账户调用、release 保留隧道与记录，以及 retire 与 cron 回收都按记录先于隧道先于行的顺序删除。
- `packages/dsh-remote-bridge/tests/relay-control.spec.ts`——15 例测试：claim 请求体、租约回读、拒绝分级（403 终止、400 重新认领 id、提示抬高退避下限）、300 秒限流重试提示不被 `CLAIM_RETRY_MAX_MS = 300_000` 截断、指数退避上限收敛至 300 秒、bridge 模式 claim 无需 Cloudflare 资源，以及 release 仅调用 release 端点而不碰 retire。
- `node --test scripts/market-relay.test.mjs`——未被改动的注册表与代理路径照旧通过。
