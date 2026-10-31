# Agent Note: 远程桥接接管接入栈并从聚合包退役 remote-web-ui

Status: implemented

## Problem

dsh-web 家族的远程访问能力原本分散在两个包中：`packages/dsh-remote-web-ui`（基于配对 cookie 门控、`/api/pair` 路由族、`/remote` 代理通道与手机竖屏 CSS/DOM 适配层的浏览器 Web GUI 镜像）与 `packages/dsh-remote-bridge`（面向原生客户端的 `/ios/v1` 协议 v1 WebSocket 适配）。然而，底层的网络接入基建——中继身份登记（`relay-registry`）、租约申领与释放控制（`relay-control`）、快速/命名双隧道连接器（`relay-connector`）、Durable Object 会合点连接器（`relay-bridge-connector`）、cloudflared 进程生命周期（`tunnel`、`tunnel-plan`、`tunnel-orphan`）、命名隧道端口同步（`ingress-sync`）以及局域网边缘转发（`lan`、`lan-bind`、`lan-forward`、`firewall`、`host-bind-capability`）——此前全部留在 `dsh-remote-web-ui` 中。

这种结构分裂带来了显著问题：
1. 原生客户端与远程桥接依赖浏览器镜像插件提供的底层网络基建，导致桥接无法作为自包含的远程接入栈独立工作。
2. `dsh-remote-web-ui` 的浏览器镜像模式伴随着严重的安全暴露（从属设备持有完全控制 cookie 凭据）与维护负担（`mobile-adapt.ts` 中的 DOM 选择器频繁随官方 DSH 升级而漂移），而协议 v1 提供了类型完备且基于硬件安全密钥（P-256）的 RPC/订阅流式交互。
3. 若立即从仓库中物理删除 `dsh-remote-web-ui`，老用户 profile 的 `cordis.patch.yml` 中残留的 `@linxin666/dsh-web-all/remote-web-ui` 行会导致模块导入硬报错；若直接重命名磁盘上的中继身份目录，已配对设备的连续性将被打断。

## Decision

接入栈完整迁入 `packages/dsh-remote-bridge`，同时将 `dsh-remote-web-ui` 从家族聚合包中退役：

- **接入栈归属迁移**：`relay-registry`、`relay-control`、`relay-connector`、`relay-bridge-connector`、`tunnel`、`tunnel-plan`、`tunnel-orphan`、`ingress-sync`、`lan`、`lan-bind`、`lan-bind-plan`、`lan-forward`、`firewall` 与 `host-bind-capability` 均迁入 `packages/dsh-remote-bridge/src/host/`。桥接在进程内自行管理公网与局域网连通性。
- **入站网关将暴露面严格收敛至 `/ios/v1`**：新增独立入站网关（`src/host/ingress-gate.ts`），严格仅绑定 `127.0.0.1`。该网关仅将目标为 `/ios/v1` 的 WebSocket 升级转发到本机协议端口（并将 `Host` 头改写为回环权威）；其余普通 HTTP 请求与非白名单升级一律直接返回 `404 {"error":"not-found"}` 并关闭连接，绝不向宿主建立上游连接。cloudflared 快速隧道与命名隧道均指向 `ingress-gate` 的动态回环端口（绝不直连 `webServer` 端口），局域网转发器同样指向该闸门端口。`relay-bridge-connector.ts` 对 Durable Object 汇聚流执行完全相同的 `/ios/v1` 白名单检查。所有公网与局域网入口的外露攻击面被彻底约束在 `/ios/v1` 协议以内。
- **下线浏览器配对面与手机触控适配**：原 `dsh-remote-web-ui` 的配对 cookie 门控、`/api/pair` 路由族、`/remote` 代理通道以及手机竖屏触控适配层不再搬入 `dsh-remote-bridge`。桥接在 Web GUI 中的面板仅作为原生 App 配对码的纯展示层。
- **通过 tombstone 与 `retiredPlugins` 实现平滑退役**：从 `packages/dsh-web-all/aggregate.yml` 的 `deps` 与 `patchFrom` 中移除 `packages/dsh-remote-web-ui`，聚合包不再挂载 `web-ui-remote-web-ui` 行。为了防止老 profile 加载时因缺失子路径导出而触发 `ERR_PACKAGE_PATH_NOT_EXPORTED` 导致宿主启动崩溃，聚合包保留指向故障隔离壳的 `tombstone` 导出，并在 `retiredPlugins` 中登记 `remote-web-ui`。壳读取该登记并将该行作为静默 no-op 处理（不 import、不记 degraded）。该包目录在过渡期内保留供独立安装，计划在下一版本中彻底删除。
- **身份目录与状态文件沿用历史拼写**：中继身份保持持久化在 `$DSH_HOME/remote-web-ui-registry/<profile>.json`，桥接连接器状态保持在 `remote-web-ui-relay-bridge.json`。沿用历史拼写避免破坏身份连续性，确保已配对设备升级后无需重新配对。
- **配置与公网地址裁定**：配置默认值为 `relay: true`、`autoTunnel: false`、`lanBind: undefined`（关），通过 profile YAML 声明，不提供设置 UI。快速隧道 running 时 announcer 会把闸门 URL 注册给中继 Worker；改配置重挂载时，若以 `relay=false` 挂载且盘上已有身份，则撤销上一次留下的注册行并调用 `pair.release()` 释放租约各一次（`relay=false` 绝不铸造新身份，盘上无身份时零副作用、不写盘；卸载时不释放也不撤行，保留手机收藏地址由服务端 GC 回收）；状态文件 `remote-web-ui-relay-bridge.json` 的写入经行为级验证（缺省落到 `$DSH_HOME`，非纯源码文本断言）。公网地址由 `livePublicOriginOf` 裁定（bridge/named 租约优先稳定子域名，quick 租约在注册未成功时退回隧道 running URL），其后退回 `DSH_REMOTE_PUBLIC_BASE_URL`，局域网兜底仅当局域网转发器真正处于监听状态时才按实际绑定的 address 与 port 给出（不猜候选列表首项，转发器停止即无兜底；彻底移除磁盘 registry 行作为兜底地址的逻辑）。

## Alternatives considered

- **将接入栈保留在 `dsh-remote-web-ui` 中并让 `dsh-remote-bridge` 依赖它。** 否决：这会导致桥接永久耦合于一个已废弃的包，聚合包无法剔除旧依赖，违背单一职责与架构解耦原则。
- **将浏览器 cookie 门控与手机触控适配层搬入 `dsh-remote-bridge`。** 否决：浏览器 Web GUI 镜像已被原生协议 v1 路线正式替代。搬入基于 cookie 的完全控制凭据会显著扩大桥接的安全风险，而保留 `mobile-adapt.ts` 会继续带来脆弱的 DOM 维护负担。
- **让隧道直接指向 webServer 端口而非通过 `ingress-gate`。** 否决：将公网隧道直接对准 webServer 会将宿主的所有路由、插件 HTTP 端点与内部控制面暴露给公网。通过纯回环的 `ingress-gate` 白名单转发，可确保非白名单请求连上游连接都不会建立。
- **直接在 `packages/dsh-web-all/package.json` 中删除 `./remote-web-ui` 子路径导出。** 否决：DSH loader 在启动时对条目实行事务性审计，子路径无法解析会导致未捕获的导入失败，造成聚合包回滚并导致整个 `dsh web` 宿主崩溃退出。tombstone 配合 `retiredPlugins` 是保障用户 profile 平滑升级的必要设计。
- **将 `$DSH_HOME/remote-web-ui-registry/` 重命名为 `$DSH_HOME/remote-bridge-registry/`。** 否决：改名会导致既有中继 id 与 secret 丢失，使已配对手机的书签与连接地址立即失效，迫使用户手动重新配对。
- **曾考虑把「磁盘身份文件中的稳定子域名」作为兜底地址来源。** 否决：身份文件只证明本机曾铸造过 id，无法证明 Worker 端子域名当前实际指向本机且可达；在 quick 注册尚未成功、租约 claim 失败或 relay 已关闭的情况下，读文件会导致二维码给出不可达的离线地址，且由于它排在局域网之前，会导致 LAN 兜底永远无法生效。该来源已被彻底删除，同时也消除了对老插件数据文件的最后一处依赖。同时否决了「用局域网候选 IP 列表中的第一个地址作兜底」：猜出来的 IP 背后可能根本没有监听者，改为严格仅当局域网转发器实际处于 listening 状态时才给出真实绑定的地址与端口。

## Consequences

- `@linxin666/dsh-remote-bridge` 拥有独立完备的公网与局域网接入能力，不再依赖 `dsh-remote-web-ui`。
- 所有公网入口（快速隧道、命名隧道、中继桥）与局域网转发均严格限定在 `/ios/v1` 路径；普通 HTTP 请求与非协议 upgrade 在入站网关层即被拦截拒绝。
- 包含旧版 `remote-web-ui` 行的既有 profile 可以平滑启动且无报错，新安装不再引入已退役的包。
- 独立安装 `@linxin666/dsh-remote-web-ui` 的用户在过渡期内仍可独立使用，但该包已退出全家桶聚合并进入删除倒计时。
- 全仓文档、清单与 AGENTS 规则统一更新，准确反映新架构分工。
- 彻底切断了对老插件目录文件的最后一处运行时依赖：配对地址完全由真实运行状态（realtime）、环境变量与局域网字面量决定，不再读取磁盘历史注册行。
- **已知风险与接受理由**：同一 profile 中若同时安装已弃用的 `dsh-remote-web-ui` 且开启其中继，当新桥以 `relay=false` 挂载时会主动撤销共用身份文件的注册行并释放租约，打断老插件中继；若两侧 relay 同时开启则会产生连接竞争或注册覆盖。该风险被接受的理由是：老插件已正式弃用并移出聚合包，文档已明确要求同一 profile 不得并存启用两端中继；替代方案「按插件拆分独立身份目录」会在过渡期内制造两套不同的稳定子域名，迫使用户在迁移时重新配对所有移动设备，增加的复杂度远大于收益。
