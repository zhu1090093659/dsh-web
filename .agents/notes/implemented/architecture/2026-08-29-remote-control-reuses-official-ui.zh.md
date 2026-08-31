# Agent Note: 远程控制复用官方界面（移动适配层取代 /m 独立界面）

Status: implemented

## 问题

dsh-remote-web-ui 此前自带一套移动端界面：独立的 `/m/` 界面（视图、markdown 渲染、mux 桥接、主题、PWA 壳、`/m/api` 白名单代理与配对模型目录）与官方桌面 GUI 并存。官方客户端每变一次，手机面就得手工追一次，且两个面在设计上就是分裂的：手机看到的是缩水产品（无设置、无插件卡片、无产出物），桌面看到的才是真产品。参考实现 [dsh-LAN](https://github.com/MrMu666/dsh-LAN) 从相反方向解决了同一问题——其 v48 起删除自写界面、改为在官方界面上注入竖屏触控适配——本仓库采纳了该方向。

## 决策

- **单一界面。** 整条 `/m/` 管线删除（移动视图、mux/rpc、markdown、PWA/Service Worker、带方法白名单的 `/m/api` 代理、配对模型目录、`mobile-pending`、`mobileEnterToSend` 配置）。二维码链接统一指向同一源上的官方 Web GUI：手机获得注入的适配层，电脑获得完整桌面界面。
- **竖屏触控适配层**（`src/client/mobile-adapt.ts`，移植自 dsh-LAN 参考，MIT）：视口为竖屏 + 粗指针 + 宽度不足 1100px 时，注入以 CSS Modules 语义后缀为键的样式表（`[class$="_composerSeat"]`……，官方改 hash 不改语义名时依然存活），以及手势 JS——可拖拽小鲸鱼按钮作为折叠侧栏入口（接到 `ctx.layout.toggleSidebar()`）、左右滑动、长按会话菜单、Enter 只换行、16px 输入防 iOS 聚焦缩放、safe-area 内边距、设置弹窗纵向布局。sessionStorage 开关（`dsh-remote-force-desktop=1`）可退出适配。
- **配对远程桌面的 host 模式。** 在 0.1.2-alpha.1 线上，host 侧 `/api` 面没有按方法的特权锁定——「配置面仅限本机」的行为在浏览器里，客户端插件按 `connection.isLoopback` 分支（设置镜像退化为 memory 作用域、文档控制器退化为内存桩）。因此通道 boot 脚本在一切 boot entry 之前，对非回环源安装传输钩子 `__DSH_TRANSPORT__ = { ownsHost: true }`：官方 UI 呈现完整配置面，所有调用仍走门控 `/remote` 通道以回环形态执行。这取代了最初设想的 dsh-LAN 式 `/lanapi` 代理——那是为 host 侧锁定特权方法的线设计的；我们不再维护任何端点表。
- **控制面保持物理本地。** `/remote` 仍拒绝 `/api/pair/*`、`/api/update/*`、`/api/plugin-manager/*` 与 `/api/dsh-desktop-launcher/*`。全家桶设置桥（`/api/dsh-web-ui-settings`）对配对设备重新开放——设置完全对等正是目的。过时的点号 `LOOPBACK_ONLY_METHODS` 表（rc 线遗留，契约 pin 早已挂起）删除。
- **二维码入口是顶层路由 `/pair-accept`。** 局域网设备在配对代码能跑之前，会先撞上 harness 的浏览器认证门（按 authority 绑定的会话 cookie），而认证门的 token 重定向会丢弃查询参数。该路由设置设备 cookie 后 303 到 `connection.authenticatedUrl(origin)`——官方的启动令牌接缝——一次导航同时越过认证门与配对门：`/pair-accept → /?token=<launch> → /`。`authenticatedUrl` 要求绝对 URL，路由传入请求 origin（对隧道尊重 `x-forwarded-proto`）。
- **移动端插件范围。** 适配层激活时，右侧详情列与面向桌面的工具界面（SSH 终端、技能中心、任务看板、git graph、宠物、性能引擎、使用统计）一律隐藏——以 L2 语义根（data-dsh-plugin）为键，归属由声明方插件负责——并且激活时经官方 ctx.layout.closeDetails() 关闭详情面板。这些是渲染抑制：客户端 bundle 仍会加载（roster 组合属于官方 web app，非本插件可控）。
- **局域网绑定开关与静态受管块。** 设置卡片向 profile `cordis.patch.yml` 写入受管块，固定 webserver 绑定（开 = 0.0.0.0，关 = 127.0.0.1）及官方行的端口与压缩键。同 id 补丁行按整行替换 config，块必须完整；且本线用户补丁层无法可靠求值依赖 `webStartup` 的 `!!js` 表达式（在 webStartup 服务挂载前就解析，热加载时端口为 undefined、冷启动直接拒绝配置），所以写入静态值。插件每次启动重断言该块——CLI 旗标（`--host`、`--port`）通过重写块来获胜——卡片展示运行中的绑定、防火墙摘要（Windows netsh；Linux firewalld/ufw/iptables；其他平台不受管）与 `pendingRestart` 标志（与生效期望绑定比较，旗标管理的绑定不会被永久标记）。CLI 对 `--host 0.0.0.0` 的拒绝保持原样：刻意的局域网暴露只经此配置层发生。
- **同日审查轮。** 后续强化笔记（[审查驱动的强化轮](../bug-fix/2026-08-29-remote-control-review-fixes.zh.md)）为本设计补齐通道的内部浏览器凭据（否则本线上被转发的 `/api` 再发起请求会 401）、如实陈述直连 `/api` 的配对缺口，并修复审查发现的 lan-bind/防火墙卫生缺陷。

## 备选方案

- dsh-LAN 式共享口令作为准入模型：产品决策否决——QR 配对体系（一次性令牌、按设备撤销、在线列表、隧道可达性）是本插件的差异点，共享密钥无法按设备撤销。
- 仿照 dsh-LAN 的 `/lanapi` 特权代理：源码核查后否决——本线的特权行为锁在客户端，ownsHost 钩子即可拿到完全对等，且不必跨 SDK 升级维护端点表。
- 向受管绑定块写入动态 `!!js ctx.webStartup.*` 表达式（dsh-LAN 的形态）：以实测证据否决——用户补丁层中表达式在 webStartup 服务挂载前解析（热加载时端口 undefined、冷启动拒绝配置），故块内落静态值，由启动重断言保证旗标优先。
- 为远程设备影子化官方工作区目录选择器（dsh-LAN 的应用内对话框）：本线不需要——选择器后端是组合选择（ui-directory-picker-native 与 -browse 填 ui-workspace 的槽位洞），没有 isLoopback 分支。
- 本重构中未变的关联机制：栅栏页的手动配对令牌输入（[remote fence manual pair token](../feature/2026-08-26-remote-fence-manual-pair-token.zh.md)）与控制台局域网可达性指引（[desktop profile and LAN guidance](../feature/2026-08-26-desktop-profile-and-lan-guidance.zh.md)）——局域网日志行现在宣传的是配对后的官方 GUI，而非已删除的 `/m/` 界面。

## 后果

- 远程界面不再可能与官方界面漂移：适配是增量式的 CSS/手势，可能失效的只有语义后缀选择器（每轮 GUI QA 复核）。
- 配对设备是完全控制凭据，现在包括配置面与全家桶设置桥。README 安全模型已如此声明；四个控制面保持本地。
- 局域网绑定的变化在下一次 `dsh web` 启动时生效；卡片展示 `pendingRestart`，而不是假装发生了实时重绑定（实测补丁热重载依赖 profile 形态，且无法重绑监听中的套接字）。
- 随界面一并移除：PWA 安装、移动端回车发送配置、工作区深链参数（`?workspace=`）——官方 UI 没有该参数，多端状态镜像使桌面当前工作区即共享工作区。

## 必需验证

- 包内 `pnpm typecheck && pnpm test && pnpm build`（250 个测试）。
- 真实 GUI、隔离 QA profile：局域网绑定开关往返（补丁写入 → 重启 → `bindHost: 0.0.0.0`、`pendingRestart: false`）、桌面铸码 → `/pair-accept?pair=` → 配对手机（390x844 触控模拟）启动官方界面且适配层生效（portrait 类、注入样式、鲸鱼按钮存在）、`__DSH_TRANSPORT__.ownsHost === true`。