# Agent Note: The Desktop application's own page is host-owned, never a pairing target

Status: implemented

## Problem

启动 dsh 桌面应用后，界面显示的是一整页「需要设备配对 / 此设备未配对，无法访问工作区数据」拦截页，而不是工作区：GUI 发出的每一个同源调用都得到 `403`，错误码 `error.code: "unpaired"`，因此会话、工作区与插件数据全都加载不出来，应用完全不可用。

该拦截页是本插件的配对栅栏（`client/FenceNotice.tsx`），在被门控的调用报告 `unpaired` 时升起。对真正来自远程的浏览器而言它是正确的——而插件当时正是这样看待这个页面的。

误判只有一个来源：本机判定此前只比较主机名（`isLoopbackHostname`：`localhost`、`::1`、`127/8`）。官方桌面外壳（Electron）并不通过 HTTP 回环源提供 GUI——它注册自定义协议，从 `dsh-app://app/` 加载官方 Web GUI（`const SCHEME = "dsh-app"`、`applicationUrl = `${SCHEME}://app/``；preload 断言 `location.protocol === 'dsh-app:' && location.hostname === 'app'`）。该页面的主机名字面量是 `app`，不是回环名，于是本插件的两个半区都把本机桌面读成了远程来源：

- 浏览器半区装上了门控 `/remote` 通道（`remoteChannelRequired`），把 `/api/*`、`/sidebar/*` 与流套接字改写到配对门控前缀上；
- 解析期 boot 补丁（`remote-channel-boot.ts`，注入到被交付的 index）走了非回环分支，装上传输钩子与未配对栅栏。

在这个页面上配对不仅多余，而且不可能成功：桌面外壳自己转发同源请求（`forwardWebRequest` 重写 `Host`，剥掉 `Origin`/`Cookie`/`Sec-Fetch-Site`，并删掉响应上的每一个 `set-cookie`），因此设备 cookie 永远存不下来；而无 cookie 的 `x-dsh-remote-device` 路径依赖一次外壳永不执行的 `/pair-app` 导航。拦截页因此是死路：立即配对不可能成功，重新检测只会重载回同一屏。

官方客户端本来就把该外壳当作本机——外壳在 boot 注入执行前就设置 `__DSH_TRANSPORT__ = { ownsHost: true }`，connection 包据此推导 `isLoopback`（`transport.ownsHost === true || isLoopbackHostname(pageLocation.hostname)`）。只有本插件自己的判定与之一致性相反，而这个不一致恰恰把插件本该永远服务的那个页面挡在了外面。

## Decision

本机判定改为**感知页面方案**，唯一真源是 `src/remote-channel-rules.ts` 里的 `isHostOwnedOrigin(hostname, scheme, desktopScheme)`——两个半区本就共享该模块，判定因此不会漂移。它对回环主机名与桌面外壳自己的页面方案 `dsh-app`（`DESKTOP_SHELL_SCHEME`）都返回 true，并把该字面量作为 `desktopScheme` 发布进 JSON 规则表，使由同一张表生成的 boot 脚本做出完全相同的判定。

方案比较不区分大小写，并接受两种写法（`dsh-app`，或 `location.protocol` 携带的 `dsh-app:`），由 `normalizeScheme` 归一；方案缺失或为空时保持原有的「仅主机名」语义，因此所有既有调用方与测试替身行为不变。

两个调用点现在都传入页面方案：`remoteChannelRequired(..., window.location.protocol)` 与 `src/client/index.ts` 里的宿主策略探测门。生成的 boot 脚本内联同一判定（跳过 `return` 之前先 `var s=(loc.protocol||"").replace(/:$/,"").toLowerCase()`），与产出它的规则表保持逐字一致。

## Alternatives considered

- **把 `app` 加进回环主机名**：拒绝。`isLoopbackHostname` 同时回答 host 半区的 Host 头问题（`src/gate.ts`、路由栅栏），在那里裸 `app` 会把任何能发送 `Host: app` 的客户端当作回环。真正区分该外壳的事实是页面方案；主机名只是它的偶然结果。
- **通过页面全局量（`dshDesktop` / `dshDesktopBoot`）识别外壳**：拒绝作为主判据。boot 脚本在 `<head>` 中、任何 boot entry 之前运行，不能依赖 preload 暴露的面；且两个半区必须从可 JSON 序列化的数据判定。页面方案在两个位置、两个半区都可读。
- **用 `requirePairingForLan: false` 关掉栅栏**：拒绝作为修复。那是部署级策略，会同时停止门控真正远程的 `/api` 调用方——而后者正是插件在暴露到局域网后的全部访问控制。缺陷是对某一个本机页面的误判，不是策略问题。
- **只在客户端半区特判该外壳**：拒绝。boot 补丁由被交付的 index 安装且最先运行，只改客户端仍会在任何 boot entry 执行前把外壳改写到门控前缀并栅栏拦住。
- **改为通过回环 HTTP 交付桌面端**：拒绝，超出本包范围。桌面外壳是官方产品；本插件必须正确分类它拿到的页面。

## Consequences

- 桌面应用直接进入工作区：没有配对栅栏、没有 `/remote` 改写、没有传输钩子、没有上传钩子。它自身已认证的 host 原样收到它的调用，与在 127.0.0.1 打开的浏览器页面完全一致。
- 对所有真正远程的来源，配对语义完整保留——局域网地址、隧道与公网地址依然门控、依然必须配对；此次改动没有移除任何访问控制。
- 此前以两种互相矛盾的形式存在的本机概念，现在只有一个归属：规则表是外壳方案唯一的书写之处，boot 脚本由它派生。
- 未来若桌面版本改名该方案，或另一套外壳以别的方式交付 GUI，则退化为需要配对的普通远程来源。届时失败会以配对栅栏的形式可见，修复只是 `DESKTOP_SHELL_SCHEME` 里的一个字面量。
- `isLoopbackHostname` 改为从共享规则模块再导出，而不是定义在 `client/remote-channel.ts`；由于规则模块不引入任何带运行时身份的依赖，浏览器半区仍保持「模块自足」的立场。

## Testing

- `packages/dsh-remote-web-ui/tests/remote-channel.spec.ts` 固定分类（`dsh-app:`、裸 `dsh-app`、`DSH-APP:` 属本机；局域网地址、隧道主机名，以及 `http:` 下的诱饵组合 `app` 都不属本机）、方案归一，以及判定本身：在配对策略开启、设置分别处于不可读与 `ready` 两种状态下，`remoteChannelRequired` 对该外壳页面都返回 false，而局域网来源仍返回 true、回环返回 false。把判定退回旧的「仅主机名」实现，「user opening the Desktop shell is never asked to pair」即失败。
- `packages/dsh-remote-web-ui/tests/remote-channel-boot.spec.ts` 让生成的 boot 脚本跑在一个 location 镜像 `dsh-app://app/`（不透明 `null` origin）的假 window 上，断言什么都没被改写、boot seat 与上传钩子都不存在，且一次调用原样落到 `dsh-app://app/api/session.list`。退回内联的跳过条件，「user on the official Desktop shell page keeps the original paths」即失败。
- `pnpm --filter @linxin666/dsh-remote-web-ui test` 383 个测试通过；复现该缺陷的真实 GUI 启动（Windows 上的 dsh 桌面，`session.list` 返回 403 `unpaired`）现在能正常加载工作区。