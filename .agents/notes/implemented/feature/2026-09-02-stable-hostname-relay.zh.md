# Agent Note: 固定域名中继——手机配对零配置跨重启

Status: implemented

## 问题

命名隧道模式（2026-09-02-named-tunnel-mode.zh.md）解决了重启抖动，但要求每个用户走完 Cloudflare 控制台流程——账号、隧道、主机名映射、令牌——违背产品需求：**用户零配置**。目标是一次配对，手机的书签与配对 Cookie 在每次 `dsh web` 重启后依然有效。快速隧道的临时主机名（每次启动重新铸造）让手机的访问源——连同其 Cookie 与 sessionStorage 上下文——随重启一起死亡；重开 service worker 此时回退到缓存的壳页面、身后没有存活的服务，呈现为白屏。

## 决策

- **dsh-market worker 增加中继注册表**：`PUT /api/relay/register` 把每个安装的 id 映射到实例当前的快速隧道地址；`POST /api/relay/unregister` 删除映射；通配子域名 `<id>.dsh-market.com` 向已注册目标反向代理（HTTP + WebSocket 透传；未知或过期 id 返回明确的双语离线页）。表 `relay_registrations` + `relay_rate_limit`（迁移 0007）；cron GC 清理过期行与旧限流窗口。
- **插件在自动隧道运行时自动注册**（中继默认开启）：每个 profile 首次运行铸造 id + 256 位密钥（`$DSH_HOME/remote-web-ui-registry/<profile>.json`，0600），并经既有的隧道 phase 监听器在每次隧道启动时重新上报当前地址——失败按上限退避重试，`invalid-params` 失败会重新认领一次 id（注册表行丢失）。二维码/公网基址优先使用固定源；注册失败期间回退裸快速隧道地址。开关关闭时销毁注册器并注销该行；进程退出与模式切换保留两者。
- **配置与界面**：`relay`（默认 true）在设置卡片呈现为「固定域名中继」；配对快照新增 `relay` 状态帧，面板据其渲染注册中/失败提示。命名隧道模式保持不变（自带域名的替代路径）。
- **滥用面**：密钥只存哈希（SHA-256）、目标限定 `*.trycloudflare.com`、注册按 IP 与 id 限流、行空闲 90 天 GC、所有中继响应 `noindex`。
- 让「纯字节转发代理」足够成立的结构性事实：手机从不面对 harness browser-auth——`/pair-app` 是插件精确路由，手机全部流量走门控 `/remote` 通道、由进程 inner 凭据回注到回环——所以中继只需搬运字节；Cookie 与 sessionStorage 按源隔离，而这个源永不变化。

## 测试

- `scripts/market-relay.test.mjs`：id 提取、铸造/刷新的密钥哈希认证、非法目标/密钥拒绝、代理的 Host 重写、离线页、注销、按 id 限流、非中继流量隔离（8 个 node 测试）。
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
- 部署需要 worker 路由外加 `*.dsh-market.com` 的通配 DNS 记录，中继才能生效；在此之前插件退化为今天的裸快速隧道行为。
- 一台主机上的多个 profile 各自拥有身份与子域名；限流与 TTL 约束滥用；代理唯一的存储成本是每请求一次 D1 读。
