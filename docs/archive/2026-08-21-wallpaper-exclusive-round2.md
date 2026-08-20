# wallpaper-exclusive 开发文档 Round 2（2026-08-21）

承接 `2026-08-20-wallpaper-exclusive-dev.md`（Round 1 已本地落地并部署）。本文记录
Round 1 之后用户实机验收的三条反馈（其中一条确认 Round 1 首修生效），随后列出剩余
未完成内容与本轮修复计划。文档为一次性交接记录，不进入长期文档。

## 1. 用户验收反馈（实机，重启 dsh web 后）

### 1.1 《壁纸消失》首修已生效 —— 仅剩「切换瞬间几帧实心闪烁」
- 用户确认：**切对话/切窗口壁纸不再消失**（Round 1 的「连接感知回拼 + surfaceObserver
  重打标」生效，#805 主问题解决）。
- 新问题：切换过程中**中间会闪烁几帧实心渲染的画面**，影响观感。壁纸最终恢复，但过渡
  帧不干净。
- **定位（主因假说）**：`wallpaper.ts scheduleSurfaceRescan` 目前是「rAF + 150ms 尾随去抖」。
  导航重建 `#root` 内部后，新的全视口表面（conversation/details 根等）是**未打标的不透明白底**，
  要等 150ms 尾随去抖结束才被重扫打标 → 约 10 帧实心画面。
  - 修法：改为**领先沿**——首个 mutation 后一帧（rAF，画面绘制前）立即打标，尾随去抖仅供
    合并同批突发（流式），不再延迟首帧。预期把实心窗口从 ~10 帧降到 ≤1 帧。
  - 次要：层回挂（mountObserver）是微任务，应赶在绘制前；若实测仍闪首帧，则在
    `render()` 里对回拼层立即 `forceStyle`/确保 video `play()` 已在首帧前可绘制。
- 新增回归点：切会话/切窗口连贯性（无实心闪烁）纳入后续验收。

### 1.2 输入框「+」与「/」触发的弹窗 —— 实机确认已随部署修复（webbridge 取证）
- webbridge 实机（`http://127.0.0.1:3080`，skin=wallpaper-exclusive）：
  - 「+」按钮 = `button[class*="_add"]`（aria「命令」）；点开后弹窗为
    `DIV[class*="_menu"][role="listbox"]`，**portal 到 body**（不在 composer 子树内）；
  - 输入「/」弹的是**同一个**容器 `DIV[class*="_menu"][role="listbox"]`（命令菜单）；
  - 该弹窗计算样式：`background=rgba(13,22,39,.22)`（= `--dsw-wallpaper-glass-fill`）、
    `backdrop-filter=blur(6px) saturate(1.3)`（= 滑杆@6px）——**已被全局 `[role="listbox"]`
    通用组捕获并随滑杆驱动**；内层菜单项透明（仅 active 项 `rgba(255,255,255,.08)`）。
- **结论**：feedback 里「弹窗不在滑杆集合」是部署前旧态；当前构建已生效。因弹窗是 body
  portal，Round 1 的 composer 作用域显式规则其实不命中（冗余但无害），真正命中的是全局
  `[role=listbox]` 通用组——保留即可。附带加固（可选）：日后若弹窗丢 role，按
  `[class*="_menu"]` 稳定后缀补一条。

### 1.3 侧栏按钮颜色 —— 实机确认已随部署修复（webbridge 取证）
- webbridge 实机当前三入口计算样式**完全一致**：
  `color=rgb(249,250,251)`（`--dsw-alias-label-primary`）、`bg=rgba(0,0,0,0)`、`active=false`、
  `font-weight=400`，且三入口都带 `data-dsh-plugin` + `data-dsh-part="sidebar-entry"` +
  row 属性（`data-dsh-taskboard/-ssh/-skill-explorer-entry`）。
- **结论**：feedback 图是早于本次部署的中间态；当前构建已统一。保留 Round 1 的
  `[data-dsh-part="sidebar-entry"]` + `[data-slot="sidebar"] [class*="entry"]` 规则即可。
  加固（可选）：把色规则再加 **row 属性族**锚点（`[data-dsh-ssh-entry]` 等），防未来某家族
  entry 丢 part 时再漏。回归点：三入口静止色一致、选中态一致。

## 2. 剩余未完成内容（承接 Round 1 清单）

### 2.1 本轮三条反馈的收尾
- [ ] `+`/`/` 弹窗真实选择器回填（见 1.2）
- [ ] 侧栏入口色规则改 row 属性族锚点 + ssh 状态复核（见 1.3）
- [ ] surface 重扫改领先沿去抖，消除切换实心闪烁（见 1.1）

### 2.2 Round 1 遗留（未动项，按优先级）
- **pet 代码层玻璃**：`.panel`/`.summon`/`.bubble*` 是写死的品牌 rgba
  （`rgba(19,28,54,.95)` / `rgba(7,11,26,.75)` 等）＋自带 `backdrop-filter`，与
  `--dsw-wallpaper-glass-*` 完全脱钩；并入滑杆需**代码层**换成变量（需产品定透明度，
  当前 ~95% 接近实底）。契约里 pet 的 `panel/bubble/summon-button` part 已存在。
- **remote-web-ui / desktop-launcher 实底模态**：remote 配对 `.panel`（`role=dialog`）
  已被通用 `[role=dialog]` 玻璃组覆盖（复核即可）；desktop-launcher 关机确认 `.dialog`
  建议按产品意图决定玻璃化或保持实底（否则被通用 dialog 规则误伤，需显式排除）。
- **plugin-manager 行**：settings.plugins 分区内行已随 `[data-dsh-surface="settings"]`
  token remap 半透明（复核即可）。
- **皮肤自身**：`--dsw-wallpaper-glass-fill` 为静态（仅 blur 随滑杆），维持 Round 1 设计；
  若后续要「随滑杆连透明度一起动」需在 `background.ts` 增加 fill 变量写入（当前未做）。
- **文档**：本文件即为 Round 2 记录；Round 1 文档保留为历史。

### 2.3 提交/推送（本轮后可 PR）
- 用户已放行：**本轮更新完成后可整理提交并 PR**。范围：PR #782（滑杆+壁纸收尾）与
  PR #807（皮肤全量：skin.json/preview/gallery manifest 重生成、skill-explorer 语义属性、
  契约表更新、wallpaper.ts 收尾、测试）。
- 提 PR 前按仓库规范补测试证据与同步上游 dev；提交信息 Conventional Commits、无 emoji。

## 3. 本轮修复落地状态

1. **surface 闪烁（真正剩余的可修项）**：`scheduleSurfaceRescan` 已改「领先沿 rAF + 短尾随」——
   首个 mutation 后一帧（绘制前）即 flush 打标，尾随 timer 合并同批突发；实心窗口由 ~10 帧
   降为 ≤1 帧。待跑 wallpaper.spec + typecheck + 重新部署验证。
2. **侧栏色一致**：webbridge 实机确认当前构建三入口已一致（rgb(249,250,251) 透明底）；
   另把色规则加了 row 属性族锚点（`[data-dsh-taskboard/-ssh/-skill-explorer-entry]`）加固。
3. **`+`/`/` 弹窗**：webbridge 实机确认两者为同一 `DIV[class*="_menu"][role="listbox"]`
   portal，已被全局 `[role=listbox]` 通用组捕获并随滑杆驱动；无需新增规则（冗余的
   composer 作用域规则保留无害）。
4. 门禁：typecheck / tests（skin-center 除 pkg-extract Windows symlink 环境 flake 全绿）/
   docs:check / skin-center:check / gallery:check。
5. **审查走 subagent（实时审查纠错）**，不用子 Claude（Claude Code）：本轮改动完成后派
   read-only subagent 按 Round 1 审查点（变量双端写入、CSS 管道作用域、选择器不自带皮肤
   前缀、`!important`、壁纸层生命周期/去抖）逐项核对，清零再交验收。
6. **本轮更新后可 PR**（用户已放行）：本地改动整理提交（PR #782 滑杆+壁纸收尾 /
   PR #807 皮肤全量），按仓库规范补测试证据。

## 4. 验收清单（本轮）

- 切对话/切窗口：无实心闪烁、壁纸连续；
- 侧栏 task-board/ssh/技能中心三入口颜色一致（静止 + 选中态）；
- `+` 点开与 `/` 弹出菜单：随「卡片背景模糊」滑杆一起模糊（漏则按回填选择器再验）；
- 上轮已达成项不回退：输入卡/气泡/代码块/设置卡片/任务清单/插件面板随滑杆；壁纸不消失。

## 5. 部署状态

- profile/web 已同步：skin-center lib（client.js 138762 / index.js 271757）+ skins/contracts；
  skill-explorer lib（client.js 39942）。本轮修复落地后需再次构建同步，等待用户重启验收。
