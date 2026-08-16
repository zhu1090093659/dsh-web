# DSH Remote Web UI

[English](README.md) | 中文

> 移动端远程控制 + 一键远程更新：扫码配对后用手机远程使用当前 dsh web 工作区；点击侧边栏更新按钮自动检查并更新 dsh-web-ui 全家桶。

本仓库是 DeepSeek Harness（DSH）的外部插件包：为 dsh web GUI 提供扫码配对式移动端远程控制，外加 dsh-web-ui 全家桶的一键自更新。它是单一双半区包——host 半区持有配对令牌、设备会话、`/api/pair` 路由族与 `/api/update` 面板；浏览器半区渲染侧边栏底部入口（下载触发按钮与设置按钮旁的手机图标）、带二维码的配对面板、实时设备状态，以及停止/刷新/复制操作，还渲染探测并执行更新的更新面板。

## 功能

- **入口**：侧边栏底部靠设置按钮旁的手机图标。
- **面板**：「移动端远程控制」标题、「扫码或在手机上打开链接，即可远程控制当前工作区」副标题、「手机扫码连接」卡片（含状态区「等待手机连接」+ 状态徽标）、大号二维码、「无法扫码？可以在手机上打开链接」提示，以及三个按钮：停止 / 刷新二维码 / 复制链接。
- **手机侧**：扫码将手机与一次性、限时令牌绑定，并落地到 **`/m` 独立移动端界面**——一款专为小屏设计的轻客户端（见[截图](#截图)），而不是把桌面 UI 塞进手机。链接携带 `workspace` 参数，手机落地到桌面正在查看的同一工作区。
- **安全**：一个有效的一次性令牌（刷新会使旧链接失效；已接受的令牌不可复用；令牌会过期）。停止会撤销每一台已配对设备与当前令牌——已配对设备在下一次请求时被切断。当插件 `requirePairingForLan` 门开启（默认）时，每个非 loopback 的 `/api` 请求必须携带有效的已配对设备 cookie，因此二维码是进入暴露在局域网上的 dsh web 的唯一途径。
- **实时状态**：桌面面板经 SSE 流实时镜像配对状态（等待 → 已连接 → 已断开）。
- **远程更新**：侧边栏底部的下载触发按钮（手机图标左侧）打开更新面板，它探测 npm registry 上已安装的 `@linxin666/dsh-*` 全家桶版本。当存在较新版本时，面板自动执行更新（在所属 dsh profile 内 `pnpm update --latest`；pnpm 缺失时依次回退 `corepack pnpm`、`npx --yes pnpm`，Windows 上经 `cmd.exe` 执行以解析 npm 安装的 `.cmd` shim；由仅 loopback 的 `/api/update/status` + `/api/update/run` 端点驱动）并请求重启 dsh web 以生效。pnpm 绿色退出后还会对照 registry 复核已装版本：绿色退出但版本纹丝不动（例如 pnpm 的 `minimumReleaseAge` 门禁静默跳过同日发布的新版本）会报告为「未更新成功」并附配置指引，而不是误报成功。本地 link 安装（开发模式）会被探测到，只报告 npm 状态而不更新。

## 截图

390pt 视口下的手机界面。亮色是默认主题；每个页头内的日/月切换随时翻到暗色调色板。

- **工作区**——列表，每行一个工作区及其各自的会话：![Workspaces](docs/screenshots/mobile-workspaces.png)
- **会话**——一个工作区的会话，头部是 新建会话 按钮（创建附加到该工作区的空白会话并立即打开）：![Sessions](docs/screenshots/mobile-sessions.png)
- **聊天**——带桌面折叠纪律的消息（折叠的 深度思考 推理与 工具 工具调用行）、钉住的输入栏带 模型 / 权限 chips，以及 agent 工作时的实时流：![Chat](docs/screenshots/mobile-chat.png)
- **模型选择**——底部弹层，provider 分组目录 + 每模型 思考强度 区（与桌面使用的同一份 `session.models` 目录）：![Model sheet](docs/screenshots/mobile-model-sheet.png)

## 需求

- 其 `dsh` CLI 支持 profile（`dsh --profile`、`dsh plugin`）的 DSH 安装——本包所依托的 profile/bundle 机制。
- 局域网使用必须手机可到达服务器：用 `dsh web --host 0.0.0.0` 启动。默认 `127.0.0.1` 绑定时，面板会显示明确说明而不是死二维码——除非配置了公网 base URL（见下文「通过互联网远程访问」），那会让二维码在无需重新绑定即可从任意位置访问。面板的 mint/stop 端点设计上仅限 loopback：在局域网 URL 打开的桌面浏览器只会看到「配对面板仅限本机使用」横幅——请在 `http://127.0.0.1` 打开面板，让手机使用配对链接。
- 一键公网隧道（`autoTunnel`）需要 `cloudflared` 平台二进制随包分发（其 postinstall 会下载它；运行时下载覆盖跳过 postinstall 脚本的安装器）。无需用户侧工具、账号或域名——Cloudflare quick tunnel 免费且匿名。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-remote-web-ui

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-remote-web-ui

```

重启 profile（`dsh web`），然后打开侧边栏底部的手机图标。插件的 `cordis.patch.yml` 插入装载两个半区的单条插件行。

> `github:<org>/<repo>` 安装适用于包位于仓库根部的独立仓库（`prepare` 脚本在安装时构建 `lib/`；pnpm ≥10 会阻断它，直到你把打印的 key 复制进 profile 的 `pnpm-workspace.yaml` `allowBuilds` 并重跑）。monorepo 子包使用上面的 `link:` 形式。

## 使用

1. `dsh web --host 0.0.0.0`（打印的局域网 URL 确认可达性）。
2. 点击手机图标 → 面板铸一枚新的二维码。
3. 用手机扫码（或打开复制的链接）：手机绑定并落到 **`/m` 独立移动端界面**——不在小屏显示桌面 UI。该界面刻意精简：
   - 直接进入工作区（每个工作区的会话列表上有 新建会话 按钮：它经 host 的 `session.create` 创建附加到该工作区的空白会话，并立即打开新聊天），
   - 一个工作区的会话**增量**加载（每页 20 行，"加载更多会话"继续；绝不同时加载整份列表），
   - 打开会话**按需**抓取聊天内容（历史分页，"加载更早的消息"继续往回翻），
   - 实时流随消息到达展示新消息，带发送自己消息的输入框（默认 **Enter 发送、Shift+Enter 换行**；设 `mobileEnterToSend: false` 后 Enter 改为换行，发送仅走「发送」按钮），
   - **亮色优先主题**：界面默认亮色调色板；每个页头内的日/月切换翻到暗色调色板，选择跨访问持久（localStorage），
   - 消息按桌面折叠纪律渲染：推理隐藏在被折叠的 深度思考 揭示下面，工具调用隐藏在被折叠的 工具 行下面（点击查看每个调用的参数），超长回答藏在显式 展开全文 切换下面，每行带时间，并且 assistant 回复按 GFM Markdown 渲染（标题 / 加粗 / 斜体 / 行内码 / 代码块 / 列表 / 表格 / 引用 / 链接 / 图片；零依赖自写渲染器，先转义再白名单协议，移动端 bundle 体积几乎不变；KaTeX 公式暂不支持，后续单独评估），用户消息保持纯文本，
   - 输入栏工具条带 **模型** 选择器（provider 分组目录 + 每模型 思考强度 effort 区）与 **权限** 选择器（权限预设；完全权限 需要显式确认步骤）。两者都走 host 自己的 `session.models` / `session.selectModel` RPC 与 `/permission` 命令——手机改的与桌面改的是同一个会话设置——外加 **显示** 弹层（含 工具调用 与 系统提示词 两个持久开关）和一个 上下文 用量 chip（显示最近一次助手回答的上下文占用百分比）。
4. 桌面徽标实时翻到 已连接；手机离开时回落到离线/断开。
5. 刷新二维码 使旧链接失效并铸一枚新的。停止 撤销移动端访问：已配对设备下一次请求 403，包括其实时流。

该移动端界面完全自包含在本插件内：`/m` 页面及其数据通道（`/m/api`）由插件自己的路由伺服，**无需任何 harness 源码改动**——手机的 RPC 调用走插件的 `/m/api` 代理（它委托给 host 的 ApiProxy 服务并自己分页 `session.list`），因此被隧道化的 Host 永远不必进入连接插件的信任围栏。手机受其已配对设备 cookie 与显式方法白名单门控（settings/credentials/host-action 域手机永远不可达；模型读写限制于建议性的 `session.models` / `session.selectModel` 对，创建限制于 `session.create`（仅工作区 id——手机绝不自命名工作目录），权限选择器只通过已放行的 `session.prompt` 发送模式无关的 `/permission` 命令）；实时流在 `/m/api/events.mux` 上经 Server-Sent Events 送达。

### 行为说明

- 移动端输入框默认 Enter 发送（Shift+Enter 换行）。在插件设置卡片（或 profile patch）把 `mobileEnterToSend` 设为 false 后，普通 Enter 改为插入换行，只有「发送」按钮会发送；手机打开聊天时经自己的 `/m/api` 偏好方法读取该开关。在支持 `field-sizing: content` 的浏览器上，输入框随草稿自动增高，最高 120px 封顶（两种模式一致）。
- 安装本插件会门控非 loopback 的 `/api` 访问于配对之后（见 `src/index.ts` 的 `requirePairingForLan`）。经局域网 URL 打开的桌面浏览器必须像任何远程设备一样配对；loopback（127.0.0.1）不受影响。把 profile patch 里 `requirePairingForLan` 设为 false 可恢复开放局域网行为，同时保留令牌/状态/撤销。
- 二维码链接基于机器的非内部 IPv4 字面量构建；多宿主主机（Wi-Fi + 有线，或代理/VPN 虚拟适配器）会显示单选器供你发布手机实际可达的网络。第一个字面量是默认值。设 `publicBaseUrl` 后，单选器在顶部额外加一项 公网地址——默认二维码改用公网 base，选中局域网字面量会重新铸一枚网内链接。
- 配置的 `publicBaseUrl` 本身满足可达绑定需求：`dsh web` 绑定 `127.0.0.1`（不带 `--host 0.0.0.0`）仍能经隧道铸出可用的公网二维码链接。

## 通过互联网远程访问（隧道）

### 一键公网隧道（推荐）

在插件设置卡片打开 `autoTunnel`（或设 profile patch `autoTunnel: true`）。插件随后运行自己的 Cloudflare quick tunnel——`cloudflared` 二进制随包分发，无需安装、账号或域名——并自动接通一切：

- 铸出的 `https://xxx.trycloudflare.com` URL 成为二维码 base，因此任意地点的手机都能配对。面板显示隧道状态（starting / running / failed 带原因），崩溃按退避自动重启。

二维码在隧道报告其 URL 前保持仅局域网，且隧道重启会铸一枚**新的** hostname——插件清除旧链接并铸一枚新的，用户永远不必触碰配置。注意 quick tunnel 是公网的：任何拿到 URL 的人都能加载静态页；配对门才是真正的围栏，手机的数据通道（`/m/api`）由自己的已配对设备门加方法白名单保护——被隧道化的 Host 永远不必进入连接插件的信任围栏，因此 **auto tunnel 工作无需任何 profile 或 harness 定制**。

### 手动隧道（自带）

二维码链接通常是局域网 URL，所以家外的手机无法使用。把隧道指向 dsh web 端口，并告知插件其公网地址——二维码随后由隧道 URL 构建，面向手机的配对围栏信任隧道化的主机。涉及两个钮：

- **`publicBaseUrl`**（插件配置，在 profile patch 或设置卡片里）：公网 origin，如 `https://foo.trycloudflare.com`。二维码链接由它构建，`accept`/`heartbeat`/`status` 接受它的主机。畸形值被忽略并告警（保持仅局域网行为）。
- **`--trusted-host <authority>`**（dsh web flag）：连接插件传输层 `/api` 围栏也必须接受公网主机——否则经隧道的每个 `/api` 请求在**配对层之前**就 403（插件自己的围栏只覆盖 `/api/pair` 路由）。请像隧道转发那样精确传入公网主机（或 `host:port`）。

### Cloudflare 隧道（quick tunnel——无账号、无域名）

先安装一次客户端（macOS：`brew install cloudflared`；其他系统：从官方 GitHub releases 拿 `cloudflared-darwin-{arm64,amd64}` 二进制）。然后：

```sh
# 1. 暴露本地端口（dsh web 监听的任何端口）：
cloudflared tunnel --url http://127.0.0.1:3080
#    打印类似：https://xxxx-xxxx-xxxx.trycloudflare.com

# 2. 以该主机为信任启动 dsh web（需要保留局域网访问时也用 --host 0.0.0.0）：
dsh web --trusted-host xxxx-xxxx-xxxx.trycloudflare.com
```

然后在 profile patch（或插件设置卡片——它会热重载）里设 `publicBaseUrl: https://xxxx-xxxx-xxxx.trycloudflare.com`。在 `http://127.0.0.1` 打开手机图标，从任意处扫码：手机绑定、重载进移动端界面，心跳保持其在线。

说明：

- Quick tunnel 免费无需登录，但 hostname 每次运行随机：每次 `cloudflared` 重启都变，所以 `--trusted-host` 与 `publicBaseUrl` 要一起更新。Cloudflare 不保证 uptime；在途请求并发受限（超过返回 HTTP 429），且 **Quick Tunnels 不转发 Server-Sent Events**。`Tailscale Serve`（以及单端口的 `tailscale serve`）行为相同。SSE 是手机**实时接收消息**的方式，所以在 quick tunnel 或 Tailscale Serve 上移动端聊天回退到轮询：手机仍收发消息（其余都走普通 HTTP，可转发），只是新消息可能晚几秒而非即时。SSE 通道一旦静默，插件按短间隔轮询 `session.history`，SSE 恢复后立即恢复流式。要真正实时推送，把二维码指向能转发 SSE 的隧道——Cloudflare **named tunnel**（域名托管在 Cloudflare，见下），或普通 TCP 端口转发（局域网地址、`tailscale up` 虚拟接口地址，或手动 `ssh -L` / 指向端口的 cloudflared TCP 隧道）。
- Quick tunnel 是公网的：任何拿到 URL 的人都能加载静态页。配对门才是真正的围栏——未配对设备每个 `/api` 调用都 403——所以请保持 `requirePairingForLan` 开启。
- 稳定 hostname 可从 Cloudflare 控制台创建 named tunnel（Networking → Tunnels；域名必须托管在 Cloudflare），并在同样两处使用其 hostname。Cloudflare 不保证中国大陆可达性；请本地验证。
- Tailscale 是无需任何插件改动的个人替代：其虚拟接口地址（`100.x.y.z`）自动出现在二维码的地址选择器中，同一 tailnet 的手机像局域网主机一样到达它。

## 开发

从这个仓库工作（无需 sibling checkout）：

```sh
cd ~/code/dsh-web-ui
export NPM_TOKEN='<token>'   # 仅当私有 @deepseek-ai 认证仍需要时
pnpm install
pnpm --filter @linxin666/dsh-remote-web-ui run build
pnpm --filter @linxin666/dsh-remote-web-ui test
pnpm --filter @linxin666/dsh-remote-web-ui run typecheck
```

peer APIs 来自官方 NPM SDK：这里用到的每个 `@deepseek-ai/*` 包都声明在 devDependencies（rc.6）里，TypeScript/Vitest 直接从 node_modules 解析类型——无需 DSH 源码 checkout。消费者侧 `prepare` 构建（`tsdown.prepare.config.ts`）不做类型检查转译，因此 git 安装也无需任何 harness checkout。

## 检查

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Harness 契约依赖

本插件依托三个在较老 checkout 里可能不存在的 harness seam：

- **`api/gate` 瀑布**（packages/client/connection）：/api 路由与事件 WebSocket 升级在信任围栏后发出该事件，插件可据此实施应用层访问控制。没有它，撤销就没有服务端执行力。
- **`sidebar.remote` 底部座位**（packages/client/ui-sidebar）：侧边栏声明并渲染手机入口占据的座位。
- **局域网运行时连接修复**（host-apiproxy 为不安全上下文 origin 的 `mintRpcId` 回退；20260808 分支在 mux 流之后打开 host 流的连接循环）：没有它们，浏览器 runtime 根本无法在纯 HTTP 局域网页上运行（本特性的移动端侧）。

围栏辅助（`isTrustedApiRequest` / `isLoopbackHostname`）在 `src/gate.ts` / `src/routes.ts` 本地重实现：20260810 upstream 把信任围栏移进连接插件并停止导出它们，因此配对路由携带自己限定到二维码链接广告的字面量的副本。见 harness checkout 的 Agent Notes `api-gate-and-sidebar-remote-seat` 与 `lan-runtime-connection-fixes`。

## 手动 E2E：局域网配对往返

单元/组件 spec 覆盖路由族、门与面板，但配对循环涉及非 loopback origin 上的真实浏览器。任何 wire 契约或连接循环改动后重复：

1. 用测试工作区根在所有接口上启动服务器：`dsh web --host 0.0.0.0 --port 3190 --workspace-root /tmp/remote-e2e`。
2. 在浏览器打开 **loopback** URL（`http://127.0.0.1:3190`）：手机图标在侧边栏底部；面板立即铸一枚二维码。
3. 在第二个 tab（或手机）打开带配对令牌的 **局域网** URL（如 `http://192.168.1.7:3190/?pair=<token>`）：页面接受、设置 HttpOnly `dsh_pair` cookie、重载并启动完整 UI——无 console 错误，并且完成一次 generation 往返。
4. 桌面徽标实时翻到 已连接；局域网 origin 的桌面页则显示 配对面板仅限本机使用 横幅且不打开状态流。
5. 桌面 停止 切断手机：其下一个 `/api` 请求 403（重连循环重试直到新二维码重新配对）。

公网路径是经隧道的同一往返（见「通过互联网远程访问」）：loopback mint → 手机打开公网二维码 URL → accept → 完整 UI。`publicBaseUrl`（插件配置）与 `--trusted-host`（dsh web flag）都必须命名隧道主机；桌面面板仍在 `http://127.0.0.1` 打开。

## 已知限制与待办

- **撤销是逐请求的**：已配对手机请求已在 停止 落地时在途，完成该请求；下一个 403。
- **设备会话在内存中**：配对状态（token + devices）随 `dsh web` 进程重置。
- **无逐设备管理 UI**：面板显示聚合状态（waiting / connected N / offline）；单设备撤销延后。
- **Quick-tunnel hostname 每次运行变化**：`trycloudflare.com` URL 每次 `cloudflared` 启动随机，所以隧道重启时 `--trusted-host` 与 `publicBaseUrl` 必须一起更新。named tunnel（固定 hostname）避免这种抖动。
- **开发 HMR**：`dsh web --dev` 按路径轮询每个 roster bundle，因此重建本包（其自己的 `tsdown --watch`）会热重载 client bundle；无 harness 侧 watcher。

## 依赖理由

`qrcode.react`（MIT，活跃维护，React 16–19 支持）将二维码渲染为无依赖的 SVG 组件——无 canvas、无服务端图片生成。它在构建时内联进 client bundle（与官方 skin/turtle-ui 插件内联其非共享依赖相同），profile 安装无需超出 dsh peer closure 之外的额外运行时依赖。`schemastery` 是 DSH 标准配置 schema 校验器。