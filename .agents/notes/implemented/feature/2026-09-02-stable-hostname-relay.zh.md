# Agent Note: 固定域名中继——手机配对零配置跨重启

Status: implemented

## 问题

命名隧道模式（2026-09-02-named-tunnel-mode.zh.md）解决了重启抖动，但要求每个用户走完 Cloudflare 控制台流程——账号、隧道、主机名映射、令牌——违背产品需求：**用户零配置**。目标是一次配对，手机的书签与配对 Cookie 在每次 `dsh web` 重启后依然有效。快速隧道的临时主机名（每次启动重新铸造）让手机的访问源——连同其 Cookie 与 sessionStorage 上下文——随重启一起死亡；重开 service worker 此时回退到缓存的壳页面、身后没有存活的服务，呈现为白屏。

## 决策

- **dsh-market worker 增加中继注册表**：`PUT /api/relay/register` 把每个安装的 id 映射到实例当前的快速隧道地址；`POST /api/relay/unregister` 删除映射；通配子域名 `<id>.dsh-market.com` 向已注册目标反向代理（HTTP + WebSocket 透传；未知或过期 id 返回明确的双语离线页）。表 `relay_registrations` + `relay_rate_limit`（迁移 0007）；cron GC 清理过期行与旧限流窗口。
- **插件在自动隧道运行时自动注册**（中继默认开启）：每个 profile 首次运行铸造 id + 256 位密钥（`$DSH_HOME/remote-web-ui-registry/<profile>.json`，0600），并经既有的隧道 phase 监听器在每次隧道启动时重新上报当前地址——失败按上限退避重试，`invalid-params` 失败会重新认领一次 id（注册表行丢失）。二维码/公网基址优先使用固定源；注册失败期间回退裸快速隧道地址。与本机同网的手机随后由落地页移出该源：落地页探测对外广告的局域网字面量，无一应答时留在公网源（[2026-10-16-pairing-auto-lan-source.zh.md](2026-10-16-pairing-auto-lan-source.zh.md)）。开关关闭时销毁注册器并注销该行；进程退出与模式切换保留两者。
- **配置与界面**：`relay`（默认 true）在设置卡片呈现为「固定域名中继」；配对快照新增 `relay` 状态帧，面板据其渲染注册中/失败提示。命名隧道模式保持不变（自带域名的替代路径）。
- **滥用面**：密钥只存哈希（SHA-256）、目标限定 `*.trycloudflare.com`、注册按 IP 与 id 限流、行空闲 90 天 GC、所有中继响应 `noindex`。
- **带内容哈希的构建产物在本跳被永久缓存。** 隧道后的实例对 `/assets/**` 不发任何 `Cache-Control`、`ETag` 或 `Last-Modified`，而原样透传让手机手里没有任何可缓存依据：每次加载都重下整个外壳——实测每请求 237502 B、经中继 TTFB 1.3–2.3 秒、字节每次都完全相同。代理现在只对 `GET`/`HEAD` 且路径为 `/assets/` 下带内容哈希的构建产物的 200 响应盖上 `public, max-age=31536000, immutable`；其余路径（`/api/*`、文档、未哈希名、WebSocket 升级、非 200）一律保留源站自己的响应头。
- 让「纯字节转发代理」足够成立的结构性事实：手机从不面对 harness browser-auth——`/pair-app` 是插件精确路由，手机全部流量走门控 `/remote` 通道、由进程 inner 凭据回注到回环——所以中继只需搬运字节；Cookie 与 sessionStorage 按源隔离，而这个源永不变化。

## 测试

- `scripts/market-relay.test.mjs`：id 提取、铸造/刷新的密钥哈希认证、非法目标/密钥拒绝、代理的 Host 重写、只对带哈希资源生效的永久缓存（含嵌套 chunk 路径与非 200）、离线页、注销、按 id 限流、非中继流量隔离（10 个 node 测试）。
- `packages/dsh-remote-web-ui/tests/relay-registry.spec.ts`：身份文件构造/铸造/持久化/隔离、固定源形态、注册器 announce/刷新/退避/重新认领/销毁/注销（12 个 vitest 用例）。
- 插件全套 333 用例通过；`i18n:check`、`docs:check` 与包类型检查通过。线上验证（wrangler dev 注册 → 反代 → 配对往返；随后真实重启 + 手机验证）是交付门槛。

## 备选方案

- **命名隧道作为默认**（2026-09-02-named-tunnel-mode.zh.md）：因控制台配置违背零配置而被否决为默认；保留为自带域名路径，互相交叉引用。
- **302 跳转而非代理**：Cookie 仍落在每次变化的域名上，重新配对无法避免；固定源必须代理。
- **两级中继主机名**（`*.t.dsh-market.com`）：先部署后放弃——Universal SSL 只覆盖一层子域，两级中继主机名拿不到证书、在边缘直接 TLS 握手失败；单层 `<id>.dsh-market.com` 被现有证书直接覆盖。
- **路径前缀源**（`dsh-market.com/r/<id>/`）：官方 shell 引用绝对路径会逃出前缀；子域名保持根路径语义。
- **自托管非 CF 中继**（VPS 上的 frp/rathole）：真实基础设施与 TLS 运维成本，没有用户可见收益；在 market 已驻留 Cloudflare 的前提下否决。
- **插件内建出站 WebSocket 隧道**（Durable Objects 中继）：彻底摆脱 trycloudflare 依赖，但要自持一套隧道协议（认证、重连、分帧、背压）；待 trycloudflare 服务条款姿态变化后再议。

## 后果

- 手机重启默认无感；代价是多一跳由包作者运营的边缘（已在 README 安全模型披露——与终结快速隧道 TLS 的是同一条边缘）。
- 部署需要通配主机名绑定齐全，中继才能生效：zone 路由（见下）加上持有通配 DNS 记录的 `*.dsh-market.com` Workers 自定义域；两者齐备前插件退化为今天的裸快速隧道行为。
- 一台主机上的多个 profile 各自拥有身份与子域名；限流与 TTL 约束滥用；代理唯一的存储成本是每请求一次 D1 读。
- 永久缓存只在客户端生效：边缘对这些响应仍返回 `cf-cache-status: DYNAMIC`，所以设备首次加载仍要付完整隧道成本，收益从第二次开始。要让边缘也缓存，需要 `ctx.waitUntil` 加 Cache API，此处有意不做。

## 生产事故（2026-09-02 晚间）：路由模式只匹配了根路径

重启后第一次真实配对，手机落在 Cloudflare 522 上。根因：zone 路由模式 `*.dsh-market.com` 缺少路径部分，而 Workers 路由模式不带路径组件时**只匹配根路径**——中继主机上的所有非根请求（`/pair-app`、`/api/*`、`/remote`、一切）从未到达 worker，直接回落到 DNS 源站：手动 `*` A 记录指向 192.0.2.1（慢 522，约 19 秒连接超时），后来是 CF 托管的自定义域占位源（快 522，约 0.25 秒）。而中继的第一条手机请求就是非根路径，所以该功能在其目标流程上从未工作过，与此同时所有根路径探测全部成功。

误读持续了数小时，因为根路径与非根路径探测交替出现：成功全是根路径、失败全是非根路径，呈现为分钟级「边缘震荡」。期间逐一排除：DNS（权威 DoH）、隧道健康（直连探测）、worker 是否被调用、D1 行、响应缓存（全新路径 + `cache-control: no-cache`）、子请求形态。决定性工具是**无注册行的合法 id**：503 离线页是 worker 的签名响应，而非根路径上它变成了 522——worker 根本没被调用。教训：一次只探测一个变量；判断「worker 是否被调用」要看 worker 生成的响应（离线页、真实鉴权页响应体），而不是「有响应就行」。

一并落地的修复：

- 路由模式改为 `*.dsh-market.com/*`（`/*` 对非根路径是必需的；已写进配置注释强制提醒）。
- 通配 DNS 从手动 `*` A 记录迁移为控制台创建的 `*.dsh-market.com` Workers 自定义域，由 CF 托管记录，不再存在占位源。
- `wrangler.jsonc` 只声明 zone 路由、永不声明 `custom_domain`：wrangler（截至 4.128）在本地校验就拒绝通配自定义域，而任何部署只要声明了一个 `custom_domain` 路由就会 PUT 全量替换该 worker 的整个域清单（wrangler 源码 `publishCustomDomains` → `PUT /domains/records` 已核实）——静默摘除控制台创建的域，诊断期间真实发生过一次。部署对这种摘除不打印任何警告；每次路由或域变更后，用 DoH 查询一个全新子域来确认域仍然存活。

同一晚的第二层：路由修复后，手机的二维码落地页返回插件的纯文本 `forbidden`（403）而不是配对页。根因：**Workers `fetch` 强制把源站侧的 Host 头改为 URL 权威**——`host` 是 Request 构造时就被剥离的禁止头，中继子请求永远无法向隧道后的实例呈现中继源主机名，源站看到的始终是隧道主机名。服务端有两处按 Host 绑定的检查因此全部失败：插件的手机侧围栏信任配置的公网主机（`publicBaseUrl` = 中继源），harness 浏览器鉴权把 Cookie 绑定到 Host 权威（手机的 Cookie 罐按它导航的中继源隔离）。旧的直连隧道流程之所以能工作，只是因为当时 `publicBaseUrl` 本来就是隧道地址。修复：插件在连接器侧盖章稳定源——quick 目标携带 `originHostHeader`（由注册器的稳定基址接线），工厂给 cloudflared 加 `--http-host-header`，本地服务器在所有请求（HTTP 与 WebSocket）上看到中继源。目标身份变化也会让运行中的隧道在中继开关切换时重启（manager 的目标幂等检查）。教训：在按 Host 绑定的应用状态前做反向代理，必须端到端保证 Host；Workers 的代理层做不到，只能由连接器负责。
