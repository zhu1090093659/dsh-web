# wallpaper-exclusive 开发文档（2026-08-20）

## 0. 背景与目标

- 皮肤中心（PR #782）正在做「背景统一场景 + 输入卡磨砂」；壁纸模块（wallpaper.ts）独立渲染 WE 视频。
- issue #805 定位：Summer Liquid Glass 自带 composer seat `::before` 磨砂会糊壁纸 → 决定**不做逐皮肤适配**，新增专门面向壁纸场景的皮肤 **wallpaper-exclusive**（PR #807）。
- wallpaper-exclusive 设计：官方默认底座 + 左右侧边栏/输入卡/气泡/代码块液态玻璃，壁纸优先，不画自己的背景。

## 1. 当前实现状态（已本地部署，未推送）

### 1.1 皮肤 center（PR #782 分支）
- 背景媒体改画 decoration 层（#732 修复），皮肤背景模糊在 Chromium 下生效。
- 共享场景标记 `data-dsh-backdrop-active` / `data-dsh-conversation-content`（backdrop-scene.ts）。
- **卡片背景模糊滑杆** `backgroundBlurCard`（0-20，默认 10）：
  - 位置：设置 → 皮肤中心 → Wallpaper 区「壁纸模糊」下方（已从背景区移入）。
  - 写入根/body 内联 CSS 变量 `--dsw-wallpaper-glass-blur` / `--dsw-wallpaper-glass-fill`。
  - 因皮肤管道会把 `:root` 作用域成 `html[data-dsh-skin=...]` 和 `html[data-dsh-skin=...] body` 两处，滑杆必须**同时写 documentElement 和 body 内联**才覆盖 body 的声明。
  - **已删除**共享中和器里的旧「输入卡 10px 占位磨砂」规则（它 `!important` 且特异性更高，会压过皮肤导致滑杆失效）。
- 壁纸自动加载修复：`preload=auto` + 挂载后重试 `play()`（大文件 moov 在尾部也能拉流）。

### 1.2 壁纸专属皮肤（PR #807 分支）
- 玻璃对象（滑杆统一驱动 `--dsw-wallpaper-glass-blur`）：
  1. 输入卡 `[data-composer-card]`
  2. 用户气泡 `[data-chat-anchor-key] [class*="bubble"]`（不是整行）
  3. 代码块 `[class*="md-code-block"]`
  4. 内联代码 `code`
  5. 设置表面与卡片 `[data-dsh-surface="settings"]`（作用域内重映射 `--dsw-alias-bg-layer-*`）
  6. 通用浮层 `[role="dialog"] / [role="menu"] / [role="listbox"] / [data-radix-popper-content-wrapper]`
  7. 侧栏新增玻璃：composer「+」按钮 `button[class*="add"]`、右下角退出按钮 `button[class*="triggerFloating"]`
  8. **任务清单（新增要求）**：看板（task-board）内任务卡片/列表行与列容器，随滑杆变量玻璃化——语义锚点 `data-dsh-plugin="task-board"` + `data-dsh-part`（column/cards/card）+ 卡片类名后缀。
- 侧栏填色：`[data-slot="sidebar"] button` 默认透明（修「自带选中效果」），hover/aria 选中轻微着色；入口文字统一 `--dsw-alias-label-primary`（修 task-board/SSH 色差——待复核）。
- 对话区不强制实体也不强制玻璃（保持 PR #782 全局设计）。
- **输入框「+」与「/」触发的弹窗（新增要求）**：它们必须同样进入 `--dsw-wallpaper-glass-blur` 滑杆集合。决定：**不依赖 webbridge 实机取 DOM**，直接新增显式玻璃规则（语义锚点 + 稳定类名后缀兜底），与通用浮层组 `[role="menu"]/[role="listbox"]/[data-radix-popper-content-wrapper]` 并列、共用同一滑杆变量；是否命中的核对交给用户验收时回填（漏则下次补一条选择器）。

## 2. 关键机制与坑（务必记住）

- 皮肤 `:root` token 会被管道作用域成 `html[data-dsh-skin=...]` 和 `html[data-dsh-skin=...] body`；所以 CSS 变量要写在更高优先级处（内联 body + documentElement）。
- patches.css 选择器统一被加 `html[data-dsh-skin=...] ` 前缀；写选择器时**不要**再自带 `html[data-dsh-skin=...]`（会变成子孙二重包裹永不匹配）。
- 语义锚点优先（`data-slot` / `data-dsh-part` / `data-dsh-plugin` / `data-composer-card` / `data-chat-anchor-key`），哈希类名用稳定后缀（`[class*=...]`）会触发 validate 警告，但可接受。

## 3. 首要任务：解决「切对话壁纸依然消失」

### 3.1 症状与关键证据
- 切换对话 / 新建会话后壁纸消失。
- **关键补充**：在设置里点进皮肤中心后，消失的壁纸很快重新加载 —— 说明壁纸层对象还在（`applied`/media 引用存活），只是被导航从 body 子树摘出；打开皮肤中心触发 `WallpaperPanel.load() → wallpaper.sync() → render()`，才把层重新挂回。

### 3.2 已定位根因
1. **主因：`ensureLayers()` 只认 `mediaLayer === null`**。导航把 body 直接子节点（壁纸层）拆掉后，引用非空但 `!isConnected`，`render()` 走 `ensureLayers()` 会跳过挂载 → 层永远回不了 body。
   - 已改：创建守卫改为**连接感知**（`=== null || !isConnected` 时 remove + 重建 + append）。
2. **次因：`markSurfaces()` 只在 render 时打一次 `data-dsh-wallpaper-surface`**。导航重建 `#root` 内部全屏表面后，新表面未被打标，其不透明底会盖住负 z-index 壁纸层。
3. 叠加：重建层 → `mediaKey` undefined → video 重建 → 无手势时 autoplay 被拦 → 首帧空白。

### 3.3 修复方向（按优先级）
- [x] `ensureLayers` 连接感知重建（已实现）。
- [ ] 在 `#root` 上挂 `subtree` MutationObserver（防抖），导航后重跑 `untagSurfaces() + markSurfaces()`，并清理 `taggedSurfaces` 中 `!isConnected` 的旧项。
- [ ] 尽量复用层元素避免 video 重建（连接感知里若引用还在，直接 `body.appendChild` 回来而不是新建，mediaKey 不变则不重建 video）。
- [ ] 部署新 client 后**必须重启 `dsh web`**（host `lib/index.js` 才载入 `backgroundBlurCard` schema；否则滑杆值读不到、修复也不生效）。

## 4. 后续任务（按优先级）

### 4.1 侧边卡片 + 底部面板渲染，并入滑杆控制集合
- 现状：侧栏底透明度 token 已半透明；要补：侧栏内各类卡片（搜索、footer、工作区/会话行）、底部面板（dock/composer dock）的玻璃，并统一加入 `--dsw-wallpaper-glass-blur` 驱动。
- 参考 maid-atelier 的侧栏分档覆盖（pane/logo/newSession/footer/settings/搜索/工作区行/会话行/rail 圆钮）。

### 4.2 任务看板、技能中心渲染
- 任务看板 `[data-dsh-plugin="task-board"]`、技能中心（skill-explorer）与 ssh 类似：做显式玻璃 bg + blur，便于壁纸透出；确认其内部卡片 token。
- **任务清单并入滑杆集合（新增要求）**：看板内任务卡片/列表行（TaskCard 及列容器 `[data-dsh-part="column"]`/cards 区）必须随 `--dsw-wallpaper-glass-blur` 一起变化；做法与 4.1 同构——子代理枚举卡片 DOM 锚点与不透明白底，主 agent 写显式玻璃规则（语义锚点优先，回退类名后缀）。

### 4.3 任务看板 / SSH 按钮色差复查
- 上一版统一了文字色（`[data-slot="sidebar"] [class*="entry"]`），用户反馈**仍有色差**：需再查 entry 的图标色/border/hover 态是否也统一。

### 4.4 待补充（第 5 点）
- 用户后续补充后再并入本计划。

### 4.5 输入框「+」/「/」弹窗并入滑杆集合（新增要求）
- 目标：composer「+」按钮弹出的菜单、输入「/」触发的命令/工具选择器，与输入卡/气泡等共享 `--dsw-wallpaper-glass-blur` / `--dsw-wallpaper-glass-fill`，随滑杆一起变化。
- 步骤（**不用 webbridge，漏/命中核对交给用户验收回填**）：
  1. 为「+」弹窗、「/」选择器各追加显式玻璃规则：优先语义锚点（radix popper wrapper / `data-*`），回退稳定类名后缀（如弹窗内容容器、工具项行），统一走滑杆变量。
  2. 保留通用浮层组不删（两者叠加保证命中：通用组兜底 role/popper，显式规则兜具体弹窗）。
  3. 顺带把弹窗内层卡片（如 / 工具项的 icon+label 行）的不透明白底抹成透明白底，避免「外层玻璃、内层仍糊」。
  4. 用户验收时重点看这两个弹窗是否随滑杆变化；发现未命中的表面，回填一条选择器即可。
- 注意：避免 `!important` 过多叠加；显式规则与通用组同值，相互覆盖无差异。

## 5. 验收/部署清单

1. 主 agent 侧门禁：`pnpm typecheck`、`pnpm --filter @linxin666/dsh-client-ui-skin-center test`、`pnpm docs:check`、`node scripts/dsh-skin validate packages/.../wallpaper-exclusive`、`pnpm skin-center:check`、`pnpm gallery:check`。
2. 代码审查：主 agent 产出后派**子 Claude（Claude Code）代理**做代码审查，问题清零再交付。
3. 用户验收（**不启用 webbridge**）：用户重启 `dsh web` 后按下列清单目测——
   - 设置 → 皮肤中心 → Wallpaper「卡片背景模糊」拖动 → 输入卡/气泡/代码块/设置卡片一起变化；
   - **composer「+」点开与「/」弹出的菜单/工具选择器随之模糊**（漏则回填选择器）；
   - 切对话/新会话壁纸不再消失；
   - 任务看板/SSH 无按钮色差（侧栏 task-board/ssh/skill-explorer 三入口 label+icon 颜色一致）；
   - 任务看板整体 + **任务清单（列/任务卡）随滑杆玻璃化**；
   - 技能中心（skill-explorer）面板/技能行玻璃、激活 tab 保留玻璃底；
   - 侧栏/底部面板（composer dock chip）/任务看板/技能中心渲染完整。

## 6. 本地改动清单（未提交/未推送）

- PR #782 分支（fix/skin-backdrop-layer-dev）：
  - 卡片模糊滑杆 `backgroundBlurCard`（field + UI 移入 WallpaperPanel）+ 变量写 html+body（早前）；
  - 壁纸（#805，本次收尾）：
    - preload=auto + 挂载 play 重试（1e80535a 已提交）；
    - 连接感知**回拼而非重建**：mediaLayer/scrim 断连时 `body.appendChild` 复挂，保留 video 与 mediaKey 不重启播放；断连后若 video paused 补一次 play()；
    - `surfaceObserver`（body childList+subtree，壁纸激活时挂载）：导航重建 #root 后 rAF + 150ms 尾随去抖 → untag + 重打标；jsdom 无 rAF 则同步；去抖窗口 `surfaceTrailMs` 可配置（默认 150，测试传 0）；
    - `markSurfaces` 每次扫描只 resolve 一次 `--dsw-alias-bg-base`（去掉逐元素 probe div 开销）；
    - 测试 +2（回拼不重建、#root 重建后重打标）；`wallpaper-panel.spec` 补 background stub（滑杆迁移遗留）。
- PR #807 分支（feat/skin-wallpaper-exclusive）：
  - **新增 `skin.json`**（此前 v2 manifest 缺失）+ `preview/light.png` + `preview/dark.png`；gallery manifest 重新生成（17 skins）→ gallery:check 绿；
  - patches.css：插件面板组 / aionui 浮层从硬编码 `blur(12/14px)` 改滑杆变量；**任务清单**（task-board 列/卡 `[data-dsh-part="column"]/["card"]`）玻璃；git-graph composer chip 玻璃；skill-explorer 卡片/行玻璃 + head/tab-bar/tab 透明、激活 tab 保留玻璃底（data-active）；composer「+」「/」弹窗显式规则 + 通用组叠加；侧栏入口 `[data-dsh-part="sidebar-entry"]` 统一 label/icon 色。
- skill-explorer 补语义属性：panel-mount 容器 `data-dsh-plugin="skill-explorer"`；SkillPanel `data-dsh-part`（card/head/tab-bar/tab/skill-row）＋ 激活 tab `aria-selected`/`data-active`；sidebar-entry 传 `plugin:'skill-explorer'`（此前缺，entry 无 plugin/part）；契约表加该 plugin id 与 5 个 part，并把 part/plugin 组计数修正为 31 行 / 10 个。
- 门禁：typecheck / docs:check / skin-center:check / gallery:check / dsh-skin validate 全绿；skin-center 测试除 `pkg-extract`（Windows 临时目录 symlink EPERM，环境 flake，Linux CI 不受影响）全绿；skill-explorer 测试全绿。
- 已部署 profile（web）：skin-center lib（client.js 138762 / index.js 271757）+ skins/contracts 整包同步；skill-explorer lib（client.js 39942）。**待用户重启 `dsh web` 验收**。
- 延期项（未动，属后续）：pet 代码层硬编码 rgba 玻璃（`.panel`/`.summon`/`.bubble*`）并入滑杆（需产品定透明度）；remote-web-ui / desktop-launcher 实底模态是否玻璃化（前者 role=dialog 已被通用组覆盖）；plugin-manager 行（settings 内已被 `[data-dsh-surface="settings"]` token remap 覆盖，仅需复核）。
- `agent.md` 未跟踪（子代理身份/规则）。

## 7. 分工与子代理适性分析

### 7.1 原则
- **方案/代码：主 agent**（设计要求、滑杆驱动、CSS 管道坑、PR 提交都由主 agent 把控）。
- **子代理：并行的只读杂活**，不进 tools schema、不碰网络/Bash，只做仓库内只读枚举、diff、结构梳理、清单产出；产出物交给主 agent 决策。
- **代码审查：子 Claude（Claude Code）代理**。主 agent 完成一段可交付改动后派 Claude Code 审查（覆盖滑杆变量写入双端、CSS 管道作用域、patches.css 选择器不自带皮肤前缀、`!important` 使用、壁纸连接感知/observer 生命周期），问题清零再报用户验收。
- **验收归用户**：全程不启用 webbridge 实机核验；主 agent 只保证门禁与静态自查通过，视觉/交互验收由用户重启 `dsh web` 后按 §5 清单目测，漏的表面回填选择器。

### 7.2 各任务适性判定
| 任务 | 是否适合子代理 | 理由与拆分 |
| --- | --- | --- |
| 首修「壁纸消失」收尾（markSurfaces #root subtree observer + taggedSurfaces 清理） | 否 | 是代码实现，且与连接感知/层复用耦合；需主 agent 写与实测 |
| 4.5「+」「/」弹窗规则 | 否（主 agent 直接写） | 不再实机取 DOM：主 agent 直接写显式规则 + 保留通用组叠加覆盖；命中核对回退用户验收回填 |
| 4.1 侧边卡片 + 底部面板玻璃覆盖清单 | 是（子代理枚举 → 主 agent 写 CSS） | 子代理：逐个列侧栏内卡片容器（搜索/footer/工作区行/会话行）、底部 dock/面板的 DOM 锚点、现有 token 与不透明白底阻塞点，输出覆盖矩阵；主 agent 依矩阵写 patches.css |
| 4.2 任务看板 + 技能中心渲染 | 是（子代理枚举 → 主 agent 写 CSS） | 子代理：task-board 与 skill-explorer 根容器/卡片/轨道/条目的语义属性与层层 token、哪些层不透明白底需抹透明；产出与 4.1 同构的覆盖清单 |
| 4.3 task-board / SSH 按钮色差复查 | 部分 | 静态部分（子代理）：diff 侧栏两项入口的 icon 色 / border / hover / aria 态样式来源；动态部分（主 agent）：webbridge 实机截图对比视觉 |
| 验收联动矩阵（滑杆 → 各表面清单核对） | 是 | 子代理按 skin.css/patches.css 与壁纸模块列一份「滑杆变量 → 选择器 → 表面」核对表，供用户验收时逐项过 |
| 代码审查 | 是 | 子 Claude（Claude Code）代理对可交付改动审查（滑杆双端写入、CSS 管道作用域、选择器不自带皮肤前缀、`!important`、壁纸层生命周期），清零再交付 |
| 文档维护（本文件） | 否 | 主 agent 维护，子代理只喂素材 |
| 用户验收 | — | 不启用 webbridge；用户重启 `dsh web` 后按 §5 目测，漏的表面回填选择器 |

### 7.3 推荐并行批
1. 第一批（子代理只读，互不依赖）：a) 4.1 侧栏+底部面板覆盖清单；b) 4.2 task-board+skill-explorer 覆盖清单；c) 4.3 侧栏 entry 样式 diff；d) 滑杆联动核对表。
2. 主 agent 拿到四份清单后：写 patches.css（侧栏/底部/看板/技能中心）+ 补「+」「/」弹窗显式规则 + 壁纸收尾代码。
3. 门禁自测通过后，派**子 Claude（Claude Code）代理**代码审查，问题清零。
4. 交用户重启 `dsh web` 验收（无 webbridge）；漏的表面回填选择器。
