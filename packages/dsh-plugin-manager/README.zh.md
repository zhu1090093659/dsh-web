# @linxin666/dsh-client-ui-plugin-manager

[English](README.md) | 中文

面向 dsh web GUI「插件」设置分区的插件管理器 Tab：从 npm 或 git 安装插件，列出已装插件并提供下次启动生效的启用开关，如实呈现安装时冲突动作并支持撤销，失败一键转交修复会话。

## 功能

- 在官方「插件」设置分区注册「插件管理」Tab（`settings.plugins.tab` 槽位，order 20，与官方安装器 Tab 并列）。
- 双通道传输：带官方安装器服务的运行时（DSHCode 与 1.0.4 checkout 版 web）走官方 `/plugin-installer`、`/plugin-control` loopback RPC 通道；npm 发布的官方 web 没有这些通道，本包的 host 半区挂载 loopback 门禁的 HTTP 网关——安装/卸载 spawn 官方 `dsh plugin` CLI（唯一写入器），启停写入 `disabled` 覆盖行。
- 从 npm 包名或 git 仓库 URL 安装插件，带进度。
- 列出已装用户插件：下次启动生效的启用开关、更新检查（npm 源走 registry）、已核验的 npm 更新与卸载。
- 检测旧聚合包 `@linxin666/dsh-web-ui-all`，把更新动作转换为到 `@linxin666/dsh-web-all` 的事务迁移；网关先移除旧包、安装精确版本的新包、恢复旧聚合包的层顺序，并在 `--dump-config` 通过后才报告成功。
- 更新前校验 DSH 运行时兼容（issue #754）：更新检查读取最新版本清单声明的 DSH 最低版本（`dsh.engines.dsh`，兼容回退读顶层 `engines.dsh`），在更新按钮旁显示要求，运行 DSH 低于要求时禁用按钮；host 更新路由在启动任何 CLI 任务前若无法核实时也会返回 412 并拒绝。
- 官方 plugin-control 面存在时展示内置产品开关。
- 安装时冲突对账：官方模式对产品快照前后 diff；网关模式对每次 CLI 运行前后的 profile 层 diff，可撤销的动作给一键撤销，每条冲突都给「让 Agent 修复」转交。
- 按插件渲染启动失败环：「让 Agent 修复」（以插件安装根为工作区的修复会话）与「复制错误」；npm web 运行时没有失败环，只有安装错误提供修复转交。
- 显示宿主安全模式横幅与「恢复正常模式」操作（web 端在下次手动重启时生效）。
- npm 运行时保护下次启动：安装后网关校验依赖真实落盘、拒绝重复入口 id 认领与引用不可解析包的 insert 行，并用 CLI 的 `--dump-config` 做组合预检；冲突或失败的安装会经官方 remove 路径自动回滚（绝不触碰现有插件），错误行带修复转交。

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

重启 `dsh web` 后，设置页「插件」分区出现该 Tab。

## 配置

本 Tab 不携带配置命名空间。开关与安装在下次重启后生效。

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

契约事实源在 `src/core/service.ts`（`PluginManagerService`）。服务随插件生命周期提供，插件卸载即消失。服务与「插件管理」Tab 共享同一个 face，因此 `onChange` 订阅者对两侧发起的变更都能收到通知。

## 已知限制

- 仅限本机：LAN 或远程浏览器只显示「仅限本机操作」提示（与官方安装器 Tab 同一边界；网关对非 loopback 请求返回 403）。
- npm 发布的官方 web 上，网关写入经官方 CLI 执行。网关先从 host 进程 PATH 解析 `dsh`，再从运行中 host 入口上层各项目根的 `node_modules/.bin` 回退查找，覆盖本地包装器与 npx 启动；两处都没有 CLI 时才不可写。git 源安装可能耗时数分钟，以后台任务运行。网关更新只适用于 npm registry 源，由 host 解析最新版本，且仅当同一已装包报告该精确版本时才算成功。
- 兼容性门禁只在目标清单声明了最低 DSH 版本时生效；未声明 `dsh.engines.dsh` 的包更新不被检查，官方安装器运行时（DSHCode 与 checkout 版 web）不经过本门禁（其更新走官方安装器）。
- npm 发布的官方 web 没有启动失败环与安全模式：这两处界面降级为空，只有安装错误提供修复转交。
- npm 运行时上的启停会在 profile 的 cordis.patch.yml 写入裸 `disabled` 覆盖行；该运行时 loader 在下次启动时认读这些行，但这条路径不如官方桌面写入器经过充分锻炼。
- web 端无壳内重启：变更在下次手动重启后生效。
- 安装时冲突检测报告安装实际改了什么（官方模式为产品行；网关模式为 profile 行与 bundle 条目）。npm 运行时上重复 insert id 认领在安装后即被检出并自动回滚新插件（共享 id 写 disabled 无法阻止 loader 的重复检查，只会误伤现有插件）；官方运行时由官方规则与失败环处置该类冲突。
- npm 运行时的启动预检（`--dump-config`）能抓组合失败，静态 insert 检查能抓引用不存在包的 insert 行；真正的运行时 import/apply 失败仍要到下次启动才暴露，官方运行时靠失败环呈现，npm 运行时没有失败环。
- 重复挂载保护（网关模式）：官方 CLI 的 bundle 对账会在任何安装/卸载后把所有声明 `dsh.bundle` 的依赖重新加进 `dsh.profile.bundles`——包括组合树里已由 patch 行挂载的包（全家桶聚合包以行挂载 `dsh-better-sidebar`），下次启动会重复挂载而失败（`duplicate prefix route`）。每次 CLI 变更成功后，网关只把「本次新增且已被 patch 行挂载」的 bundles 条目剥除（清单写入走备份 + tmp + 原子 rename），并在任务结果上为每个被剥除的条目发一条 notice；正常安装的 bundles 条目与用户此前已有的条目一律不动。
- wire 形状镜像官方安装器 Tab 协议；漂移时宽容解析器降级为错误行，不误操作。
- 修复会话工作区保留路径派生的默认标题。

## 安全模型

- 信任边界是 loopback 门禁：每条网关路由都要求 loopback socket 地址、loopback Host 头与非跨站来源（socket + Host + Origin + `sec-fetch-site` 四重），与官方安装器通道同一权威。远程来源的浏览器没有可达路径；被拒请求返回 HTTP 403 与 `{ ok: false, error: "forbidden: loopback-only" }`。
- 变更类路由（install / update / remove / set-enabled）不带 token：loopback 权威即本机用户，与官方通道同模型。因此任何本机进程都能驱动插件安装与卸载，且 npm 安装会执行包的 install 脚本——请将本网关视为「设计上即本机代码执行」，绝不暴露到 loopback 之外。
- 安装 spec 与包 id 含命令行展开字符或控制字符时一律拒绝。Windows 下，npm shim 会解析为 `node.exe` 加包内 `bin.js`；DSH Desktop 打包 shim 附近没有 npm 布局，因此通过带完整预引用、逐字参数封套的 `cmd.exe /d /s /c` 执行。桌面 profile 从打包启动器环境值或持久化的 profile 选择中读取，进程内官方安装器则由浏览器 RPC 能力探测确认。
- 变更经同一队列串行，并发任务的 before/after profile 快照绝不交错。安装只有在依赖真实落入 profile 后才判 done（卸载以依赖消失为准），绝不轻信成功退出码。
- 启停操作会在该变更队列内重新读取最新 profile 清单，并在写入前以 `404` 拒绝过期或未知的包 id，因此卸载后遗留在面板里的旧行不会制造孤儿 `disabled` 覆盖。
- 冲突处置是 owner-aware 的：重复入口 id 或引用不可解析包的 insert 行会经官方 remove 路径回滚**新**包；网关绝不对共享 id 写 `disabled` 行（那既阻止不了 loader 的重复检查，又会误伤现有插件）。
- 启动预检（`--dump-config`）只组合 patch 层、不 import 条目：能抓组合失败，抓不到 import 期失败——后者仍在首次真实启动时暴露。
- profile 名（来自 `--profile` / `DSH_PROFILE`）在任何文件读写前做路径穿越校验；patch 写入走备份 + tmp + 原子 rename（`cordis.patch.yml.bak-plugin-manager`）。
- 重复挂载保护只写 profile 清单的 `dsh.profile.bundles`，与 patch 写入同一纪律（备份 + tmp + 原子 rename，备份为 `package.json.bak-plugin-manager`）；只移除 CLI 刚加入且与既有 patch 行挂载重复的条目；保护写回失败会让任务显式失败，绝不静默留下破坏下次启动的状态。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。

## 许可证

BSD-3-Clause。
