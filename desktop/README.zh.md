# desktop — DeepSeek Harness 桌面版

[English](README.md) | 中文

一个把 DeepSeek Harness Web GUI 变成可安装桌面应用（macOS / Windows）的 Electron 壳。安装包内置独立的 Node.js 运行时（含 npm 与 pnpm）、dsh 宿主和预装好的 web profile（官方 web bundle + dsh-web 插件全家桶），因此开箱即用——不需要预装 Node、npm 或 dsh CLI。

## 功能

- 双击启动：当 `~/.dsh/profiles/web` 缺失时用内置 profile 种子初始化，用内置 Node 运行时在专用回环端口启动自己的 dsh 宿主，等 GUI 就绪后加载宿主打印的带 token URL（认证门每次进程启动签发一次性 token；会话 cookie 保存在应用窗口内）。
- 独立宿主、端口有保证：应用始终运行自己的内置宿主——不会附着到已有 GUI，也绝不占用原生 `dsh web` CLI 默认端口 3080/3081。优先使用专用端口段 3082-3181（跨启动地址稳定），段满时回退到系统分配端口。桌面实例与你自己的 `dsh web` 并存运行，各自持有独立的 GUI 会话。
- 与已有 dsh 安装共享 `~/.dsh`：由本应用播种的 profile 带 `.dsh-desktop-seed.json` 标记，内置运行时版本变化时会被重新播种；没有该标记的 profile 视为用户自管，永不触碰。用户的 `cordis.patch.yml` 层在重新播种后保留。
- 单实例：第二次启动只会聚焦已有窗口。关闭窗口即退出应用，并优雅停止由它启动的宿主（POSIX 进程组 SIGTERM，Windows 用 `taskkill /T`，5 秒后强杀）。
- 应用内插件管理开箱可用：`dsh plugin add/remove` 转发给安装在内置 Node 运行时里的 pnpm（11.24.0，与仓库工具链同版本），与官方发行包自带的 npm 并列。
- 后台提醒（issue #1498）：窗口在后台时，只要有运行在等你（审批、提问或计划评审），或有对话回合结束，外壳就会闪烁任务栏图标并播放系统提示音。GUI 是普通网页内容、不认识这个外壳，所以每次页面加载后都会注入一个很小的观察器；它只读官方未哈希的 data 属性（`[data-approval-key]`、`[data-question-key]`、`[data-plan-review-key]`、`[data-chat-flow-kind="turn-tail"]`、`[data-chat-flow-kind="turn-error"]`、`[data-state="stopped"]`），绝不依赖 CSS-Modules 哈希。窗口处于焦点时绝不打扰，并有 4 秒冷却合并连续信号。
- 启动失败（载荷缺失、宿主在就绪前退出、就绪超时）会进入错误页，展示宿主日志尾部，提供「重试」和「打开日志文件」按钮。完整宿主日志在 Electron `logs` 目录（`dsh-host.log`）。

## 仓库布局

| 路径 | 内容 |
| --- | --- |
| `src/` | Electron 主进程（`main.cjs`）、可测试的纯函数模块（`runtime.cjs`）、preload、启动页与错误页 |
| `runtime/host/` | 锁定版本的 `@deepseek-ai/dsh` 清单 + pnpm 布局（hoisted、多平台） |
| `runtime/profile-web/` | web profile 种子清单：bundle 为 `dsh-base` + `dsh-web-app` + `@linxin666/dsh-web-all` |
| `scripts/fetch-node.mjs` | 下载并校验 sha256 的内置 Node 发行版（`resources/runtime/node-<os>-<cpu>/`） |
| `scripts/fetch-pnpm.mjs` | 把锁定版本的 pnpm 装进每个内置 Node 发行版（npm registry tarball，校验完整性，npm 式全局布局） |
| `scripts/build-runtime.mjs` | 用 pnpm 安装两份载荷并暂存到 `resources/runtime/`（含 Windows 的 `cloudflared.exe` 隧道二进制） |
| `scripts/after-pack.cjs` | 打包后把暂存载荷拷进应用（electron-builder 的 extraResources 会静默丢弃载荷的 node_modules） |
| `resources/` | 应用图标 + 生成的运行时载荷（git 忽略） |

## 构建

### 前提

构建机需要 Node 22+ 与 pnpm 11（仓库工具链）。打包出来的应用本身没有任何环境要求。

### 步骤

```sh
cd desktop
npm install            # electron + electron-builder
npm run prepare-runtime  # 下载 Node 发行版 + 安装并暂存载荷
npm run dist:mac         # dist/*.dmg + *.zip（arm64 + x64）
npm run dist:win         # dist/*.exe（nsis）+ *.zip（可从 macOS 交叉构建）
```

`npm start` 基于已暂存的 `resources/runtime/` 以未打包形态运行应用，供开发调试。

## 配置

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | 与 dsh CLI 共享的数据目录（配置、会话、密钥）。仅在隔离测试时设置。 |

### 后台提醒

`$DSH_HOME/desktop-attention.json` 用于调节后台提醒。该文件可选，且只有字面量 `false` 才会关闭某个通道——打错字绝不会静默关掉你要的提醒：

```json
{ "flash": true, "sound": true }
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `flash` | `true` | 窗口在后台时闪烁任务栏图标。 |
| `sound` | `true` | 播放系统提示音（Electron `shell.beep`）。 |

内置版本锁定在 `runtime/host/package.json`（`@deepseek-ai/dsh`）与 `runtime/profile-web/package.json`（`@linxin666/dsh-web-all`），构建时记录进 `resources/runtime/VERSION.json`。

## 安全模型

- dsh 宿主只绑定回环地址（`127.0.0.1`）；`--host 0.0.0.0` 会被宿主自身拒绝。
- 窗口无 Node 集成，preload 运行在沙箱中；导航被限制在回环地址（以及本地启动页/错误页），外部链接一律交给系统浏览器打开。
- 内置 Node 发行版在构建时按官方 SHASUMS256.txt 校验；内置 pnpm 的 tarball 按其 npm registry 完整性元数据校验。
- 应用只会写入启动时解析出的 `$DSH_HOME`、Electron `logs` 目录和它自己的安装目录。
- 渲染进程到主进程的提醒通道只承载一个封闭枚举（`approval` / `completed` / `interrupted`）。主进程会丢弃其他任何载荷，以及任何不是 GUI 窗口 webContents 的发送方；页面侧观察器是只读 DOM 监视，不触碰页面状态。

## 已知限制

- **未签名构建**：macOS 首次打开会有 Gatekeeper 警告（右键 → 打开，或 `xattr -dr com.apple.quarantine`）；Windows 有 SmartScreen 提示（更多信息 → 仍要运行）。签名与公证是后续计划。
- **远程隧道（`dsh-remote-web-ui`）**：载荷内置 Windows x64 的 `cloudflared` 二进制（以及构建机平台自己的 macOS 二进制），隧道在 macOS arm64 与 Windows x64 上开箱可用；macOS x64 上隧道插件会在首次使用时校验出架构不符并按需重新拉取匹配的二进制（需联网一次）。
- **Windows arm64 与 Linux** 暂不构建；运行时布局已支持后续加入。
- **「中断」是启发式判定**：出错回合与被中断的工具调用都有未哈希钩子，但用户停止一个只输出正文的回合时页面没有任何语义属性，因此该情形会按「已完成」上报。要精确区分，需要宿主 `turn/end` 的 reason（`/api/remote.mux` 上的 `session/follow`），而外壳刻意不订阅它。
- **后台提醒是桌面外壳的能力**：它来自本应用注入的观察器，普通浏览器标签页没有（该场景由 `dsh-notifier` 覆盖）。
- 全新机器首次启动会花几秒钟把预装 profile 拷贝进 `~/.dsh`（一次性）。
- **同一个 `~/.dsh` 上的两个宿主**：桌面应用与你自己的 `dsh web` 同时运行时，两个 dsh 宿主进程共享同一数据目录。这种并存是设计内模式——桌面应用不读取也不操控你的实例，两个 GUI 各自持有独立会话。
