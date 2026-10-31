# dsh-remote-web-ui · DeepSeek Harness (DSH) 手机端与跨设备浏览器远程控制插件

[English](README.md) | 中文

> **弃用声明**：`@linxin666/dsh-remote-web-ui` 已弃用，后续由 [@linxin666/dsh-remote-bridge](../dsh-remote-bridge/README.zh.md) 承接。本插件已从 `@linxin666/dsh-web-all` 聚合包中摘除（老 profile 行通过 tombstone 导出与 `retiredPlugins` 登记静默跳过为 no-op），并计划在下一版本中正式删除。过渡期内独立安装（`dsh plugin --profile <name> add @linxin666/dsh-remote-web-ui`）仍可正常使用。浏览器远程控制能力已由手机 App（@linxin666/dsh-remote-bridge）取代，本包不再提供远程访问功能。
>
> - **已迁往 `@linxin666/dsh-remote-bridge` 的能力**：接入栈（中继身份登记、租约 claim/release 控制面、快速/命名双隧道连接器、Durable Object 会合点连接器、cloudflared 进程生命周期与孤儿进程清理、Cloudflare 命名隧道 ingress 端口同步、局域网转发器、宿主通配绑定探测与主机防火墙管理）。
> - **随本插件一起下线的能力**：浏览器侧远程控制面（配对 cookie 门控、`/api/pair` 路由族、门控 `/remote` 代理通道以及手机浏览器竖屏触控适配层）。
> - **并存已知风险**：若与 `@linxin666/dsh-remote-bridge` 在同一 profile 中并存，切勿同时开启两端的中继（两者按 profile 共用同一中继身份，两侧同时启用会竞争 Durable Object 会合点连接，且新桥以 `relay=false` 挂载时会主动撤销该身份的注册行并释放租约）。

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-remote-web-ui?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）官方 Web GUI 与桌面客户端手机与跨设备远程控制中心</strong><br>
  <em>手机扫码即连 · 跨设备 PC 浏览器访问 · 竖屏触控手势优化 · Cloudflare 公网隧道 · 安全设备配对</em>
</p>

> 为 DeepSeek Harness (DSH) Web GUI 与官方桌面客户端提供共享**同一份界面**的远程访问：在设置按钮旁的二维码配对手机或另一台电脑，两端运行的都和本机一样是官方 Web GUI——手机获得注入的竖屏触控适配，电脑获得完整桌面；准入基于限时配对令牌与可撤销设备会话。设置卡片可将服务绑定到局域网，可选 Cloudflare 快速隧道触达公网——并由一个永不变化的固定主机名前置，手机的书签与配对零配置跨重启有效。

本仓库是 DeepSeek Harness（DSH）的外部插件包，为单一双面包：host 半区持有配对令牌、设备会话、`/api/pair` 路由族、门控 `/remote` 通道、局域网绑定开关；浏览器半区渲染侧栏底部、设置按钮旁的远程访问入口、带二维码的配对面板、实时设备状态、已授权设备列表、设置卡片，以及官方界面之上的竖屏触控适配层。

## 功能

- **入口**：展开侧栏与窄栏中设置按钮旁的手机图标；tooltip 与可访问标签为「远程访问」。
- **面板**：「远程访问」标题、「设备配对」卡片（状态区「等待设备连接」+ 状态徽标）、大二维码、带复制按钮的配对链接、停止 / 刷新二维码操作，以及已授权设备列表（可保存的设备名，未命名时回退到按 User-Agent 推断的名称；在线/离线、最近活动时间、逐设备重命名与取消配对，以及同 User-Agent 记录的一键合并）。承载凭据的设备 id 与原始 User-Agent 值绝不渲染。手机与电脑共用同一条限时链接：在令牌过期或刷新二维码之前，该链接可为多台设备完成配对，每台各自生成独立设备会话。
- **手机侧**：扫码后以限时令牌绑定并重载进入**官方 Web GUI**——不存在会漂移的第二套界面。手机竖屏时插件在运行中的界面上注入触控适配层（见下文）。接受链路不依赖 cookie（`/pair-accept` → `/pair-app`）：官方应用壳由插件直接交付，手机全程不需要 harness 浏览器认证 cookie。随后由重开 service worker（https 源）接管此后对 `/` 的导航——来自历史、书签或标签恢复的重开直接回到应用，而不是 401 死路（见安全模型）。
- **电脑侧**：同一链接在另一台电脑的浏览器里打开完整桌面 Web GUI，流量走门控 `/remote` 通道；未配对的电脑看到引导式拦截页（含手动粘贴配对令牌输入框），其后没有任何工作区数据。
- **安全**：同时只有一枚有效令牌（刷新二维码使旧链接失效；链接在其有效期窗口内可重复配对——扫码在浏览器间转手也能完成配对；令牌会过期）。停止会撤销所有配对设备与当前令牌——`/remote` 通道在下一次请求即切断它们。配对是本插件对 `/remote` 通道的访问控制；web server 自身保持回环绑定，因此局域网浏览器经本插件门控的 `/remote` 网关进入应用（客户端把传输改写到那里），而不是走原生 `/api`——对局域网权威，harness 的 Host 围栏会返回 403（见安全模型）。回环（127.0.0.1）继续直接使用 `/api`；本机应用交付的页面（桌面外壳的 `dsh-app://app/`、`file:` 页面）同样如此——配对链接只能经网络到达。配对设备是**完全控制凭据**（见安全模型）。
- **局域网访问开关（运行时转发器）**：设置卡片启动一个转发器，不改写任何文件。web server 保持回环绑定，转发器在本机局域网 IPv4 地址、同一端口上监听，把每个请求——HTTP 与 WebSocket upgrade 一视同仁——转发到 `127.0.0.1:<端口>`。`--host`/`--port` 恢复常规语义：显式 `dsh web --host <局域网地址>` 照旧可用，此时转发器让出该端口。开关在进程运行期间即时生效：无需重启，也不写 profile。本机没有局域网 IPv4 地址时转发器保持关闭，卡片会如实说明。同时维护对应的主机防火墙规则（Windows Defender 经 netsh；Linux firewalld/ufw/iptables；其他平台报告防火墙不受管），并展示运行中的绑定、可达局域网地址、与宿主自身 `localBindHost` 并列的转发器状态（`forward { listening, host, port, reason, error }`）以及防火墙状态。
- **实时状态**：桌面徽标实时切换为已连接；`/api` 姿态探测报告 SDK 栅栏仍敞开的 `/api` 来源；隧道启动期间面板显示自动隧道状态。
- **自更新就在隔壁**：一键家族更新是独立插件（`dsh-update`，同一个侧栏脚部席位），因此关闭远程访问、甚至禁用本插件，都不会把更新入口一起带走。
- **桌面端底栏一行**：宽栏下脚部动作占用者不再各自成行，而是与官方「设置」触发器共用一行，设置按钮不再独占整行；其他脚部块（用量速览卡、其它插件的块）仍各占一整行，56px 栏轨保持官方原有的堆叠脚部。

## 移动端适配层

官方桌面布局在 1024px 以下已自动折叠侧栏。在此基础上，视口为竖屏 + 粗指针 + 宽度不足 1100px 时插件注入：

- 以 CSS Modules **语义后缀**为键的样式表（`[class$="_composerSeat"]`），官方重构只改 hash 时选择器依然存活：折叠栏 44px 触控目标、16px 输入（防 iOS 聚焦缩放）、composer 的 safe-area 内边距、消息列表与侧栏的紧凑字号、设置弹窗纵向布局、PlanReview 卡片全宽；
- **可拖拽小鲸鱼按钮**作为折叠侧栏的展开入口（位置记忆；接到官方 `ctx.layout.toggleSidebar()`），侧栏展开时隐藏；
- **手势**：左滑收起侧栏、会话区右滑展开；长按会话行打开与桌面省略号相同的操作菜单；点会话行或侧栏外任意位置再次收起；
- **触控输入行为**：Enter 只换行（发送走发送按钮）、抑制程序化 composer 聚焦（不乱弹键盘）、隐藏官方 tooltip 气泡（触屏上会残留）；
- **移动端插件范围**：适配层激活时，右侧详情列与面向桌面的工具界面（SSH 终端、技能中心、任务看板、git graph、宠物、使用统计）一律隐藏——以 L2 语义根（`data-dsh-plugin`）为键，归属由声明方插件负责，官方类名变动也不会复活它们。这些是渲染抑制；客户端 bundle 仍会加载。激活时还会经官方 `ctx.layout.closeDetails()` 真正关闭详情面板。
- **手动退出**：`sessionStorage.dsh-remote-force-desktop = 1` 关闭整个适配层；横屏、桌面与宽视口永不触碰。

配对远程桌面同时运行在 **host 模式**：在本 harness 线上，「配置面仅限本机」的行为是客户端分支（`connection.isLoopback`），通道 boot 脚本在一切 boot entry 之前安装传输钩子（`__DSH_TRANSPORT__.ownsHost = true`）。host 模式由**服务器授予**：只有当设备门控的应用落地页（`/pair-app`）在 boot 补丁之前发布了授权标记时才会安装该钩子，因此交付给未配对浏览器（围栏被打开的部署）的应用壳永远不会自称机器主人。设置、凭据、Agent 预设与产出物在手机上与桌面完全一致——所有调用仍走门控 `/remote` 通道。三个控制面保持物理本地：`/api/pair/*`、`/api/update/*` 与 `/api/plugin-manager/*`。

## 环境要求

- DSH 安装的 `dsh` CLI 需支持 profile（`dsh --profile`、`dsh plugin`）——本包依托的 profile/bundle 机制。
- 局域网使用：在设置卡片打开**局域网访问**——它立刻在本机当前的局域网 IPv4 地址、web server 的端口上监听，因此网络变化后把开关关一次再打开即可；或以 `dsh web --host <本机的局域网地址>` 启动。通配的 `--host 0.0.0.0` 只在仍接受它的宿主上有效；DSH 0.2.1-rc.2 及以后会直接拒绝。默认 `127.0.0.1` 绑定时面板会显示明确说明而非失效二维码——除非已配置公网地址（见下文「通过互联网远程访问」），此时二维码随处可达而无需重绑，随后落地页会把同一网络里的手机从隧道移到局域网源。面板的铸造/停止端点设计上仅限回环：在局域网地址打开的桌面浏览器会看到「配对面板仅限本机使用」横幅。
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

1. 打开设置卡片（设置 → Web 插件 → 远程访问）并打开**局域网访问**；卡片展示运行中的绑定、与宿主自身 `localBindHost` 并列的转发器状态、防火墙状态与可达局域网地址，本机没有局域网地址时还会说明局域网入口为何关闭。转发器立即启停、无需重启：本机网络变化后把开关关一次再打开，它才会跟随新的地址。
2. 启动 `dsh web`，点手机图标，面板铸造一枚全新的限时二维码。
3. 手机扫码（或打开复制的链接）：设备完成配对，进入由插件不依赖 cookie 交付的**官方 Web GUI**（`/pair-accept` → `/pair-app`），并重载到 `/`。链接指向公网基址时，落地页还会探测对外广告的局域网源（每个候选向 `/pair-ping` 发一次短超时的 no-cors 请求），把手机切到第一个应答的源，并在会话内记住该决定：它所在的那张公网页全程可用，探测从不阻塞配对；不在同一网络的手机原地不动。手机上竖屏适配层已生效——与桌面同布局、同实时状态。此后的重开（历史、书签）直接回到应用（https 源；见安全模型）。
4. **改为配对电脑**：复制同一链接，在另一台电脑的浏览器打开。相同往返后完整 Web GUI 在彼处经门控 `/remote` 通道运行；未配对电脑看到引导式拦截页，其后没有数据。一枚令牌配一台设备；下一台设备请刷新二维码。
5. 桌面徽标实时切换为已连接；设备列表列出已配对设备并支持逐设备取消配对，停止则全部撤销。
6. 配对有效期、设备上限、局域网栅栏策略（`requirePairingForLan`）、公网地址、自动隧道、固定域名中继与命名隧道令牌都在同一设置卡片配置。走哪张网络无需选择：二维码链接固定指向公网基址，手机与本机同网时由落地页自行切到局域网源；若该探测误判，用仅补丁可见的 `pairingSource`（`auto` | `public` | `lan`）钉住选择——卡片没有它的控件，卡片保存不会改动它。

## 通过互联网远程访问（隧道）

隧道进程重启（最常见的原因是移动网络闪断重连）过去会让插件在隧道离开 `running` 的瞬间把公网主机移出配对栅栏，于是二维码上仍显示着的地址会返回 403——连有意公开的 `/api/pair/status` 也不例外（issue #1547）。命名隧道的固定主机名与已注册的中继源本来就不会变，现在在整个重连期间保持受信任；快速隧道的上一个地址保留 60 秒宽限期（边缘可能仍在投递手机已经建立的连接），只有到期仍未恢复才彻底失效。

### 一键公网隧道（推荐）

在设置卡片打开**自动公网隧道**（autoTunnel）。插件运行自己的 Cloudflare 快速隧道（`cloudflared` 随包分发），把铸造的公网 URL 动态喂给二维码与配对栅栏，并同步姿态探测——手机随时随地都能配对。开启期间忽略下方手动公网地址与命名隧道令牌。铸造的域名是临时的，每次 `dsh web` 重启都会变化——下方的固定域名中继会把手机的访问源钉在固定地址上，重启不再需要重新扫码。宿主异常退出、来不及拆掉隧道时，`cloudflared` 子进程会留在系统里；因此每次启动都会回收自己记录的那个子进程（pid 与命令行都要逐字符匹配），绝不碰任何不是它自己启动的进程。

### 固定域名中继（默认开启；配对一次，重启不再重配）

快速隧道运行期间，插件会额外把当前隧道地址注册到 dsh-market 中继注册表，并把二维码重建在一个固定源上——`https://<id>.dsh-market.com`——每个 profile 首次运行铸造一次，存放在 `$DSH_HOME/remote-web-ui-registry/`。主机名永不变化，手机的书签与配对 Cookie 在 `dsh web` 重启后依然有效，且不需要 Cloudflare 账号、控制台操作或自己的域名。

- 注册以密钥认证：插件在身份旁铸造一个 256 位密钥，每次隧道启动（含崩溃重启）以退避重试同步映射。注册表不可达时，该次会话的二维码回退为裸快速隧道地址，并在面板中说明。
- 实例离线时，手机打开固定源会看到明确的「实例离线——稍后刷新即可，无需重新配对」页面，而不是死链。
- 在设置卡片关闭**固定域名中继**（relay）可让部署完全留在临时源上；注册表行会立即删除。信任说明：中继流量经由 dsh-market 边缘（由包作者运营的 Cloudflare Worker）转发——见安全模型。
- 中继控制面是附加式的：只要中继开启且 web 服务端口已绑定，插件就向 `https://dsh-market.com/api/relay/claim` 认领一条命名隧道租约——worker 找到或创建名为 `dsh-relay-<id>` 的隧道、写入 ingress（含必需的 catch-all 规则）与一条精确的代理 CNAME，并把该实例专属的隧道 Token 交回插件。被运营方翻到桥接传输的租约在账户里不收敛任何东西：该次 claim 不建隧道、不写 ingress、不建 CNAME，一次 Cloudflare API 调用都不发，只保留主机名与桥接授权，应答里也没有 `tunnel` 块——桥的数据面是实例自己的 Durable Object，既没有东西要建，也不占账户那 1 000 条隧道配额。插件据此在同一条主机名上运行命名连接器，与快速连接器并行；控制面应答的 `mode` 决定手机由哪一条服务，切换与回滚都不需要重启插件。认领失败不是致命的：快速隧道与注册表给出的源照旧服务，认领按封顶退避重试（`502` 会附带 `retryAfterMs`）。关闭开关只 `release` 租约（隧道与 DNS 记录保留，重新开启瞬时恢复），只有显式 `retire` 与 90 天未见的 cron 回收才会删除源。
- 桥接传输共用同一条租约：插件用租约密钥在 `Authorization` 头里连接 `wss://dsh-market.com/api/relay/bridge?id=<id>`，把每条桥接请求与手机的 WebSocket 都从这一个套接字上服务，转发公网源作为 `Host`，绝不改成它拨号的回环权威。控制面应答 `mode=quick` 时它空转；没有连接器附着时 Worker 在同一次请求内回落到快速路径，并在应答上标注 `x-relay-fallback: no-connector`。认领是唯一携带桥接授权的应答，因此它不等快速隧道：由桥接服务的实例即使在 `autoTunnel` 关闭时也能连到自己的对象。连接器把状态写进 `$DSH_HOME/remote-web-ui-relay-bridge.json`——状态、实例、端点、本地上游与最近一次拨号错误——于是「连接器从未附着」不必读宿主日志也能查到。

### 固定域名命名隧道（自带域名）

上方的中继已经把手机的访问源固定在共享的 dsh-market 子域名上。Cloudflare 命名隧道适合希望主机名落在**自己域名**下的部署：公共主机名永久固定，手机的书签与配对 Cookie 在 `dsh web` 重启后依然有效——配对一次，终身使用（会话空闲超过 `idleExpireMs` 除外）。

1. 在 Cloudflare 控制台创建一个 Tunnel，并把一个公共主机名（如 `dsh.example.com`）映射到 `http://127.0.0.1:3080`（`dsh web` 监听的端口）。
2. 复制隧道 Token，粘贴到设置卡片的**固定域名隧道令牌**（tunnelToken）。
3. 把同一主机名填入**公网地址**（publicBaseUrl）。Token 本身不携带主机名，缺了这一步隧道不会启动，并会给出缺失警告。

插件随后以与快速隧道相同的生命周期管理运行 `cloudflared tunnel run --token`：二进制随包分发，意外退出自动退避重启，运行中的隧道每 60 秒探测一次公网地址，连续两次失败即经同一条重启路径重铸隧道；姿态探测持续审计该固定主机的 `/api` 围栏。Token 作为设置密文存储，读取时脱敏。自动快速隧道开启时优先级更高。

`running` 不是终态：连接器失去 Cloudflare 边缘注册后，进程与 metrics 端口仍然活着，而已铸造的域名已经无法解析——插件过去会一直报 `running`，中继继续把手机转发到那个失效地址（Cloudflare 530 / Error 1016），而不是中继自己的离线页（工单 #1723）。就绪看门狗现在把「公网地址不再应答」（DNS 失败、连接被拒、或 530 这类 Cloudflare 5xx）在连续两次探测后判为隧道死亡，走既有退避重启路径重铸隧道并重新注册中继。尚未配对时返回的 `401`/`403` 仍视为存活，因为它是一次正常的往返。

#### 让入口服务端口跟随（可选，仅更新）

命名隧道的主机名永久固定，但它的 ingress 规则里写的是一个固定的本地端口（上面例子中的 `http://127.0.0.1:3080`）。之后 `dsh web` 换到别的端口监听——操作者加了 `--port`、换了 profile、旧端口被另一个实例占用——主机名仍然能解析，却回 502，而本插件这边一切仍以为地址可用。打开**Cloudflare 配置同步**（`ingressSync`），再填账户级 API 令牌（`cfApiToken`）、`cfAccountId` 与 `cfTunnelId`，插件就会让这一个数字跟随宿主实际绑定的端口：

- 启动只读取一次；只有当匹配到的规则服务偏离实际端口时才写入文档；
- 只改主机名与 `publicBaseUrl` 的 host 精确相等的那条规则的 `service`——因为 API 没有单规则补丁，写入是一次全量 PUT，但写前必须先证明其余所有规则与所有顶层键完全一致；
- 证明不了就不写、只上报：主机名缺失或重复、任一规则使用通配符、`ingress` 不是数组、缺少 catch-all、服务不是 http(s) 源，或服务托管在本机之外的任何地方——只改回环字面量（127.0.0.0/8、`::1`、`localhost`）与本机自己的局域网地址，邻居的地址或 DNS 名一律不动。插件从不新增规则，也从不补 catch-all；
- 写完再读回一次。读回不一致即判为冲突并就此停止：同一份隧道文档只有一个写入者，控制台或另一个同步在写它时须由人工核对；
- 目标就是实际绑定的端口：监听器还没绑定时一个请求都不发（由启动快速隧道的那套静置重规划把端口送到），且从不解析隧道令牌自身的格式。

状态帧上报 `off`/`waiting`/`applied`/`failed`/`conflict`，并附主机名、端口、两个服务字符串与原因，设置卡片把它渲染在开关旁边。快速隧道优先：`autoTunnel` 开启时没有命名隧道可更新，同步状态显示为关闭。

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

对端 API 来自官方 NPM SDK：用到的每个 `@deepseek-ai/*` 包都声明在 devDependencies（0.2.1-rc.3 cohort）中，TypeScript/Vitest 直接从 node_modules 解析类型——不需要 DSH 源码 checkout。消费侧 `prepare` 构建（`tsdown.prepare.config.ts`）不做类型检查地转译，git 安装同样无需 harness checkout。

## 检查

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Harness 契约依赖

锚定 0.2.1-rc.3 线；本构建依赖的接缝：

- **`sidebar.footer.action` 底部席位**（0.1.7 shell 组合）：侧栏声明并渲染远程入口占据的席位。
- **`ctx.layout.toggleSidebar()`**（packages/client/ui-layout）：鲸鱼按钮经官方面板动作面展开折叠侧栏。
- **`ctx.connection.authenticatedUrl()`**（packages/client/connection）：代理为内部凭据一次性兑换启动令牌的官方接缝（`src/inner-auth.ts`），使再发起的 `/api` 调用满足 harness 浏览器认证校验。
- **`__DSH_FILE_UPLOAD__`**（file-upload 客户端钩子）：上传服务在构造时读取一次的可选启动前传输。远程引导补丁会发布它，使后台上传留在被改写的主线程 fetch 上，而不是逃出通道的 Web Worker（issue #1580）。
- **`__DSH_TRANSPORT__.ownsHost`**（client-connection 传输钩子）：配对远程桌面的 host 模式翻转。只有当设备门控的应用落地页在 boot 补丁之前发布了 `__DSH_REMOTE_HOST_GRANT__` 标记时才会安装，因此翻转是服务器授予而非按源自称。本线没有 host 侧按方法特权锁定——配置面在客户端按 `connection.isLoopback` 分支——也没有 `api/gate` 瀑布（gate 监听器保持挂载，待未来部署获得该接缝；配对强制在插件自己的 `/remote` 通道上）。
- **web server 绑定的归属**：profile 里的 `- id: webserver` 行属于官方 bundle，本插件永不写它——同 id 补丁行整行替换该行 config，且用户补丁层无法可靠求值依赖 `webStartup` 的 `!!js` 表达式，因此该行保留 `host: !!js ctx.webStartup.host ?? '127.0.0.1'`，`--host`/`--port` 照旧能到达它。局域网可达性改为运行时状态：`src/lan-forward.ts` 的转发器在 web server 的实际端口上、按局域网接口监听，并转发到同一端口的 `127.0.0.1`。

栅栏辅助函数（`isTrustedApiRequest` / `isLoopbackHostname`）在 `src/gate.ts` / `src/routes.ts` 本地重实现：connection 插件不再导出它们，配对路由自带一份、只作用于二维码链接宣传的字面量。回环问题在那里被拆成两层：`isLoopbackUpstream`（回环套接字与 Host，刻意忽略转发头）只判断一个 Host 能否被应答，`isLoopbackClient`（无转发头）判断谁能拿到凭据或桌面载荷。`shared/host/loopback.ts` 的共享副本继续让 `isLoopbackRequest` 拒绝一切被转发的请求，并新增 `isForwardedLoopbackRequest`，描述某个路由族可在自己的默认关闭开关之后放行的那个更窄形态。

## 手动 E2E：局域网配对往返

单测/组件 spec 覆盖路由族、栅栏、通道、局域网转发器与其状态帧、适配层，但配对闭环涉及非回环源上的真实浏览器。凡改动 wire 契约或连接循环之后请重跑：

1. 启动隔离实例：`DSH_HOME=/tmp/dsh-qa dsh --profile web --no-open --port 3191`；在 `http://127.0.0.1:3191` 打开卡片、打开**局域网访问**，确认卡片报告转发器已在本机局域网 IPv4 与该端口上监听。
2. 浏览器打开**回环** URL（`http://127.0.0.1:3191`）：手机图标位于侧栏底部；面板立即铸造二维码，链接形如 `<lan-url>/pair-accept?pair=<token>`。若配置了公网地址，链接改指该源（随处可达），网络选择由落地页完成，见「使用」一节。
3. 在第二个标签（390x844 触控模拟）打开该链接：链路在 https 源上是 `/pair-accept → /pair-app?grant=<一次性> → /`，在纯 HTTP 局域网上则停在 `/pair-app`；它设置设备 cookie、消费一次性授权、交付打过补丁的官方应用壳并启动 UI——`document.body.classList` 带 `dsh-remote-portrait`、适配样式表与小鲸鱼按钮存在、`__DSH_TRANSPORT__.ownsHost` 为 `true`。设置面渲染 host 数据（host 模式），而非 memory 镜像。https 部署下应用壳还会注册重开 service worker（`/pair-app.sw.js`）；在该标签刷新 `/` 会直接进入应用而不是 harness 401。纯 HTTP 局域网下同一个标签刷新 `/pair-app`，同样凭配对 cookie 进入应用。
4. 桌面徽标实时切换为已连接；局域网源的桌面页面则显示配对面板仅限本机使用横幅且不开状态流。
5. 桌面点停止切断设备：下一次请求 403 且 `unpaired`（栅栏页提供手动配对令牌输入）。

公网路径是同一条经隧道的往返（见「通过互联网远程访问」）：回环铸造 → 设备打开公网二维码 URL → 接受 → 官方 UI；当对外广告的局域网源确实应答时（`curl -s -o /dev/null -w '%{http_code}' http://<lan-ip>:<port>/pair-ping` 应为 204），落地页会把自身替换为 `http://<lan-ip>:<port>/pair-app?grant=<一次性>`，UI 从局域网源启动。同一会话内再次扫公网二维码会重新落在公网源，因为决定里记着这次没有生效的切换。只有 `publicBaseUrl`（插件配置）命名隧道主机；`--trusted-host` 不属于本配对流。桌面面板仍在 `http://127.0.0.1` 打开。

## 安全模型

- **配对是 `/remote` 通道的访问控制，且无条件生效**：每个请求必须携带有效配对设备 cookie，在任何字节转发之前强制。缺失或被撤销的会话收到 HTTP 403，JSON 拒绝携带 `error.code: "unpaired"`；浏览器 `EventSource` API 只暴露流失败，不暴露响应体。该门**不**跟随 `requirePairingForLan`：通道会用进程自身的浏览器认证凭据重新发起每一次调用，放行未配对调用者等于把该权限交出去。局域网策略只作用于普通 `/api` 面，永远不能放宽本通道（issue #1665）。
- **通道携带进程自己的内部凭据。** harness 浏览器认证 cookie 与 authority 绑定（为浏览器访问过的确切 `host:port` 签发）且没有回环豁免，因此转发到 `127.0.0.1` 的再发起请求无法复用设备的 cookie。插件因此自行兑换一次自己的启动令牌——与浏览器首次访问执行的是同一次交换——并把所得 cookie 附到再发起请求上。该凭据只在上面的配对门之后被使用；停止/取消配对会立即停止对它的使用。

- **通道转发调用者自己的请求头，只把属于本通道的那些留在门外（issue #1925）。** 插件可能用自己的头认证自己的调用——实测命中案例是 `@michengai/dsh-im-connect` 的 `/sessions/ensure` 带 `x-dsh-im-connect-client`——所以再发起的请求不再按固定白名单重建：除本通道自己掌握的头之外全部透传。它把 `host` 改写为回环权威、用进程自己的内层凭据替换调用者 cookie、合成 `sec-fetch-site: same-origin`，并丢弃 `origin`/`referer`、整族浏览器 fetch 元数据（`sec-*`）、逐跳头（含调用者自己在 `Connection` 头里点名的那些）、转发标记（`x-forwarded-*`、`cf-connecting-ip`、`forwarded`、`x-real-ip`——再发起的请求是回环请求，边缘留下的戳会让围栏把它判成远程），以及无 cookie 的设备凭据 `x-dsh-remote-device`：门在入口消费它，绝不向外转发。`accept-encoding`、`range` 与 `if-range` 同样不透传，因为本代理复制的响应头里既没有 `content-encoding` 也没有 `content-range`。
- **运行时现实：局域网浏览器走 `/remote` 网关，不走原生 `/api`。** 本插件从不重绑 web server，因此宿主停在本机回环上，harness 的 `/api` Host 围栏对局域网权威返回 403。转发器让宿主在局域网上可达，但那里只有本插件自己的面在应答：配对入口页、状态视图与门控 `/remote` 通道。要在局域网权威上恢复原生 `/api`，需要 harness web server 的 `trustedHosts`，这不在本包范围内；运维自己用 `--host` 把宿主绑到网络时，那块面只由 harness 围栏约束，因为官方运行时没有任何组件发出 `api/gate` seam（对照本仓库安装的 0.2.1-rc.3 包核实）。在这种部署下，设备已经兑换过的浏览器凭据在停止/取消配对后仍然有效，直到其自然过期（30 天）——撤销约束的是 `/remote` 通道与配对 cookie，而不是那个凭据。插件会对 `/api` 姿态做探测并大声告警；请把宿主暴露到网络当作深思熟虑的决定，在共享机器上优先回环加隧道。
- **配对设备是完全控制凭据。** host 模式下它可达完整 host API——聊天、会话、设置、凭据、Agent 预设、产出物——与 SDK 对回环桌面的信任一致。只有三个控制面（配对、自更新、插件安装/卸载）保持物理本地。只配对你控制的设备；停止或逐设备取消配对立即撤销。
- **控制端点仅限回环，状态视图对隧道访客只答最小载荷**：铸造/停止/撤销/重命名/合并、设备列表、事件流与 lan-bind 状态只应答桌面请求（回环套接字与回环 Host、无转发头），门控通道同时让自更新与插件安装路径保持物理本地。`/api/pair/status` 经隧道可达，但被转发或未配对的调用者只会收到 `{ ok, paired, requirePairingForLan, phase, lanAvailable }`；完整快照——令牌过期时间、公网隧道 URL、计数——与逐设备列表只留在桌面。局域网源浏览器看到「配对面板仅限本机使用」横幅。
- **带转发头的请求一律视为远程（issue #1906），只有运维本人可以收窄它。** 部署在宿主前面的反向代理——Cloudflare 隧道、frp、nginx 反代——拨的是 `127.0.0.1:<port>` 并把 Host 头改写成该上游字面量，于是源站为一个公网请求同时看到回环套接字与回环 Host：回环判定两半都成立，配对门会直接放行。围栏因此把携带 `CF-Connecting-IP` 或 `X-Forwarded-For` 的请求判为被转发、永不视为本机。该规则只存在一份（`shared/host/loopback.ts` 的 `isProxiedRequest`，由 `isLoopbackRequest` 消费），并随同步副本在全部包生效。本包把这个问题拆成两层（issue #1919）：`isLoopbackUpstream`（回环套接字与 Host，刻意忽略转发头）只判断一个 Host 能否被应答，因此隧道访客能到达配对状态与入口页；`isLoopbackClient`（无转发头）继续守护配对门、`/api/pair` 控制面与桌面载荷。本包没有任何开关会把被转发的请求放进承载凭据的面；同级 task-board 插件把那个更窄的反例做成自己的默认关闭开关（`trustForwardedProxy`）。真实的桌面请求（回环套接字 + 回环 Host + 无转发头）仍判为本机；浏览器同源标记逻辑未改动，跨站请求照旧被拒。残余风险：会剥掉这两个头的代理会让请求重新回到与桌面相同的形状，任何基于头的规则都无法区分——请让代理转发 `X-Forwarded-For`（Cloudflare 与 nginx 默认转发），并注意本机进程本来就能伪造任何请求头。
- **后台文件上传同样走通道。** 官方上传服务优先使用 Web Worker 载体，其独立全局对象不受主线程补丁影响；因此引导补丁（以及作为兜底的浏览器补丁）会发布官方启动前钩子 `__DSH_FILE_UPLOAD__`，并把打过补丁的 `fetch` 交给它：原始 `/api/session/uploadFileBinary` POST 会被改写到 `/remote`，并像其他受门控调用一样携带设备凭据。没有该钩子时，配对浏览器的上传会绕过通道，被 harness 浏览器认证围栏拒为 401（issue #1580）。该钩子仅在非回环源、且通道安装期间发布，且永不覆盖页面已有的钩子。
- **落地页 URL 只携带一次性授权，绝不携带设备 ID。** `/pair-accept` 签发 256 位、一次性消费、TTL 60 秒的授权并 303 到 `/pair-app?grant=<g>`；落地页消费它——无论成功、过期还是重放都先删除记录，因此重放或过期的授权解析不出任何设备——再由自己的响应把设备 ID 交给应用壳。设备 ID 是活的会话凭据，因此永不进入 URL、地址栏或重定向路径上的任何日志。请求经 TLS 到达时（`x-forwarded-proto: https`）配对 cookie 带 `Secure`，局域网明文 HTTP 下不带——在那里 Secure cookie 会被浏览器直接丢弃。代理把 Host 改写成自己的回环上游、且已配置公网基址时，303 改指该公网源，因为访客出示的那个字面量是访客自己的回环，而不是本机的（issue #1919）。
- **应用落地页不依赖 cookie。** 配对后二维码把设备带到 `/pair-app`——由本插件直接交付官方应用壳，不经过 harness 索引认证门；设备凭据经 `x-dsh-remote-device` 请求头（fetch）与 `device` 查询参数（WebSocket 升级）由引导补丁从 sessionStorage 挂载。因此手机浏览器完全禁用 cookie 时链路依然成立；有 cookie 时配对 cookie 仍是主凭据，手机路径不再需要 harness 浏览器认证 cookie。
- **按实例的隧道 Token 只够运行那一条隧道。** 控制面把 `dsh-relay-<id>` 隧道专属的 Token 只发给已证明持有该 id 密钥的调用方；插件经 `TUNNEL_TOKEN` 环境变量把它交给 `cloudflared`，从不进入命令行参数、日志或设置文件，因此本机的 `ps` / proc 看不到它。泄漏该 Token 的人能顶替该主机名对外服务，但读不到实例、够不到别的实例、也写不了 DNS。Worker 侧的 Cloudflare API Token 是账户级凭据（Cloudflare Tunnel 编辑加该 zone 的 DNS 编辑），只存为 Worker secret，永不进入插件、设置文档或进程列表；未配置时认领端点以 `503 cf-api-unconfigured` 安全失败，既不创建资源也不写租约行。
- **配置同步的 API 令牌是本机密文，且只有一个网络去处**：账户级 Cloudflare API 令牌以设置密文存储（读取脱敏），只发往 `https://api.cloudflare.com`——默认传输层在构造请求之前就拒绝其它源——绝不进入子进程参数、日志行、状态帧或任何浏览器可见字段。状态帧携带公网主机名、本地端口与两个服务字符串，这些都是操作者本来就掌握的事实，没有任何一项来自凭据。401/403 直接终止而不是重试，且只要 plan 无法证明「只差一条服务」，就绝不发起写入。
- **重开由 service worker 接管（仅 https 源）。** 配对过的手机从历史、书签或标签恢复回来时导航到裸 `/`——插件不拥有的路径，harness 兜底座会用浏览器认证 401 应答（不依赖 cookie 的流程永远拿不到那份凭据）。应用壳因此注册 `/pair-app.sw.js`（与 `/pair-app` 同一栅栏；脚本是不含任何秘密的惰性逻辑）：只拦截对 `/` 的导航，经 `/pair-app` 网络优先地重发应用壳——同时校验设备 cookie 并刷新其活跃时间，每次重开也在为会话续期——离线时回退缓存的壳，插件不再应答时把导航原样放行（被撤销的设备随后看到 harness 应答或双语重扫页）。纯 HTTP 的局域网源永远不是安全上下文，因此也不会注册该 worker；那里的应用壳把 `/pair-app` 留在地址栏，刷新、书签或标签恢复都会经同一个设备门控落地页重新校验设备 cookie（配对失效后则落到双语重新配对页）。
- **撤销按请求生效**：停止落地时已在途的请求会完成；下一个请求 403。
- **配对设备会话默认持久化**：设备会话（非限时 QR 令牌）写入 `$DSH_HOME/remote-web-ui-devices.json`（0600，临时文件 + 原子改名）。`dsh web` 重启后配对 cookie 依然有效。刷新二维码铸造新令牌；重启不会恢复当前二维码。空闲超过 `idleExpireMs`（默认 30 天；重开 service worker 每次接管导航都会刷新该窗口）的会话被删除并须重新配对。设备 id 即会话凭据；自定义设备名只是展示元数据，与设备会话存在同一文件，永不参与授权判定。需要时可用 `devicesFile` 指定其他绝对路径。更换 `cookieName` 会使现有设备失效（预期行为）。无法落盘的撤销（DSH_HOME 只读、磁盘写满）会删除过期设备库，而不是把被撤销的会话留在磁盘上，因此下次启动不会恢复它。
- **局域网入口永不让请求看起来像本机**：转发器丢弃客户端自带的 `Host` 与它发来的每一个转发头，再盖上它被到达时的局域网权威与 `X-Forwarded-For`，因此回环上游这一跳仍然以被转发请求的身份到达，每一个判断「这是不是桌面」的围栏都会拒绝它。局域网套接字抢不到时——网络变化后地址消失、端口已被占用——只损失局域网入口：回环监听器永不受影响，失败会记入日志并以 `forward.error` 上报，且不写任何文件，因此网络变化既不需要改 profile，也不需要重启。
- **桌面栅栏策略公开，但它不是访问控制**：`/api/pair/status` 只暴露布尔 `requirePairingForLan` 策略，供远程桌面在设置作用域可用前选择正确传输。该开关只作用于裸 `/api` 面：关闭它让未配对调用者在 harness 自己的围栏之下使用那块面，永远不会放宽 `/remote` 通道——该通道无条件要求配对凭据。该字段不是凭据，不暴露令牌、设备、计数或隧道 URL；隧道访客会收到的最小载荷见上面那条控制端点规则。
- **设备凭据仍会出现在 WebSocket 查询串中。** WS 握手无法携带 Web API 的请求头，因此无 cookie 凭据以 `?device=<id>` 传递；插件自己的 `/remote` 处理会消费它、且不再转发给内层回环请求，但源站访问日志、中继 Worker 与 Cloudflare 边缘仍会看到一条可认证为该设备的 URL。支持 cookie 的浏览器改用 cookie 认证握手。计划以短时一次性 WS 票据替代。
- **快速隧道主机名每次运行都变**：`trycloudflare.com` URL 每次 `cloudflared` 启动都随机，`publicBaseUrl`（或自动隧道）须随之刷新。固定域名中继会把一个固定的 `<id>.dsh-market.com` 源前置在该临时地址上（随自动隧道默认开启）；命名隧道模式（`tunnelToken`）是自带域名的替代路径。Token 本身作为设置密文存储（读取脱敏），不会写日志，也不会回传浏览器半区。
- **中继只改变访问源，不改变信任根**：中继开启时，手机访问的是 `https://<id>.dsh-market.com`——一个 dsh-market 的 Cloudflare Worker，它查询实例当前的隧道地址并逐字节转发请求——配对 Cookie 与所有应用层校验仍留在实例上，worker 不终结任何配对。变化的是传输路径：中继流量经过包作者在 Cloudflare 边缘运营的基础设施，作者的 worker 可以观察到这些流量——这与 Cloudflare 自身对裸 `trycloudflare.com` 快速隧道的可见性相同。注册表把每个 id 绑定到一个 256 位密钥的 SHA-256 哈希（明文只存于 `$DSH_HOME`，0600），只接受 `*.trycloudflare.com` 目标，对注册做限流，且除映射外不存储任何数据；关闭中继即可让部署完全留在临时源上。

## 已知限制与后续工作

- **局域网入口跟随转发器，而不是跟着 profile 写入走**：开关在进程运行期间启停它，因此这里没有需要重启的东西；网络变化后把开关关一次再打开即可。局域网地址已消失或端口已被占用时只损失局域网入口——回环监听器不受影响，状态帧以 `forward.reason`（`off`、`host-bind`、`no-address`）与 `forward.error` 上报。
- **旧版受管块会被清理一次，其中一种形态仍需手工介入**：本插件截至 0.4.8 写下的受管块会在每个进程首次激活时被剥离——原子替换、只在它确实存在时动手、保留文件权限且不回写任何内容——并由 `legacyBlockRemoved` 上报；清理在插件激活时运行，因此升级后的构建要到下一次 `dsh web` 启动才会执行。例外是固定 `0.0.0.0` 的块：DSH 0.2.1-rc.2 及以后的宿主在本插件加载之前就拒绝该值，那台宿主根本到不了清理这一步。手动编辑 profile 的 `cordis.patch.yml` 一次：删掉该块的两行标记注释（`# --- remote-web-ui lan-bind block ...` 与 `# --- end remote-web-ui lan-bind block ---`），以及两者之间那条 `- id: webserver` 条目——不要删掉整个标记区域，因为其他插件行可能就落在其中。
- **配置同步假设同一份隧道文档只有一个写入者**：它先读、证明、写入、再读回，但 Cloudflare API 没有条件写入，因此并发写入者（浏览器里开着的控制台、另一台机器上的同一同步）可能落在读取与 PUT 之间。那次写入便是一份可能带上了对方状态的全量文档，而读回不一致会被判为 `conflict` 且绝不自动重写。每个隧道只在一台机器上开启同步；第二台会在状态帧里显形，而不是被静默重试。整条链路只有离线测试覆盖：传输层是可注入 seam，测试与本次交付都没有驱动真实 Cloudflare 账户。
- **worker 注册被拒绝时会退回 harness 栅栏**：重开 service worker 只在存在 service worker 的源上注册。当一个本已安全的源拒绝注册（部署策略、浏览器加固配置）时，地址栏此时已经改到 `/`，重开需要重新扫码；纯 HTTP 局域网路径没有这个缺口——它的应用壳停在 `/pair-app`。
- **适配选择器跟随官方构建**：语义后缀策略可在 hash 变化中存活，但语义改名不行；每次官方 GUI 升级需要一轮视觉 QA（参考 dsh-LAN，这些后缀在多次官方发布中保持稳定）。
- **开发 HMR**：`dsh web --dev` 按路径轮询每个 roster bundle，重建本包（自身 `tsdown --watch`）即热重载客户端 bundle；host 半区需要重启。
- **profile 里挂了 `@deepseek-ai/dsh-hmr` 行会让所有设置保存失败**：只要 `hmr` 服务存在，官方配置编辑器就会把写入包进 `hmr.runExclusive`，而在本 cohort 上这种写入会被判为嵌套事务——Host 返回 `HMR transactions cannot be nested`，本插件的各设置卡片（以及官方设置页）都显示保存失败。该行由用户自行添加（没有任何 bundle 自带），桌面版 profile 用它为本地插件的 host 半区做热重载。从 profile 补丁里删掉 `- id: hmr` 这一行即可恢复保存；只在需要热重载该插件时再加回。观察于 2026-09-30，桌面版客户端 0.2.1-rc.2。

## 依赖说明

`qrcode.react`（MIT，活跃维护，支持 React 16–19）以无依赖 SVG 组件渲染二维码——无 canvas、无服务端出图。它构建期内联进客户端 bundle（与官方 skin/turtle-ui 插件内联非共享依赖一致），profile 安装因此无需 dsh peer 闭包之外的运行时依赖。`schemastery` 是 DSH 标准配置 schema 校验器。

## 遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一条匿名安装心跳：一个随机 localStorage id 与本包名，仅此而已。服务端只存该 id 的加盐哈希，永不存 IP 地址，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。