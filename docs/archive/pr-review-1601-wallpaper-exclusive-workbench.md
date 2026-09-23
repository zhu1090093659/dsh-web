# PR 评审记录：#1601 wallpaper-exclusive 工作台包含块修复（2026-09-17）

> 一次性评审快照，冻结历史。评审对象：PR #1601
> `fix(skin-center): stop painting the better-sidebar host shells in wallpaper-exclusive`
> （作者 chemmy-11，head `11303d20`，base `dev`=`51faa866`，24 文件 +379/-94）。
> 记录决策与本地验证证据；当前行为以皮肤资产与
> [Agent Note: 皮肤玻璃不得成为插件固定面板宿主的包含块](../../.agents/notes/implemented/bug-fix/2026-09-16-wallpaper-exclusive-better-sidebar-containing-block.md)
> 为准。

## 结论

**采纳并合入**。评审通过（APPROVE），以 merge commit `2d92b900` 合入 `dev`
（2026-09-17T03:59:16Z，合并者 Aa728848）。合并前 PR 已 rebase 到 `origin/dev` 顶端，
`mergeable=MERGEABLE`、无冲突，无需冲突处理。

## 根因复核（对照插件产物，不采信 PR 描述）

- `dsh-better-sidebar@0.19.x`：`host = document.createElement('div')` +
  `host.setAttribute('data-dsh-better-sidebar', '')` + `document.body.appendChild(host)`，
  包装节点是静态、零高的普通 div。
- 面板宿主 `[data-dsh-panel-host]` 是该包装节点的**后代**，自身
  `position: fixed; inset: 0; z-index: 25; overflow: clip; pointer-events: none`；
  其内部面板（`_bottomPanel`/`_panel`）为 `position: absolute`。
- 因此皮肤给包装节点刷 `backdrop-filter` 会令其成为固定定位后代的包含块 → 宿主相对
  空盒子解析 → 实测 `1600x0 @ y=950`（贴视口底边），再由宿主自身 `overflow: clip`
  把面板从绘制与命中测试中移除。与作者描述、与缺陷现象（底栏空白、卡片点不动、
  右侧栏仍渲染）一致。

## 变更面核对

- **宿主壳已彻底退出**：合入后的 `packages/skins/skin-center/skins/wallpaper-exclusive/patches.css`
  中不存在任何以 `[data-dsh-better-sidebar]` 或 `[data-dsh-panel-host]` 结尾的裸选择器
  （逐选择器扫描，计数 0）；未保留「中和 backdrop-filter」之类的绕过规则。
- **无同类残留**：皮肤两文件中不存在 `transform / will-change / contain / filter` 等
  会再造包含块的声明。
- **同族皮肤无需连带改**：`maid-atelier` / `phoebe-atelier` / `orca-link` 只在这两个
  宿主上设置 CSS 自定义属性（`--dsw-alias-*` / `--dsw-specific-sidebar-fill`），
  不会产生包含块。
- **`.aionui-*` 选择器删除安全**：`packages/dsh-aionui-panel` 零跟踪文件，
  `market/dist/manifest/plugins.json` 无 aionui 条目，残留字样仅在 archive 文档与注释。

## 产物一致性（按 git blob 比对，不依赖时间戳自洽）

| 产物 | 结论 |
| --- | --- |
| `market/dist/assets/skins/wallpaper-exclusive/{patches.css,skin.json,README.md,README.zh.md}` | 与源文件 blob 逐一相同 |
| `market/dist/assets/skins/wallpaper-exclusive.zip` | 内 `patches.css` 同 blob；`skin.json` 版本 `0.2.1` |
| `market/dist/tryon-assets/skins/wallpaper-exclusive/patches.css` | 经 `transformSkinCss` 的副本，且已含新规则 |
| `market/dist/styles.js` | 内联 patches 与源文件逐字相同 |
| `market/dist/manifest/skins.json` | 仅 `0.2.0 → 0.2.1` |
| 其余 `manifest/*.json`、`manifest.js` | 仅 `generated: 2026-09-16 → 2026-09-17` |

## 门禁与本地验证

- CI：`CI checks` / `plugin-mount` / `Desktop unit tests (Windows)` /
  `Validate PR contribution evidence` / `guard-agent-notes` 等全部 success。
- 评审补跑（PR head 的临时 worktree）：`node scripts/verify-docs.mjs` exit 0；
  `node scripts/i18n-audit.mjs --check` exit 0（仅既有 host-half 警告）。
  `skin-center:check` / `market:check` 在该临时 worktree 中因缺 `node_modules`
  无法运行（环境限制，非 PR 缺陷）；两者在作者本地与 CI 均为绿。
- 证据截图目检：任务看板（单层磨砂、搜索框材质统一）、轨迹视图（单层磨砂、
  工具栏/表格可读）、底栏亮暗双态与修复前后对比。

## 非阻塞跟进项（已记录，不阻塞合入）

1. `[data-dsh-taskboard-view] input` 的覆盖范围比其注释更宽：除搜索框外还会重刷
   任务表单输入、时间输入（`.scheduleInput` / `.scheduleInputInvalid` 的状态色）
   与 `type=checkbox`。建议收紧到搜索框类名或改写注释。
2. 建议补机械守护测试：本仓库已有先例
   `packages/skins/skin-center/tests/orca-link-hit-targets.spec.ts`（解析皮肤 CSS
   断言危险声明永不出现）。可断言「宿主壳选择器不得携带 backdrop-filter /
   transform / contain 等包含块属性」。
3. PR 证据图按 [docs/AGENTS.md](../AGENTS.md)「一次性验证记录入 docs/archive/」
   宜落在 `docs/archive/pr-evidence/`（`docs:check` 不覆盖该条，故 CI 不会报）。
4. Agent Note：作者受 `agent-notes-guard`（仅 OWNER/COLLABORATOR/MEMBER 可改
   `.agents/notes/`）限制未随 PR 提交 note，决策记录在 PR 描述内；
   由维护者合入后补 implemented note（本目录决策记录），已闭环。
