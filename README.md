# dsh-web · DeepSeek Harness（DSH）Web GUI 插件聚合生态包

中文 | [English](README.en.md)

<p align="center">
  <img src="docs/dsh-web-banner.png" alt="dsh-web" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/zhu1090093659/dsh-web?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/github/stars/zhu1090093659/dsh-web?style=flat-square" alt="Stars">
  &nbsp;
  <img src="https://img.shields.io/github/forks/zhu1090093659/dsh-web?style=flat-square" alt="Forks">
  &nbsp;
  <a href="https://www.npmjs.com/package/@linxin666/dsh-web-all"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fdsh-market.com%2Fapi%2Fnpm-badge%2Fversion&style=flat-square&label=npm" alt="npm"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@linxin666/dsh-web-all"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fdsh-market.com%2Fapi%2Fnpm-badge%2Ftotal&style=flat-square" alt="downloads"></a>
  &nbsp;
  <a href="https://dshfind.com/zh/plugins/zhu1090093659/dsh-web?ref=badge"><img src="https://dshfind.com/api/badge/zhu1090093659/dsh-web?metric=downloads&amp;lang=zh" alt="dshfind"></a>
  &nbsp;
  <a href="https://dsh-market.com"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fdsh-market.com%2Fapi%2Ftelemetry%2Fbadge%2Fusers&style=flat-square&label=users" alt="users"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img src="https://img.shields.io/badge/DSH-%3E%3D0.1.2--alpha.4-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）Web 的插件聚合生态包 · 一切皆插件</strong><br>
  <em>性能引擎 · 创意工坊 · 任务看板 · 移动端远程 · SSH 运维 · 图像理解</em>
</p>

<div align="center">

[是什么](#是什么) · [创意工坊](#创意工坊dsh-marketcom) · [功能插件](#功能插件) · [皮肤](#皮肤) · [快速上手](#快速上手) · [常见问题](#常见问题) · [已知限制](#已知限制) · [社区](#社区)

</div>

## 是什么

dsh-web 是 DeepSeek Harness（DSH）Web GUI 的插件聚合生态包（DSH Web plugin ecosystem），也是「一切皆开发、一切皆插件」理念在 Web 端最完整的落地：任务看板（task board）、移动端远程控制（mobile remote）、SSH 运维终端、图像理解（image understanding）、梁神模式 agent 预设、救助模式（rescue mode）与右侧面板，每一样都是独立成包的插件，可插拔、可替换、可再开发——一次装齐便是完整的 AI 开发工作台，只挑一两个也能安静融入原生界面。所有插件都经官方 profile 机制挂载到 `dsh web`，不改 DSH 源码；聚合包还能把外部插件（如 `dsh-better-sidebar`）拼进全家桶，其他皮肤与宠物资产统一从创意工坊获取，详见 [dsh-web-all README](packages/dsh-web-all/README.zh.md)。

皮肤同样长在插件体系里：v2 皮肤不是独立产品，而是「皮肤」插件的纯资产包（skin.json 清单 + 样式、贴图与可选特效脚本），由该插件这一唯一加载器即时加载，与官方彻底解耦——官方升级不再牵动皮肤，新增皮肤也只需落一个目录，无需发布、无需安装。插件负责逻辑，皮肤资产负责外观；Blue Fantasy 随插件内置，其他皮肤与宠物资产统一走 [创意工坊](#创意工坊dsh-marketcom)（dsh-market.com）。

![DSH Web UI 主界面](docs/screenshots/13-hero-main.png)

| 能力 | 原生 dsh web | dsh-web 全家桶 |
| --- | --- | --- |
| 性能观测与治理 | 无 | HUD 检测面板 + 事件/事件循环/内存指标 + 写批频控 + 渲染降载 + 三档告警 |
| Agent 预设 | 官方预设（Standard / Minimal 等） | 官方与社区预设 |
| 任务看板 | 无 | 多列看板 + cron 定时真实执行 |
| 移动端远程 | 无 | 扫码配对、SSE 实时同步；同一链接也可配对 PC 浏览器 |
| 远程服务器运维 | 无 | SSH 面板：终端 / 传输 / 隧道 / 集群 |
| 图像理解 | 无 | `describe_image` 视觉工具 |
| 文件预览与变更 | 无 | 右侧面板：资源管理器 / 编辑器 / 终端 / Git / 浏览器 |
| Git 可视化 | 无 | 分支选择器 + 提交历史图谱 |
| 主题皮肤 | 默认主题 | Blue Fantasy 随皮肤插件内置，其他皮肤从创意工坊按需安装 |

## 创意工坊（dsh-market.com）

[创意工坊](https://dsh-market.com)（dsh-market.com）是 DSH 的一站式创作空间，统一分发皮肤、宠物与插件：每类按设备点赞热度排序、前三名登上首页颁奖台；皮肤支持实时试穿预览，插件提供一键复制的安装命令。经典的 Blue Fantasy 蓝色幻想随皮肤插件内置，鲸鱼娘宠物与其他皮肤可在工坊浏览预览、查看源码并按需安装。Web GUI 里的「创意工坊」设置卡直接浏览工坊清单——皮肤与宠物一键装进 DSH 主目录，插件经插件管理器安装，装完即可在皮肤与宠物面板中使用。

![创意工坊首页](docs/screenshots/31-market-home.png)

站点也是本仓库的产物：纯静态构建，由 `scripts/market-build` 从三类真值源（`skin.json` / `pet.json` / `community.json`）确定性生成；点赞等动态能力由 Cloudflare Workers 边缘 API 承载（D1 持久化、按设备一票），push 到 `main` 即自动部署。

创意工坊对标 Steam Workshop 的定位：让社区创作被发现、被试穿、被一键装回家，让作者的作品被看见、被点赞——欢迎一起来建设。

## 功能插件

### 性能引擎（dsh-perf）

面向流式和多会话场景的性能观测与治理插件。右下角的 HUD 检测面板默认关闭，在插件设置里打开后，会实时显示每个会话的事件速率、事件循环 p99 延迟、前端 FPS / Longtask、内存与写批延迟；活跃会话数超过阈值（轻 / 标准 / 严格三档）时面板亮警。治理侧做三件事：写批延迟调谐，流式期降低 fsync 频率；消息渲染降载，超重的助手消息折叠、代码高亮延后，开窗和回合结束时的代码高亮尖峰就是这么消掉的；还有 agent 空闲徽标和 CSS 渲染降载。

所有配置都在这张「Web 插件 → 性能引擎」设置卡里：总开关（全栈联动）、观测档位 off / balanced / aggressive、告警阈值预设、HUD 面板和渲染降载，模式与采样间隔在 host 端改动后即时生效，不用重启。观测拿到的只有聚合指标（事件速率、延迟分布、内存），不碰会话内容；API 有 loopback 守卫，只接受本机同源的请求。详见 [packages/dsh-perf/README.zh.md](packages/dsh-perf/README.zh.md)。

### 任务看板（Task Board）

侧边栏点「任务看板」进入。任务按五列摆开：待规划、待办、进行中、已完成、已失败。点卡片上的「执行」，任务交给真实的 DSH 智能体会话去跑，跑完状态自动回写；想复盘就跳回执行会话看完整过程。

任务也支持 Host 定时跑：详情里配 cron 表达式（比如每天 23:00 自动升级 DSH、每周一 09:00 生成周报），关闭浏览器后仍会到点执行和结算。可选的空闲睡眠保护支持 Windows、macOS 和带 systemd-logind 的 Linux，允许屏幕熄灭，同时阻止整机因空闲睡眠；该设置默认关闭。

| 多列看板 | 定时执行 |
| --- | --- |
| ![任务看板](docs/screenshots/09-task-board.png) | ![任务定时执行](docs/screenshots/10-task-board-detail-cron.png) |

### 移动端远程控制（Mobile Remote）

侧边栏底部的手机图标打开配对面板。扫码（或复制链接）配对后，手机运行的就是官方 Web GUI 本身，竖屏下自动注入触控适配层：鲸鱼按钮展开侧边栏、左滑收起 / 右滑展开、长按会话行展开与桌面省略号相同的操作菜单、Enter 只换行、16px 输入框防聚焦缩放；面向桌面的工具面（SSH 终端、任务看板、Git 图谱等）在手机上自动隐藏——看会话、开新会话、收发消息、切模型和思考强度、调权限预设，和桌面端同一份界面、同一份状态。同一份配对链接也能配对 **PC 浏览器**（手机配对流扩展到桌面 Web GUI）：在另一台电脑打开桌面 URL 形态的链接，完整 Web GUI 便在那台设备上运行，流量走配对门控的 `/remote/api` 通道——未配对设备只有横幅提示、拿不到任何数据。配对令牌一次性、限时，「停止」随时吊销所有设备；二维码默认走局域网，开 cloudflared 公网隧道后手机（和 PC）在任何网络都能配对。PC 远程桌面应优先使用插件自己的设备配对通道，安全上不建议为隧道域名设置 `--trusted-host`；该 flag 会让 SDK 的 `/api` 绕过配对门控（详见[插件 README](packages/dsh-remote-web-ui/README.zh.md)）。

![手机与 Web 同界面（示意图）](docs/assets/phone-and-web.png)

> **实时消息与隧道**：移动端靠 SSE（Server-Sent Events）收实时消息。Cloudflare quick tunnel（trycloudflare.com）和 Tailscale Serve 不透传 SSE，普通 HTTP 正常、实时推送到不了；这种网络下插件自动降级轮询，收发消息正常，只是新消息可能晚几秒。要即时推送就用支持 SSE 的隧道（Cloudflare named tunnel、自定义 TCP 端口转发等）。

| 移动端主页（鲸鱼入口） | 会话列表 |
| --- | --- |
| ![移动端主页](docs/screenshots/20-mobile-home.png) | ![移动端会话列表](docs/screenshots/21-mobile-sessions.png) |
| 聊天（思考与工具调用） | 模型选择（底部弹层） |
| ![移动端聊天](docs/screenshots/22-mobile-chat.png) | ![模型选择](docs/screenshots/23-mobile-model-sheet.png) |

### 远程连接（SSH Ops）

侧边栏「SSH」入口打开远程运维面板。主机支持密钥 / 密码认证，可从 `~/.ssh/config` 一键导入；配置都在 `~/.dsh/dsh-ssh.json`。对已配置主机可执行真实操作：

- **Web 终端**：xterm.js 远程终端，实时输出，窗口大小自适应；
- **文件传输**：SFTP 上传 / 下载，有进度条，能浏览远程目录；
- **端口转发**：本地隧道直连远程内网服务（数据库、API、管理后台），只监听 127.0.0.1；
- **集群执行**：一条命令并发跑多台主机，按别名 / 环境 / 标签过滤；
- **Agent 直连**：Agent 和面板共用同一份主机配置，对话里说一句「连一下 xxx 看看状态」，智能体就去执行远程命令。

### 图像理解（Image Understanding）

给纯文本模型补上视觉：对话里提到图片（本地路径、http(s) URL、会话附件）时，`describe_image` 把图片发给配置好的 OpenAI 兼容视觉端点（Qwen-VL、GLM-4V、GPT-4o、本地 Ollama 都行）回答，**进会话的只有返回的文本，图片本身不进会话记录**。纯文本模型输入框没有图片入口，插件在输入框加了个图片按钮：选图后生成附件引用插进草稿，模型就能用 `describe_image` 分析；工具还支持 `prompt` 参数传自定义指令（OCR、UI 诊断、翻译），比默认描述准。端点、模型、密钥、默认指令在「设置 > 插件配置 > Image understanding」里配，即时生效。

### 右侧面板（Right Panel）

右侧面板由外部插件 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 提供（聚合包已集成并默认启用），支持其内置功能与第三方插件注册，详见其 [README](https://github.com/omdsh-dev/DSH-better-sidebar)。注：DSH 0.1.2-alpha.2 起官方移除了 `@deepseek-ai/dsh-client-runtime` 面，better-sidebar 曾暂被排除，现已随 0.18.0-alpha.0（对齐 alpha.2 的构建）回归聚合。

![右侧面板](docs/screenshots/19-right-panel.png)

> 旧 aionui-panel 右侧面板已**彻底移除**（2026-08-28）：包与全家桶聚合行已删除，右侧面板由 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 提供，其偏好在该插件自身的设置区管理。

### Git 图谱（Git Graph）

输入框上方有分支选择器，可以切分支、翻提交历史；Git 图谱把分支泳道和提交历史画出来，仓库再大也能顺着时间线找到变更。

还支持 git worktree 并行会话：弹层里「在 worktree 中开始新会话」会在 `$DSH_HOME/worktrees/` 下建一个隔离检出（携带新分支 `wt/<名称>`，基线分支可选），注册为工作区后直接在其中开新会话，主检出全程不动；「管理 worktree」面板列出全部托管检出并可删除（有未提交改动先拦一次再强制，`wt/` 分支默认保留）。设置里还有两个默认关闭的开关：「自动隔离」让 git 工作区的每个新会话自动落进独立 worktree（基线可选当前分支或远程默认分支），「Agent 工具」把 `git_worktree` 交给智能体自己创建隔离环境。

![Git 图谱](docs/screenshots/04-git-graph.png)

![Git worktree 并行会话](docs/screenshots/34-git-worktree.png)

### 梁神模式（LiangShen Anchored Preset）

梁神模式（`dsh-liangshen`）是两阶段锚定的 agent preset，随全家桶一键安装：新建会话时在预设选择器中选「梁神模式」即可。首轮模型请求只看到官方 Minimal 的精确双工具（持久 `bash` 与 `str_replace_editor`）和一行 persona，没有运行时上下文与指令注入；首次工具调用后，晋升等到首个 minimal-like 推理块出现，随后 wire 切换为 PTC Mode（单个 `run_code` 经生成 SDK 调起完整工具注册表），并恢复全部 prompt section 与常规注入。它把「首轮轨迹选择」与「后续完整工具能力」拆开——社区评测里 Standard / PTC 为 91/92 分、Minimal 达 99/96 分，而两阶段方案在 Windows 原生实测均值 98.5，不牺牲完整工具能力；阶段从持久化 session events 推导，resume 不丢状态，已支持 plan mode。原理与稳定化控制详见 [dsh-liangshen README](packages/dsh-liangshen/README.zh.md)。

### 救助模式（Rescue Mode）

救助模式（`dsh-doctor`）是 DSH profile 的事务式救援体系，**默认开启**：用户级 Doctor Supervisor 后台服务与透明的 Doctor Launcher 维持一份隔离救援胶囊，检测启动失败、进程崩溃、心跳丢失、Web 故障与浏览器白屏。每次修复都是一个事务：快照当前 profile，在候选环境应用确定性规则，经隔离的 dump-config 与 Web 健康门禁后原子提升，失败按字节回滚——profile 只经官方 `dsh plugin` 命令修改，不安装未验证的 latest。Web 控制台（设置 → 插件配置 → Web 插件的 Doctor 卡片）展示故障事件，提供诊断、修复与回滚动作；「发送给 Harness」把最近一次故障的摘要与错误堆栈组合成排障提示词投回当前会话，让 agent 就地诊断。Supervisor 只监听本地 socket（0600 token），Web API 仅限 loopback；安全模型与 `dsh-doctor` CLI 详见 [dsh-doctor README](packages/dsh-doctor/README.zh.md)。

### 会话归档管理（Session Archive Manager）

会话归档管理（`dsh-session-archive`）是内置的会话管理入口，随全家桶安装：集中查看全部会话（活跃 / 已归档 / 空白 / 子代理 / 无工作区 / 元数据缺失的历史会话），支持按状态、工作区、标题或 ID 搜索筛选与多维排序，跨完整筛选结果集的多选，以及批量归档、批量恢复与物理删除。物理删除走级联语义（父会话连同全部后代），展示直接选中数、级联数、最终总数、预计释放空间与将被跳过的受保护会话，大批量删除需额外知情确认；运行中、当前正在查看、有运行中后代的会话始终受保护。两个默认关闭的自动策略可按"最后活动时间"自动归档、按"归档时间"自动清理超期归档（归档时间未知的历史会话永不自动删除），支持启用前预览与立即执行。删除不可恢复；全部路由仅限本机回环访问。详见 [dsh-session-archive README](packages/dsh-session-archive/README.zh.md)。

### 更多插件（More Plugins）

- **Skill 中心**（`dsh-client-ui-skill-explorer`）：按来源浏览已加载的 skill，支持启停、创建与删除。
- **插件管理器**（`dsh-client-ui-plugin-manager`）：经官方 host 通道从 npm / git 安装插件，管理启停与配置。
- **桌面启动器**（`dsh-desktop-launcher`）：双击桌面图标启动 `dsh web` 并打开 Web GUI，悬浮电源按钮优雅退出宿主进程。
- **外部归档管理**（外部插件 [@mlgbnb/dsh-archive-manager](https://github.com/z953218350/dsh-archive-manager)）：不使用。其上游构建仍 import 已移除的 `@deepseek-ai/dsh-client-runtime` 面，alpha.2 全家桶不内置；会话归档需求由上方内置的「会话归档管理」承担，该外部插件仅在上游发布 alpha.2 兼容构建后再评估。

### 皮肤

经典的 Blue Fantasy 蓝色幻想是随皮肤插件提供的默认皮肤：鲸鱼插画垫在半透明面板下面，靛蓝色调贯穿全局，暗色主题下更明显。其他皮肤与 Wallpaper Engine 壁纸由皮肤插件管理，并统一在[创意工坊](https://dsh-market.com)浏览、试穿与按需安装。

![Blue Fantasy 暗色](docs/screenshots/17-skin-blue-fantasy-dark.png)

## 快速上手

### 系统要求

- 已安装 DeepSeek Harness，`dsh web` 可正常启动。
- npm 安装无额外要求；从仓库安装需要 Node.js >= 22 与 pnpm。

### 三步上手（npm 安装，推荐）

- **DSH Web CLI（浏览器端）**：
  1. 安装聚合包：`dsh plugin --profile web add @linxin666/dsh-web-all@latest`
  2. 重启 `dsh web`，侧边栏出现全部插件入口
  3. 打开「设置 > 插件配置」按需开关插件，或在皮肤面板试穿皮肤
- **DSH Desktop（桌面客户端）**：
  1. 安装聚合包：`dsh plugin --profile desktop add @linxin666/dsh-web-all@latest`
  2. 验证挂载：`dsh --profile desktop --dump-config`
  3. 完全退出并重新启动 DSH Desktop 客户端应用，界面即可显示全部插件与皮肤入口

> 只要皮肤就装 `@linxin666/dsh-client-ui-skin-center`。若装到了旧版本（pnpm 11 的发布年龄门禁），见下方「安装排障」。

### 从 GitHub 仓库直接安装

仓库根 `package.json` 声明 `dsh.bundle`（复用聚合包的装配清单）并依赖 npm 已发布的聚合包，整个仓库因此可以直接当成一个插件安装，无需克隆与构建，插件中心 / hub 按仓库一键安装时走的就是这条路：

```sh
dsh plugin --profile web add github:zhu1090093659/dsh-web
# 等价写法：dsh plugin --profile web add git+https://github.com/zhu1090093659/dsh-web.git
```

插件代码来自安装时解析到的 npm 聚合包，仓库只提供装配清单；该方式与 npm 安装聚合包二选一，两者产出相同的 `web-ui-*` 插件行，同时安装会因重复 id 挂载失败。

### 从仓库安装（开发调试）

插件包已在 npm 发布，仓库安装仅供开发调试（需要 Node.js >= 22 与 pnpm）：

```sh
# 1. 克隆仓库
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web

# 2. 安装依赖并构建
pnpm install
pnpm -r build

# 3. 把全家桶链接进 web profile（推荐，先链接全部子包再注册聚合包）
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-all

# 4. 重启 dsh web，侧边栏即可看到全部插件入口
dsh web
```

> 只想用皮肤：第 3 步只执行 link-profile 后安装 `packages/skins/skin-center` 即可。
>
> 注意：profile 目录不是 pnpm workspace，聚合包里的 `workspace:*` 依赖会回退拉取 npm 已发布版本；
> 若 npm 版本滞后或损坏会出现「宿主已挂载但 UI 不显示」，此时先用 `node scripts/link-profile.mjs`
> 让全部子包走仓库构建产物。

### 从旧聚合包升级

已有 profile 如果仍挂在 `@linxin666/dsh-web-ui-all`，不需要手动先删旧包再装新包。启用 Doctor 后，Doctor Launcher 会在启动 DSH 前检测该旧聚合包并自动执行事务迁移：先安装 `@linxin666/dsh-web-all`，再移除旧包，保留原有 `web-ui-*` 行和 bundle 顺序，并通过 `--dump-config` 预检后才继续启动。用户通过 `dsh-doctor launch` 或 Doctor 服务启动即可；裸 `dsh web` 不经过该 preflight。

### 单独安装某个插件

不想装全家桶时，可单独安装任意插件（npm 已发布，直接用包名）：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board@latest    # 任务看板
dsh plugin --profile web add @linxin666/dsh-ssh@latest                     # 远程连接（SSH）
dsh plugin --profile web add @linxin666/dsh-tool-describe-image@latest     # 图像理解工具
dsh plugin --profile web add @linxin666/dsh-pet@latest                     # 鲸鱼娘宠物
dsh plugin --profile web add @linxin666/dsh-liangshen@latest               # 梁神模式（两阶段锚定 preset，新建会话选择）
dsh plugin --profile web add @linxin666/dsh-doctor@latest                  # 救助模式（默认开启，可在 Doctor 卡片关闭）
dsh plugin --profile web add dsh-better-sidebar@latest                     # 右侧面板（推荐；资源管理器/编辑器/终端/Git/浏览器）
```

<details>
<summary><strong>全部 npm 包一览</strong></summary>

所有插件都以 `@linxin666/dsh-*` scope 发布在 npm，可直接查看与安装：

| npm 包 | 说明 |
| --- | --- |
| [@linxin666/dsh-web-all](https://www.npmjs.com/package/@linxin666/dsh-web-all) | 全家桶聚合包：一个包装齐全部功能插件（含皮肤插件及其皮肤资产） |
| [@linxin666/dsh-client-ui-task-board](https://www.npmjs.com/package/@linxin666/dsh-client-ui-task-board) | 任务看板：真实会话执行 + cron 定时 |
| [@linxin666/dsh-remote-web-ui](https://www.npmjs.com/package/@linxin666/dsh-remote-web-ui) | 扫码配对，移动端 / PC 远程使用 Web GUI |
| [@linxin666/dsh-ssh](https://www.npmjs.com/package/@linxin666/dsh-ssh) | SSH 面板：终端 / 传输 / 隧道 / 集群 |
| [@linxin666/dsh-tool-describe-image](https://www.npmjs.com/package/@linxin666/dsh-tool-describe-image) | `describe_image` 视觉工具 |
| [@linxin666/dsh-pet](https://www.npmjs.com/package/@linxin666/dsh-pet) | 注册表驱动的悬浮宠物 |
| [@linxin666/dsh-liangshen](https://www.npmjs.com/package/@linxin666/dsh-liangshen) | 梁神模式：两阶段锚定 agent preset |
| [@linxin666/dsh-client-ui-git-graph](https://www.npmjs.com/package/@linxin666/dsh-client-ui-git-graph) | Git 分支选择器与提交历史图谱 |
| [@linxin666/dsh-client-ui-skin-center](https://www.npmjs.com/package/@linxin666/dsh-client-ui-skin-center) | 皮肤：全部皮肤的唯一加载器，皮肤资产按需从创意工坊安装 |
| [@linxin666/dsh-client-ui-market](https://www.npmjs.com/package/@linxin666/dsh-client-ui-market) | 创意工坊商店卡：浏览 dsh-market.com 的皮肤 / 宠物 / 插件并一键安装 |
| [@linxin666/dsh-client-ui-plugin-manager](https://www.npmjs.com/package/@linxin666/dsh-client-ui-plugin-manager) | 插件管理器：从 npm / git 安装、启停与配置 |
| [@linxin666/dsh-client-ui-skill-explorer](https://www.npmjs.com/package/@linxin666/dsh-client-ui-skill-explorer) | Skill 中心：浏览 / 启停 / 管理 |
| [@linxin666/dsh-desktop-launcher](https://www.npmjs.com/package/@linxin666/dsh-desktop-launcher) | 桌面启动器：一键启动与关闭 dsh |
| [@linxin666/dsh-doctor](https://www.npmjs.com/package/@linxin666/dsh-doctor) | 事务式救助模式：修复 DSH profile（默认开启） |
| [@linxin666/dsh-client-ui-community-plugins](https://www.npmjs.com/package/@linxin666/dsh-client-ui-community-plugins) | 社区插件数据源：市场插件清单由它生成 |
| [@linxin666/dsh-client-ui-web-ui-settings](https://www.npmjs.com/package/@linxin666/dsh-client-ui-web-ui-settings) | dsh-web 插件组设置区 |

</details>

### 验证与卸载

装好重启 `dsh web`，侧边栏出现对应入口就是生效了；也可以用 `dsh --profile web --dump-config` 确认插件配置层已挂载。侧边栏没新入口，多半是装完没重启 `dsh web`。

卸载：`dsh plugin --profile web remove @linxin666/dsh-web-all`，然后重启 `dsh web`。

技术细节见 [docs/plugins.md](docs/plugins.md)。

### 安装排障

<details>
<summary><strong>展开查看 pnpm 常见问题</strong></summary>

<br>

> pnpm 的严格（isolated）布局只把聚合包放在 profile 顶层，patch 行引用的子包会被收进嵌套目录，`dsh web` 会报 `Cannot find package '@linxin666/dsh-...'`。本包的子包已声明为 dependencies；使用严格布局时，在 profile 的 `pnpm-workspace.yaml` 加 `nodeLinker: hoisted`（或旧式 `public-hoist-pattern: ['@linxin666/*']`），再重新安装即可。

> 首次安装若提示 `ERR_PNPM_IGNORED_BUILDS`（pnpm 拒绝依赖的构建脚本），按提示把 `cloudflared` / `cpu-features` / `ssh2` 加入 profile 的 `pnpm-workspace.yaml` `allowBuilds` 后重新执行即可。

> **pnpm 11 发布年龄门禁**：新版本发布后 24 小时内（`minimumReleaseAge` 内置默认值），pnpm 11 会静默装回更旧的 `@linxin666/*` 版本（如 `dsh-web-all@0.1.20` 配旧版皮肤插件），显式写 `@latest` 同样被隔离。旧版皮肤插件 Apply 皮肤时会写入独立皮肤包引用，导致 `dsh web` 启动崩溃（`ERR_MODULE_NOT_FOUND ... dsh-client-ui-skin-*`）。在 profile 的 `pnpm-workspace.yaml` 中排除全部 `@linxin666/*` 包后再安装或更新：
>
> ```yaml
> minimumReleaseAgeExclude:
>   - '@linxin666/*'
> ```

</details>

## 常见问题

<details>
<summary><strong>装完重启了，侧边栏还是没有入口？</strong></summary>

A: 先确认插件装进了 `web` profile（命令里的 `--profile web`），再用 `dsh --profile web --dump-config` 确认插件配置层已挂载；还不行就看上文「安装排障」。注意页面刷新不够，要重启 `dsh web` 进程。

</details>

<details>
<summary><strong>定时任务为什么没有到点执行？</strong></summary>

A: 定时调度由 `dsh web` Host 完成，不要求浏览器标签页保持打开。Host 停止、系统睡眠或长暂停期间错过的触发点按「错过即跳过」处理，不排队补跑；同一任务正在运行时到点也会顺延到下一个匹配点。若需要允许息屏但阻止整机因空闲睡眠，可显式开启任务看板的电源保护设置。

</details>

<details>
<summary><strong>手机配对后收不到实时消息？</strong></summary>

A: Cloudflare quick tunnel 和 Tailscale Serve 不透传 SSE，这种网络下插件自动降级轮询，消息正常收发，只是新消息可能晚几秒。要即时推送就用支持 SSE 的隧道（Cloudflare named tunnel、自定义 TCP 端口转发等）。

</details>

<details>
<summary><strong>皮肤试了不满意怎么办？</strong></summary>

A: 皮肤支持先试穿再应用：试穿即时生效、退出完全还原，没点「应用」就不落盘，随便试。

</details>

<details>
<summary><strong>只想用皮肤，或者只装某一个插件？</strong></summary>

A: 只要皮肤就装 `@linxin666/dsh-client-ui-skin-center`；只装某一个插件就用「单独安装某个插件」里的包名，两者都走 npm 安装。

</details>

<details>
<summary><strong>装了全家桶还能再单独装同一个插件吗？</strong></summary>

A: 可以。聚合包的行 id 统一带 `web-ui-` 前缀（如 `web-ui-describe-image`），与独立包自己的 id（如 `describe-image`）不冲突，`dsh web` 不会再报 `duplicate loader entry id`；同一插件双源加载时 host 半区只注册一次，浏览器半区按包名去重。两个来源并存没有额外收益，建议只保留一个。注意：profile 里按 id 写的配置行，若插件来自聚合包要用 `web-ui-` 前缀的 id（如 remote-web-ui 的 `autoTunnel` 配置行写成 `web-ui-remote-web-ui`）；独立安装时仍用插件原 id。

</details>

## 已知限制

- 任务看板由 Host 调度，关闭浏览器后仍可运行；Host 停止或整机睡眠期间错过的触发点跳过、不补跑。可选电源保护默认关闭，只阻止空闲系统睡眠，不拦截合盖、手动睡眠、休眠或关机，详见 [dsh-task-board README](packages/dsh-task-board/README.zh.md)。
- SSH 密码与 passphrase 口令以明文保存在 `~/.dsh/dsh-ssh.json`（权限 0600）；断线重连可能重放非幂等命令，远程输出原样返回、不脱敏，安全模型见 [dsh-ssh README](packages/dsh-ssh/README.zh.md)。
- 移动端靠 SSE 实时推送：Cloudflare quick tunnel 和 Tailscale Serve 不透传 SSE，插件自动降级轮询，新消息可能晚几秒。
- 仓库安装需要 Node.js >= 22 与 pnpm，仅供开发调试；npm 安装不受影响。

## 社区

社区交流群在这里，和开发者、其他用户一起聊用法、报问题、提想法。QQ 扫码加入「DSH Web UI 交流群」：

<img src="docs/community-center.jpg" alt="DSH Web UI 交流群" width="240">

也可以加 [Discord 社区](https://discord.gg/6v4gm9u4S)，或直接到 [GitHub Issues](https://github.com/zhu1090093659/dsh-web/issues) 报 Bug / 提需求。

<details>
<summary>友情链接</summary>

- [DeepSeek Harness Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) —— 为 DeepSeek Harness (DSH) 生态打造的现代化桌面端体验。
- [LINUX DO](https://linux.do) —— 有理想的新社区。
- [dshfind](https://dshfind.com) —— 面向 DeepSeek Harness 的学习与分享社区，聚合论文精读、插件超市与用户排名。
- [deepseek-plugin-store](https://github.com/Ericwong5021/deepseek-plugin-store) —— DeepSeek Harness 独立社区插件商店，发现、安装并提交经过验证的插件、工具与扩展。
- [dsh-data-agent](https://github.com/omdsh-dev/dsh-data-agent) —— 为 DSH 定义专用 Data Agent 预设，让 AI 帮你查询、更新、分析数据。
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) —— Claude Code 风格全屏交互终端插件，补位官方缺失的终端 TUI：像素鲸鱼顶栏、实时工作状态行、思考流式展开、双击 Esc 回滚、上下文进度条与 TPS 仪表。
- [dsh-tianshu-tui](https://github.com/huiliyi37/dsh-tianshu-tui) —— 基于官方 DeepSeek Harness 的交互式终端 UI 插件，在官方基础上增加 TDD 与证据门等工作流。
- [dsh-genui](https://github.com/omdsh-dev/dsh-genui) —— 助手回复内联渲染生成式 UI（dsh-ui fence）：布局、图表、表格、表单、Mermaid、3D 与原生音视频，双通道渲染兼容原版 DSH 与新构建，支持流式渲染、面板停靠与组件交互回传模型。
- [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) —— DSH Web 选中批注插件：选文字、写批注、随消息发送，模型按 Annotation N 逐条对照回复；UI 与批注块跟随 DSH 语言切换 zh/en，Cmd/Ctrl+Enter 直发纯批注，斜杠命令原样放行。

</details>

## 参与贡献

- 先读 [CONTRIBUTING.md](CONTRIBUTING.md) 再开 PR；用户可见变更请附截图或验证证据。
- 提交信息遵循 Conventional Commits（如 `fix(task-board): 修复 xxx`），代码、文档与提交信息全程禁止 emoji。
- 新插件与皮肤用脚手架生成：`node scripts/dsh-plugin-new <name>`、`node scripts/dsh-skin-new`。
- 提交前过门禁 `pnpm typecheck && pnpm test && pnpm docs:check`；完整开发流程见 [docs/development.md](docs/development.md)。

## 许可证

本仓库以 [Apache-2.0](LICENSE) 授权。迁入第三方代码必须保留 LICENSE 与署名；活跃且有上游的第三方优先 fork 或依赖引用，不搬代码。

### 来源与版权

<details>
<summary>第三方来源与版权登记（点击展开 · 插件 / 皮肤 / 宠物）</summary>

**插件**

- **dsh-task-board / dsh-git-graph / dsh-pet / dsh-remote-web-ui / dsh-web-settings / dsh-doctor / dsh-ssh / dsh-skill-explorer / dsh-desktop-launcher / dsh-market / dsh-plugin-manager / dsh-community-plugins / dsh-web-all** — 本仓库原创（zhu1090093659），Apache-2.0（zhu1090093659）
- **dsh-tool-describe-image** — 移植自 [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)（deepseek-harness `packages/vision/tool-describe-image`），Apache-2.0（zhu1090093659）
- **dsh-liangshen** — 插件本体原创；preset 派生自 DeepSeek Harness 内置 Minimal / Standard preset 与 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)，Apache-2.0（zhu1090093659）+ MIT（preset 派生件）
- **dsh-better-sidebar** — 外部集成插件 [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（右侧面板，npm 依赖引用），MIT（omdsh-dev）
- **dsh-archive-manager** — 外部集成插件 [z953218350/dsh-archive-manager](https://github.com/z953218350/dsh-archive-manager)（设置页归档管理，npm 依赖引用），MIT（z953218350）
- **dsh-ssh** — 依据 [badseal/ssh-skill](https://github.com/badseal/ssh-skill) 的能力清单实现；代码为本仓库 Apache-2.0（zhu1090093659），上游能力清单归属 badseal/ssh-skill
- **dsh-miku-pet** — 代码与素材布局沿用 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 结构（MIT）；角色「初音未来（Hatsune Miku）」的名称、形象与肖像权归 Crypton Future Media, INC.，使用遵循 Piapro Character License（详见包内 [NOTICE.md](packages/dsh-miku-pet/NOTICE.md)）
- **社区插件索引** — 37 项外部插件，来源与版权由各作者声明，登记于 [community.json](packages/dsh-community-plugins/community.json)，可在「设置 → 社区插件」与 dsh-market.com 查看

**皮肤（第三方作者或第三方素材）**

- **maid-atelier / orca-link** — [Small-tailqwq/dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)，CC BY-NC-SA 4.0；署名链见包内 LICENSE/NOTICE（maid：上善 → zipzip → Small-tailqwq；orca：上善 → Small-tailqwq）
- **cyber-night** — logan0116；代码按仓库许可，背景图由作者以 OpenAI GPT 生成并按 CC0 1.0 贡献公有领域
- **future-window** — zhuqin；背景与装饰原件 Apache-2.0（包内 LICENSE/NOTICE，attribution 见 skin.json）
- **matrix** — 贡献者 seanchen 原创（Matrix 深夜护眼暗色皮肤），Apache-2.0（seanchen 声明）
- **blue-fantasy** — powerdog996（DreamSkin 社区）× dsh-web 适配；皮肤目录内未附第三方许可声明（待作者确认补声明）
- **deep-current** — Twelveeee；皮肤目录内未附许可声明（待作者确认补声明）
- **furina** — 立绘/角色素材 sclass53，皮肤代码 zhu1090093659（目录内 LICENSE 为 BSD-3-Clause）；角色「芙宁娜」版权属米哈游（《原神》），作为粉丝创作使用
- **harbor** — moeblack；皮肤目录内未附许可声明（待作者确认补声明）
- **miku** — 立绘素材 涂山苏苏，皮肤代码 zhu1090093659；角色「初音未来」版权属 Crypton Future Media, INC.（Piapro Character License）
- **pink-sakura** — 立绘素材 guomengjia618-dot，皮肤代码 zhu1090093659（目录内 LICENSE 为 Apache-2.0）
- **war-thunder** — 皮肤代码为本仓库（Apache-2.0）；背景美术与启动器星徽取文本机 War Thunder 游戏客户端，版权归 Gaijin Entertainment，仅供个人非商业使用（见 skin.json attribution）

> 其余皮肤（mint / whale-song / whale-mom / dragon-heir / minecraft / trading / summer-liquid-glass / wallpaper-exclusive / xp）为本仓库原创，Apache-2.0。

**宠物**

- **ouo-neko** — Pessimist0906，MIT（贡献记录见 [PR #1118](https://github.com/zhu1090093659/dsh-web/pull/1118) 与 dsh-pet [THIRD_PARTY_NOTICES.md](packages/dsh-pet/THIRD_PARTY_NOTICES.md)）
- **whale / whale-refined** — 基于 DeepSeek wordmark 衍生的鲸鱼挂件（MIT / BSD-3-Clause；材料与声明见 dsh-pet THIRD_PARTY_NOTICES.md）
- **miku-pet** — 见上文插件条目（角色权利按 Piapro Character License）

</details>

## 贡献者

<!-- CONTRIBUTORS:START -->
<p align="center">
  <a href="https://github.com/zhu1090093659"><img src="https://github.com/zhu1090093659.png?size=64" width="48" height="48" alt="zhu1090093659" title="zhu1090093659" /></a>
  <a href="https://github.com/Aa728848"><img src="https://github.com/Aa728848.png?size=64" width="48" height="48" alt="Aa728848" title="Aa728848" /></a>
  <a href="https://github.com/thinkmoon"><img src="https://github.com/thinkmoon.png?size=64" width="48" height="48" alt="thinkmoon" title="thinkmoon" /></a>
  <a href="https://github.com/sharkymew"><img src="https://github.com/sharkymew.png?size=64" width="48" height="48" alt="sharkymew" title="sharkymew" /></a>
  <a href="https://github.com/stushansusu"><img src="https://github.com/stushansusu.png?size=64" width="48" height="48" alt="stushansusu" title="stushansusu" /></a>
  <a href="https://github.com/mkloveyy"><img src="https://github.com/mkloveyy.png?size=64" width="48" height="48" alt="mkloveyy" title="mkloveyy" /></a>
  <a href="https://github.com/Nath-Vikky"><img src="https://github.com/Nath-Vikky.png?size=64" width="48" height="48" alt="Nath-Vikky" title="Nath-Vikky" /></a>
  <a href="https://github.com/whitelonng"><img src="https://github.com/whitelonng.png?size=64" width="48" height="48" alt="whitelonng" title="whitelonng" /></a>
  <a href="https://github.com/guomengjia618-dot"><img src="https://github.com/guomengjia618-dot.png?size=64" width="48" height="48" alt="guomengjia618-dot" title="guomengjia618-dot" /></a>
  <a href="https://github.com/Qiuner"><img src="https://github.com/Qiuner.png?size=64" width="48" height="48" alt="Qiuner" title="Qiuner" /></a>
  <a href="https://github.com/SnowNightt"><img src="https://github.com/SnowNightt.png?size=64" width="48" height="48" alt="SnowNightt" title="SnowNightt" /></a>
  <a href="https://github.com/suharvest"><img src="https://github.com/suharvest.png?size=64" width="48" height="48" alt="suharvest" title="suharvest" /></a>
  <a href="https://github.com/ch1bug"><img src="https://github.com/ch1bug.png?size=64" width="48" height="48" alt="ch1bug" title="ch1bug" /></a>
  <a href="https://github.com/Menghuan1918"><img src="https://github.com/Menghuan1918.png?size=64" width="48" height="48" alt="Menghuan1918" title="Menghuan1918" /></a>
  <a href="https://github.com/wingsky-1"><img src="https://github.com/wingsky-1.png?size=64" width="48" height="48" alt="wingsky-1" title="wingsky-1" /></a>
  <a href="https://github.com/Qinling-Melon-Farmers"><img src="https://github.com/Qinling-Melon-Farmers.png?size=64" width="48" height="48" alt="Qinling-Melon-Farmers" title="Qinling-Melon-Farmers" /></a>
  <a href="https://github.com/chemmy-11"><img src="https://github.com/chemmy-11.png?size=64" width="48" height="48" alt="chemmy-11" title="chemmy-11" /></a>
  <a href="https://github.com/isdoge"><img src="https://github.com/isdoge.png?size=64" width="48" height="48" alt="isdoge" title="isdoge" /></a>
  <a href="https://github.com/Xeehho"><img src="https://github.com/Xeehho.png?size=64" width="48" height="48" alt="Xeehho" title="Xeehho" /></a>
  <a href="https://github.com/EricWang1358"><img src="https://github.com/EricWang1358.png?size=64" width="48" height="48" alt="EricWang1358" title="EricWang1358" /></a>
  <a href="https://github.com/skymecode"><img src="https://github.com/skymecode.png?size=64" width="48" height="48" alt="skymecode" title="skymecode" /></a>
  <a href="https://github.com/TiankunDai"><img src="https://github.com/TiankunDai.png?size=64" width="48" height="48" alt="TiankunDai" title="TiankunDai" /></a>
  <a href="https://github.com/Small-tailqwq"><img src="https://github.com/Small-tailqwq.png?size=64" width="48" height="48" alt="Small-tailqwq" title="Small-tailqwq" /></a>
  <a href="https://github.com/Grivn"><img src="https://github.com/Grivn.png?size=64" width="48" height="48" alt="Grivn" title="Grivn" /></a>
  <a href="https://github.com/ads4395-prog"><img src="https://github.com/ads4395-prog.png?size=64" width="48" height="48" alt="ads4395-prog" title="ads4395-prog" /></a>
  <a href="https://github.com/matriox1003"><img src="https://github.com/matriox1003.png?size=64" width="48" height="48" alt="matriox1003" title="matriox1003" /></a>
  <a href="https://github.com/spacexun2"><img src="https://github.com/spacexun2.png?size=64" width="48" height="48" alt="spacexun2" title="spacexun2" /></a>
  <a href="https://github.com/z953218350"><img src="https://github.com/z953218350.png?size=64" width="48" height="48" alt="z953218350" title="z953218350" /></a>
  <a href="https://github.com/guo6x"><img src="https://github.com/guo6x.png?size=64" width="48" height="48" alt="guo6x" title="guo6x" /></a>
  <a href="https://github.com/LittleDarkZero"><img src="https://github.com/LittleDarkZero.png?size=64" width="48" height="48" alt="LittleDarkZero" title="LittleDarkZero" /></a>
  <a href="https://github.com/taekchef"><img src="https://github.com/taekchef.png?size=64" width="48" height="48" alt="taekchef" title="taekchef" /></a>
  <a href="https://github.com/YEYUbaka"><img src="https://github.com/YEYUbaka.png?size=64" width="48" height="48" alt="YEYUbaka" title="YEYUbaka" /></a>
  <a href="https://github.com/DDDMUC"><img src="https://github.com/DDDMUC.png?size=64" width="48" height="48" alt="DDDMUC" title="DDDMUC" /></a>
  <a href="https://github.com/suyicon"><img src="https://github.com/suyicon.png?size=64" width="48" height="48" alt="suyicon" title="suyicon" /></a>
  <a href="https://github.com/dickpy"><img src="https://github.com/dickpy.png?size=64" width="48" height="48" alt="dickpy" title="dickpy" /></a>
  <a href="https://github.com/Abyss-Seeker"><img src="https://github.com/Abyss-Seeker.png?size=64" width="48" height="48" alt="Abyss-Seeker" title="Abyss-Seeker" /></a>
  <a href="https://github.com/JsonFish"><img src="https://github.com/JsonFish.png?size=64" width="48" height="48" alt="JsonFish" title="JsonFish" /></a>
  <a href="https://github.com/Theater-ahyeon"><img src="https://github.com/Theater-ahyeon.png?size=64" width="48" height="48" alt="Theater-ahyeon" title="Theater-ahyeon" /></a>
  <a href="https://github.com/xohmai"><img src="https://github.com/xohmai.png?size=64" width="48" height="48" alt="xohmai" title="xohmai" /></a>
  <a href="https://github.com/Zacklinkk"><img src="https://github.com/Zacklinkk.png?size=64" width="48" height="48" alt="Zacklinkk" title="Zacklinkk" /></a>
  <a href="https://github.com/Noob-stupid"><img src="https://github.com/Noob-stupid.png?size=64" width="48" height="48" alt="Noob-stupid" title="Noob-stupid" /></a>
  <a href="https://github.com/weike-zhang"><img src="https://github.com/weike-zhang.png?size=64" width="48" height="48" alt="weike-zhang" title="weike-zhang" /></a>
  <a href="https://github.com/BlessedWithLuck1105"><img src="https://github.com/BlessedWithLuck1105.png?size=64" width="48" height="48" alt="BlessedWithLuck1105" title="BlessedWithLuck1105" /></a>
  <a href="https://github.com/Richard-Peng402"><img src="https://github.com/Richard-Peng402.png?size=64" width="48" height="48" alt="Richard-Peng402" title="Richard-Peng402" /></a>
  <a href="https://github.com/GreenLv"><img src="https://github.com/GreenLv.png?size=64" width="48" height="48" alt="GreenLv" title="GreenLv" /></a>
  <a href="https://github.com/RevolutionLA"><img src="https://github.com/RevolutionLA.png?size=64" width="48" height="48" alt="RevolutionLA" title="RevolutionLA" /></a>
  <a href="https://github.com/JAVA-LW"><img src="https://github.com/JAVA-LW.png?size=64" width="48" height="48" alt="JAVA-LW" title="JAVA-LW" /></a>
  <a href="https://github.com/qzhqzh"><img src="https://github.com/qzhqzh.png?size=64" width="48" height="48" alt="qzhqzh" title="qzhqzh" /></a>
  <a href="https://github.com/neystan"><img src="https://github.com/neystan.png?size=64" width="48" height="48" alt="neystan" title="neystan" /></a>
  <a href="https://github.com/lpreterite"><img src="https://github.com/lpreterite.png?size=64" width="48" height="48" alt="lpreterite" title="lpreterite" /></a>
  <a href="https://github.com/nicecx"><img src="https://github.com/nicecx.png?size=64" width="48" height="48" alt="nicecx" title="nicecx" /></a>
  <a href="https://github.com/logan0116"><img src="https://github.com/logan0116.png?size=64" width="48" height="48" alt="logan0116" title="logan0116" /></a>
  <a href="https://github.com/lemonmmice"><img src="https://github.com/lemonmmice.png?size=64" width="48" height="48" alt="lemonmmice" title="lemonmmice" /></a>
  <a href="https://github.com/kyrie204"><img src="https://github.com/kyrie204.png?size=64" width="48" height="48" alt="kyrie204" title="kyrie204" /></a>
  <a href="https://github.com/kop022"><img src="https://github.com/kop022.png?size=64" width="48" height="48" alt="kop022" title="kop022" /></a>
  <a href="https://github.com/wang-kaopu"><img src="https://github.com/wang-kaopu.png?size=64" width="48" height="48" alt="wang-kaopu" title="wang-kaopu" /></a>
  <a href="https://github.com/dongwenxiu83-web"><img src="https://github.com/dongwenxiu83-web.png?size=64" width="48" height="48" alt="dongwenxiu83-web" title="dongwenxiu83-web" /></a>
  <a href="https://github.com/ma15803216102"><img src="https://github.com/ma15803216102.png?size=64" width="48" height="48" alt="ma15803216102" title="ma15803216102" /></a>
  <a href="https://github.com/Chimney"><img src="https://github.com/Chimney.png?size=64" width="48" height="48" alt="Chimney" title="Chimney" /></a>
  <a href="https://github.com/viplocco"><img src="https://github.com/viplocco.png?size=64" width="48" height="48" alt="viplocco" title="viplocco" /></a>
  <a href="https://github.com/Zhiyi-Zhao"><img src="https://github.com/Zhiyi-Zhao.png?size=64" width="48" height="48" alt="Zhiyi-Zhao" title="Zhiyi-Zhao" /></a>
  <a href="https://github.com/PcHeN0720"><img src="https://github.com/PcHeN0720.png?size=64" width="48" height="48" alt="PcHeN0720" title="PcHeN0720" /></a>
  <a href="https://github.com/AngleNaris"><img src="https://github.com/AngleNaris.png?size=64" width="48" height="48" alt="AngleNaris" title="AngleNaris" /></a>
  <a href="https://github.com/ShiroEirin"><img src="https://github.com/ShiroEirin.png?size=64" width="48" height="48" alt="ShiroEirin" title="ShiroEirin" /></a>
  <a href="https://github.com/zxkk97984-creator"><img src="https://github.com/zxkk97984-creator.png?size=64" width="48" height="48" alt="zxkk97984-creator" title="zxkk97984-creator" /></a>
  <a href="https://github.com/yiyueawa"><img src="https://github.com/yiyueawa.png?size=64" width="48" height="48" alt="yiyueawa" title="yiyueawa" /></a>
  <a href="https://github.com/yufengnigel"><img src="https://github.com/yufengnigel.png?size=64" width="48" height="48" alt="yufengnigel" title="yufengnigel" /></a>
  <a href="https://github.com/yongshuai0314"><img src="https://github.com/yongshuai0314.png?size=64" width="48" height="48" alt="yongshuai0314" title="yongshuai0314" /></a>
  <a href="https://github.com/xiaobin"><img src="https://github.com/xiaobin.png?size=64" width="48" height="48" alt="xiaobin" title="xiaobin" /></a>
  <a href="https://github.com/wszhoho"><img src="https://github.com/wszhoho.png?size=64" width="48" height="48" alt="wszhoho" title="wszhoho" /></a>
  <a href="https://github.com/wsy222"><img src="https://github.com/wsy222.png?size=64" width="48" height="48" alt="wsy222" title="wsy222" /></a>
  <a href="https://github.com/v833"><img src="https://github.com/v833.png?size=64" width="48" height="48" alt="v833" title="v833" /></a>
  <a href="https://github.com/user-A100"><img src="https://github.com/user-A100.png?size=64" width="48" height="48" alt="user-A100" title="user-A100" /></a>
  <a href="https://github.com/starryrbs"><img src="https://github.com/starryrbs.png?size=64" width="48" height="48" alt="starryrbs" title="starryrbs" /></a>
  <a href="https://github.com/SnowCrescenter-tech"><img src="https://github.com/SnowCrescenter-tech.png?size=64" width="48" height="48" alt="SnowCrescenter-tech" title="SnowCrescenter-tech" /></a>
  <a href="https://github.com/slywalker2006"><img src="https://github.com/slywalker2006.png?size=64" width="48" height="48" alt="slywalker2006" title="slywalker2006" /></a>
  <a href="https://github.com/Sivan757"><img src="https://github.com/Sivan757.png?size=64" width="48" height="48" alt="Sivan757" title="Sivan757" /></a>
  <a href="https://github.com/sclass53"><img src="https://github.com/sclass53.png?size=64" width="48" height="48" alt="sclass53" title="sclass53" /></a>
  <a href="https://github.com/rongxingda"><img src="https://github.com/rongxingda.png?size=64" width="48" height="48" alt="rongxingda" title="rongxingda" /></a>
  <a href="https://github.com/rainow"><img src="https://github.com/rainow.png?size=64" width="48" height="48" alt="rainow" title="rainow" /></a>
  <a href="https://github.com/OctKwong30"><img src="https://github.com/OctKwong30.png?size=64" width="48" height="48" alt="OctKwong30" title="OctKwong30" /></a>
  <a href="https://github.com/Moeblack"><img src="https://github.com/Moeblack.png?size=64" width="48" height="48" alt="Moeblack" title="Moeblack" /></a>
  <a href="https://github.com/Lem0nTea2002"><img src="https://github.com/Lem0nTea2002.png?size=64" width="48" height="48" alt="Lem0nTea2002" title="Lem0nTea2002" /></a>
  <a href="https://github.com/LHMQ878"><img src="https://github.com/LHMQ878.png?size=64" width="48" height="48" alt="LHMQ878" title="LHMQ878" /></a>
  <a href="https://github.com/JUANWANG-BUAA"><img src="https://github.com/JUANWANG-BUAA.png?size=64" width="48" height="48" alt="JUANWANG-BUAA" title="JUANWANG-BUAA" /></a>
  <a href="https://github.com/Izgenlre"><img src="https://github.com/Izgenlre.png?size=64" width="48" height="48" alt="Izgenlre" title="Izgenlre" /></a>
  <a href="https://github.com/NuCl34R"><img src="https://github.com/NuCl34R.png?size=64" width="48" height="48" alt="NuCl34R" title="NuCl34R" /></a>
  <a href="https://github.com/HAN102300"><img src="https://github.com/HAN102300.png?size=64" width="48" height="48" alt="HAN102300" title="HAN102300" /></a>
  <a href="https://github.com/superman32432432"><img src="https://github.com/superman32432432.png?size=64" width="48" height="48" alt="superman32432432" title="superman32432432" /></a>
  <a href="https://github.com/FoolishWiser"><img src="https://github.com/FoolishWiser.png?size=64" width="48" height="48" alt="FoolishWiser" title="FoolishWiser" /></a>
  <a href="https://github.com/farobute"><img src="https://github.com/farobute.png?size=64" width="48" height="48" alt="farobute" title="farobute" /></a>
  <a href="https://github.com/DavidWanm"><img src="https://github.com/DavidWanm.png?size=64" width="48" height="48" alt="DavidWanm" title="DavidWanm" /></a>
  <a href="https://github.com/DamonKoy"><img src="https://github.com/DamonKoy.png?size=64" width="48" height="48" alt="DamonKoy" title="DamonKoy" /></a>
  <a href="https://github.com/aexachao"><img src="https://github.com/aexachao.png?size=64" width="48" height="48" alt="aexachao" title="aexachao" /></a>
  <a href="https://github.com/ch3n4y"><img src="https://github.com/ch3n4y.png?size=64" width="48" height="48" alt="ch3n4y" title="ch3n4y" /></a>
  <a href="https://github.com/Beverly621"><img src="https://github.com/Beverly621.png?size=64" width="48" height="48" alt="Beverly621" title="Beverly621" /></a>
  <a href="https://github.com/AmethystLuna"><img src="https://github.com/AmethystLuna.png?size=64" width="48" height="48" alt="AmethystLuna" title="AmethystLuna" /></a>
  <a href="https://github.com/Aik358"><img src="https://github.com/Aik358.png?size=64" width="48" height="48" alt="Aik358" title="Aik358" /></a>
  <a href="https://github.com/liaoyonghong"><img src="https://github.com/liaoyonghong.png?size=64" width="48" height="48" alt="liaoyonghong" title="liaoyonghong" /></a>
  <a href="https://github.com/YeqingTang"><img src="https://github.com/YeqingTang.png?size=64" width="48" height="48" alt="YeqingTang" title="YeqingTang" /></a>
  <a href="https://github.com/cncolder"><img src="https://github.com/cncolder.png?size=64" width="48" height="48" alt="cncolder" title="cncolder" /></a>
  <a href="https://github.com/great-man2096"><img src="https://github.com/great-man2096.png?size=64" width="48" height="48" alt="great-man2096" title="great-man2096" /></a>
  <a href="https://github.com/Starfie1d1272"><img src="https://github.com/Starfie1d1272.png?size=64" width="48" height="48" alt="Starfie1d1272" title="Starfie1d1272" /></a>
  <a href="https://github.com/WyxBUPT-22"><img src="https://github.com/WyxBUPT-22.png?size=64" width="48" height="48" alt="WyxBUPT-22" title="WyxBUPT-22" /></a>
  <a href="https://github.com/Wike-CHI"><img src="https://github.com/Wike-CHI.png?size=64" width="48" height="48" alt="Wike-CHI" title="Wike-CHI" /></a>
  <a href="https://github.com/CCMKCCMK"><img src="https://github.com/CCMKCCMK.png?size=64" width="48" height="48" alt="CCMKCCMK" title="CCMKCCMK" /></a>
  <a href="https://github.com/wanpan11"><img src="https://github.com/wanpan11.png?size=64" width="48" height="48" alt="wanpan11" title="wanpan11" /></a>
  <a href="https://github.com/Walvez"><img src="https://github.com/Walvez.png?size=64" width="48" height="48" alt="Walvez" title="Walvez" /></a>
  <a href="https://github.com/UnusWhite"><img src="https://github.com/UnusWhite.png?size=64" width="48" height="48" alt="UnusWhite" title="UnusWhite" /></a>
  <a href="https://github.com/Ultronen"><img src="https://github.com/Ultronen.png?size=64" width="48" height="48" alt="Ultronen" title="Ultronen" /></a>
  <a href="https://github.com/Twelveeee"><img src="https://github.com/Twelveeee.png?size=64" width="48" height="48" alt="Twelveeee" title="Twelveeee" /></a>
  <a href="https://github.com/Tinger-X"><img src="https://github.com/Tinger-X.png?size=64" width="48" height="48" alt="Tinger-X" title="Tinger-X" /></a>
  <a href="https://github.com/Signalight"><img src="https://github.com/Signalight.png?size=64" width="48" height="48" alt="Signalight" title="Signalight" /></a>
  <a href="https://github.com/Scotlight"><img src="https://github.com/Scotlight.png?size=64" width="48" height="48" alt="Scotlight" title="Scotlight" /></a>
  <a href="https://github.com/NikolaFC"><img src="https://github.com/NikolaFC.png?size=64" width="48" height="48" alt="NikolaFC" title="NikolaFC" /></a>
  <a href="https://github.com/QIU0826"><img src="https://github.com/QIU0826.png?size=64" width="48" height="48" alt="QIU0826" title="QIU0826" /></a>
</p>
<p align="center">
  <sub><a href="https://github.com/zhu1090093659/dsh-web/graphs/contributors">查看全部贡献者</a></sub>
</p>
<!-- CONTRIBUTORS:END -->

<div align="center">

**喜欢这个项目？点个 Star。**

[报告 Bug](https://github.com/zhu1090093659/dsh-web/issues) · [请求功能](https://github.com/zhu1090093659/dsh-web/issues) · [查看 Releases](https://github.com/zhu1090093659/dsh-web/releases)

</div>

## 赞助支持

感谢每一位使用、反馈和贡献 dsh-web 的朋友。如果这个项目对你有帮助，欢迎扫码赞助，支持项目持续维护与发展：

<p align="center">
  <img src="docs/zanzhu-wechat.jpg" alt="微信赞助二维码" width="360">
</p>