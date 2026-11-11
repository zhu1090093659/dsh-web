# Agent Note: 任务看板桥接 Host connection 认证

Status: implemented

## Problem

经反向代理、Kubernetes Ingress 或 Tailscale 提供服务的 dsh 部署，以一个可信 Host 权威访问 GUI：运维用 `dsh web --host <lan-ip> --trusted-host dsh.example.internal` 启动，TLS 在边缘终结，Host 的 `connection` 服务用它的 Host/Origin 围栏和与 authority 绑定、HMAC 签名的 `dsh-auth-*` 浏览器会话认证每个 `/api` 请求。GUI 的其余部分正常工作，任务看板不正常：`GET /api/task-board/state` 返回 403，因为 `isTrustedTaskBoardRequest` 用 `isLoopbackAddress(req.socket.remoteAddress)` 围栏所有路由，而反代或 Ingress 呈现的是网关或容器地址，永远不是 `127.0.0.1`。

看板已经有两条反代路径，但都不适合这个部署。`trustedProxyHosts` 要求运维的代理注入一个看板专用的服务端 token，托管 Ingress 没有地方设置它；`trustForwardedProxy`（#1918）只放行落在本机回环上游的被转发请求，并且是一个默认关闭的开关。一个 Host 已经用自己签发的会话认证浏览器的部署，仍被要求为单个插件再配置一条更弱的信任路径。

这就是 issue [#1930](https://github.com/zhu1090093659/dsh-web/issues/1930) 的报告。它与[带转发头的反代请求一律判为远程](2026-10-19-reverse-proxy-loopback-fence.md)相邻，后者拥有共享回环围栏与看板的转发代理开关；那条围栏保持发布时的原样。

## Decision

- 看板在请求到达时通过 `resolveConnectionTrust`（`packages/dsh-task-board/src/index.ts`）解析 composition 可选的 `connection` 服务，并把读取器交给路由访问面（`connection?: () => TaskBoardConnectionTrust | undefined`）。它像可选 agent 工具注册表那样按需解析，而不是加进 `inject`：不提供 connection 的 composition 仍必须能挂载整个看板。
- 在 `isTrustedTaskBoardRequest`（`packages/dsh-task-board/src/host-routes.ts`）的最前面，已挂载的 connection 服务若对 `requestRejection(req)` 返回 `undefined`，请求直接放行。该判定已经覆盖看板本来要自己做的事：Host 围栏（回环、监听器的绑定字面量或配置的 `trustedHosts`）、Origin 相等检查、对显式 `sec-fetch-site: cross-site` 的拒绝，以及用 Host 持久化的密钥校验签名浏览器会话。看板不再重复其中任何一项。
- 既有围栏保持为回退路径，内容与顺序都不变：浏览器同源标记、`isLoopbackRequest`、回环套接字加白名单 Host 加服务端 token 的路径，以及默认关闭的转发代理路径。因此 connection 服务拒绝请求、缺席、或在路由注册之后才挂载，都不会构成新的拒绝：服务不去认证的直连回环客户端，仍和以前一样能到达看板。
- 服务面以 `TaskBoardConnectionTrust` 结构化声明，与官方 open-in-app 路由消费的形状一致，因此 Host 半区不会 value import 浏览器侧的 connection 包。即使服务会答 401，看板仍只保留一种拒绝状态（403）：这个差别不改变请求能否到达看板，浏览器半区本来就把一次围栏拒绝映射为它唯一的那条认证提示。
- 不新增配置键。只要 Host 提供该服务，桥接就生效，因为运维的信任决定已经由 `--trusted-host`/`trustedHosts` 做出，浏览器会话也由同一个 Host 签发。配置之外的第三方代理仍过不了服务自己的围栏，并继续回退到看板的围栏。

## Alternatives considered

把 `connection` 加进插件必需的 `inject` 被否决：看板会被不提供 connection 服务的 composition 挂载，必需注入会把那里一个能用的看板变成挂载不上的看板。

用 connection 判定取代看板围栏被否决：直连回环访问、认证 token 代理路径、转发代理路径，以及每一个在不带 Host 上下文的测试或嵌入里挂载路由的场景，都必须保持原有行为；桥接必须是额外的放行路径，而不是新的权威。

传递服务的 401 被否决，理由是它没有访问后果：本仓每个路由族只答一种拒绝状态，浏览器面板把该拒绝映射为同一条认证提示。把 401 与 403 分开，只会让看板的响应取决于两个围栏中哪一个拒绝了请求，却不给调用方任何可行动的信息。

只相信 `dsh-auth-*` cookie 的存在（既有浏览器标记）被否决：该标记是「存在一个浏览器形态客户端」的信号，不是「Host 签发了该会话」的证明。校验签名与 authority 正是 connection 服务提供的，所以看板去问它，而不是自己读请求头。

要求运维把看板加进另一份白名单或再注入一个 token 被否决：Ingress 已经确立了身份，在这里复制一遍正是 issue 报告的配置负担。

## Consequences

- 由 DSH 自己服务的反代、Ingress 或可信隧道部署，无需任何看板侧配置即可到达全部看板路由（state、action、events、parse、model-catalog、attachments）；守卫由它们共用。
- Host 的 connection 服务不去认证的调用者得不到任何好处：服务拒绝它，看板的回退路径仍会拒绝非回环代理权威，除非显式 token 或转发代理 opt-in 适用。跨站提交在看板看到之前就被服务拒绝。
- 不提供 connection 服务的 composition，以及每一个被服务拒绝的直连回环客户端，都保持既有判定；桥接从不撤销看板原本给出的任何放行。
- 转发代理开关与 token 白名单保持它们已记录的含义，仍是 Host 自己不认证的代理所走的路径。

## Testing

- `packages/dsh-task-board/tests/connection-auth-bridge.spec.ts`（7 项）在真实回环监听器上跑真实路由族，并把套接字对端覆盖为网关地址。它钉住：被接受的 connection 会话放行 state 与一次 action（200，action 只应用一次）；被拒绝的会话拒绝 action（403，未应用任何动作）；没有服务时保持仅回环围栏；服务拒绝时直连回环会话仍被放行；路由注册之后才挂载的服务会在下一次请求生效；解析器只在服务真的暴露 `requestRejection` 时返回它，对缺失、不完整或抛错的查询返回 undefined。
- 本地证据为 `pnpm --filter @linxin666/dsh-client-ui-task-board typecheck`、它的 `vitest run` 套件（限定 worker 数时 1243 项通过、1 项跳过；默认 worker 数在负载较高的本机会间歇性地让无关的账本与 fiber 测试撞上 5 秒超时，这些测试单独运行均通过）与 `pnpm test:standards`；`pnpm docs:check` 覆盖双语 README 改动，`pnpm i18n:check` 保持绿色。
