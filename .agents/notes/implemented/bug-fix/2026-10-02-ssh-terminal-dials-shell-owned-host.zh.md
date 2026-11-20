# Agent Note: The SSH terminal dials the shell-owned Host on an application-delivered page

Status: implemented

## Problem

`dsh-ssh` 的终端页签在官方 DSH 桌面应用内完全无法使用。点击「连接」后在
0.2.0-rc.2 桌面版上提示 `终端已退出（<alias>）当前页面不支持 WebSocket（应用外壳只转发
HTTP）…`，而同一面板的其他面（主机列表、exec、SFTP 传输、隧道）全部正常。用户可见的
预期是「可以使用终端连接远程主机」，桌面版同样应当如此。

传输层面的成因是真实且未变的：桌面外壳从 `dsh-app://app/` 提供 Web GUI，而自定义 scheme
无法承载 WebSocket 升级。首版修复因此在任何应用 scheme 上拒绝拨号，并让操作者改用浏览器
（[#1743-1751 批次中的 #1744](2026-09-29-open-issues-resolution-1743-1751.zh.md)）。这个判断
对页面本身是对的，对外壳却是错的：它把一条可用的本机路径变成了产品自家客户端上的死路。

## Decision

终端 socket 改为拨向外壳通过官方传输钩子 `__DSH_TRANSPORT__.streamBaseUrl` 公布的主机
authority。

外壳拥有该 Host，并且已经通过自己的 protocol handler 把其余每个请求都转发过去。它同时
为该 Host 改写 WebSocket 握手（`onBeforeSendHeaders` 覆盖 `ws://127.0.0.1/*`：要求
`Origin: dsh-app://app`，随后替换成 Host origin、外壳持有的 authority 绑定凭据，以及合成的
`sec-fetch-site: same-origin`），并把同一个值通过 `streamBaseUrl` 交给浏览器半区。官方
gateway stream mux 正是靠这条路径从 `dsh-app://app` 文档抵达外壳自有的 Host。因此
`terminalSocketUrl()` 的行为是：

- **网页**仍按自身 origin 解析，行为不变；
- **应用交付的页面**按 `streamBaseUrl` 解析，`ws`/`wss` 由 base 自身 scheme 推导，且仅在
  该 base 是可解析、无 userinfo、authority 非空的 `http:`/`https:` origin 时成立；
- 其余情况一律返回 `undefined`，操作者仍得到可执行的提示，而不是一个注定失败的 socket。

该 base **仅**在应用交付的页面上被读取。携带该钩子的网页仍走自身 origin：远程通道会把
`ownsHost` 授予已配对的局域网／隧道页面，而该页面恰恰因为非本机才被门控通道围栏保护，网页
绝不能被改道到它无权抵达的主机上。

升级路由声明 `auth: 'anonymous'`，并采用与其他 SSH API 相同的宿主 connection 准入或
loopback 围栏。凭据仍由外壳附加；上述拨号规则本身不放行任何请求，远程页面仍须通过宿主
裁决或严格回环校验。
zh/en/ru 的 `terminal.noWebSocket` 文案现在描述的是剩余情形（外壳没有公布任何主机地址），而
不再声称外壳永远无法承载 socket。

## Testing

`packages/dsh-ssh/tests/terminal-socket-url.test.ts` 以纯函数形式钉住该解析器：两种网页
origin；桌面场景从公布的 base 拨出 `ws://127.0.0.1:3080/api/dsh-ssh/terminal?…`；https base
的 `wss` 变体；shell 页面未公布 base 时的拒绝；未知应用 scheme 且无 base 时的拒绝；非网络
authority 的 base 拒绝（空、无法解析、`dsh-app:`、`ftp:`、无 host、带 userinfo）；携带钩子
的网页仍走自身 origin；网络可生成的文档仍留在网页一侧。该套件在改动前的解析器上失败、改动后
通过；包级套件（24 个文件，210 通过，1 跳过）、`pnpm typecheck`、`pnpm build`、
`pnpm docs:check`、`pnpm i18n:check` 与 `pnpm aggregate:check` 均为绿。

## Alternatives considered

保留拒绝并改进文案被否决：它对页面传输的判断正确，却仍让该特性在客户端自家外壳上不可用，而
可行的修法是一个官方、已发布的钩子，而非新造能力。

要求 DSH 在 `dsh-app://` 上转发 WebSocket 升级被否决，因为这超出本仓库的边界——
[桌面外壳 browser-auth 凭据笔记](2026-09-25-desktop-shell-browser-auth-marker.zh.md) 拒绝改动
门控时用的正是同一理由。宿主侧插件不能要求未来的外壳版本配合，而外壳已经提供了拨号所需的两
样东西。

从页面自身请求反推 Host authority（从 `fetch` 响应读回，或从 bundle base 推断）被否决：那
是对一个外壳已明确公布的值做猜测，而猜测可能悄悄解析到错误 authority。钩子是外壳自己对其
Host 位置的声明。

在网页上也接受该 base 被否决，这是替远程通道做的决定。`ownsHost` 会授予已配对的局域网／隧道
页面，而该页面正因非本机才走门控通道；在那里尊重 base 会把它的终端 socket 拉离围栏。

## Consequences

终端现在可以在 DSH 桌面应用内对向外壳自有的同一 Host 工作；没有公布 base 的外壳仍会给出可执
行的提示。Web GUI 路径逐字节未变，因此本次改动不可能造成浏览器侧回归。

本笔记沉淀的规则具有一般性：应用交付的页面并非「无 socket 的页面」，而是传输位于另一个
authority 上的页面，而拥有该 authority 的外壳会明说它在哪里。将来某个外壳公布不同形态的
base 时，需要扩展 `hostAuthorityOf` 去接受它，而不是重开一个决策。

被取代的是 1743-1751 批次中的第 3 条，其中「列出网页 scheme 而非已知外壳清单」的理据仍然保留；
被替换的只是「应用 scheme 一律拒绝」这一结论。`WEB_PAGE_PROTOCOLS` 仍用于判定页面，只是
不再终结整个判断。
