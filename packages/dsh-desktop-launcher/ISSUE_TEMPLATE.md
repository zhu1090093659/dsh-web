### 提交前查重

- [x] 我已搜索过 open/closed 的 Issue，确认本 Issue 没有重复。（搜索关键词：desktop launcher / 桌面启动器 / shutdown / 关机 / 一键退出；未发现 `dsh-desktop-launcher` 的收录提案。）

### 涉及插件

- [x] 其他 / 不确定（新插件收录：`@linxin666/dsh-desktop-launcher`）

### Issue 类型

- [x] 功能请求

### 摘要

希望将 `dsh-desktop-launcher` 收录进 `dsh-web-ui` 仓库（`packages/dsh-desktop-launcher`）：一个集**桌面一键启动**与**Web GUI 一键关机**于一体的双功能插件——在桌面创建双击启动图标（Windows .lnk / macOS .command / Linux .desktop），同时在页面右下角提供浮动电源按钮，确认后请求宿主进程优雅退出。

### 预期结果

已在本仓库 `packages/dsh-desktop-launcher` 完成开发，包含 host/client 双半区、31 个单元测试、中英文 README 配对、聚合包集成。等待审核合并。

### 详情 / 复现步骤

1. 插件简介：
   - **桌面启动**：host 端 `POST /api/dsh-desktop-launcher/create` 写入启动脚本到 `~/.dsh/desktop-launcher/`，在桌面放置图标。双击图标：探测 GUI URL → 已在响应则打开浏览器 → 否则后台启动 `dsh web`（Windows 隐藏窗口），轮询最多 30 秒后打开浏览器。支持 Windows（.lnk，WPF 启动弹窗）、macOS（.command）、Linux（.desktop + gio 信任标记）。
   - **一键关机**：client 端浮动圆形按钮（固定右下角，z-index 900），点击弹出确认框，确认后 `POST /api/dsh-desktop-launcher/shutdown`（loopback 专用），宿主先写回 200 响应，80ms 后调用 `ctx.appExit`（launcher 提供的 bounded exit，先回收插件树再退出），无 launcher 时回退 `process.exit(0)`。页面在进程退出前自行关闭（`window.close()` 或回退空白页）。
   - **设置卡**：一张卡片管理全部配置（`web-ui.plugin.item` 子槽位）：`enabled` / `announceToAgent` / `dshCommand` / `url` / `profile` / `iconPath` + "创建桌面图标"按钮，以及 `confirmShutdown` 开关。
   - **引导文本**：Agent 系统提示词中一条声明，同时描述启动器与关机能力。

2. 与仓库规则的合规性：
   - 纯 cordis bundle 包，`cordis.patch.yml` + `dsh.bundle.patch` 挂载，不改 DSH 源码。
   - 仅依赖官方 NPM SDK（`@deepseek-ai/*` peer/devDependencies）。
   - host/client 双半区：`src/index.ts` + `src/routes.ts` + `src/shutdown-routes.ts`（host），`src/client/`（browser）。
   - 两组路由均仅限 loopback（复用 `shared/host/loopback.ts` 围栏）。
   - 三件套（settings-form.ts / PluginSettingsCard.tsx / settings-card.module.css）来自 `scripts/sync-shared.mjs` 同步副本。
   - CSS Modules（`launcher-card.module.css`、`shutdown.module.css`），经 lightningcss 编译进 bundle。
   - 中英双语 README 配对（`README.md` + `README.zh.md` + `README.i18n.yaml`）。
   - 无 emoji，Apache-2.0。
   - 31 个单元测试覆盖 launcher 生成、路由围栏、client apply、ShutdownEntry 组件交互，`vitest run` 全绿。
   - 已集成到聚合包 `dsh-web-ui-all`（`aggregate.yml` 含 `../dsh-desktop-launcher`）。
   - 已在 `packages/dsh-web-ui-settings` allowlist 注册 `desktop-launcher` 命名空间别名。

3. 项目状态：
   - 仓库：本仓库 `packages/dsh-desktop-launcher`（v0.2.0）
   - 安装命令：`dsh plugin --profile web add link:$(pwd)/packages/dsh-desktop-launcher`
   - 协议：Apache-2.0

### 环境信息

- DSH 版本: 0.1.0-rc.x（DeepSeek Harness）
- 浏览器: Chromium（Web GUI）
- 插件名称 / 版本: `@linxin666/dsh-desktop-launcher` 0.2.0
- 操作系统: 跨平台（Windows / macOS / Linux）

### 补充信息

- 桌面图标使用内置 DeepSeek Harness 鲸鱼图标（`assets/dsh.ico` + `dsh.png`），支持自定义图标路径。
- Windows 启动器使用 WPF XAML 弹窗（内嵌 PowerShell），显示中文启动进度，无黑框。
- 关机退出通过 `ctx.appExit` 提供的 bounded exit 实现，先回收插件树再结束进程。
- 两个路由各持独立测试 seam（`src/routes.ts` 的 `makeRoutes` + `src/shutdown-routes.ts` 的 `makeShutdownRoute`），互不耦合。