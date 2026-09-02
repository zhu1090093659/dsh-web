# DSH 远程访问（Remote Web UI）

[English](README.md) | 中文
> 为 dsh web GUI 提供共享**同一份界面**的远程访问：在设置按钮旁的二维码配对手机或另一台电脑，两端运行的都和本机一样是官方 Web GUI——手机获得注入的竖屏触控适配，电脑获得完整桌面；准入基于一次性配对令牌与可撤销设备会话。设置卡片可将服务绑定到局域网，可选 Cloudflare 快速隧道触达公网——并由一个永不变化的固定主机名前置，手机的书签与配对零配置跨重启有效——侧栏还会检查 dsh-web 新版本并支持一键自更新。

本仓库是 DeepSeek Harness（DSH）的外部插件包，为单一双面包：host 半区持有配对令牌、设备会话、`/api/pair` 路由族、门控 `/remote` 通道、局域网绑定开关与 `/api/update` 界面；浏览器半区渲染侧栏底部入口（下载触发器与设置按钮旁的远程访问入口）、带二维码的配对面板、实时设备状态、已授权设备列表、设置卡片、官方界面之上的竖屏触控适配层，以及更新面板。

## 功能

- **入口**：展开侧栏与窄栏中设置按钮旁的手机图标；tooltip 与可访问标签为「远程访问」。
- **面板**：「远程访问」标题、「设备配对」卡片（状态区「等待设备连接」+ 状态徽标）、大二维码、带复制按钮的配对链接、停止 / 刷新二维码操作，以及已授权设备列表（按 User-Agent 推断的设备名、在线/离线、最近活动时间、逐设备取消配对）。承载凭据的设备 id 与原始 User-Agent 值绝不渲染。手机与电脑共用同一条一次性链接。
- **手机侧**：扫码后以一次性限时令牌绑定并重载进入**官方 Web GUI**——不存在会漂移的第二套界面。手机竖屏时插件在运行中的界面上注入触控适配层（见下文）。接受链路不依赖 cookie（`/pair-accept` → `/pair-app`）：官方应用壳由插件直接交付，手机全程不需要 harness 浏览器认证 cookie。随后由重开 service worker（https 源）接管此后对 `/` 的导航——来自历史、书签或标签恢复的重开直接回到应用，而不是 401 死路（见安全模型）。
- **电脑侧**：同一链接在另一台电脑的浏览器里打开完整桌面 Web GUI，流量走门控 `/remote` 通道；未配对的电脑看到引导式拦截页（含手动粘贴配对令牌输入框），其后没有任何工作区数据。
- **安全**：同时只有一枚有效令牌（刷新二维码使旧链接失效；链接在其有效期窗口内可重复配对——扫码在浏览器间转手也能完成配对；令牌会过期）。停止会撤销所有配对设备与当前令牌——`/remote` 通道在下一次请求即切断它们。配对是本插件对 `/remote` 通道的访问控制；暴露到局域网后的直连 `/api` 由 harness 围栏 + 浏览器认证约束（见安全模型）。回环（127.0.0.1）继续直接使用 `/api`。配对设备是**完全控制凭据**（见安全模型）。
- **局域网绑定开关**：设置卡片向 profile `cordis.patch.yml` 写入受管块，将 webserver 绑定固定为 `0.0.0.0`（开）或 `127.0.0.1`（关）——无需 `--host` 命令行操作；显式 `--host`/`--port` 旗标仍然优先。同时维护对应的主机防火墙规则（Windows Defender 经 netsh；Linux firewalld/ufw/iptables；其他平台报告防火墙不受管），并展示运行中的绑定、可达局域网地址与防火墙状态。
- **实时状态**：桌面徽标实时切换为已连接；`/api` 姿态探测报告 SDK 栅栏仍敞开的 `/api` 来源；隧道启动期间面板显示自动隧道状态。
- **一键自更新**：侧栏下载触发器在加载后检查 dsh-web 新版本，有新版本时标记按钮并执行带校验的更新（面板展示发布说明）。

## 移动端适配层

官方桌面布局在 1024px 以下已自动折叠侧栏。在此基础上，视口为竖屏 + 粗指针 + 宽度不足 1100px 时插件注入：

- 以 CSS Modules **语义后缀**为键的样式表（`[class$="_composerSeat"]`），官方重构只改 hash 时选择器依然存活：折叠栏 44px 触控目标、16px 输入（防 iOS 聚焦缩放）、composer 的 safe-area 内边距、消息列表与侧栏的紧凑字号、设置弹窗纵向布局、PlanReview 卡片全宽；
- **可拖拽小鲸鱼按钮**作为折叠侧栏的展开入口（位置记忆；接到官方 `ctx.layout.toggleSidebar()`），侧栏展开时隐藏；
- **手势**：左滑收起侧栏、会话区右滑展开；长按会话行打开与桌面省略号相同的操作菜单；点会话行或侧栏外任意位置再次收起；
- **触控输入行为**：Enter 只换行（发送走发送按钮）、抑制程序化 composer 聚焦（不乱弹键盘）、隐藏官方 tooltip 气泡（触屏上会残留）；
- **移动端插件范围**：适配层激活时，右侧详情列与面向桌面的工具界面（SSH 终端、技能中心、任务看板、git graph、宠物、性能引擎、使用统计）一律隐藏——以 L2 语义根（`data-dsh-plugin`）为键，归属由声明方插件负责，官方类名变动也不会复活它们。这些是渲染抑制；客户端 bundle 仍会加载。激活时还会经官方 `ctx.layout.closeDetails()` 真正关闭详情面板。
- **手动退出**：`sessionStorage.dsh-remote-force-desktop = 1` 关闭整个适配层；横屏、桌面与宽视口永不触碰。

配对远程桌面同时运行在 **host 模式**：在本 harness 线上，「配置面仅限本机」的行为是客户端分支（`connection.isLoopback`），通道 boot 脚本在一切 boot entry 之前对非回环源安装传输钩子（`__DSH_TRANSPORT__.ownsHost = true`）。设置、凭据、Agent 预设与产出物在手机上与桌面完全一致——所有调用仍走门控 `/remote` 通道。四个控制面保持物理本地：`/api/pair/*`、`/api/update/*`、`/api/plugin-manager/*` 与 `/api/dsh-desktop-launcher/*`。

## 环境要求

- DSH 安装的 `dsh` CLI 需支持 profile（`dsh --profile`、`dsh plugin`）——本包依托的 profile/bundle 机制。
- 局域网使用：在设置卡片打开**局域网访问**（写入绑定块，自下一次 `dsh web` 启动生效），或以 `dsh web --host 0.0.0.0` 启动。默认 `127.0.0.1` 绑定时面板会显示明确说明而非失效二维码——除非已配置公网地址（见下文），此时二维码随处可达而无需重绑。面板的铸造/停止端点设计上仅限回环：在局域网地址打开的桌面浏览器会看到「配对面板仅限本机使用」横幅。
- 一键公网隧道（`autoTunnel`）所需的 `cloudflared` 平台二进制随包分发（postinstall 下载；跳过 postinstall 的安装方式由运行时下载兜底）。无需用户侧工具、账号或域名。
- 同一二进制也支撑固定域名命名隧道模式（`tunnelToken`）：公共主机名永久不变，手机配对一次后书签与配对 Cookie 跨重启持续有效，无需重新配对。

## 安装

安装全家桶聚合包 `@linxin666/dsh-web-all`（全部插件与皮肤）或单独安装本插件：

```sh
# 推荐：直接从 npm 安装
dsh plugin --profile web add @linxin666/dsh-remote-web-ui@latest

# 或从仓库（开发循环）
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-remote-web-ui
```

重启 profile（`dsh web`），然后打开侧栏底部的手机图标。插件的 `cordis.patch.yml` 插入单一插件行，同时挂载两个半区。

> `github:<org>/<repo>` 安装适用于包位于仓库根的独立仓库（`prepare` 脚本在安装期构建 `lib/`；pnpm ≥10 会阻止，需把打印的 key 复制进 profile 的 `pnpm-workspace.yaml` `allowBuilds` 后重试）。monorepo 子包使用上面的 `link:` 形式。

## 使用

1. 打开设置卡片（设置 → Web 插件 → 远程访问设置），若服务绑定回环则打开**局域网访问**；卡片展示运行中的绑定、防火墙状态与可达局域网地址。绑定变化自下一次 `dsh web` 启动生效。
2. 启动 `dsh web`，点手机图标，面板铸造一枚全新的一次性二维码。
3. 手机扫码（或打开复制的链接）：设备完成配对，进入由插件不依赖 cookie 交付的**官方 Web GUI**（`/pair-accept` → `/pair-app`），并重载到 `/`。手机上竖屏适配层已生效——与桌面同布局、同实时状态。此后的重开（历史、书签）直接回到应用（https 源；见安全模型）。
4. **改为配对电脑**：复制同一链接，在另一台电脑的浏览器打开。相同往返后完整 Web GUI 在彼处经门控 `/remote` 通道运行；未配对电脑看到引导式拦截页，其后没有数据。一枚令牌配一台设备；下一台设备请刷新二维码。
5. 桌面徽标实时切换为已连接；设备列表列出已配对设备并支持逐设备取消配对，停止则全部撤销。
6. 配对有效期、设备上限、局域网栅栏策略（`requirePairingForLan`）、公网地址、自动隧道、固定域名中继与命名隧道令牌都在同一设置卡片配置。

## 通过互联网远程访问（隧道）

### 一键公网隧道（推荐）

在设置卡片打开**自动公网隧道**（autoTunnel）。插件运行自己的 Cloudflare 快速隧道（`cloudflared` 随包分发），把铸造的公网 URL 动态喂给二维码与配对栅栏，并同步姿态探测——手机随时随地都能配对。开启期间忽略下方手动公网地址与命名隧道令牌。铸造的域名是临时的，每次 `dsh web` 重启都会变化——下方的固定域名中继会把手机的访问源钉在固定地址上，重启不再需要重新扫码。

### 固定域名中继（默认开启；配对一次，重启不再重配）

快速隧道运行期间，插件会额外把当前隧道地址注册到 dsh-market 中继注册表，并把二维码重建在一个固定源上——`https://<id>.dsh-market.com`——每个 profile 首次运行铸造一次，存放在 `$DSH_HOME/remote-web-ui-registry/`。主机名永不变化，手机的书签与配对 Cookie 在 `dsh web` 重启后依然有效，且不需要 Cloudflare 账号、控制台操作或自己的域名。

- 注册以密钥认证：插件在身份旁铸造一个 256 位密钥，每次隧道启动（含崩溃重启）以退避重试同步映射。注册表不可达时，该次会话的二维码回退为裸快速隧道地址，并在面板中说明。
- 实例离线时，手机打开固定源会看到明确的「实例离线——稍后刷新即可，无需重新配对」页面，而不是死链。
- 在设置卡片关闭**固定域名中继**（relay）可让部署完全留在临时源上；注册表行会立即删除。信任说明：中继流量经由 dsh-market 边缘（由包作者运营的 Cloudflare Worker）转发——见安全模型。

### 固定域名命名隧道（自带域名）

上方的中继已经把手机的访问源固定在共享的 dsh-market 子域名上。Cloudflare 命名隧道适合希望主机名落在**自己域名**下的部署：公共主机名永久固定，手机的书签与配对 Cookie 在 `dsh web` 重启后依然有效——配对一次，终身使用（会话空闲超过 `idleExpireMs` 除外）。

1. 在 Cloudflare 控制台创建一个 Tunnel，并把一个公共主机名（如 `dsh.example.com`）映射到 `http://127.0.0.1:3080`（`dsh web` 监听的端口）。
2. 复制隧道 Token，粘贴到设置卡片的**固定域名隧道令牌**（tunnelToken）。
3. 把同一主机名填入**公网地址**（publicBaseUrl）。Token 本身不携带主机名，缺了这一步隧道不会启动，并会给出缺失警告。

插件随后以与快速隧道相同的生命周期管理运行 `cloudflared tunnel run --token`：二进制随包分发，意外退出自动退避重启，姿态探测持续审计该固定主机的 `/api` 围栏。Token 作为设置密文存储，读取时脱敏。自动快速隧道开启时优先级更高。

### 手动隧道（自带）

用任意隧道暴露本地端口并填写**公网地址**（publicBaseUrl），例如：

```sh
# 1. 暴露本地端口（dsh web 正在监听的端口）：
cloudflared tunnel --url http://127.0.0.1:3080
#    输出形如：https://xxxx-xxxx-xxxx.trycloudflare.com

# 2. 照常启动 dsh web。除非有意让 SDK 信任该主机的 /api，
#    否则不要为隧道域名加 --trusted-host。若只需要隧道访问，
#    保持局域网绑定关闭。
```

然后把打印的 URL 填入公网地址。二维码链接由它构造，插件的配对栅栏接受该隧道 authority。姿态探测持续审计 SDK 栅栏对哪些 `/api` 来源保持敞开。

## 开发

在本仓库内工作（无需 DSH 源码 checkout）：

```sh
cd dsh-web
export NPM_TOKEN='<token>'   # 仅当仍需私有 @deepseek-ai 认证时
pnpm install
pnpm --filter @linxin666/dsh-remote-web-ui run build
pnpm --filter @linxin666/dsh-remote-web-ui test
pnpm --filter @linxin666/dsh-remote-web-ui run typecheck
```

对端 API 来自官方 NPM SDK：用到的每个 `@deepseek-ai/*` 包都声明在 devDependencies（0.1.2-alpha.2 cohort）中，TypeScript/Vitest 直接从 node_modules 解析类型——不需要 DSH 源码 checkout。消费侧 `prepare` 构建（`tsdown.prepare.config.ts`）不做类型检查地转译，git 安装同样无需 harness checkout。

## 检查

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Harness 契约依赖

锚定 0.1.2-alpha.2 线；本构建依赖的接缝：

- **`sidebar.footer.action` 底部席位**（0.1.2 shell 组合）：侧栏声明并渲染远程入口占据的席位。
- **`ctx.layout.toggleSidebar()`**（packages/client/ui-layout）：鲸鱼按钮经官方面板动作面展开折叠侧栏。
- **`ctx.connection.authenticatedUrl()`**（packages/client/connection）：代理为内部凭据一次性兑换启动令牌的官方接缝（`src/inner-auth.ts`），使再发起的 `/api` 调用满足 harness 浏览器认证校验。
- **`__DSH_TRANSPORT__.ownsHost`**（client-connection 传输钩子）：配对远程桌面的 host 模式翻转。本线没有 host 侧按方法特权锁定——配置面在客户端按 `connection.isLoopback` 分支——也没有 `api/gate` 瀑布（gate 监听器保持挂载，待未来部署获得该接缝；配对强制在插件自己的 `/remote` 通道上）。
- **用户补丁绑定语义**：同 id 补丁行整行替换 config，且用户补丁层无法可靠求值依赖 `webStartup` 的 `!!js` 表达式——局域网绑定块因此落静态值，插件每次启动重断言。

栅栏辅助函数（`isTrustedApiRequest` / `isLoopbackHostname`）在 `src/gate.ts` / `src/routes.ts` 本地重实现：connection 插件不再导出它们，配对路由自带一份、只作用于二维码链接宣传的字面量。

## 手动 E2E：局域网配对往返

单测/组件 spec 覆盖路由族、栅栏、通道、lan-bind 块与适配层，但配对闭环涉及非回环源上的真实浏览器。凡改动 wire 契约或连接循环之后请重跑：

1. 启动隔离实例：`DSH_HOME=/tmp/dsh-qa dsh --profile web --no-open --port 3191`，并打开局域网绑定开关（或使用绑定块固定 0.0.0.0 的 profile）。
2. 浏览器打开**回环** URL（`http://127.0.0.1:3191`）：手机图标位于侧栏底部；面板立即铸造二维码，链接形如 `<lan-url>/pair-accept?pair=<token>`。
3. 在第二个标签（390x844 触控模拟）打开该链接：链路 `/pair-accept → /pair-app?device=<id> → /` 设置设备 cookie、交付打过补丁的官方应用壳并启动 UI——`document.body.classList` 带 `dsh-remote-portrait`、适配样式表与小鲸鱼按钮存在、`__DSH_TRANSPORT__.ownsHost` 为 `true`。设置面渲染 host 数据（host 模式），而非 memory 镜像。https 部署下应用壳还会注册重开 service worker（`/pair-app.sw.js`）；在该标签刷新 `/` 会直接进入应用而不是 harness 401。
4. 桌面徽标实时切换为已连接；局域网源的桌面页面则显示配对面板仅限本机使用横幅且不开状态流。
5. 桌面点停止切断设备：下一次请求 403 且 `unpaired`（栅栏页提供手动配对令牌输入）。

公网路径是同一条经隧道的往返（见「通过互联网远程访问」）：回环铸造 → 设备打开公网二维码 URL → 接受 → 官方 UI。只有 `publicBaseUrl`（插件配置）命名隧道主机；`--trusted-host` 不属于本配对流。桌面面板仍在 `http://127.0.0.1` 打开。

## 安全模型

- **配对是 `/remote` 通道的访问控制**：`requirePairingForLan` 开启（默认）时，每个请求必须携带有效配对设备 cookie，在任何字节转发之前强制。缺失或被撤销的会话收到 HTTP 403，JSON 拒绝携带 `error.code: "unpaired"`；浏览器 `EventSource` API 只暴露流失败，不暴露响应体。
- **通道携带进程自己的内部凭据。** harness 浏览器认证 cookie 与 authority 绑定（为浏览器访问过的确切 `host:port` 签发）且没有回环豁免，因此转发到 `127.0.0.1` 的再发起请求无法复用设备的 cookie。插件因此自行兑换一次自己的启动令牌——与浏览器首次访问执行的是同一次交换——并把所得 cookie 附到再发起请求上。该凭据只在上面的配对门之后被使用；停止/取消配对会立即停止对它的使用。
- **本 cohort 的现实：配对不门控直连 `/api`。** 在锚定的 0.1.2-alpha.2 线上，没有任何组件发出 `api/gate` seam，因此来自局域网源头的直连 `/api` 仅由 harness 围栏（`0.0.0.0` 绑定下自动信任局域网字面量）加 harness 浏览器认证 cookie 约束。设备已经兑换过的浏览器凭据在停止/取消配对后仍然有效，直到其自然过期（30 天）——撤销约束的是 `/remote` 通道与配对 cookie，而不是那个凭据。插件会对 `/api` 姿态做探测并大声告警；请把局域网绑定当作深思熟虑的决定，在共享机器上优先回环加隧道。
- **配对设备是完全控制凭据。** host 模式下它可达完整 host API——聊天、会话、设置、凭据、Agent 预设、产出物——与 SDK 对回环桌面的信任一致。只有四个控制面（配对、自更新、插件安装/卸载、桌面启动器）保持物理本地。只配对你控制的设备；停止或逐设备取消配对立即撤销。
- **控制端点仅限回环**：铸造/停止/撤销、设备列表、lan-bind 状态与更新端点只应答回环。局域网源浏览器看到「配对面板仅限本机使用」横幅。
- **应用落地页不依赖 cookie。** 配对后二维码把设备带到 `/pair-app`——由本插件直接交付官方应用壳，不经过 harness 索引认证门；设备凭据经 `x-dsh-remote-device` 请求头（fetch）与 `device` 查询参数（WebSocket 升级）由引导补丁从 sessionStorage 挂载。因此手机浏览器完全禁用 cookie 时链路依然成立；有 cookie 时配对 cookie 仍是主凭据，手机路径不再需要 harness 浏览器认证 cookie。
- **重开由 service worker 接管（仅 https 源）。** 配对过的手机从历史、书签或标签恢复回来时导航到裸 `/`——插件不拥有的路径，harness 兜底座会用浏览器认证 401 应答（不依赖 cookie 的流程永远拿不到那份凭据）。应用壳因此注册 `/pair-app.sw.js`（与 `/pair-app` 同一栅栏；脚本是不含任何秘密的惰性逻辑）：只拦截对 `/` 的导航，经 `/pair-app` 网络优先地重发应用壳——同时校验设备 cookie 并刷新其活跃时间，每次重开也在为会话续期——离线时回退缓存的壳，插件不再应答时把导航原样放行（被撤销的设备随后看到 harness 应答或双语重扫页）。纯 HTTP 的局域网源不是安全上下文，永远不会注册该 worker；那里的重开意味着重新扫码。
- **撤销按请求生效**：停止落地时已在途的请求会完成；下一个请求 403。
- **配对设备会话默认持久化**：设备会话（非一次性 QR 令牌）写入 `$DSH_HOME/remote-web-ui-devices.json`（0600，临时文件 + 原子改名）。`dsh web` 重启后配对 cookie 依然有效。刷新二维码铸造新令牌；重启不会恢复当前二维码。空闲超过 `idleExpireMs`（默认 30 天；重开 service worker 每次接管导航都会刷新该窗口）的会话被删除并须重新配对。设备 id 即会话凭据。需要时可用 `devicesFile` 指定其他绝对路径。更换 `cookieName` 会使现有设备失效（预期行为）。
- **局域网绑定块拥有 webserver 行**：开关翻过后受管块固定绑定；插件每次启动重断言，显式 `--host`/`--port` 旗标通过重写块获胜。手工编辑该块会被检测并在卡片展示（`blockHost` 显示字面量）。
- **桌面栅栏策略公开**：`/api/pair/status` 只暴露布尔 `requirePairingForLan` 策略，供远程桌面在设置作用域可用前选择正确传输。该字段不是凭据，不暴露令牌、设备、计数或隧道 URL。
- **快速隧道主机名每次运行都变**：`trycloudflare.com` URL 每次 `cloudflared` 启动都随机，`publicBaseUrl`（或自动隧道）须随之刷新。固定域名中继会把一个固定的 `<id>.dsh-market.com` 源前置在该临时地址上（随自动隧道默认开启）；命名隧道模式（`tunnelToken`）是自带域名的替代路径。Token 本身作为设置密文存储（读取脱敏），不会写日志，也不会回传浏览器半区。
- **中继只改变访问源，不改变信任根**：中继开启时，手机访问的是 `https://<id>.dsh-market.com`——一个 dsh-market 的 Cloudflare Worker，它查询实例当前的隧道地址并逐字节转发请求——配对 Cookie 与所有应用层校验仍留在实例上，worker 不终结任何配对。变化的是传输路径：中继流量经过包作者在 Cloudflare 边缘运营的基础设施，作者的 worker 可以观察到这些流量——这与 Cloudflare 自身对裸 `trycloudflare.com` 快速隧道的可见性相同。注册表把每个 id 绑定到一个 256 位密钥的 SHA-256 哈希（明文只存于 `$DSH_HOME`，0600），只接受 `*.trycloudflare.com` 目标，对注册做限流，且除映射外不存储任何数据；关闭中继即可让部署完全留在临时源上。

## 已知限制与后续工作

- **绑定变化需要重启**：补丁热重载监视器无法重绑监听中的套接字，且热重载行为依赖 profile 形态。卡片以 `pendingRestart` 提示局域网访问将在下次 `dsh web` 启动时生效。
- **纯 HTTP 局域网的重开需要重扫**：重开 service worker 只在安全上下文（https 隧道、localhost）注册；经纯 HTTP 局域网 URL 配对的手机导航回 `/` 时会撞上 harness 401，需要重新扫码。局域网内重配对成本很低，配对后一切恢复。
- **适配选择器跟随官方构建**：语义后缀策略可在 hash 变化中存活，但语义改名不行；每次官方 GUI 升级需要一轮视觉 QA（参考 dsh-LAN，这些后缀在多次官方发布中保持稳定）。
- **开发 HMR**：`dsh web --dev` 按路径轮询每个 roster bundle，重建本包（自身 `tsdown --watch`）即热重载客户端 bundle；host 半区需要重启。

## 依赖说明

`qrcode.react`（MIT，活跃维护，支持 React 16–19）以无依赖 SVG 组件渲染二维码——无 canvas、无服务端出图。它构建期内联进客户端 bundle（与官方 skin/turtle-ui 插件内联非共享依赖一致），profile 安装因此无需 dsh peer 闭包之外的运行时依赖。`schemastery` 是 DSH 标准配置 schema 校验器。

## 遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一条匿名安装心跳：一个随机 localStorage id 与本包名，仅此而已。服务端只存该 id 的加盐哈希，永不存 IP 地址，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。