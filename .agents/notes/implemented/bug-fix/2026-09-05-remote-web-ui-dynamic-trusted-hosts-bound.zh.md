# Agent Note: remote-web-ui 动态信任主机表保持有界

Status: implemented

## Problem

Docker/反向代理配对改造([docker 配对适配](2026-09-04-remote-web-ui-docker-pairing-adaptation.md))在 `makeRoutes` 中引入的 `dynamicTrustedHosts` 是一个进程生命周期的 `Set<string>`,有三个插入点,既无淘汰也无上限。该表的数据来自调用方可控的 `Host` 头:任何满足 `isPrivateOrLocalHostname`(全部 RFC 1918 IPv4 字面量、IPv6 ULA/链路本地前缀、`*.local`/`*.lan`/`*.internal`/`*.home.arpa` 域名)且携带有效设备凭证(`isPairedDeviceRequest`/`hasDevice`,或在 accept 路径上持有一一次性令牌)的请求都会把该权限永久加入集合。因此,持有任一有效设备 id 的调用方可以用互不相同的私网 Host 头发起连续请求,让集合无界增长。

代价有两个。内存:常驻守护进程里出现无界结构。手机侧热路径的 CPU:每次 `lanFence` 都会把整个集合展开成新数组,`isTrustedApiRequest`/`isTrustedHost` 内的 Host 校验对每个条目、每个请求各做一次 `new URL()` 解析,每多一个条目就给后续所有被门控请求加一次税。

## Decision

`dynamicTrustedHosts` 现在通过导出的纯函数 `addBounded(set, value, max)` 与 `MAX_DYNAMIC_TRUSTED_HOSTS = 64` 保持有界:重复插入是空操作;越过上限时,先按 Set 的插入顺序淘汰最老条目,再插入新值。`makeRoutes` 中原来的三处 `.add()`(`lanFence` 的 cookie 路径、POST accept 路径、`/pair-accept` 页面路径)全部改走该辅助函数。

合法流程的行为不变。表被占满只会淘汰过期的权限;cookie 设备的主机被淘汰后,会在下一次被门控请求中经由创建该条目的同一个 `lanFence` 回退分支自动重新加入;无 cookie 流程则经 `/pair-accept` 重新配对,该路径自带私网 LAN 回退。每个请求的信任语义不变——上限只约束这张备忘表,本身既不授予也不撤销信任。

## Testing

- `tests/routes.spec.ts` 为 `addBounded` 新增单元测试:插入顺序、重复插入幂等、达上限时最老条目先被淘汰,以及 `4 x MAX_DYNAMIC_TRUSTED_HOSTS` 个不同主机的洪泛后集合恰好剩 `MAX_DYNAMIC_TRUSTED_HOSTS` 个条目,首个主机被淘汰、最后一个在表中。
- 既有路由族测试(`routes.spec.ts`、`docker-pairing.spec.ts`、`remote-api.spec.ts`、`remote-upgrade.spec.ts`)覆盖三个调用点的接线,行为不变地通过。

## Alternatives considered

- 按时间过期(仿照 `acceptAttempts` 的窗口清理):否决——基于时间的表需要定时清扫和一个调参旋钮,而这张缓存表的条目本就自愈;上限加 FIFO 在不引入定时器、不产生可调错策略的情况下达到同样的有界目标。
- 取消动态表,每个请求仅凭 cookie 重新推导信任:否决——无 cookie 移动流程(`/pair-app` 上的一次性 `?grant=` 落地页,本记录撰写时是 `?device=`,见[一次性落地授权](../../architecture/2026-09-21-remote-one-time-landing-grant.zh.md))与反向代理拓扑依赖被记住的权限在 `/pair-accept` 之后通过 `lanFence`;移除该表会破坏 [docker 配对适配](2026-09-04-remote-web-ui-docker-pairing-adaptation.md)交付的流程。
- 只对配置过的 `trustedHosts` 校验动态条目:否决——这张表恰恰是为配置不知道的权限而存在(容器桥接 IP、轮换的代理主机)。

## Consequences

插件的手机侧 fence 不再增长一张可被攻击者影响的表:最坏情况是固定的 64 个条目和每次被门控请求至多 64 次 URL 解析。恶意配对设备可以通过洪泛挤掉合法权限,但对携带 cookie 的设备只是一次请求的自愈,对无 cookie 设备是一次重新配对——两种情况都不产生访问升级,且洪泛本身已经需要有效设备凭证。
