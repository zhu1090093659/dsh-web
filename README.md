# dsh-web-ui · DSH Web UI

中文 | [English](README.en.md)

<p align="center">
  <img src="docs/dsh-web-ui-banner.png" alt="dsh-web-ui" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/zhu1090093659/dsh-web-ui?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/github/stars/zhu1090093659/dsh-web-ui?style=flat-square" alt="Stars">
  &nbsp;
  <img src="https://img.shields.io/github/forks/zhu1090093659/dsh-web-ui?style=flat-square" alt="Forks">
  &nbsp;
  <img src="https://img.shields.io/npm/v/@linxin666%2Fdsh-web-ui-all?style=flat-square&label=npm" alt="npm">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
  <br>
  <img src="https://github.com/zhu1090093659/dsh-web-ui/actions/workflows/ci.yml/badge.svg?style=flat-square&branch=main" alt="CI">
  &nbsp;
  <img src="https://img.shields.io/badge/coverage-pending-lightgrey?style=flat-square" alt="Coverage">
</p>

CI 门禁：typecheck / test / scripts / docs / 聚合与画廊一致性；覆盖率与代码风格（Prettier / ESLint）门禁待接入 CI。

<p align="center">
  <strong>DeepSeek Harness（DSH）Web GUI 的插件与皮肤全家桶</strong><br>
  <em>梁神模式 · 任务看板 · Git 图谱 · 右侧面板 · 移动端远程 · SSH 运维 · 图像理解 · 鲸鱼娘宠物 · 实时吞吐 · 皮肤中心</em>
</p>

<p align="center">

[是什么](#是什么) · [功能插件](#功能插件) · [皮肤](#皮肤) · [快速开始](#快速开始) · [常见问题](#常见问题) · [已知限制](#已知限制) · [社区](#社区)

</p>

## 是什么

dsh-web-ui 是给 DeepSeek Harness（DSH）Web GUI 用的插件和皮肤集合：面向 DeepSeek V4 Pro 的「梁神模式」agent 预设，以及任务看板、Git 图谱、右侧面板、移动端远程、SSH 运维、图像理解、鲸鱼娘宠物、实时吞吐和皮肤中心。所有插件都走官方 profile 机制挂载到 `dsh web`，不改 DSH 源码；可以逐个安装，也可以用聚合包一次装齐。

![DSH Web UI 主界面](docs/screenshots/13-hero-main.png)

| 能力 | 原生 dsh web | dsh-web-ui 全家桶 |
| --- | --- | --- |
| Agent 预设 | 官方预设（Standard / Minimal 等） | 梁神模式：面向 V4 Pro 的两阶段锚定预设 |
| 任务看板 | 无 | 多列看板 + cron 定时真实执行 |
| Git 可视化 | 无 | 分支泳道 + 提交历史图谱 |
| 文件预览与变更 | 无 | 右侧面板：预览 / 文件树 / SCM |
| 移动端远程 | 无 | 扫码配对，SSE 实时同步 |
| 远程服务器运维 | 无 | SSH 面板：终端 / 传输 / 隧道 / 集群 |
| 图像理解 | 无 | `describe_image` 视觉工具 |
| 主题皮肤 | 默认主题 | 皮肤中心 10 款，先试穿再应用 |

## 功能插件

### 梁神模式

DeepSeek V4 Pro 对首轮工具目录很敏感。社区评测里，官方 Standard / PTC 预设只有 91 / 92 分，Minimal 能到 99 / 96，但 Minimal 只有两个工具。梁神模式把这两步拼起来：新建会话时在预设选择器里选「梁神模式」，首轮按 Minimal 开局（只暴露持久 `bash` 与 `str_replace_editor`，只放行你自己的消息），轨迹锚定后自动切到 Code Mode（PTC），完整工具注册表、workspace 指令和 skill 目录随后恢复。Windows 原生环境实测（DeepSeek V4 Pro）98 / 99，均值 98.5，不是抽卡，也不需要牺牲完整工具能力。

![梁神模式两阶段锚定效果对比（示意图，模拟渲染）](docs/images/liangshen-mode.png)

原理、稳定化控制与限制详见 [dsh-liangshen README](packages/dsh-liangshen/README.zh.md)。

### 任务看板

侧边栏点「任务看板」进入。任务按五列摆开：待规划、待办、进行中、已完成、已失败。点卡片上的「执行」，任务交给真实的 DSH 智能体会话去跑，跑完状态自动回写；想复盘就跳回执行会话看完整过程。

任务也支持定时跑：详情里配 cron 表达式（比如每天 23:00 自动升级 DSH、每周一 09:00 生成周报），到点自己开工，不用人盯着。

| 多列看板 | 定时执行 |
| --- | --- |
| ![任务看板](docs/screenshots/09-task-board.png) | ![任务定时执行](docs/screenshots/10-task-board-detail-cron.png) |

### Git 图谱

输入框上方有分支选择器，可以切分支、翻提交历史；Git 图谱把分支泳道和提交历史画出来，仓库再大也能顺着时间线找到变更。

![Git 图谱](docs/screenshots/04-git-graph.png)

### 右侧面板

项目会话打开时，聊天区右侧出现「预览」与「文件/变更」两块面板：

- **文件树**：浏览工作目录，点文件名在预览面板打开，点整行展开文件夹，支持按文件名搜索；
- **预览**：多标签预览 markdown、HTML、代码、diff、CSV、PDF、Office、图片与文本，可切换源码 / 预览、分屏编辑、保存；
- **变更（SCM）**：真实的 git 变更面板，stage / unstage / discard；
- 面板宽度可拖，双击把手复位；折叠状态和宽度按项目记住；
- 10 款皮肤都适配右侧面板，换肤后面板跟着变。

![右侧面板](docs/screenshots/19-right-panel.png)

### 鲸鱼娘宠物

一只常驻界面的鲸鱼娘，跟着智能体状态换动画：思考、等待、工作、庆祝。可以点她互动（摸头），喂小鱼干加亲密度，从幼鲸一路养到「深海羁绊」。名字能改，位置能拖，不想看就藏起来。

| 陪伴工作 | 互动面板 |
| --- | --- |
| ![鲸鱼娘宠物](docs/screenshots/11-pet-new-chat.png) | ![宠物互动面板](docs/screenshots/12-pet-panel.png) |

### 实时吞吐统计

会话状态行本来就有 token 用量，本插件补的是实时吞吐：响应边流边更新输入 / 输出 token 估算（`~` 表示启发式估算），TPS 跟在步骤计数后面；provider 用量一到，估算自动换成真实值。

![实时吞吐统计](docs/screenshots/18-live-stats.png)

### 移动端远程

侧边栏底部的手机图标打开配对面板。扫码（或复制链接）配对后，手机进独立移动端界面，远程操作当前的 dsh web 工作区：看会话、开新会话、收发消息、切模型和思考强度、调权限预设，都和桌面端同步。配对令牌一次性、限时，「停止」随时吊销所有设备；二维码默认走局域网，开 cloudflared 公网隧道后手机在任何网络都能配对。

> **实时消息与隧道**：移动端靠 SSE（Server-Sent Events）收实时消息。Cloudflare quick tunnel（trycloudflare.com）和 Tailscale Serve 不透传 SSE，普通 HTTP 正常、实时推送到不了；这种网络下插件自动降级轮询，收发消息正常，只是新消息可能晚几秒。要即时推送就用支持 SSE 的隧道（Cloudflare named tunnel、自定义 TCP 端口转发等）。

| 工作区列表 | 会话列表与新建会话 |
| --- | --- |
| ![移动端工作区](docs/screenshots/20-mobile-workspaces.png) | ![移动端会话列表](docs/screenshots/21-mobile-sessions.png) |
| 聊天（折叠的深度思考与工具调用） | 模型与思考强度选择 |
| ![移动端聊天](docs/screenshots/22-mobile-chat.png) | ![模型选择](docs/screenshots/23-mobile-model-sheet.png) |

### 远程连接

侧边栏「SSH」入口打开远程运维面板。主机支持密钥 / 密码认证，可从 `~/.ssh/config` 一键导入；配置都在 `~/.dsh/dsh-ssh.json`。对已配置主机可执行真实操作：

- **Web 终端**：xterm.js 远程终端，实时输出，窗口大小自适应；
- **文件传输**：SFTP 上传 / 下载，有进度条，能浏览远程目录；
- **端口转发**：本地隧道直连远程内网服务（数据库、API、管理后台），只监听 127.0.0.1；
- **集群执行**：一条命令并发跑多台主机，按别名 / 环境 / 标签过滤；
- **Agent 直连**：Agent 和面板共用同一份主机配置，对话里说一句「连一下 xxx 看看状态」，智能体就去执行远程命令。

### 图像理解

给纯文本模型补上视觉：对话里提到图片（本地路径、http(s) URL、会话附件）时，`describe_image` 把图片发给配置好的 OpenAI 兼容视觉端点（Qwen-VL、GLM-4V、GPT-4o、本地 Ollama 都行）回答，**进会话的只有返回的文本，图片本身不进会话记录**。纯文本模型输入框没有图片入口，插件在输入框加了个图片按钮：选图后生成附件引用插进草稿，模型就能用 `describe_image` 分析；工具还支持 `prompt` 参数传自定义指令（OCR、UI 诊断、翻译），比默认描述准。端点、模型、密钥、默认指令在「设置 > 插件配置 > Image understanding」里配，即时生效。

### 设置中心

全部插件的开关和参数都在「设置」里，改了即时生效。设置侧边栏的一级菜单：通用设置、模式、插件、Agent 预设，加上 Web UI 插件组（归组 task-board / live-stats / remote-web-ui / describe-image）、皮肤中心、社区插件与宠物，打开即直接展开内容、无需再点折叠；插件配置页保留三个内置插件（Shell / Agent loop / Web search），各自独立开关与配置。

![设置中心](docs/screenshots/02-settings-web-ui-plugins.png)

## 皮肤

皮肤中心有 10 款皮肤，都支持先试穿再应用：试穿即时生效、退出完全还原，满意再一键应用。

![皮肤中心](docs/screenshots/03-settings-skin-center.png)

10 款皮肤一览（龙的传人 / 初音未来 · 电子歌姬 / 同花顺风格三款截图待补充）：

![10 款皮肤一览](docs/images/skins-montage.png)

### Windows XP（Luna）

还原 Luna 经典界面：蓝色渐变窗口条、绿色「开始」按钮、Bliss 蓝天桌面，全局直角风格。

![Windows XP 皮肤](docs/screenshots/16-skin-xp-light.png)

### Blue Fantasy 蓝色幻想

鲸鱼插画垫在半透明面板下面，靛蓝色调贯穿全局，暗色主题下更明显。

![Blue Fantasy 暗色](docs/screenshots/17-skin-blue-fantasy-dark.png)

### 鲸吟（Whale Song）

深海鲸语女神主题：无文字纯氛围背景画（蓝发女神与鲸群居左、冰蓝星座网格与金色细线点缀、右侧大量留白）垫在半透明面板下面，冰蓝 / 浅青 / 深海军蓝 / 钴蓝冷色体系贯穿全局，暗色变体是深海夜航调。

![鲸吟 亮色](docs/screenshots/24-skin-whale-song-light.png) · ![鲸吟 暗色](docs/screenshots/25-skin-whale-song-dark.png)

### 夕港（Harbor）

黄昏港口主题：动漫少女港口背景（暮光蓝天空渐入日落橙）垫在半透明面板下面，深暮蓝底与日落橙主色贯穿全局，亮色是薄暮纱、暗色是深海夜航纱。

![夕港 亮色](docs/screenshots/26-skin-harbor-light.png) · ![夕港 暗色](docs/screenshots/27-skin-harbor-dark.png)

## 快速开始

### 系统要求

- 已安装 DeepSeek Harness，`dsh web` 可正常启动。
- npm 安装方式无额外要求；从仓库安装需要 Node.js >= 22 与 pnpm。

### 三步上手

1. 安装聚合包：`dsh plugin --profile web add @linxin666/dsh-web-ui-all`
2. 重启 `dsh web`，侧边栏出现全部插件入口
3. 打开「设置 > 插件配置」按需开关插件，或在皮肤中心试穿皮肤

### 从 npm 安装（推荐）

插件已发布到 npm（`@linxin666` scope），一条命令装齐：

```sh
dsh plugin --profile web add @linxin666/dsh-web-ui-all
```

装完重启 `dsh web`，侧边栏就有全部插件入口。只要皮肤就装 `@linxin666/dsh-skins`。

### 从 GitHub 仓库安装（开发调试）

插件包已在 npm 发布，仓库安装仅供开发调试（需要 Node.js >= 22 与 pnpm）：

```sh
# 1. 克隆仓库
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui

# 2. 安装依赖并构建
pnpm install
pnpm -r build

# 3. 把全家桶链接进 web profile（推荐，先链接全部子包再注册聚合包）
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-all

# 4. 重启 dsh web，侧边栏即可看到全部插件入口
dsh web
```

> 只想用皮肤：第 3 步只执行 link-profile 后安装 `packages/dsh-skins` 即可。
>
> 注意：profile 目录不是 pnpm workspace，聚合包里的 `workspace:*` 依赖会回退拉取 npm 已发布版本；
> 若 npm 版本滞后或损坏会出现「宿主已挂载但 UI 不显示」，此时先用 `node scripts/link-profile.mjs`
> 让全部子包走仓库构建产物。

### 单独安装某个插件

不想装全家桶时，可单独安装任意插件（npm 已发布，直接用包名）：

```sh
dsh plugin --profile web add @linxin666/dsh-liangshen              # 梁神模式
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board   # 任务看板
dsh plugin --profile web add @linxin666/dsh-ssh                    # 远程连接（SSH）
dsh plugin --profile web add @linxin666/dsh-tool-describe-image    # 图像理解工具
dsh plugin --profile web add @linxin666/dsh-pet                    # 鲸鱼娘宠物
```

### 验证与卸载

装好重启 `dsh web`，侧边栏出现对应入口就是生效了；也可以用 `dsh --profile web --dump-config` 确认插件配置层已挂载。侧边栏没新入口，多半是装完没重启 `dsh web`。

卸载：`dsh plugin --profile web remove @linxin666/dsh-web-ui-all`，然后重启 `dsh web`。

技术细节见 [docs/plugins.md](docs/plugins.md)。

### 安装排障

<details>
<summary><strong>展开查看 pnpm 常见问题</strong></summary>

<br>

> pnpm 的严格（isolated）布局只把聚合包放在 profile 顶层，patch 行引用的 11 个子包（共 12 行 insert）会被收进嵌套目录，`dsh web` 会报 `Cannot find package '@linxin666/dsh-...'`。本包的子包已声明为 dependencies；使用严格布局时，在 profile 的 `pnpm-workspace.yaml` 加 `nodeLinker: hoisted`（或旧式 `public-hoist-pattern: ['@linxin666/*']`），再重新安装即可。

> 首次安装若提示 `ERR_PNPM_IGNORED_BUILDS`（pnpm 拒绝依赖的构建脚本），按提示把 `cloudflared` / `cpu-features` / `ssh2` 加入 profile 的 `pnpm-workspace.yaml` `allowBuilds` 后重新执行即可。

> **pnpm 11 release-age 门禁**：新版本发布后约 10 天内，pnpm 11 的 `minimumReleaseAge` 门禁可能静默装回更旧的 `@linxin666/*` 版本（如 `dsh-web-ui-all@0.1.5` 配旧版皮肤中心）。旧版皮肤中心 Apply 皮肤时会写入独立皮肤包引用，导致 `dsh web` 启动崩溃（`ERR_MODULE_NOT_FOUND ... dsh-client-ui-skin-*`）。在 profile 的 `pnpm-workspace.yaml` 中排除全部 `@linxin666/*` 包后再安装或更新：
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

A: 定时调度在浏览器端完成，`dsh web` 标签页要一直开着；关闭期间错过的触发点按「错过即跳过」处理，不排队补跑。任务正在运行时到点也会顺延到下一个匹配点。

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

A: 只要皮肤就装 `@linxin666/dsh-skins`；只装某一个插件就用「单独安装某个插件」里的包名，两者都走 npm 安装。

</details>

## 已知限制

- 任务看板的定时调度在浏览器端：`dsh web` 标签页要保持打开，关闭期间错过的触发点跳过、不补跑，详见 [dsh-task-board README](packages/dsh-task-board/README.zh.md)。
- SSH 密码与 passphrase 口令以明文保存在 `~/.dsh/dsh-ssh.json`（权限 0600）；断线重连可能重放非幂等命令，远程输出原样返回、不脱敏，安全模型见 [dsh-ssh README](packages/dsh-ssh/README.zh.md)。
- 移动端靠 SSE 实时推送：Cloudflare quick tunnel 和 Tailscale Serve 不透传 SSE，插件自动降级轮询，新消息可能晚几秒。
- 仓库安装需要 Node.js >= 22 与 pnpm，仅供开发调试；npm 安装不受影响。

## 社区

社区交流群在这里，和开发者、其他用户一起聊用法、报问题、提想法。QQ 扫码加入「DSH Web UI 交流群」：

![DSH Web UI 交流群](docs/community-center.jpg)

也可以加 [Discord 社区](https://discord.gg/6v4gm9u4S)，或直接到 [GitHub Issues](https://github.com/zhu1090093659/dsh-web-ui/issues) 报 Bug / 提需求。

<details>
<summary>友情链接</summary>

- [DeepSeek Harness Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) —— 为 DeepSeek Harness (DSH) 生态打造的现代化桌面端体验。
- [LINUX DO](https://linux.do) —— 有理想的新社区。
- [dshfind](https://dshfind.com) —— 面向 DeepSeek Harness 的学习与分享社区，聚合论文精读、插件超市与用户排名。
- [deepseek-plugin-store](https://github.com/Ericwong5021/deepseek-plugin-store) —— DeepSeek Harness 独立社区插件商店，发现、安装并提交经过验证的插件、工具与扩展。
- [dsh-data-agent](https://github.com/omdsh-dev/dsh-data-agent) —— 为 DSH 定义专用 Data Agent 预设，让 AI 帮你查询、更新、分析数据。
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) —— Claude Code 风格全屏交互终端插件，补位官方缺失的终端 TUI：像素鲸鱼顶栏、实时工作状态行、思考流式展开、双击 Esc 回滚、上下文进度条与 TPS 仪表。
- [dsh-tianshu-tui](https://github.com/huiliyi37/dsh-tianshu-tui) —— 基于官方 DeepSeek Harness 的交互式终端 UI 插件，在官方基础上增加 TDD 与证据门等工作流。
- [dsh-genui](https://github.com/omdsh-dev/dsh-genui) —— 助手回复内联渲染生成式 UI（dsh-ui fence）：布局、图表、表单、Mermaid、3D 与面板停靠，组件交互回传模型。
- [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) —— DSH Web 选中批注插件：选文字、写批注、随消息发送，模型按 Annotation N 逐条对照回复。

</details>

## 参与贡献

- 先读 [CONTRIBUTING.md](CONTRIBUTING.md) 再开 PR；用户可见变更请附截图或验证证据。
- 提交信息遵循 Conventional Commits（如 `fix(task-board): 修复 xxx`），代码、文档与提交信息全程禁止 emoji。
- 新插件与皮肤用脚手架生成：`node scripts/dsh-plugin-new <name>`、`node scripts/dsh-skin-new`。
- 提交前过门禁 `pnpm typecheck && pnpm test && pnpm docs:check`；完整开发流程见 [docs/development.md](docs/development.md)。

## 许可证

本仓库以 [Apache-2.0](LICENSE) 授权。迁入第三方代码必须保留 LICENSE 与署名；活跃且有上游的第三方优先 fork 或依赖引用，不搬代码。

### 来源与版权

| 包 | 来源 | 版权 |
| --- | --- | --- |
| dsh-task-board / dsh-git-graph / dsh-aionui-panel / dsh-pet / dsh-remote-web-ui / dsh-live-stats / dsh-web-ui-settings / dsh-liangshen / dsh-skins / dsh-web-ui-all / skins | 作者 zhu1090093659 个人开发 | Apache-2.0（zhu1090093659） |
| dsh-tool-describe-image | 移植自 [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)（deepseek-harness `packages/vision/tool-describe-image`） | Apache-2.0（zhu1090093659） |

## 贡献者

<p align="center">
  <a href="https://github.com/zhu1090093659/dsh-web-ui/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=zhu1090093659/dsh-web-ui" alt="Contributors">
  </a>
</p>

<div align="center">

**喜欢这个项目？点个 Star。**

[报告 Bug](https://github.com/zhu1090093659/dsh-web-ui/issues) · [请求功能](https://github.com/zhu1090093659/dsh-web-ui/issues) · [查看 Releases](https://github.com/zhu1090093659/dsh-web-ui/releases)

</div>
