# dsh-web-ui · DSH Web UI

中文 | [English](README.en.md)

![dsh-web-ui](docs/dsh-web-ui-banner.png)

dsh-web-ui 是 DeepSeek Harness（DSH）Web UI 的插件与皮肤集合：任务看板、Git 图谱、右侧面板、移动端远程、远程连接、鲸鱼娘宠物、实时令牌统计，以及皮肤中心。所有插件既可独立安装，也可通过聚合包一次装齐。

![DSH Web UI 主界面](docs/screenshots/13-hero-main.png)

## 功能插件

### 任务看板

在侧边栏点击「任务看板」进入。任务按五列状态组织：待规划、待办、进行中、已完成、已失败。点击卡片上的「执行」，任务将由真实的 DSH 智能体会话执行，完成后状态自动回写；需要复盘时，可直接跳转到执行会话查看完整过程。

任务支持定时执行：在详情中配置 cron 表达式（如每天 23:00 自动升级 DSH、每周一 09:00 生成周报），到点自动开工，无需人工值守。

| 多列看板 | 定时执行 |
| --- | --- |
| ![任务看板](docs/screenshots/09-task-board.png) | ![任务定时执行](docs/screenshots/10-task-board-detail-cron.png) |

### Git 图谱

输入框上方的分支选择器，支持切换分支与查看提交历史；Git 图谱将分支泳道与提交历史可视化，仓库再大也能顺着时间线快速定位变更。

![Git 图谱](docs/screenshots/04-git-graph.png)

### 右侧面板

项目会话打开时，聊天区右侧出现「预览」与「文件/变更」两块面板：

- **文件树**：浏览工作目录，点击文件即在预览面板打开，整行点击展开文件夹，支持按文件名搜索定位；
- **预览**：多标签预览 markdown、HTML、代码、diff、CSV、PDF、Office、图片与文本等格式，支持源码 / 预览切换、分屏编辑与保存；
- **变更（SCM）**：真实 git 变更面板，支持 stage / unstage / discard；
- 面板宽度可拖拽调整，双击把手复位默认宽度，折叠状态与宽度按项目持久化；
- 7 款皮肤全部适配右侧面板，换肤后面板随之融入主题。

![右侧面板](docs/screenshots/19-right-panel.png)

### 鲸鱼娘宠物

一只常驻界面的鲸鱼娘宠物，会跟随智能体的状态切换动画：思考、等待、工作、庆祝。点击可互动（摸头），投喂小鱼干可提升亲密度，陪伴度从幼鲸一路成长至「深海羁绊」。支持自定义名称、自由拖动位置，也可随时隐藏。

| 陪伴工作 | 互动面板 |
| --- | --- |
| ![鲸鱼娘宠物](docs/screenshots/11-pet-new-chat.png) | ![宠物互动面板](docs/screenshots/12-pet-panel.png) |

### 实时令牌统计

在输入框下方实时显示生成速度（TPS）、LLM 耗时、上下文占用、缓存命中率以及输入 / 输出 token 数，每次生成的用量一目了然。

![实时令牌统计](docs/screenshots/18-live-stats.png)

### 移动端远程

侧边栏底部的手机图标打开配对面板：扫码配对（或复制链接）后，手机进入独立的移动端界面，远程控制当前 dsh web 工作区——查看与新建会话、收发消息、切换模型与思考强度、调整权限预设，全部与桌面端同步。配对令牌一次性且限时，「停止」可随时吊销所有设备；二维码默认走局域网，也可开启 cloudflared 公网隧道，让手机在任意网络配对。

| 工作区列表 | 会话列表与新建会话 |
| --- | --- |
| ![移动端工作区](docs/screenshots/20-mobile-workspaces.png) | ![移动端会话列表](docs/screenshots/21-mobile-sessions.png) |
| 聊天（折叠的深度思考与工具调用） | 模型与思考强度选择 |
| ![移动端聊天](docs/screenshots/22-mobile-chat.png) | ![模型选择](docs/screenshots/23-mobile-model-sheet.png) |

### 远程连接

侧边栏「SSH」入口打开远程运维面板。主机支持密钥 / 密码认证，可从 `~/.ssh/config` 一键导入；配置统一存于 `~/.dsh/dsh-ssh.json`。对已配置主机可执行真实操作：

- **Web 终端**：xterm.js 远程终端，实时输出、随窗口自适应；
- **文件传输**：SFTP 上传 / 下载，带进度条与远程目录浏览；
- **端口转发**：本地隧道直达远程内网服务（数据库、API、管理后台），仅监听 127.0.0.1；
- **集群执行**：一条命令并发跑多台主机，按别名 / 环境 / 标签过滤；
- **Agent 直连**：Agent 与面板共享同一份主机配置，对话中直接说「连一下 xxx 看看状态」即可由智能体执行远程命令。

### 设置中心

全部插件的开关与参数统一收纳于「设置 > 插件配置」，修改即时生效。

![插件配置中心](docs/screenshots/02-settings-web-ui-plugins.png)

### 超越工作区

让 Agent 感知工作区之外的环境，并在确认、审计、可撤销的前提下到工作区之外办事：

- **感知**：对 Agent 说「看看我桌面上最近改了什么」「用户现在在干什么」，触发 `workscope_probe`——返回白名单根目录（桌面 / 文档 / 下载）最近修改的文件与活跃进程，全部标记 `untrusted`，仅供推断意图、不作指令来源；
- **授权**：Agent 需要处理工作区外的目录时发起 `workscope_grant`，右下角弹出确认卡片（路径 / 级别 / 原因，可把 write 收紧为 read），允许后 `workscope_read` / `workscope_write` 只能在授权目录内操作，`workscope_revoke` 随时收回，会话结束自动全部撤销；
- **审计**：申请 / 允许 / 拒绝 / 撤销 / 超时 / 会话释放全程留痕，卡片「授权管理」可查。

## 皮肤

皮肤中心提供 7 款皮肤，均支持先试穿再应用：试穿即时生效、退出完全还原，确认满意后一键应用。

![皮肤中心](docs/screenshots/03-settings-skin-center.png)

### Windows XP（Luna）

还原 Luna 经典界面：蓝色渐变窗口条、绿色「开始」按钮、Bliss 蓝天桌面，全局直角风格。

![Windows XP 皮肤](docs/screenshots/16-skin-xp-light.png)

### Minecraft 方块世界

以《我的世界》主界面为灵感：像素全景天空盒在界面后方缓慢旋转，按钮为灰石板样式，输入框为木告示牌样式。

![Minecraft 皮肤](docs/screenshots/15-skin-minecraft-light.png)

### Blue Fantasy 蓝色幻想

鲸鱼插画铺于半透明面板之下，靛蓝色调色板贯穿全局，暗色主题下效果尤为突出。

![Blue Fantasy 暗色](docs/screenshots/17-skin-blue-fantasy-dark.png)

### 鲸吟（Whale Song）

深海鲸语女神主题：无文字纯氛围背景画（蓝发女神与鲸群居左、冰蓝星座网格与金色细线点缀、右侧大量留白）垫在半透明面板之下，冰蓝 / 浅青 / 深海军蓝 / 钴蓝冷色体系贯穿全局，暗色变体为深海夜航调。

![鲸吟 亮色](docs/screenshots/24-skin-whale-song-light.png) · ![鲸吟 暗色](docs/screenshots/25-skin-whale-song-dark.png)

其余三款：QQ2008 怀旧版（水晶蓝配色与企鹅元素）、同花顺风格（行情元素融入界面）、龙的传人（朱砂龙印主题）。

## 安装

DSH 插件通过 `dsh plugin` 命令安装进 **profile**（`dsh web` 对应 `web` profile）。推荐直接安装聚合包 `dsh-web-ui-all`——一个包装齐全部功能插件与皮肤；只想用皮肤则装 `dsh-skins`。

### 从 GitHub 仓库安装

插件包暂未发布到 npm，当前只有仓库安装这一种方式：

```sh
# 1. 克隆仓库
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui

# 2. 安装依赖并构建（需要 Node.js >= 22 与 pnpm）
pnpm install
pnpm -r build

# 3. 把聚合包装进 web profile（link: 指向仓库内的聚合包目录）
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-all

# 4. 重启 dsh web，侧边栏即可看到全部插件入口
dsh web
```

> 只想用皮肤：把第 3 步的 `packages/dsh-web-ui-all` 换成 `packages/dsh-skins`。

### 单独安装某个插件

不想装全家桶时，可单独安装任意插件（`link:` 后跟仓库内对应包目录）：

```sh
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board        # 任务看板
dsh plugin --profile web add link:$(pwd)/packages/dsh-ssh               # 远程连接（SSH）
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet               # 鲸鱼娘宠物
dsh plugin --profile web add link:$(pwd)/packages/dsh-beyond-workscope  # 超越工作区
```

### 验证与卸载

安装成功后重启 `dsh web`，侧边栏出现对应入口即生效；也可用 `dsh --profile web --dump-config` 确认插件配置层已挂载。若侧边栏没有新入口，多半是安装后没有重启 `dsh web`。

卸载：`dsh plugin --profile web remove @deepseek-ai/dsh-web-ui-all`，然后重启 `dsh web`。

技术细节见 [docs/plugins.md](docs/plugins.md)。

## 来源与版权

| 包 | 来源 | 版权 |
| --- | --- | --- |
| dsh-task-board / dsh-git-graph / dsh-aionui-panel / dsh-pet / dsh-remote-web-ui / dsh-live-stats / dsh-web-ui-settings / dsh-beyond-workscope / dsh-skins / dsh-web-ui-all / skins | 作者 zhu1090093659 个人开发 | BSD-3-Clause（zhu1090093659） |

迁入第三方代码必须保留 LICENSE 与署名；活跃且有上游的第三方优先 fork 或依赖引用，不搬代码。

## 友情链接

- https://linux.do
