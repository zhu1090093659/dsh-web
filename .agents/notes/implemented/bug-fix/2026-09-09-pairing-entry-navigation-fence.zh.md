# Agent Note: 配对入口页面拒绝跨站导航（手机显示 forbidden）

Status: implemented

## Problem

DSH 宿主重启后，用手机打开桌面面板二维码里的配对链接
（`https://<公网域名>/pair-accept?pair=<token>`）只看到一个白底页面，上面只有
一个词 `forbidden`。同一链接在桌面浏览器、干净标签页和 curl 下都正常，说明
问题只在手机上。

根因：入口页面用的是 `isTrustedApiRequest()` 做栅栏，它在 Host 校验之后还会拒绝
`Sec-Fetch-Site: cross-site` 的请求，以及带不匹配 `Origin` 的请求。这对 `/api`
是正确的（CSRF 防御），但配对链接是一次**顶层文档导航**，而最常用来打开二维码的
浏览器——微信及其它 WKWebView 外壳——恰恰会给这次导航打上 `cross-site` 标记
和/或附带 `Origin: null`。于是这个页面拒绝了它本来要服务的那个请求。手机设备记录
的 `lastSeenAt` 自重启前就没有更新过，与"在设备校验之前就被拒绝"一致。

## Decision

本记录修订了[docker 配对适配](2026-09-04-remote-web-ui-docker-pairing-adaptation.zh.md)里记录的标记语义；[动态授信上限](2026-09-05-remote-web-ui-dynamic-trusted-hosts-bound.zh.md)记录的上界机制不变。

1. **把 Host 信任与浏览器标记栅栏拆开。** `isTrustedHost()` 现在只负责权限校验；
   `isTrustedApiRequest()` 在其之上保留 `cross-site` 与 `Origin` 的拒绝。
2. **入口页面接受顶层文档导航。**
   `isTopLevelDocumentNavigation()`（`Sec-Fetch-Mode: navigate` +
   `Sec-Fetch-Dest: document`）让 `/pair-accept`、`/pair-app` 与
   `/pair-app.sw.js` 在 Host 受信的前提下无视这些标记放行，受信 Host 与私网
   LAN 回退两条路径都适用。其它任何请求形态——API 调用、fetch、iframe、
   WebSocket 升级——仍走严格栅栏，CSRF 防御不变。
3. **让下一次同类故障可诊断。** 入口页面拒绝请求时打印一行日志（Host、路径、
   原因、四个标记头），按 `reason|host|path` 去重且上限 64 条，手机再出问题
   时在宿主控制台就能看见，不必再做现场探测。

## Verification

- 真实中继上，用带手机 UA（`CriOS/152`）的 curl 打 `/pair-accept`：基线 200；
  `Sec-Fetch-Site: cross-site` + `navigate`/`document` 403；
  `Origin: null` 403；`Origin: https://weixin.qq.com` 403；只有外部
  `Referer` 时 200。前三项正是内嵌浏览器会发的组合，而手机屏幕上显示的正是
  栅栏自己的 `text/plain` 403 正文。
- 桌面浏览器走中继的完整链路：签发的二维码链接 303 到 `/pair-app`，官方外壳
  正常启动，Service Worker 注册并接管 `/`，新标签页重新打开 `/` 依然进入应用。
- 包内测试 359 个用例通过，其中 2 个新增用例：跨站顶层导航能被 `/pair-accept`
  与 `/pair-app` 接受，而同样标记用在 fetch、iframe 与 `POST /api/pair/accept`
  上仍然 403；以及拒绝日志按形态只打一次。
- `pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check`、
  `pnpm aggregate:check` 全部通过。改的是宿主半区，需要重启 DSH 宿主后才生效
  （运行中的宿主仍是旧模块）。

## Alternatives considered

- **在所有地方去掉跨站/Origin 栅栏。** 否决：那正是 `/api` 的 CSRF 防御；这次
  的问题在导航，不在 API。
- **针对微信 User-Agent 做特例。** 否决：这组标记是浏览器上下文的属性，不是产品
  属性，每个 WKWebView 外壳行为都一样。
- **让用户改用 Safari 打开链接。** 否决：二维码流程必须能应付打开它的任意扫描器，
  这是产品该承担的事。
- **先校验令牌再走栅栏。** 否决：应用落地页本身不带令牌，而令牌恰恰是栅栏要防止
  被任意来源探测的东西。

## Consequences

- 入口页面可以被任意来源打开，这正是二维码链接需要的；授权凭据（一次性令牌，或
  URL 里的设备 id）仍然是唯一权威。iframe 仍会拿到 403，因此嵌入这些页面无法
  设置第三方 Cookie。
- 放宽条件以两个 `Sec-Fetch-*` 导航标记为准。既不发送这两个标记的浏览器仍会走
  严格栅栏，也就仍会看到同样的 `forbidden` 页面；新增的日志行让这种情况一眼可辨。
- 拒绝日志是进程级、只记首次出现，因此不会被反复探测刷屏。
