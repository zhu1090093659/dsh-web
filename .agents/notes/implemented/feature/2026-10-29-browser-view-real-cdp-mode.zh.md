# Agent Note: 浏览器视图的真实浏览器 CDP 模式

Status: implemented

## Problem

浏览器自动化有时需要实际浏览器 profile 中的登录态。一次性隔离 profile 无法接触这些状态，而复制 Cookie 不等于真正操作浏览器：站点还会把身份保存在 localStorage、IndexedDB、service worker 与设备绑定凭据中。这个能力必须显式开启，因为 CDP 会让每个 DSH 会话都能访问真实页面，而没有鉴权的本机调试端口也会把同样权限暴露给其他本机进程。

## Decision

浏览器视图有两种来源。默认隔离来源仍启动临时 Chromium profile；显式 opt-in 的真实浏览器来源连接用户自行启动的 Chrome/Edge CDP 端点，配置为 volatile 的 `realBrowserEnabled=false` 与 `cdpEndpoint=http://127.0.0.1:9222`。设置变更释放旧连接，下一次动作使用新来源，无需重挂载插件。

CDP HTTP origin 与 `/json/version` 返回的 WebSocket 都必须位于 loopback、显式带端口且不含凭据，发现请求拒绝重定向。连接失败明确报错，绝不回退到隔离浏览器。

真实来源发现并接管全部现有及未来页面 target。所有 DSH 会话都能用现有浏览器工具枚举和操作这些页面。接管绝不应用 device-metrics override；主动刷新帧读取真实 CSS 视口。DSH 创建的 target 与接管 target 在宿主、线上协议和客户端中都有独立 origin 元数据。

插件释放与配置切换只停止投屏并关闭 CDP socket，不关闭外部浏览器或其标签页。未显式给 tab id 的 `browser_close` 保持会话归属限制；真实模式下显式 id 可以关闭任意已列出页面。面板 close 命令拒绝接管家标签。

接管带一对独立超时：DevTools 握手限时五秒，每条命令仍沿用共享的 30 秒 CDP 预算，因此慢导航不会被报成连接失败。socket 已关闭的会话（外部浏览器重启或崩溃）在下一次调用时按同一套只分离的清理被丢弃，并换成一条新连接；并发调用共用这一次替换，重连失败按连接错误上报，而不是换成隔离浏览器。

Chrome 136+ 对默认数据目录忽略远程调试开关。因此，本功能支持浏览器实际允许 CDP 的真实 profile，包括以非默认 `--user-data-dir` 启动的 profile；它不宣称能接管默认 Chrome profile。登录态在原处使用，不导入或复制 Cookie 数据。

## Runtime and client contract

`BrowserPanelState` 携带可选 `mode` 与 `cdpEndpoint`，`BrowserTabView` 携带可选 `origin`。旧载荷仍有效：缺少 mode 按隔离模式理解，缺少 origin 保持历史面板行为。socket 解码器保留这些字段。工具栏标明来源，并在真实模式显示端点；面板仍只是视图，不转发用户输入。`plugins.row.config` 贡献同时覆盖独立 `ui-browser-view` 与聚合 `web-ui-browser-view` 行 id，使 volatile 字段可从插件行配置页编辑。同一表单还在 Web 扩展中以共享 `PluginSettingsCard` 呈现，并回退独立与聚合 entry id。reconfigure 会为已挂载面板重新启动投屏，浏览器来源变化时客户端同时清除旧帧与旧错误。

## Testing

包测试覆盖端点校验、恶意发现 WebSocket、默认配置、现有与未来 target 接管、真实帧尺寸、关闭授权、失败不回退以及只分离的清理，并单独覆盖两个接管超时（五秒握手对三十秒命令预算）与替换路径（传输关闭、并发调用只替换一次、重连失败仍停留在真实浏览器模式、绑定的标签页与面板选择一并丢弃）。默认隔离套件保持全绿。客户端测试覆盖线上解码、真实/隔离来源显示与行配置写入，本地化门禁覆盖 zh/en/ru 键一致性。临时 Chromium 探针接管了已有页面，在导航与快照中直接使用其 HttpOnly 登录 Cookie，并确认 reconfigure 后浏览器与页面仍存活。独立 DSH_HOME 的 GUI 验收渲染了全部配置字段，持久化开关与端点编辑，并通过状态路由读到了一致的 CDP 模式与端点。第二轮 GUI 在 Web 扩展中渲染共享卡片并持久化同样两个字段。真实投屏探针在 reconfigure 后未重挂面板即收到四帧，导航后的 JPEG 字节确实变化。

## Alternatives considered

**导入 Cookie 或复制浏览器 profile。** 不作为主要机制：这不是操作实际浏览器，不能覆盖全部身份存储，会削弱凭据边界，而且得到的可能是过期副本而不是用户当前会话。

**无条件替换隔离浏览器。** 否决：显式开启的真实浏览器并非始终可用，升级也不能静默把日常浏览权限授予全部会话。临时隔离浏览器仍是默认值。

**只接管 DSH 创建的标签页。** 产品决策否决了这一限制：需求包括现有真实浏览器页面。因此界面和安全文档明确说明每个 DSH 会话都能操作每个页面。

**允许所有路径关闭接管家标签。** 否决：隐式清理或面板动作可能毁掉未保存的用户工作。真实标签必须由 agent 显式给出 tab id，面板关闭被拒绝，释放流程绝不关闭它们。

**允许远程 CDP 端点。** 否决：CDP 没有应用层鉴权。配置 origin 与发现 WebSocket 都限制为 loopback，而不是只在一个层面校验一次。

**开发浏览器扩展或原生桥接。** 本次未选择。它能覆盖禁止默认 profile CDP 的浏览器，但需要不同的权限模型与逐标签传输。CDP 的兼容限制被明确记录，而不是隐藏。

## Consequences

开启此模式就是有意授予对真实已登录页面的广泛访问权。本机 CDP 端口必须视为敏感能力，只在目标浏览器需要被使用的期间开放。Chrome 的默认 profile 限制意味着部分用户需要单独维护一个真实 profile 并在其中登录一次；本功能不绕过浏览器的安全控制。

宿主现在负责 target 接管与两套生命周期。后续改动必须保持模式各自的释放语义、幂等 target attach、真实视口行为与显式关闭边界。协议字段只做增量，因此无需提升线上协议版本。
