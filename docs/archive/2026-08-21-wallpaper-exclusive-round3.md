# wallpaper-exclusive 开发文档 Round 3（2026-08-21）

承接 Round 1/2（见 `2026-08-20-...md` / `2026-08-21-...round2.md`）。本文件记录渲染优化批（已入 #807
commit 0b774b8f）之后的用户验收反馈与下一轮分工。一次性交接记录。

## 1. 用户验收反馈（渲染优化批之后）

### A. 技能中心、ssh 看板未渲染（玻璃未生效）
- 技能中心面板/技能行、ssh 看板（tab/主机行/面板 chrome）没有出现玻璃。
- **初步诊断**：
  - profile 已部署的 `dsh-client-ui-skill-explorer/lib/client.js` **不含 `skill-row`**；`data-dsh-part`
    /`data-dsh-plugin` 存在但缺 part 值 → 我 patches.css 里 `[data-dsh-part="skill-row"]`、`["card"]` 可能
    与实际输出不一致（部署包旧，或组件未输出这些 part）。
  - profile 已部署 `dsh-ssh/lib/client.js` 只有 `data-dsh-part="terminal"`，**无 `host-row`**
    → `[data-dsh-plugin="ssh"] [data-dsh-part="host-row"]` 必然落空；tab 是否输出 `data-dsh-part="tab"`
    需核实。
  - 需：读两端（repo src + profile 部署 bundle）列**真实锚点**，按实修规则并确保部署包同步。

### B. 底部面板：终端不方便渲染就跳过；先修「展开底部面板壁纸消失」
- 底部面板展开后主对话框壁纸消失、收起自动复原（Round 2 已记录；本批玻璃化面板 chrome 后仍待确认）。
- 终端画布（`.xterm-viewport`/`_terminalWrap`）渲染麻烦，**放弃玻璃化**，保持可读即可；
- 优先修复展开面板导致壁纸消失：究竟是不透明覆盖层、z-index 遮挡还是 shell 新增全视口表面漏标，
  需定位那个「盖住壁纸的元素」。

### C. 侧边卡片属于 dsh-better-sidebar，目前未渲染
- 我 Round 2 用 `[data-slot="sidebar"] [class*="_sessionRow/_workspaceRow/_projectRow"]` 目标的是 shell
  workspaces 行；但用户指出侧边卡片由 **dsh-better-sidebar** 渲染（外部/聚合插件）。
- profile 有 `@linxin666/dsh-better-sidebar` 与顶层 `dsh-better-sidebar` 完整 bundle → 可读其 client
  bundle 取真实类/稳定后缀/语义属性 → 在 patches.css 加正确规则。

### D. 侧栏「新会话」已渲染，但「任务看板 / ssh」两键仍有色差
- 新会话已玻璃+primary；任务看板/ssh 入口静止态是透明底 + 白字 → 与「新会话」的填充玻璃按钮观感不同。
- 修法方向：给 task-board/ssh（以及 skill-explorer）入口**同等的玻璃填充 + blur**（进滑杆集合），三键观感
  一致；或明确「色差」是指文字/图标颜色，需 webbridge 实测三者计算样式再定。

### E. 侧栏各工作区入口按键「又出现自动显示选中气泡」bug
- Round 1 曾用 `[data-slot="sidebar"] button { background: transparent !important }` 修掉插件入口「自带
  选中效果」；Round 2 审查 P1-1 时把它**收窄到插件 entry 族** → 工作区入口（非 entry 族）失去了透明覆盖，
  自动选中气泡回归。
- 修法方向：把透明静止态恢复给「除新会话外的所有侧栏按钮」，同时给 新会话/插件三键 玻璃填充：
  `[data-slot="sidebar"] button:not([class*="newSession"]) { background: transparent !important }` +
  新会话 glass + 插件三键 glass。需确认不把 shell 原生 nav 按钮的 hover/aria 选中态打坏。

## 2. 初步结论（主 agent 已测）

### 2.A 实机复核（webbridge，skin=wallpaper-exclusive 生效中）
- 新会话 `button[class*="newSession"]`：bg `rgba(13,22,39,.22)` + blur7 + 白字 → 已玻璃。
- taskboard/ssh 入口：blur7 有、bg **透明**、白字 → 与「新会话」填充玻璃观感不同（D 的色差根因）；
  技能中心入口连 blur 都是 none。
- 侧栏 session/project 行（`_sessionRow`/`_workspaceRow`/`_projectRow`）：静止态已带 `rgba(255,255,255,.06)`
  ——疑似我 Round 2 给行加的 0.06 填充造成「自动选中气泡」（静止态不该有填充；hover/aria 才显示）。
- 结论：D=给三键（taskboard/ssh/skill 入口）补**同款玻璃填充**；E=侧栏行/工作区入口**静止态去填充**、
  只留 hover/选中微着色（与 新会话区分开）。待子代理 C 确认哪些是 better-sidebar 卡片、哪些是工作区入口按钮。

### 2.A.1 子代理 A 结论（技能中心 + ssh 真实锚点；A 中途崩，主 agent 已固化）
- **技能中心未渲染根因 = 部署包旧**：profile 的 `dsh-client-ui-skill-explorer/lib/client.js` 是 #805 之前的构建，
  缺 `data-dsh-plugin="skill-explorer"`（容器）/`data-dsh-part="card/skill-row/head/tab-bar/tab"`；repo src 本来就有。
  → patches.css 全部 skill 规则落空；**重建 + 同步部署包**即修复（无需改 CSS）。
- **ssh 看板**：部署 bundle 只输出 `data-dsh-part="tab-bar"` + `terminal`，**没有** `host-table/host-row/tab/banner`
  part；`.panel`（`mL8Uca_panel`）是不透明 `--dsw-alias-bg-base` 盖住容器玻璃 → 需在 `[data-dsh-ssh-view]` 下用
  稳定类后缀兜底：`[class*="_panel"]`、表格 `tbody tr`、`[class*="_banner"]`、tab（role=tab/data-active）；终端画布跳过。
- 补验（编译后 CSS）：skill `.cBrkua_card` bg=`--dsw-alias-bg-overlay`（不透明）、`.cBrkua_skill` bg=`--dsw-alias-bg-base`
  （不透明）；ssh `.mL8Uca_tabBar` 存在且透明（已有 part 规则命中）。

### 2.B 初步结论要点
- 技能中心/ssh：patches.css 现有 part 选择器与实际部署输出**不匹配**（skill-row 缺、host-row 缺）。
- 底部面板：待定位覆盖元素（见 B，子代理 B）。
- 侧边卡片：目标是 better-sidebar，锚点要换。
- 三键色差：新会话有填充玻璃、插件两键透明 → 补同款玻璃填充。
- 工作区入口选中气泡：透明规则被收窄导致回归 → 恢复非 newSession 按钮透明。

## 3. 子代理任务分工（只读，并行）
1. **子代理 A（技能中心 + ssh 真实锚点）**：读 `packages/dsh-skill-explorer` 与 `packages/dsh-ssh`
   的 src/client（含 *.module.css 与 *.tsx）+ profile 已部署 `lib/client.js`，列出面板实际输出的
   `data-dsh-plugin/data-dsh-part`/稳定类后缀，指出现有 patches.css 规则命中/落空，给出正确选择器。
2. **子代理 B（底部面板壁纸消失）**：读 dsh-ssh（terminal/底部面板 mount）与 repo/src 中与「底部面板/
   bottomPanel」相关的组件，定位展开时盖住壁纸的元素（不透明 bg / z-index / 新增全视口表面），给出最小
   修复指向（CSS 规则或挂载点）；确认终端画布放弃玻璃化的取舍。
3. **子代理 C（dsh-better-sidebar 侧边卡片 + 工作区入口选中气泡）**：读
   `~/.dsh/profiles/web/node_modules/(dsh-better-sidebar | @linxin666/dsh-better-sidebar)` 的 client
   bundle + 仓库聚合配置，列出侧边卡片的真实类/稳定后缀/语义属性；并分析各工作区入口「自动选中气泡」
   的样式来源（对应 `data-active`/默认 bg），供修复透明静止态用。

## 4. 主 agent 落地顺序（拿结果后）
1. **底部面板壁纸消失**（B 优先）：按定位补 CSS/修复。
2. **技能中心 + ssh 玻璃**：按真实锚点改 patches.css；重建并同步 profile（skill-explorer/ssh bundle）。
3. **better-sidebar 侧边卡片**：按真实锚点加玻璃（进滑杆）。
4. **三键一致**：task-board/ssh/skill-explorer 入口补同款玻璃填充 + 颜色统一（与 新会话 一致）。
5. **工作区入口选中气泡**：恢复「非 newSession 侧栏按钮透明静止」，保留 hover/aria 微着色。
6. 门禁（typecheck/gallery/skin-center/docs）+ 子代理实时审查 + 重新部署 + 交用户验收。

### 4.x 当前落地状态（本地，未推；待 B'/C' 回执后补底部面板与 better-sidebar）
- [x] 技能中心：`dsh-skill-explorer` 重建（含 card/head/skill-row/tab/tab-bar parts）并部署 profile → 现有 skill 玻璃规则可命中。
- [x] D 三键一致：taskboard/ssh/skill 入口补 `--dsw-wallpaper-glass-fill` + blur（与 新会话 同款）。
- [x] E 工作区入口/侧栏行：静止态 `transparent`（去 0.06 常驻填充=去除自动选中气泡），hover 0.06 / 选中(_selected/aria) 0.1。
- [x] ssh 兜底：`[data-dsh-ssh-view] [class*="_panel"]`/`[role=tab]`/`table tbody tr`/`[class*="_banner"]` 玻璃（部署只输出 tab-bar/terminal part）；终端画布跳过。
- [x] 底部面板壁纸消失（B' 定位，已修）：根因=展开面板时 dsh-better-sidebar 用
  `margin-bottom: var(--dsh-sidebar-height)` 把中列 `[data-dsh-frame] > [data-pane="conversation"]`
  顶短 → 跌破全视口阈值 → surface 几何检测不再打标 → 中列恢复不透明 `--dsw-alias-bg-base`。
  修复=壁纸挂载期中列恒定透明：
  `body[data-dsh-wallpaper-active] [data-dsh-frame] > [data-pane="conversation"] { background: transparent !important }`
  （注意不打 `html[...]` 前缀——管道会再包 `html[data-dsh-skin] ` 造成 html-in-html 不匹配）。
  通用根因修法（让所有壁纸皮肤受益）：把同规则加进 wallpaper.ts rootNeutralizer —— 列为后续可选项。
- [x] better-sidebar 侧边卡片（C' 定位，已加）：侧边卡片 = better-sidebar 右栏 `.paneCard`
  空面板欢迎卡（+ 面板 chrome `.tabBar/.panel/.bottomPanel`）；宿主是 body portal
  `[data-dsh-better-sidebar]`/`[data-dsh-panel-host]`（**不在 #root 内、无 data-dsh-part**）→
  用宿主属性 + 类后缀玻璃化：`[data-dsh-better-sidebar] [class*="_paneCard/_tabBar/_panel/_bottomPanel"]`，
  卡片 hover 0.14；终端画布沿用 0.62 深底取舍。
- [x] 工作区入口「自动选中气泡」（C' 定位，已修）：双层来源——Round2 给 shell 行加的 0.06 常驻填充
  （本批已去，改静止透明+hover/aria 着色）+ Round2 把侧栏按钮透明收窄到 entry 族导致非 entry 工作区
  入口露出自带填充。修复：
  `[data-slot="sidebar"] button:not([class*="newSession"]):not([data-dsh-part])` 静止透明 +
  hover 0.06 + aria/active 0.1（`:not([data-dsh-part])` 保住插件三键玻璃，`:not(newSession)` 保 新会话 填玻璃）。
- 本批 CSS 已过 builtin-skins transform + gallery:check(17) + skin-center:check；profile 已部署（patches.css 17485）。
  等待 dsh web 重启后做实机验收；验收通过再推 #807。
- 注：`table tbody tr` 元素选择器已过 builtin-skins transform（白名单允许）；profile 已同步 patches.css（14651）。

## 5. 验收清单（下一轮）
- 技能中心面板/技能行玻璃；ssh 看板 tab/主机行/面板 chrome 玻璃（终端画布保持可读，不强求玻璃）。
- 底部面板展开时壁纸仍可见（无消失），收起后不变；终端画布文字可读。
- better-sidebar 侧边卡片玻璃（进滑杆）。
- 侧栏「新会话/任务看板/ssh」三键观感一致（同玻璃+同色）。
- 侧栏工作区入口静止态无自动选中气泡；hover/选中态保留。

## 6.（已废弃，见 §7）原 4.x 中「三键玻璃 / skill 入滑杆 / better-sidebar 已修 / 底部面板已修」等结论

## 7. 用户方向修正（rework）— 2026-08-21 后段
> 全局默认模型已切 `llm-deepseek / deepseek-v4-flash`（settings.yaml，已备份）。**不急着推 PR**，本地验证通过才推。

### 7.1 方向修正（覆盖 4.x 对应项）
1. **侧栏按键不进滑杆集合**：左侧栏按键（新会话/任务看板/ssh/技能中心）**全透明静止 + 保留鼠标 hover**，
   不做玻璃填充（覆盖 4.x 的「三键同款玻璃」与 newSession 玻璃）。颜色统一照旧。
2. **侧边栏背景透明度并入滑杆**：`[data-slot="sidebar"]` 容器背景用 `--dsw-wallpaper-glass-fill/blur`
   （新增要求）。
3. **技能中心看板不进滑杆**：skill-center 面板/技能行**默认静态半透明**即可（不接 `--dsw-wallpaper-glass-*`，
   覆盖 4.x 的 skill 玻璃规则）。
4. **顶栏子代理展开按键本身全透明**：`button[class*="_trigger"]` 不玻璃；**仅展开部分**（`_menu`/`_subagent*`
   面板体）进滑杆（已实现，复核）。
5. **底部面板 bug 未变**（分开处理，任务 X）：4.x 的
   `body[data-dsh-wallpaper-active] [data-dsh-frame] > [data-pane="conversation"]` 在 0.2.6 上未生效或结构不同。
6. **右侧边卡片 bug 未变**（分开处理，任务 Y）：better-sidebar 右栏卡片/面板玻璃未生效，0.2.6 锚点待复核。
7. **排队命令模块渲染不到位**（分开处理，任务 Z）：当前是实色条非玻璃，`[data-queue-dock]` 未命中其真实 DOM。

### 7.2 子代理任务规划（0.2.6 复核，只读）
- **任务 X（底部面板 0.2.6）**：读 profile 0.2.6 `node_modules/dsh-better-sidebar` bundle，确认
  `_bottomPanel/_pane/tabBar/tab` 类名、`--dsh-sidebar-height` margin-push CSS、中列
  `[data-pane=conversation]` 锚在 0.2.6 是否仍成立；解释为何 conversation 透明规则没生效，给正确选择器。
- **任务 Y（右侧边卡片 0.2.6）**：读 0.2.6 better-sidebar bundle，确认 `.paneCard/.panel/.tabBar` 类后缀
  与宿主属性是否变化；为何现有玻璃规则没命中；给正确选择器。
- **任务 Z（排队命令模块 0.2.6）**：找「排队命令/排队发送」模块的真实 DOM 锚（如
  `conversation.input.dock` 槽位 / `[data-queue-dock]` / `queue-dock` part / 其它类后缀），确认
  `[data-queue-dock]` 为何落空，给正确玻璃选择器。

### 7.3 主 agent 落地顺序（本地，不推 PR）
1. [x] 反向修正 ①②③④（keys 全透明+hover、侧栏 bg 入滑杆 `[data-slot="sidebar"]`、skill 静态半透明 rgba、
   trigger 透明）→ patches.css 已改；待 builtin 校验 + 重建/部署。
2. [x] ⑤ 底部面板（X 定位，已修）：0.2.6 面板结构/锚未变；我原
   `body[wallpaper-active] [data-dsh-frame] > [data-pane=conversation]` 失败原因 = `>` 指定非直接子代太脆 +
   背景画在 CSS-module `[class*=centerCol]` 上。修正双路径、去 `>`：
   `body[data-dsh-wallpaper-active] [data-dsh-frame] [data-pane="conversation"], body[data-dsh-wallpaper-active] [class*="centerCol"] { background: transparent !important }`。
   通用修法（让所有皮肤受益）= 加进 wallpaper.ts rootNeutralizer —— 列后续项。
   [x] ⑥ 右侧边卡片（Y 定位，已加）：better-sidebar 面板用 `background` 简写；改为
   `background: var(--dsw-wallpaper-glass-fill) !important`（简写，替代 color-only）+ `:not()` 排除
   `_panelHidden/_panelBody/_panelResize`、`_bottomPanelHidden`，避免过度匹配。
   [x] ⑦ 排队命令模块（Z 定位，已加）：= dsh-chat-recovery `RetryDockView`（挂
   `conversation.input.dock` 槽），**未输出** `data-queue-dock`（契约锚未落地）→ 改用
   `[data-slot="conversation.input.dock"]`（含 `[class*="_dock/_row"]` 后代）玻璃化，不误伤、不改包。
3. [ ] 全部门禁 + 重启 dsh web 后实机验收；通过前不推 #807。

### 7.4 新验收项
- 侧栏按键静止透明、颜色统一、hover 生效；侧边栏背景随滑杆。
- 技能中心看板默认半透明（不进滑杆）；ssh 看板 chrome 玻璃（终端暗色可读）。
- 顶栏子代理触发钮透明，展开板体玻璃随滑杆。
- 底部面板展开壁纸透出；右侧边卡片半透明/玻璃可见；排队命令模块玻璃渲染到位。
- 工作区入口无自动选中气泡；hover/选中态保留。

### 7.5 后段再修正（2026-08-21 再反馈）
1. **侧栏 工作区按键 不要滑杆**：之前误把侧栏行 `_sessionRow/_workspaceRow/_projectRow` 的 backdrop-filter
   接进滑杆 → 已去掉；只保留 `[data-slot="sidebar"]` **背景**随滑杆。
2. **task-board/ssh 按键渲染不对、skill 对**（返图：task-board 深蓝块 / ssh 灰紫块+圆角 / skill 透明）：
   前两者被 shell 自身 nav 项 hover/active 填充（蓝/紫 token）漏出 → 新增
   `[data-slot="sidebar"] [class*="entry"]` 统一三键：静止透明 + hover 0.06 + 选中/aria 0.1
   （覆盖 `data-dsh-part` 在 0.2.6 缺失的情况）。
3. **侧边卡片（⑥）+ 底栏（⑤）bug 暂时不修**（用户明确冻结此轮；代码保留但不再推进）。
4. **PR #807 已被 zhu1090093659 于 2026-08-21T05:03Z 关闭（未合并、无说明 comment）** → 推 PR 暂停；
   主 agent 仅本地维护，等用户决定重开与否（可能因 scope 混杂/方向修正后再重开）。
5. **输入卡相关展开面板入滑杆（user 补充）**：`+`/`/` 命令面板、访问权限选择、模型选择、上下文面板、
   技能中心看板 全部并入滑杆集合。实机（0.2.6）确认前四类都是 `role=menu/listbox/dialog`
   （访问 `role=menu`、模型 `_7KE1Ra_menu role=menu`、上下文 `JObwrW_panel role=dialog`、命令
   `role=listbox`）→ 已被通用 `[role=dialog/menu/listbox]` 组覆盖随滑杆（bg=glass-fill 0.22 实证）；
   **技能中心看板改回滑杆**（card/skill-row → `--dsw-wallpaper-glass-blur/fill`，覆盖此前"默认静态半透明"）。
   head/tab 透明、激活 tab 0.14。ssh/任务看板按键改用 `:not([data-dsh-part="sidebar-entry"])` 排除插件面板组，
   保持全透明（与技能中心一致）。
   - 追加：**通用浮层组 fill 提为可读档** `rgba(13,22,39,0.62)`（Summer float tier）。用户反馈菜单/弹窗
     0.22 太透 → 后面壁纸/图标透进文字区成"重叠"、且显不出滑杆差别；blur 仍走 `--dsw-wallpaper-glass-blur`
     （随滑杆）。影响面：`[role=dialog/menu/listbox]` + `[data-radix-popper-content-wrapper]` + composer
     作用域同组 + 命令 `role=listbox`（覆盖 访问权限/模型/上下文/+/ 面板）。技能中心看板保持滑杆。
6. **渲染参考 Summer Liquid Glass（user 指引）**：Summer 做法 = 在 `:root` 重映射表面 token
   （`--dsw-alias-bg-layer-*/overlay`、侧栏 nav-item、button 等）为玻璃档，靠 shell 自身消费 token 得到统一
   半透明，而非逐元素 patches；「切对话壁纸模糊消失」= 共享运行期中和器（rootNeutralizer 清 composer-seat
   `::before` backdrop），wallpaper-exclusive 同套。已按此改 skin.css：侧栏 nav-item hover/active 统一为
   白色透明档（修 task-board 蓝 / ssh 灰紫差异）+ layer/overlay 透明档（侧栏/底板统一）。

## 8. dsh-0.1.1-rc.1 更新准备（2026-08-21；用户手动拉取）
- **更新前现状**：分支 `feat/skin-wallpaper-exclusive`（本地未推，PR #807 关闭中）；未提交文件 =
  `skins/wallpaper-exclusive/{patches.css,skin.css,README.md,README.zh.md}`、`gallery/styles.js`、
  `docs/archive/round2/round3`（agent.md 不入库）。门禁全绿；profile 已部署（skin-center lib 142696 +
  皮肤目录 + skill-explorer 40191），**待 host 重启后才加载 runtime**。
- **版本敏感锚点（0.1.1-rc.1 后逐个复查）**：
  1. 侧栏：`[data-slot="sidebar"]` 容器 + `button[class*="newSession"]` + `[class*="_sessionRow/_workspaceRow/_projectRow"]` +
     插件入口 `data-dsh-part="sidebar-entry"`/`[data-dsh-*-entry]`/`[class*="entry"]`；
  2. 输入卡展开面板：`[role=dialog/menu/listbox]`、`[data-radix-popper-content-wrapper]`、`_trigger`/`_menu`/`_panel`
     后缀、排队条 `[data-slot="conversation.input.dock"]`；
  3. 顶栏子代理板：`[data-slot="conversation.session.header.actions"] button[class*="_trigger"]` + `_menu/_subagent*`；
  4. 底部面板/中列：`[class*="_bottomPanel/_pane/_tabBar/_tab/_terminalWrap"]`、
     `body[data-dsh-wallpaper-active] [data-dsh-frame] [data-pane="conversation"]`/`[class*="centerCol"]`；
  5. better-sidebar：`[data-dsh-better-sidebar]`/`[data-dsh-panel-host]` + `[class*="_paneCard/_panel/_tabBar"]`；
  6. 技能中心：`[data-dsh-plugin="skill-explorer"] [data-dsh-part="card/skill-row/..."]`。
- **更新后动作（用户拉取后我执行）**：① 重建 skin-center+skill-explorer 并重部署 profile（升级会清 node_modules）；
  ② 重启 dsh web；③ 按上面锚点抽查（弹窗磨砂随卡片滑杆、底板壁纸不消失、三键全透明、子代理板等）；④ 门禁重跑。

## 9. web-ui dev 同步 + 上游壁纸修复（2026-08-21 后段）
- 本地 `dev` 已快进到 origin/dev `9270d01a`。用户已更新 dsh-0.1.1-rc.1。
- **上游已含壁纸修复**：
  - `fd3f08de #712`：放宽表面检测——高度 ≥90% 视口 + 任意不透明背景（不再精确等于 bg-base token），并排除
    dialog/aria-modal/`data-dsh-plugin`/z>100 浮层（= #734 反馈建议的落地方案）；
  - `635565e6/6eeb871d #838`：关闭被中断的壁纸流；`148e5ed5 #808`：退役未配对 fence 页；`a3e4025c #826`：shiki 代码块背景重绑；
  - `c0087354`：贡献规范新增「拒绝低质琐碎皮肤 PR」；`08e68dea`：新 issue 自动分配给 Aa728848。
- **仍在我们本地（上游 dev 没有）**：滑杆（backgroundBlurCard / --dsw-wallpaper-glass-*）、壁纸重连回拼、
  surfaceObserver 导航重打标、领先沿去抖（`git grep origin/dev` 均 False）。
- **衔接影响**：`feat/skin-wallpaper-exclusive` 落后 dev 26 / 领先 7 → 需 rebase 到新 dev；wallpaper.ts 中我们旧的
  `defaultWallpaperSurfaceWithBase`+resolveCssColor 记忆化与上游 #712 重写冲突 → rebase 时**采用上游 #712 检测器、
  丢弃我们的 WithBase 记忆化**（上游已改颜色无关、无需逐元素 resolve），**保留** surfaceObserver/重连/领先沿。
  `body[wallpaper-active] [data-pane=conversation] transparent` 仍需保留（#712 高度阈值 90%，底板挤压下的中列 <90% 仍失标）。
- 按用户：先不同步本地优化，rebase/收敛待指示。

## 10. web-ui 0.2.7 适配（2026-08-21 后段；用户已更新 web-ui 至 0.2.7）
- **上游 0.2.7 替换了滑杆机制**：`backgroundBlurCard` / `--dsw-wallpaper-glass-blur` 已由
  `inputCardBlur` / `--dsh-input-card-blur` 取代（值写成 `Npx`，消费方必须包
  `blur(var(--dsh-input-card-blur, 10px))`）。决定**采用上游变量**，丢弃本地旧滑杆 runtime，
  皮肤与 patches 全部改吃 `--dsh-input-card-blur`。
- **rebase 结果**：`feat/skin-wallpaper-exclusive` 已 rebase 到 origin/dev `f26f947e`；
  丢弃旧滑杆 runtime 提交（backgroundBlurCard/SkinCenter/WallpaperPanel 旧块），**保留**：
  壁纸重连回拼、surfaceObserver 导航重打标、领先沿去抖、skill-explorer 语义属性、
  wallpaper-exclusive 皮肤 patches/skin.css。
- **代码清理**：WallpaperPanel 移除旧 `cardBlur` 滑杆与 `background` prop（0.2.7 的
  `inputCardBlur` 滑杆已在 SkinCenter 卡片内）；patches.css 44 处
  `--dsw-wallpaper-glass-blur` → `blur(var(--dsh-input-card-blur, 10px))`，剩余 1 处注释同步；
  skin.css 定义改为 `--dsh-input-card-blur: 10px`。
- **门禁**：typecheck 全绿；skin-center 测试 342 过 / 2 个已知本地环境 flake
  （pkg-extract symlink EPERM、we-routes #817 30s 超时）；gallery:check(17)、skin-center:check、
  docs:check 全绿。
- **部署**：已同步 profile 0.2.7（skin-center lib + skins 目录 + skill-explorer lib），
  profile 内 patches.css 旧变量计数 0、skin.css 仅 `--dsh-input-card-blur`。
- **待办**：host 重启后由用户验收；通过前不推 PR（PR #807 保持关闭，壁纸域归 Aa728848）。


## 11. 滑杆方案作废，固定磨砂（2026-08-21 后段；用户确认）
- **用户方向**：输入卡功能已由 web-ui 统一设计，之前滑杆相关功能全部作废；**不再使用滑杆方案**。
  除输入卡之外的其它组件（气泡、代码块、插件面板、任务看板、技能中心、侧栏背景、底部面板、
  better-sidebar、composer 弹窗、排队卡、ssh chrome 等）统一渲染为**固定半透明磨砂材质**。
- **确认项**：输入卡完全交给 web-ui（移除 `[data-composer-card]` 覆盖规则）；皮肤中心背景区的
  「输入卡片模糊」滑杆**保留上游版本**，只控制 web-ui 统一输入卡，不再驱动本皮肤其它表面。
- **代码落地**：
  - `patches.css`：删除 `[data-composer-card]` 规则；所有 `blur(var(--dsh-input-card-blur, 10px))`
    改为 `blur(var(--dsw-wallpaper-glass-blur, 10px))`；注释同步为固定磨砂。
  - `skin.css`：`--dsh-input-card-blur: 10px` 改为 `--dsw-wallpaper-glass-blur: 10px`（固定 10px）。
  - README 中英同步：输入卡不属本皮肤磨砂集合，其它表面固定磨砂、无滑杆驱动。
- **门禁**：待重跑 skin-center:check / gallery:check / docs:check / builtin skins 相关测试后部署。


## 12. 范例皮肤最终优化（2026-08-21 后段；用户验收反馈）
- **1. 底部 footer 按钮选中高亮**：`fThDlq_trigger`（检查更新 / 远程访问 / 连接手机）在弹窗打开时
  无高亮。修复：侧栏通用透明按钮规则排除 `[class*="trigger"]`，保留 shell hover/active；
  新增 `body:has(.fThDlq_panel[aria-label=...])` 打开态高亮（rgba 255 0.14）。
- **2. 正文显示区域与实时参数重叠**：曾试用 Summer/Mint 两种遮罩方案，用户验收后认为遮罩不对，
  **最终移除 composer seat 遮罩**（不留 `::before`、不改 seat 自身背景），保持官方/web-ui 原始行为。
- **3. 按范例皮肤补漏洞**：浮层（dialog/menu/listbox/popper）补 Summer 式内高光、顶部高光渐变、
  投影；新增 tooltip 磨砂、`:focus-visible` 焦点环、button/a 过渡与 reduced-motion。
- **验证**：webbridge 实测——检查更新弹窗打开时按钮背景 `rgba(255,255,255,0.14)`；
  浮层 `background-image`/`box-shadow` 生效；composer seat 无遮罩。
- **门禁**：gallery:check(17)、skin-center:check、docs:check、css-safety/builtin-skins/wallpaper-panel
  全绿。profile 已同步。


## 13. 内置默认壁纸 whale-art-v2（2026-08-21 后段；本地部署待截图）
- 将 `C:\Users\15266\Desktop\whale-art-v2.png` 加入
  `skins/wallpaper-exclusive/assets/whale-art-v2.png`，并在 skin.json
  `contributes.backgroundMedia` 声明 light/dark 同图 + 暗色 scrim。
- 优先级沿用 skin-center 规则：WE 壁纸 > 用户手动背景 > 皮肤 manifest 默认壁纸；
  因此默认壁纸仅在未选择 WE 壁纸时显示。
- README 中英同步说明内置默认壁纸；gallery/skin-center/docs 门禁全绿；profile 已部署。
- 用户先本地截图，再按指示推送。


## 14. 深浅双主题适配（2026-08-21 后段；未推送）
- 按 PR 模板「新皮肤收录」要求：亮 / 暗双态样式完整 + preview/{light,dark}.png。
- `skin.css` 重构为 `:root` 浅色 + `body[data-ds-dark-theme]` 深色两套 token：
  - 浅色：白玻璃 fill `rgba(255,255,255,0.42)`、float `0.78`、tooltip `0.9`、深色文字/hover/active。
  - 深色：沿用原深色玻璃 fill `rgba(13,22,39,0.22)`、float `0.62`、tooltip `0.72`、浅色文字/hover/active。
- `patches.css` 将浮层/工具提示底色与 hover/active 高亮改为主题变量
  （`--dsw-wallpaper-glass-float/tooltip/hover/active/...`）；终端视口保持深色。
- `skin.json` 浅色 scrim 调轻（`rgba(7,19,33,0.18/0.12/0.22)`）。
- README 中英补充「深浅双主题」；gallery/skin-center/docs 门禁全绿；profile 已部署。

