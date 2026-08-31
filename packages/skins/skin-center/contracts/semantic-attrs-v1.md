# L2 语义属性枚举 v1 — data-dsh-surface / data-dsh-part / data-dsh-plugin

契约归属：本表由皮肤中心单方面拥有和维护（冲突仲裁纪律：不靠加载顺序）。
版本：`semantic-attrs/v1`（2026-08-18 初版，依据 rc.7 SDK 实地扫描，
调研快照见 `docs/archive/2026-08-18-semantic-attrs-survey.md`）。

## 纪律

- 每个枚举值必须有明确 **owner、版本、含义与锚定方式**，不能只堆字符串——
  防止语义层退化成另一套隐式 DOM API。
- 两个产出通道：**compat adapter**（皮肤中心的合并 MutationObserver，为官方
  DOM 与未 opt-in 插件补打属性；非永久公共契约，官方区域在上游主题缝落地后
  进入删除评估，第三方插件区域长期保留）与**组件主动输出**（仓内插件按
  packages/AGENTS.md 约定自行输出，更准更快）。
- 不输出语义属性的插件只享受 L1 token 基础覆盖，不承诺完整换肤覆盖。
- part 用**裸值**、归属交给 `data-dsh-plugin`（如 `column` 而非
  `task-board-column`）；选择器写法 `[data-dsh-plugin="ssh"] [data-dsh-part="terminal"]`。
- **不复用官方 `data-plugin`**：官方用它标注 style 标签的插件归属
  （dsh-client-modules / dsh-client-hmr），语义不同。
- body/html 级属性（`data-ds-dark-theme`、`data-dsh-skin`、各插件
  `*-active`）不属于本枚举三组，另行管理。

## surface 组（8 个）

| data-dsh-surface | owner | 含义 / 锚定方式 |
| --- | --- | --- |
| `root` | shell | 应用根出口；`[data-slot="root"]` |
| `sidebar` | shell | 左导航列；`[data-slot="sidebar"]`（列容器本体上游缝落地前经适配器） |
| `conversation` | shell | 中栏主区；`[data-slot="conversation"]` |
| `session-header` | shell | 会话头；`[data-slot="conversation.session.header"]` |
| `composer` | shell | 输入区；`[data-slot="conversation.composer"]` |
| `details` | shell | 右详情列；`[data-slot="details"]` |
| `settings` | shell | 设置模态；`[role="dialog"]` 内含 `[data-slot="settings.section"]` 组合判定 |
| `overlay` | shell | 帧级浮层；`[data-shell-overlay]` / `[data-slot="shell.overlay"]` |

### 背景自有标记（owner: skin-center）

皮肤中心「有背景艺术可见」期间的自有标记；均为 body/html 级属性（按上文纪律
另行管理），`data-dsh-wallpaper-surface` 打在元素上：

| 属性 | 位置 | 含义 / 锚定方式 |
| --- | --- | --- |
| `data-dsh-backdrop-active` | html + body（body/html 级，另行管理） | 皮肤背景媒体（`backgroundMedia`）或 WE 壁纸任一挂载期间置 `true`（`backdrop-scene.ts` 汇总双侧来源），卸载 / 禁用清净；供 composer seat 遮罩统一中和与输入区前置磨砂面板规则锚定，皮肤与壁纸场景行为一致（#777） |
| `data-dsh-conversation-content` | html + body（body/html 级，另行管理） | 当前对话存在消息行（`[data-chat-anchor-key]`）期间置 `true`；`backdrop-scene.ts` 在背景可见时随 MutationObserver 更新。输入卡磨砂仅在 backdrop-active 且本标记置位时启用，空对话不显示多余模糊（#777 follow-up） |
| `data-dsh-wallpaper-active` | html + body（body/html 级，另行管理） | WE 壁纸挂载期间置 `true`，卸载 / 禁用清除；供皮肤 CSS 与壁纸中和规则锚定（#734） |
| `data-dsh-wallpaper-surface` | 官方 shell 全视口背景元素 + 侧栏工作区淡化条（元素级） | `WallpaperController.markWallpaperSurfaces()` 在 WE 壁纸挂载期间打标（全视口 bg-base 背景 + `data-slot="sidebar.workspaces"` 内渐变淡化条），命中 `html[data-dsh-wallpaper-active] [data-dsh-wallpaper-surface]` 中和；卸载清除，不含哈希类依赖（#734） |

## part 组（49 行，含各 owner 行）

shell 区域（owner: shell）：

| data-dsh-part | 含义 / 锚定方式 |
| --- | --- |
| `message-row` | 聊天流条目；`[data-chat-flow-kind]` |
| `message-body` | 助手消息正文；`[data-streaming]` 根 |
| `scrollport` | 会话滚动口；`[data-conversation-scroll]` |
| `composer-input` | 输入 textarea；`textarea[data-phase]` |
| `composer-chip` | 输入引用 chip；`[data-decoration="chip"]` |
| `queue-dock` | 排队条；`[data-queue-dock]` |
| `turn-tail` | turn 尾行；`[data-turn-tail]` |
| `resize-handle` | 列宽手柄；`[data-side]` |
| `new-session` | 侧栏新会话按钮；官方稳定属性落地前由兼容适配器从 `button[class*="newSession"]` 补打，皮肤不得依赖本地化文案 |

family / 插件区域：

| data-dsh-part | owner | 含义 / 锚定方式 |
| --- | --- | --- |
| `sidebar-entry` | family | 插件注入的侧栏入口行；`[data-dsh-*-entry]` |
| `header` | task-board | 看板头；`[data-dsh-taskboard-board] > header` |
| `column` | task-board | 状态列；`section[data-status]` |
| `card` | task-board | 任务卡；列内 `[data-status]` 条目 |
| `detail` | task-board | 任务详情面板 |
| `tab-bar` / `tab` | ssh | 页签条/页签；`[role="tablist"]` / `[role="tab"]` |
| `host-table` / `host-row` | ssh | 主机表/行；`[data-dsh-ssh-view]` 内 table/tr |
| `terminal` | ssh | xterm 终端；面板内 termContainer（.xterm 辅锚） |
| `banner` | ssh | 状态横幅；`[data-kind]` 横幅 |
| `chip` | git-graph | 分支 chip；`[data-gitgraph-chip-anchor]` |
| `dialog` | git-graph | 图对话框；`[data-gitgraph-dialog]` |
| `graph-row` | git-graph | 提交行；dialog 内行容器 |
| `ref` | git-graph | 分支徽标；`[data-gitgraph-ref]` |
| `worktree-create` / `worktree-manage` | git-graph | worktree 创建/管理入口按钮；分支弹层 footer 内裸值按钮 |
| `sprite` | pet | 精灵；`[data-dsh-pet-root]` 子树 float 容器 |
| `bubble` | pet | 气泡容器 |
| `announcement` | pet | 插件公告气泡（dsh-usage 联动）；`[data-dsh-pet-announcement]`，值来源插件标签 |
| `panel` | pet | 交互面板；`[data-placement]` |
| `summon-button` | pet | 召唤钮；`[data-testid="pet-summon"]` |
| `plugin-item` | web-ui-settings | 家族插件设置卡；`[data-slot="web-ui.plugin.item"]` 内 entry |
| `head` | skill-explorer | 技能中心模态卡头部；`[data-dsh-plugin="skill-explorer"] [data-dsh-part="card"] > header` |
| `card` | skill-explorer | 技能中心模态卡；`[data-dsh-plugin="skill-explorer"] [data-dsh-part="card"]` |
| `tab-bar` / `tab` | skill-explorer | 技能中心页签条/页签；`[data-dsh-plugin="skill-explorer"] [data-dsh-part="tab-bar"]` / `[data-dsh-plugin="skill-explorer"] [data-dsh-part="tab"]` |
| `skill-row` | skill-explorer | 技能卡行；`[data-dsh-plugin="skill-explorer"] [data-dsh-part="skill-row"]` |
| `header` | doctor | 救助控制台头部；`[data-dsh-plugin="doctor"] [data-dsh-part="header"]` |
| `enable` | doctor | 救助模式启用行 |
| `status` | doctor | 系统状态卡 |
| `profiles` | doctor | 受保护 profile 列表 |
| `incidents` | doctor | 故障事件列表 |
| `probe` | doctor | 客户端故障探针列表 |
| `plugin-row-actions` | doctor | 失败插件行「复制错误 / 禁用并重启」动作组 |
| `actions` | doctor | 诊断/修复动作组 |
| `boundary` | doctor | 错误边界回退提示；`role="alert"` |
| `harness-target` | doctor | “发送给 Harness” 对话框内的目标会话行 |
| `entry` | session-id | 侧栏 footer 触发器；`button[data-dsh-part="entry"]`（`[data-dsh-plugin="session-id"]` 容器内） |
| `panel` | session-id | 会话 ID 模态面板；`[role="dialog"]` 根（`[data-dsh-part="panel"]`） |
| `row` | session-id | 会话列表行；面板内行容器（`[data-dsh-part="row"]`） |
| `copy` | session-id | 每行复制按钮；`button[data-dsh-part="copy"]` |
| `search` | session-id | 面板搜索输入框；`input[type="search"][data-dsh-part="search"]` |
| `sprite` | miku-pet | 宠物帧舞台；`[data-dsh-plugin="miku-pet"] [data-dsh-part="sprite"]` |
| `menu` | miku-pet | 悬停菜单（两级）；`[data-dsh-part="menu"]` |
| `stats` | miku-pet | 左侧属性彩条；`[data-dsh-part="stats"]` |
| `shop` | miku-pet | 商店居中窗口；`[data-dsh-part="shop"]` |
| `bubble` | miku-pet | 对话气泡；`[data-dsh-part="bubble"]` |
| `float` | miku-pet | 互动飘字；`[data-dsh-part="float"]` |
| `header` | usage | 使用统计分区头部（当前提供方 + 刷新钮）；`[data-dsh-plugin="usage"] [data-dsh-part="header"]` |
| `tabs` / `tab` | usage | 用量/个人套餐页签；`[role="tablist"]` / `[role="tab"]` |
| `today-card` | usage | 今日用量统计卡；`[data-dsh-part="today-card"]` |
| `provider-list` / `provider-row` | usage | 今日分 provider 用量列表 / 余额行；卡片内行容器 |
| `balance-card` | usage | 各 provider 余额卡；`[data-dsh-part="balance-card"]` |
| `trend-card` / `usage-chart` | usage | 近 30 天卡 / 其中的提供方-模型条形图；`[data-dsh-part="trend-card"]` 内 `[data-dsh-part="usage-chart"]` |
| `settings-row` | usage | 插件设置行；`[data-dsh-part="settings-row"]` |
| `plan-card` / `plan-window` | usage | 套餐卡 / 套餐窗口行（个人套餐页签）；`[data-dsh-part="plan-card"]` 内窗口行 |

## plugin 组（14 个，含停更 aionui-panel）

| data-dsh-plugin | owner | 锚定方式 |
| --- | --- | --- |
| `task-board` | dsh-task-board | `[data-dsh-taskboard-view]` / `[data-dsh-taskboard-entry]` / slot entry id |
| `ssh` | dsh-ssh | `[data-dsh-ssh-view]` / `[data-dsh-ssh-entry]` |
| `git-graph` | dsh-git-graph | slot entry id `git-graph`；`[data-gitgraph-chip-anchor]` / `[data-gitgraph-dialog]` |
| `pet` | dsh-pet | `[data-dsh-pet-root]`；一级设置分区 settings.section id `pet`（只列内置与已安装宠物） |
| `remote-web-ui` | dsh-remote-web-ui | slot entry id `remote-web-ui` |
| `web-ui-settings` | dsh-web-settings | settings.section id `web-ui-plugins` |
| `skill-explorer` | dsh-skill-explorer | `[data-dsh-skill-explorer-view]` / `[data-dsh-skill-explorer-entry]` |
| `doctor` | dsh-doctor | web-ui.plugin.item 槽 entry id `doctor`（设置 → Web 插件 → Doctor 卡片）；卡片内 `[data-dsh-plugin="doctor"]` |
| `aionui-panel` | dsh-aionui-panel（停更） | dock entry id `aionui-*` |
| `dsh-web-ui-market` | dsh-market | 创意工坊商店一级页（settings.section id `dsh-web-ui-market`），商店卡与目录条目容器 |
| `skin-center` | skins/skin-center | 一级设置分区 settings.section id `skin-center`（列已安装皮肤，属内置源时显式标记） |
| `session-id` | dsh-session-id | footer action slot entry id `session-id`；`[data-dsh-plugin="session-id"]`（面板 overlay 根 + 入口触发器） |
| `miku-pet` | dsh-miku-pet | 宠物浮层根 `[data-dsh-plugin="miku-pet"]`；host 路由前缀 `/miku-pet/*`；设置页 settings.section id `miku-pet-config` |
| `usage` | dsh-usage | 一级设置分区 settings.section id `dsh-usage`（创意工坊下方）；`[data-dsh-plugin="usage"]` |

## 已知脆弱点（上游主题缝 PR 诉求）

1. AppFrame 三列容器本体只有 hash 类，列级钩子缺失 → 诉求：三列自带稳定 data 钩子。
2. 侧栏导航行无官方 slot，插件靠 DOM 注入 → 诉求：sidebar 导航 list slot。
3. 设置模态只有 `role="dialog"`（与其他对话框撞车）→ 诉求：设置 dialog 根专属标识。
4. list slot 的单 entry 无 DOM 归属标识 → 诉求：slot entry 渲染透传 entry id 到 DOM。
