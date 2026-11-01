# Agent Note: 命名隧道中继——数据面不再租用 Worker

Status: proposed

> 传输选型已由[中继传输 v2](2026-10-23-relay-bridge-transport.zh.md)取代；2026-10-23 的三条生产读数推翻了本文的前提，以下结论保留为历史记录。

## 问题

已配对的手机通过 `https://<id>.dsh-market.com` 访问自己的 DSH 实例，而这个源上的每一个字节都由 market Worker 送出（`market/worker/src/relay.js`）：Worker 读一行 D1 拿到该实例当前的 `*.trycloudflare.com` quick tunnel 主机名，再把请求转发过去。market Worker 因此是数据面上的一跳，quick tunnel 则是回源传输，而唯一能在用户机器上启动、监督、重启与回收连接器的那一端（插件）今天两样都不拥有。

推动这份提案的是两条理由，都不关于隧道落点。

- **quick tunnel 不是生产传输。** 它按设计无账户、没有 SLA，主机名每次启动重新生成，稳定源之所以存在只是因为第三方替它代理。当前在跑的那条隧道甚至由遗留脚本（`/tmp/netperf-tunnel2.sh`）看守，而不是由任何已发布的代码看守，这撑不过一次发版。
- **数据面走 Worker 等于把手机耦合到控制面。** 每个请求、每次 WebSocket 重连都要付一次 D1 读加一跳额外转发；D1、Worker、隧道任一方故障都是手机故障，故障源有三个。租约与登记属于控制面，字节不属于。

2026-10-23 的两条实测约束设计取向，但都不足以成为立项理由本身。

- 今天中继的延迟由隧道落点与回源路径决定，不由 market 决定：连接器在 `sjc01` 时中继 ttfb 约 1.1 s，只有把连接器换到 `hkg11`（经本机选择的代理）才降到约 0.38 s。那次读数里手机报 `colo=HKG`，而产品的目标用户两端都在美国，且本机这条代理选择不随产品发布。
- `tpe01` 那一个 `530` 样本在 `hkg11` 上**没有**复现，用的还是同一条 quick tunnel、同样经代理建立的 edge 连接。因此「Worker 回源被硬锁在某个落点」这个判断不成立，本文不拿它当依据；至多只有一个样本点失败，构不成结论。它降级成一个未解释的残余，而这种残余在数据面不再包含 Worker 子请求之后已经无从产生。

## 提案

一个决定里包含两步结构改动：Worker 离开数据面，market Worker 只做中继的控制面。

数据面上，每个实例各得一条 Cloudflare 命名隧道，`<id>.dsh-market.com` 变成指向 `<tunnel-uuid>.cfargotunnel.com` 的精确代 proxied CNAME。边缘仍在与今天相同的主机名上终止手机的 TLS，并把请求直接交给实例的 `cloudflared` 连接器；不再有 Worker 路由、也不再有 Workers 自定义域匹配中继主机名，于是「数据面不过 Worker」是配置的性质，而不是代码路径的性质。

控制面上，market Worker 保留它已经有的 id/secret 登记表，并接管租约：创建（或找到）实例的隧道、写入隧道的 ingress 与 DNS 记录、下发按实例的隧道 token，并在实例退役时回收这两样。连接器这一半已经交付：[命名隧道模式](../../implemented/feature/2026-09-02-named-tunnel-mode.md) 已经让插件用环境变量里传的 token 跑 `cloudflared tunnel run`。变化的是「谁铸造隧道」和「固定主机名从哪来」，好让[固定域名中继](../../implemented/feature/2026-09-02-stable-hostname-relay.md)不再需要一层代理，同时保住它的稳定源。

## 上下文与效率影响

本文新增一份文档、不新增代码；它描述的实现在现有 `relay_registrations` 表后面加一个 D1 迁移、两个控制面端点，以及一个复用已交付 `RelayRegistrar` 退避与既有隧道管理器接缝的插件模式开关。

- 契约的 token 规模：claim 请求携带 id、secret、可选的 `new_secret`、本地回源端口与插件版本；响应携带 mode、隧道 id、主机名与 token。这个形状既不需要缓存也不需要落盘，所以读本文的上下文成本就是决定本身加它的代价，两者都在前三节。
- Schema 开销：行保留它已经存在的 id 与 secret 哈希，新增隧道 UUID、主机名、回源端口、最近登记时间与状态列；遗留的 target 列随 quick tunnel 路径一起消失。

## 域名与证书的选型

两个约束框住了 CNAME 能落在哪：通配 Worker 路由 `*.dsh-market.com/*` 在查 DNS 之前就截走任意 `<id>.dsh-market.com`，而 Universal SSL 只覆盖一级子域，更深的任何名字都要额外做证书工作。两条约束都是承重的，也都有文档。


| 选项 | 名字与证书 | 手机 origin | 迁移影响 | 代价 | 推翻条件 |
| --- | --- | --- | --- | --- | --- |
| A：中继主机用独立 zone | `<id>.dsh-relay.example`；新 zone 的 Universal SSL 免费覆盖一级 | 变化 | 每台已配对手机重新配对一次；新旧方案可并存，切换不需要采纳门槛 | 一次域名注册、第二个 zone 及其证书生命周期，以及品牌分裂 | 只有在域名成本或品牌分裂另有理由时才可接受 |
| B：market zone 下的两级名 | `<id>.relay.dsh-market.com`；需要 Advanced Certificate Manager 追加 `*.relay.dsh-market.com` | 变化 | 手机重新配对；而且仍然必须先收窄路由，因为通配路由跨点匹配 | 一个付费插件加逐级证书簿记，路由改动仍在关键路径上 | 只有该插件已经被付过费时才成立 |
| C：收窄路由、单级名、直连 CNAME（选定） | `<id>.dsh-market.com` 用 zone 现成的 Universal SSL 覆盖；零证书工作 | 不变 | 现有手机保住书签与 cookie 上下文、不需重配；弱点是仍跑旧插件的实例被一个原子步骤切断 | 一次 Worker 部署加删除一个通配自定义域；无新增周期成本 | 若活跃实例规模无法在一次已公告的窗口内迁完，而选项 A 买的正是这个余量 |
| D：Worker 留在数据面 | 不变 | 不变 | 无 | 保留额外一跳、每请求一次 D1 读与三方可用性耦合 | 只有可用性与每请求成本都不重要时才被推翻 |

支撑选项 C 的证据，逐条取自当前官方文档：

- full setup 下 Universal SSL 覆盖 zone 的根域与一级子域，更深的名字要 Total TLS 或 advanced certificate（[Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/)）。
- Total TLS 在这里不是逃生门：它为 proxied 主机名签发证书，但**排除**用在 Cloudflare Tunnel 上的主机名（[Total TLS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/total-tls/)）；隧道文档同样写明多级子域必须显式订购 advanced certificate（[创建远端管理的隧道](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)）。
- Advanced Certificate Manager 在所有套餐上都是付费插件，通配证书只覆盖一级，要覆盖多级得逐级加通配（[Advanced Certificate Manager](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/)）。
- 路由通配匹配零个或多个任意字符，而不是一段标签，所以 `*.dsh-market.com/*` 同样命中 `a.b.dsh-market.com/*`，且最具体模式胜出（[Workers 路由](https://developers.cloudflare.com/workers/configuration/routing/routes/)）。因此凡是继续用这个 zone 的选项都得先收窄路由，只有选项 A 不必。
- 精确 DNS 记录优先于通配记录，而 `*.dsh-market.com` 记录本身已覆盖多级（[通配 DNS 记录](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/)）；CNAME 目标必须是 `<UUID>.cfargotunnel.com`，且只代理同账户内的记录（[隧道 DNS 记录](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)）。

有一个子问题是被移除而不是被回答的。zone 上现在有一条 dashboard 创建的 `*.dsh-market.com` Workers 自定义域，而文档把自定义域描述为按注册主机名完全匹配、且不支持通配 DNS 记录作底（[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)）。文档没有承诺这种通配绑定与更精确 CNAME 之间的先后次序，所以选定方案不依赖它：删掉那条通配自定义域，让「没有路由匹配、只有一条精确 CNAME」成为全部解释。通配绑定能否保留下来给未知 id 出一个离线页，是实验里点名的开放问题，不是设计里的假设。

## 控制面契约

Worker 的端点留在 market 顶点（`https://dsh-market.com/api/relay/...`），那是一个 Workers 自定义域，因此永不依赖中继路由。

### 端点

| 端点 | 方法 | 请求 | 响应 | 副作用 |
| --- | --- | --- | --- | --- |
| `/api/relay/claim` | `PUT` | `id`、`secret`、可选 `new_secret`、`origin.port`、`plugin.version` | `mode`（`named` 或 `quick`）、`tunnel.id`、`tunnel.token`、`hostname`、`dns.target`；`bridge` 模式的租约应答既没有 `tunnel` 也没有 `dns` | 找到或创建名为 `dsh-relay-<id>` 的隧道、写 ingress、找到或创建 CNAME、upsert 行 |
| `/api/relay/release` | `POST` | `id`、`secret` | `ok` | 把行标为 released；隧道与 DNS 记录保留，以便重新启用是瞬时的 |
| `/api/relay/retire` | `POST` | `id`、`secret` | `ok` | 先删 DNS 记录、再删隧道、最后删行；这是唯一会移除源的路径 |

整条租约用 Worker secret 打 Cloudflare API：先 `PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations`，ingress 为 `[{ "hostname": "<id>.dsh-market.com", "service": "http://127.0.0.1:<port>" }, { "service": "http_status:404" }]`，再 `POST /zones/{zone_id}/dns_records` 写一条 proxied CNAME，最后 `GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token` 取 token；ingress 之所以在服务端，是因为用 token 运行的连接器属远端管理，且 catch-all ingress 规则是必需的（[创建远端管理的隧道](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)）。本地回源端口来自 claim 请求体，插件从 `ctx.webServer.port` 本来就知道它。

### 失败、重试与修复

- 鉴权与滥用控制沿用已交付的实现：secret 以 SHA-256 哈希做常量时间比较，首次 claim 必须带等于 `secret` 的 `new_secret`，按 IP 与按 id 的两个限流窗口与写入走同一个 D1 批次。
- `400 invalid-params`、`403 auth-failed`、`404 unknown-id`、`429 rate-limited` 的语义与今天一致；插件现成的封顶退避与在 `invalid-params` 上的一次性重认领原样沿用。
- `502 cf-api-unavailable` 是新错误，带 `retryAfterMs`；插件按网络故障处理，保持上一个连接器继续运行并退避重试。
- 每次隧道传输的 claim 在应答前按名字对三件套（隧道、ingress、记录）做一次收敛，所以中途死掉的 claim 会在下一次尝试上收敛，而不是留下半建的实例。
- `bridge` 模式的租约是例外，这条归[传输 v2 提案](2026-10-23-relay-bridge-transport.zh.md) 所有：它的数据面是实例自己的 Durable Object，因此它的 claim 在账户里不收敛任何东西——不建隧道、不写 ingress、不碰 CNAME、连 token 都不取——只回主机名与桥接授权。
- 在 quick tunnel 路径仍然保留的期间，claim 失败不是致命的：响应 mode 留在 `quick`，手机继续用登记表已经给它的源。

### 下线与回收

- 插件的下线动作（关设置开关、profile 卸载）调 `release`，绝不调 `retire`：主机名是手机的书签，只有当操作者说这个实例已经不存在时才移除源。
- 已在跑的每 30 分钟 cron 回收 90 天未见的行，与登记表今天的 TTL 相同；回收先删记录再删隧道，因此不存在「可解析的主机名指着一条死隧道」的窗口。
- `release` 之后的 `claim` 是正常重启路径，必须保持免费：不新建隧道、不新建记录、只取一次 token。

### Token 的爆炸半径

- Worker 的 Cloudflare API token 限定为 Account: Cloudflare Tunnel, Edit 加 Zone: DNS, Edit，且只限 `dsh-market.com`，存成 Worker secret，永不出现在插件、设置文档或进程列表里（[创建远端管理的隧道](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)）。
- 该 token 能创建和删除账户内所有隧道，所以账户的隧道命名空间专供这层中继使用，并且 token 按固定节奏轮换而不是永不轮换。
- 按实例的隧道 token 只能运行那一条隧道：泄漏让人可以顶替该主机名对外服务，但读不到实例、够不到别的实例、也写不了 DNS；token 只发给已经证明持有该 id secret 的调用方，且从不记日志（[隧道权限](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/)）。
- 例行 claim 永不轮换 token，因为刷新会让旧 token 无法建立新连接；轮换是一次明确的修复动作，而插件本来就把 token 走 `TUNNEL_TOKEN` 环境变量、不走 argv，因此它不会出现在进程列表里。

## 迁移路径

### 切换顺序

1. 附加式部署控制面，通配路由原样不动，并让每次 claim 应答 `mode: "quick"`，于是还没有任何实例移动。
2. 发布插件版本：每次隧道启动都认领一条命名隧道，并把该连接器与 quick 连接器并行跑起来；quick 连接器继续服务二维码里的源，命名连接器因为通配路由仍遮蔽它的 DNS 记录而处于空闲。
3. 用采纳率给切换设门槛：最近七天被看到过的每个 id 都必须已认领命名隧道，并至少上报过一次 edge 注册。
4. 用一次部署收窄路由，使任何模式都不再匹配中继主机名，并在同一次改动里删除 `*.dsh-market.com` Workers 自定义域。
5. 静默一个窗口后再删掉 quick tunnel 路径：登记器、`relay_registrations`、`relay.js` 里的代理分支，以及代理需要的 `--http-host-header` 接线。至此本文部分取代[固定域名中继](../../implemented/feature/2026-09-02-stable-hostname-relay.md)，后者为它记录过的决定保留理由。

### 断线窗口

第 2 步采纳过的实例是零：主机名没有变，命名连接器已经注册好，收窄路由只是移走一层遮蔽，手机的下一跳请求就落在连接器上。手机缓存的地址仍然有效，因为主机名在改动前后都解析到 Cloudflare 边缘。全局停摆只有一次 Worker 部署加一次自定义域删除。没采纳过的实例在第 4 步之后没有兜底页——主机名不再解析，手机需要从桌面重新扫一次二维码——这正是第 4 步以第 3 步为门槛的原因。

### 回滚

- 回滚由控制面驱动，不靠插件降级：`claim` 应答 `mode`，所以把它翻回 `quick` 就让每个实例在下次启动时回到 quick tunnel 与登记表，只要那条路径仍然保留。
- 恢复路由模式与通配自定义域会把 Worker 代理带回来，它需要的登记行在整个窗口里都还在，因为 `release` 从不删除它们。
- 两侧必须在一个窗口内一起动：只恢复路由会让已迁移的实例没有 quick 目标，代理对它们只会回离线页。

## 最小可验证实验

### 阶段 0：只读对照

这些探针在本文写出之前已经跑过，不需要改动任何资源。

| 探针 | 命令 | 读数 | 它判定了什么 |
| --- | --- | --- | --- |
| 合法格式但未登记的 id | `curl -s -o /dev/null -w '%{http_code}' https://<16-hex>.dsh-market.com/x` | `503`，正文是双语离线页，`x-robots-tag: noindex`，`cf-ray` 落在 SJC | 应答任意中继主机名的是通配路由，不是 DNS |
| 两级主机名过 TLS | `curl -sv https://x.y.dsh-market.com/` | `sslv3 alert handshake failure`，退出码 000 | Universal SSL 只覆盖一级 |
| 同一个两级名字过 DNS | DoH 查询 `name=x.y.dsh-market.com&type=A` | `Status 0`，两条边缘地址 | 深度限制在证书，不在 DNS |
| zone 的路由表 | `GET /zones/{zone_id}/workers/routes` | 一条模式，`*.dsh-market.com/*` | 一行配置就能是数据面依赖的全部 |
| 账户内的隧道 | `GET /accounts/{account_id}/cfd_tunnel` | 空列表 | 隧道命名空间未被占用，可以专供这层中继 |
| 操作者凭据能读到什么 | 用本机 wrangler OAuth token 打 `GET /zones/{zone_id}/dns_records` | `10000 Authentication error` | 控制面搭不上开发者凭据，必须用自己的限定 token |

### 阶段 1：在非生产 zone 上跑探针隧道

一次附加式账户写就能证明传输那一半，它不触碰任何 `dsh-market.com` 资源，也不触碰在跑的主机名。

- 建一条名为 `dsh-relay-probe` 的隧道，ingress 为 `http_status:404`，加一条 proxied CNAME `probe.<其它 zone>` 指向 `<uuid>.cfargotunnel.com`，并用该隧道 token 对着本机静态文件服务跑连接器。
- 预期读数：主机名送出本机文件，响应不带 `x-robots-tag`、不带 Worker 形状的响应头，连接器日志出现 `Registered tunnel connection`。
- 第二轮把连接器落到非 SJC 边缘时的预期读数：同样 `200`，ttfb 落在亚秒级，而这正是回源一跳还在路径里时中继做不出的读数。
- 收尾删掉 CNAME 与隧道，探针不留任何残留。

### 阶段 2：切换后的读数

在迁移第 4 步之后跑，用一个已采纳的实例和一台手机。

| 检查 | 命令 | 期望读数 | 失败意味着 |
| --- | --- | --- | --- |
| 没有模式能匹配中继主机 | `GET /zones/{zone_id}/workers/routes` | 没有 `*.dsh-market.com` 模式，也没有通配 Workers 自定义域 | 收窄没有生效 |
| 权威 DNS | DoH `type=CNAME name=<id>.dsh-market.com` | `<uuid>.cfargotunnel.com` | 记录缺失等于主机名不可解析 |
| 数据面不再租用 Worker | `curl -s -D - https://<id>.dsh-market.com/` | 实例自己的 `401` 正文，没有 `x-robots-tag`，`/assets/` 上没有 Worker 盖的 `cache-control` | 仍有 Worker 应答该主机名 |
| 残余的 `530` 无从复发 | 同一请求，此时连接器注册在 SJC 之外 | 实例自己的响应，而不是边缘错误页 | 说明回源子请求不是全部原因 |

## 需要批准的生产改动

1. 创建限定范围的 Cloudflare API token（Account: Cloudflare Tunnel, Edit；Zone: DNS, Edit，仅 `dsh-market.com`），并存成 Worker secret。
2. 附加式部署控制面，并把 `relay_registrations` 的行迁进租约表。
3. 在非生产 zone 上跑阶段 1 的探针隧道，跑完删除。
4. 删除 `*.dsh-market.com` Workers 自定义域。
5. 收窄 `routes`，使任何模式都不再匹配中继主机名，并让 market 顶点与遥测主机名留在各自的自定义域上。
6. 添加 zone Cache Rule，为中继主机名下带哈希的 `/assets/` 响应盖上浏览器 TTL，这正是今天由 Worker 代码盖章的那件事（[Browser Cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/)）。

## 备选方案

**中继主机用独立 zone（选项 A）**是最强的竞争者，输在手机的源上：它买到新旧方案并存、也完全消掉路由问题，但它改变每台已配对手机的源，而换源就是重新配对。它的 Universal SSL 覆盖免费、CNAME 机制完全相同，所以只要迁移里的采纳门槛不可达，这个选项就是文档化的升级路径。

**两级名加 Advanced Certificate Manager（选项 B）**被否，因为它为一个证书插件付钱却仍然消不掉路由：路由通配跨点匹配，所以路由照样要收窄，而收窄之后一级名字用 zone 现成的 Universal SSL 覆盖就能免费拿到。Total TLS 无法替代，因为它不为 Cloudflare Tunnel 的主机名签发证书。

**让 Worker 留在数据面（选项 D）**保住了所有能跑的东西、决定成本为零，但它把每请求一次 D1 读与一跳额外转发留在手机路径上，并让三个组件留在一个数据面的可用性链条里。它是本文的度量基线，不是活着的候选。

**插件原生的出站 WebSocket 隧道（Durable Objects）**能把 quick tunnel 与 Worker 同时移出数据面，仍然按中继记录的理由推迟：它要自己拥有一套隧道协议——鉴权、重连、分帧、背压——而命名隧道加 DNS 用一个被维护的连接器拿到了同样的结构性收益。

## 验收标准

- 中继主机名解析到 `<uuid>.cfargotunnel.com`，其响应带实例自己的响应头，绝不带 Worker 的离线页或它的 immutable 资产盖章。
- zone 的路由表里没有能匹配中继主机名的模式，且 zone 上不再有通配 Workers 自定义域。
- 改动前配对过的手机，改动后用同一个书签打开且不需要重新配对。
- 已 release 的实例保住主机名，已 retire 的实例同时失去记录与隧道，cron 回收 90 天空闲行后不留下可解析的主机名。
- 带哈希的 `/assets/` 响应在中继主机名下仍带一年浏览器缓存，来源换成 zone Cache Rule 而不是 Worker 代码。

## 风险

- 那个原子步骤是真的：从未采纳的实例在收窄路由时失去稳定主机名，它们的手机需要从桌面重新扫一次二维码。采纳门槛与发布说明是唯一缓解手段，而一个超出单窗口容量的用户规模会把选项 A 重新变成答案。
- Cloudflare API token 能创建和删除账户内所有隧道；Worker secret 泄漏就是账户级隧道灾难，只能靠专用隧道命名空间与轮换节奏收窄。
- 删除通配 Workers 自定义域会拿走双语离线页，已登记但停跑的实例从此显示 Cloudflare 自己的隧道故障页。
- 一个 profile 一条隧道意味着账户的隧道数与单机上的连接器数随采纳增长，而采纳窗口里每个实例要跑两个连接器。
- 收窄路由同时把 `tv.dsh-market.com` 交还给它自己的自定义域：今天这个主机名被通配路由接住，再经 `cloudflare.config.ts` 注释里那条 service binding 转发到 telemetry-view worker，所以收窄上线前要在它自己的绑定上把遥测面板重新验一遍。
- Worker 对 `<uuid>.cfargotunnel.com` 的子请求能否成功未经验证（阶段 1 要测）；若不能，回滚就无法只做一侧，两侧必须在同一个窗口内一起动。
