# Agent Note: 远程应用落地页携带一次性授权，host 模式由服务器授予

Status: implemented

## Problem

配对设备路径上有两处凭据的处理比参考实现更弱。

`/pair-accept` → `/pair-app` 重定向把刚铸造的**设备 ID**放在查询串里
（`/pair-app?device=<id>`）。设备 ID 是活的会话凭据：`pairedDeviceIdOf` 以它授权
每一个被门控的 `/remote` 请求，而它对应的 cookie 有效期为一年。把它放进 URL 就等于
发布到浏览器历史、地址栏，以及重定向路径上的每一份日志——而这正是通道门所信任的值。

host 模式是按源自称的。解析期 boot 补丁在每个非回环源上安装
`__DSH_TRANSPORT__ = { ownsHost: true }`，于是任何在非回环 authority 上到达浏览器的
应用壳都会呈现官方 UI 的完整配置面。配对门仍然拒绝调用，但这一特权呈现是客户端声明，
而非服务器签发的授权——而在 `/api` 围栏被打开的部署上（即姿态探测报告的状态），
应用壳根本无需配对即可到达。

## Decision

- **落地页 URL 携带一次性授权。** `src/pair-grant.ts` 移植参考实现的一次性能力语义
  （zcode `packages/server/src/hostCapability.ts`）：256 位 base64url 熵、60 秒 TTL、
  有界表（`MAX_LIVE_GRANTS = 256`，最老条目先淘汰），以及「尝试即删除」的消费语义——
  记录在校验之前就被移除，因此重放永远解析不出结果，过期授权也不会滞留。
  `/pair-accept` 签发一张绑定新设备会话的授权并 303 到 `/pair-app?grant=<g>`；
  落地页消费它，并在自己的响应中（它注入的捕获脚本）把设备 ID 交给应用壳。落地页上的
  `?device=` 已退役；WebSocket 的 `device` 查询参数（`REMOTE_DEVICE_QUERY`）是另一种
  传输，保持不变。
- **host 模式由服务器授予。** 设备门控落地页注入的捕获脚本会发布
  `__DSH_REMOTE_HOST_GRANT__`，boot 补丁只有在读到该标记时才安装传输钩子。
  `patchAppShell` 因此把捕获脚本插到开头 `<head>` 标签之后——位于 harness 注入的
  boot 补丁之前——而不是插在 `</head>` 之前。交付给未配对浏览器的应用壳永远不带该标记，
  因而保持官方 UI 的 memory 作用域呈现。
- **配对 cookie 在 TLS 下带 `Secure`。** 当请求经 TLS 到达时（`x-forwarded-proto:
  https`，也就是 `appOrigin` 已经信任的同一信号），`deviceCookie` 会加上 `Secure`；
  明文 HTTP 局域网下不加——在那里 Secure cookie 会被浏览器直接丢弃，手机会静默丢失会话。

## Testing

- `tests/pair-grant.spec.ts`（8 个测试）在注入时钟上钉住一次性语义：单次消费、拒绝重放、
  TTL 边界、未知/空授权、不消费的 `peek`、签发时的过期清理、FIFO 上限，以及默认熵形状。
- `tests/routes.spec.ts` 覆盖重定向、一次性落地页（重放授权得到重扫页）、退役的
  `?device=` 查询、捕获脚本与 boot 补丁的顺序，以及带/不带 Secure 的 cookie 组合。
- `tests/docker-pairing.spec.ts` 与 `tests/remote-channel-boot.spec.ts` 跟随新契约；
  boot 补丁新增明确的反例（无标记即无 `ownsHost`）。

## Alternatives considered

- 保留 `?device=` 并与授权并存：否决——在 URL 里接受设备 ID 就等于保留泄漏面，而捕获脚本
  本来就把设备 ID 交给应用壳，查询参数并无必要。
- 让授权跨页面刷新存活（会话级凭据）：否决——那是设备 cookie 的职责；授权存在的唯一目的是
  把凭据挡在 URL 之外，而重开由 service worker 网络优先导航携带的 cookie 承担。
- 对 WebSocket 升级也使用一次性能力：否决——WS URL 在每次重连时被复用，客户端无法在
  `WebSocket` 构造函数里同步铸造新授权；那里的传输凭据仍是设备 cookie/查询参数。
- 在启动时用一次服务器往返来决定 host 模式：否决——boot 补丁必须在连接插件读取
  `__DSH_TRANSPORT__` 之前同步决定，而落地页自身的响应已经是服务器的授权。

## Consequences

- 泄漏的落地页 URL 只值 60 秒内的一次消费，之后毫无价值；会话凭据不再出现在配对路径上的
  任何 URL 中。
- `/pair-app` 契约发生变化：升级期间处于流程中的手机，或收藏的落地页 URL，必须重新扫码。
  落地页会立刻用 `history.replaceState` 替换自身 URL，因此没有任何用户可见的收藏依赖它。
- host 模式现在依赖落地页的响应。受支持的入口——首次扫码、service worker 重开、隧道重开——
  都经过 `/pair-app`；若配对设备以其他路径加载 harness 应用壳，则保持 memory 作用域呈现，
  直到它经落地页重新进入。
- `device` 查询参数仍保留在 WebSocket 升级上，在那里仍是 URL 承载的凭据；该传输无法携带
  Web API 的请求头，而只要浏览器存储 cookie，配对 cookie 就仍是主凭据。
