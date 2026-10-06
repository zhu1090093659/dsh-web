# dsh-plugin-manager · DeepSeek Harness (DSH) 客户端插件可视化管理与启停中心

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-client-ui-plugin-manager?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）官方 Web GUI 与桌面客户端插件生命周期与更新管理中心</strong><br>
  <em>已装插件版本比对 · 一键批量检查更新 · 运行时兼容性门禁 · 冲突预检与安全回滚 · 桌面客户端与 Web 双通道</em>
</p>

面向 dsh web GUI 与官方桌面客户端「插件」面板的更新检查与生命周期管理插件：补齐官方插件管理页没有的能力——把已装插件与其 registry 来源的版本比对（含 DSH 运行时兼容门禁）作为插件页内的一个区块渲染，并在该页「已安装」标题旁加一条列表级工具条：一次检查全部已装插件，一键更新其中的第三方插件，再重启 DSH 使更新生效。安装、卸载与启停由官方页面负责（面板归它所有）。

## 功能

- 向官方插件页注入「检查更新」区块（该页声明的 `plugins.detail.section` 席位），只渲染在已安装组合包的页面上；「插件」设置分区不再有本包自己的 Tab。
- 在该页 **已安装** 标题旁加一条列表级工具条。该标题是官方页面自己的 chrome，页面并未为它声明席位（扩展点是 `plugins.detail.*`、`plugins.item`、`plugins.bundle.config`、`plugins.row.config` 与 `plugins.bundle.activation`），因此工具条直接插入该元素，并靠家族共享的 body mutation hub 保持就位。一次点击检查全部已装插件；面板列出有新版本的第三方插件（当前运行时版本不够的行附上其声明的 DSH 最低版本）；「全部更新」逐条应用合格行并显示逐行进度，遇到第一个失败即停止并把其余行留在列表里；随后「立即重启」使更新生效（见「已知限制」中的重启说明）。官方 `@deepseek-ai/` 包绝不参与批量更新——它们的版本属于 DSH 安装本身。
- 双通道传输：带官方安装器服务的运行时（DSHCode 与 1.0.4 checkout 版 web）走官方 `/plugin-installer`、`/plugin-control` loopback RPC 通道；npm 发布的官方 web 没有这些通道，本包的 host 半区挂载 loopback 门禁的 HTTP 网关——安装/卸载 spawn 官方 `dsh plugin` CLI（唯一写入器），启停写入 `disabled` 覆盖行。应用自有 profile（打包桌面启动）的安装、更新与卸载走第三种写入器：宿主挂载的官方进程内插件管理器，因为 CLI 完全拒绝写该 profile。
- 检测旧聚合包 `@linxin666/dsh-web-ui-all`，把更新动作转换为到 `@linxin666/dsh-web-all` 的事务迁移；网关先移除旧包、安装精确版本的新包、恢复旧聚合包的层顺序，并在 `--dump-config` 通过后才报告成功。
- 更新前校验 DSH 运行时兼容（issue #754）：更新检查读取最新版本清单声明的 DSH 最低版本（`dsh.engines.dsh`，兼容回退读顶层 `engines.dsh`），在更新动作旁显示要求，运行 DSH 低于要求时禁用它；host 更新路由在启动任何 CLI 任务前若无法核实时也会返回 412 并拒绝。
- npm 运行时保护下次启动：安装后网关校验依赖真实落盘、拒绝重复入口 id 认领与引用不可解析包的 insert 行，并用 CLI 的 `--dump-config` 做组合预检；冲突或失败的安装会经官方 remove 路径自动回滚，绝不触碰现有插件。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-plugin-manager
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-plugin-manager
```

重启 `dsh web` 后，官方「插件」面板中的组合包页面出现该更新区块。

## 配置

本包不携带配置命名空间。更新的写入在下次重启后生效。

## cordis 服务

浏览器半区把共享的双通道 face 以 cordis 服务名 `pluginManager` 提供，兄弟客户端插件无需重复实现通道探测即可驱动与观察插件管理。用 `ctx.inject(['pluginManager'], cb)` 注入并读取 `ctx.pluginManager`：

- `isLoopback: boolean` — 本浏览器是否具有使用 host 路由的 loopback 权威。
- `list(): Promise<InstalledPluginItem[]>` — 读取已装快照。
- `install(spec): Promise<InstalledPluginItem>` — 从 npm spec 或 git URL 安装一个插件。
- `uninstall(id): Promise<InstalledPluginItem[]>` — 卸载一个插件。
- `status(): Promise<InstallProgressItem>` — 读取当前安装/更新进度。
- `failures(): Promise<PluginFailuresSnapshot>` — 读取宿主侧记录的插件启动失败环（插件 id、消息、堆栈、安装路径）；无失败环的运行时返回空快照。
- `setEnabled(id, enabled): Promise<InstalledPluginItem>` — 经当前通道（官方安装器 RPC，或网关写 profile patch 的 `disabled` 行）翻转插件的下次启动启用状态；宿主重启后生效。
- `onChange(cb): () => void` — 订阅成功变更；`install()`、`update()`、`uninstall()`、`setEnabled()` 任一成功 resolve 后触发，返回退订函数。

契约事实源在 `src/core/service.ts`（`PluginManagerService`）。服务随插件生命周期提供，插件卸载即消失。服务与更新区块共享同一个 face，因此 `onChange` 订阅者观察到的是同一批变更。

## 已知限制

- 仅限本机：LAN 或远程浏览器只显示「仅限本机操作」提示（与官方安装器页同一边界；网关对非 loopback 请求返回 403）。
- npm 发布的官方 web 上，网关写入经官方 CLI 执行。网关先从 host 进程 PATH 解析 `dsh`，再从运行中 host 入口上层各项目根的 `node_modules/.bin` 回退查找，然后回退到运行中 host 包自身的 `lib/bin.js`，最后回退到桌面安装包自带的 CLI 启动器（位于 Electron 资源目录下：Windows 为 `runtime/cli/bin/dsh.cmd`，其他平台为 `runtime/cli/bin/dsh`）——最后这条覆盖打包桌面端：host 从 `app.asar` 内运行、私有 host 包不带 `lib/bin.js`、安装包剥除所有 `.bin` shim 目录，且启动器只把自带的 `node` 放进 host 的 PATH；Node 脚本形式的 CLI（npm/homebrew shim、`.bin` 符号链接、`lib/bin.js`）由不依赖 PATH 的解释器执行——安装包里 CLI 旁有 `node` 时用它，否则用 host 自身的解释器；CLI 所在目录放在子进程 PATH 首位，使 `dsh plugin` 运行能找到同处安装的 pnpm。全部来源都没有 CLI 时，走 CLI 的写入才不可用——应用自有 profile 由官方进程内管理器写入，不需要任何二进制，其安装、更新与卸载路由也不要求它。CLI 输出按字节一次性解码，Windows 中文控制台（CP936/GBK）的报错文本可读而不再是替换字符。git 源安装可能耗时数分钟，以后台任务运行。网关更新只适用于 npm registry 源，由 host 解析最新版本，且仅当同一已装包报告该精确版本时才算成功。
- 应用自有 profile（打包桌面客户端）的安装、更新与卸载走宿主挂载的官方进程内插件管理器——即该 profile 官方插件页所用的同一个写入器：CLI 直接拒绝 `--profile desktop`，启动器则把自带的包管理器调用交给该管理器。任务、状态轮询与校验与 CLI 路径一致：安装必须新增一条此前没有的依赖、卸载必须删除一条依赖、更新必须报告路由解析出的版本；而 CLI 专属的守卫（重复挂载剥离、insert 行与启动预检）仍留在 CLI 写入器一侧，因为该路径下官方管理器会自行校验并应用 bundle。管理器返回的判定会先于 profile 被读取：被拒绝的运行以 `application: 'failed'` 解析而不是抛错，因此任务上报该运行的真实原因（pnpm 诊断文本，或 `incompatible-version` 拒绝点名的包），而不是在 profile 未变之后给出一句空转文案。其余运行时的安装、更新与卸载仍以 CLI 为唯一写入器。
- 兼容性门禁只在目标清单声明了最低 DSH 版本时生效；未声明 `dsh.engines.dsh` 的包更新不被检查，官方安装器运行时（DSHCode 与 checkout 版 web）不经过本门禁（其更新走官方安装器）。运行中的 DSH 版本读取安装自身的 `@deepseek-ai/dsh` 清单——启动器把它作为 profile 的 install anchor 发布——无需子进程、无需 PATH，因此打包桌面端也能作答；运行时不发布 anchor 时回退到 `dsh --version`。宿主完全无法核验的要求按「无法确认」呈现，而不是报成低于下限：两者都拦住更新，但只有后者会让用户去升级 DSH。
- npm 运行时上的启停显示下次启动的真实生效值：profile 覆盖行优先，其次由所装 bundle 自带的 `disabled` 行决定（聚合包的按需开启家族），两层都未提及的行视为启用。开启一个被 bundle 停用的行会写入显式 `disabled: false` 覆盖行——只删除用户行只会退回 bundle 默认值；该运行时 loader 在下次启动时认读这些行，但这条路径不如官方桌面写入器经过充分锻炼。
- 重启是显式、需用户点击且有三种模式的动作，路由按方法区分：`GET /api/plugin-manager/restart` 只读「重启方案」（无副作用，因此浏览器预取或直接输入 URL 都不会停掉宿主），`POST` 才执行；其他方法一律 405 拒绝。工具条先读方案，确认面板说的后果与实际执行的一致。终端启动（`dsh web`）时宿主启动一个 detached helper：等旧进程退出后按原命令行重新拉起，端口先释放再被替换进程绑定，替换进程的输出写入 `$DSH_HOME/logs/plugin-manager-restart.log`。打包桌面应用下本插件无法重启任何东西——进程树归 Electron，detached 重拉只会与桌面外壳抢同一端口，而外壳只提供它自己的恢复对话框这一条重启路径——因此那里的确认面板会先写明该对话框会做什么：确认后宿主退出，外壳弹出错误样式的「应用无法启动或已意外停止」对话框，在对话框里点「重启」即完成 `app.relaunch()`（同时写一份崩溃报告）；旁边给出替代路径——退出 DeepSeek Harness 后重新打开。无终端的启动（受监督进程、编辑器任务）保持不动，工具条提示手动重启。不重启时，更新后的插件代码在下次启动生效。
- npm 运行时上重复 insert id 认领在安装后即被检出并自动回滚新插件（共享 id 写 disabled 无法阻止 loader 的重复检查，只会误伤现有插件）。
- npm 运行时的启动预检（`--dump-config`）能抓组合失败，静态 insert 检查能抓引用不存在包的 insert 行；真正的运行时 import/apply 失败仍要到下次启动才暴露。
- 重复挂载保护（网关模式）：官方 CLI 的 bundle 对账会在任何安装/卸载后把所有声明 `dsh.bundle` 的依赖重新加进 `dsh.profile.bundles`——包括组合树里已由 patch 行挂载的包（bundle 以 patch 行挂载外部插件时），下次启动会重复挂载而失败（`duplicate prefix route`）。每次 CLI 变更成功后，网关只把「本次新增且已被 patch 行挂载」的 bundles 条目剥除（清单写入走备份 + tmp + 原子 rename），并在任务结果上为每个被剥除的条目发一条 notice；正常安装的 bundles 条目与用户此前已有的条目一律不动。
- wire 形状镜像官方安装器协议；漂移时宽容解析器降级为错误行，不误操作。

## 安全模型

- 信任边界是 loopback 门禁：每条网关路由都要求 loopback socket 地址、loopback Host 头与非跨站来源（socket + Host + Origin + `sec-fetch-site` 四重），与官方安装器通道同一权威。远程来源的浏览器没有可达路径；被拒请求返回 HTTP 403 与 `{ ok: false, error: "forbidden: loopback-only" }`。
- 变更类路由（install / update / remove / set-enabled / restart）不带 token：loopback 权威即本机用户，与官方通道同模型。重启路由是唯一作用在进程层面的路由：它绝不臆造命令行（只重放本进程自身的 `execPath` + argv，并剔除 inspector 开关），对无法确认为终端启动的宿主拒绝重拉，在打包桌面应用下只让本进程退出而把后续交给外壳。因此任何本机进程都能驱动插件安装与卸载，且 npm 安装会执行包的 install 脚本——请将本网关视为「设计上即本机代码执行」，绝不暴露到 loopback 之外。
- 安装 spec 与包 id 含命令行展开字符或控制字符时一律拒绝。Windows 下，npm shim 会解析为 `node.exe` 加包内 `bin.js`；DSH Desktop 打包 shim 附近没有 npm 布局，因此通过带完整预引用、逐字参数封套的 `cmd.exe /d /s /c` 执行。桌面 profile 从打包启动器环境值或持久化的 profile 选择中读取；应用自有 profile 的安装、更新与卸载由 host 半区直接调用宿主挂载的官方 `pluginManager` 服务（与官方插件页经自身 RPC 面驱动的是同一个写入器），其权威同样是 loopback 门禁加用户点击。
- 变更经同一队列串行，并发任务的 before/after profile 快照绝不交错。安装只有在依赖真实落入 profile 后才判 done（卸载以依赖消失为准），绝不轻信成功退出码。
- 启停操作会在该变更队列内重新读取最新 profile 清单，并在写入前以 `404` 拒绝过期或未知的包 id，因此卸载后遗留在面板里的旧行不会制造孤儿 `disabled` 覆盖。
- 冲突处置是 owner-aware 的：重复入口 id 或引用不可解析包的 insert 行会经官方 remove 路径回滚**新**包；网关绝不对共享 id 写 `disabled` 行（那既阻止不了 loader 的重复检查，又会误伤现有插件）。
- 启动预检（`--dump-config`）只组合 patch 层、不 import 条目：能抓组合失败，抓不到 import 期失败——后者仍在首次真实启动时暴露。
- 启动 profile 的解析顺序为 `--profile`、宿主在 `profileContext` 上发布的启动 profile、打包启动器 argv 中按位置携带的 profile 目录（Electron 会剥掉 exec 开关，桌面宿主因此按位置拿到 profile 目录）、`DSH_PROFILE`、`web` 子命令、打包应用持久化的选择。已发布 profile 优先于环境变量：打包桌面端两者都不传，而全局 `DSH_PROFILE` workaround 可能指向运行中宿主根本不读的 profile。
- 宿主发布的启动 profile 属外来输入：其名称做路径穿越校验，其目录必须是绝对且不含穿越的路径，其 patch 路径只有等于该 profile 自己的 `cordis.patch.yml` 时才被接受——patch 路径是写入目标。patch 写入走备份 + tmp + 原子 rename（`cordis.patch.yml.bak-plugin-manager`）。
- 重复挂载保护只写 profile 清单的 `dsh.profile.bundles`，与 patch 写入同一纪律（备份 + tmp + 原子 rename，备份为 `package.json.bak-plugin-manager`）；只移除 CLI 刚加入且与既有 patch 行挂载重复的条目；保护写回失败会让任务显式失败，绝不静默留下破坏下次启动的状态。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。

## 许可证

BSD-3-Clause。
