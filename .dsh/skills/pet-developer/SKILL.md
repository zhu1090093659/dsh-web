---
name: pet-developer
description: Create a pet for the dsh-pet plugin and integrate it into the dsh web GUI — author a v2 pet.json manifest plus an 8-column x 9-row atlas per the Codex/hatch-pet contract (live2d pets, voice packs and status decorations included), drop it into the pet-center user directory or contribute it as a built-in asset under packages/dsh-pet/assets, rebuild and test dsh-pet, verify the pet in the first-level Pet settings section, and submit the PR. Use when the user asks to create/add/develop/接入 a pet (宠物), build or calibrate a pet spritesheet, register a custom pet, author a status decoration, or asks how pets are discovered and rendered.
whenToUse: 用户要新建/开发/接入一只宠物（桌面宠物、dsh-pet）、制作或校准宠物图集与 pet.json、把宠物放进自定义目录或贡献为内置宠物、做状态装饰（decoration），或询问宠物如何被发现与渲染。美术与图集生成参考 hatch-pet skill；皮肤走 skin-developer skill。
---

# 宠物开发者（dsh-pet 多宠物注册表）

本技能指导制作并接入一只宠物到 **dsh-pet**（GUI 右下角桌面宠物 + 设置页一级菜单「宠物」）。
宠物是**注册表条目而不是代码**：一只宠物 = 一个目录 + 一份 `pet.json` manifest + 一张图集
（可选 voice.json 语音包与状态装饰 decoration），新增宠物不需要改任何宿主或客户端代码。
契约按 pet-center 里程碑演进（issue #623）：M1 场景/动画语义、M2 manifest v2 结构校验、
M3 live2d、M4 voice pack（#677）、M5 状态装饰（#567）。

## 0. 宠物契约（硬性约束，违反会被跳过或拒绝）

契约的权威实现是 `packages/dsh-pet/src/manifest-v2.ts`（结构门，fail-closed）与
`registry.ts`（归一化，never-throw）；JSON Schema 孪生文件在
`packages/dsh-pet/contracts/pet-manifest-v2.schema.json`（文档与 CLI 用，仓库内以手写校验器为准）。
完整示例：`packages/dsh-pet/assets/whale/pet.json`（id `whale-girl`，v2 全量：frames/tracks
覆盖 + sequences + license）与 `assets/whale-refined/pet.json`（id `whale-girl-refined`，
最小 v2）。v1 manifest 兼容读取（附迁移提示）；v2 manifest **fail-closed**：未知顶层键、未知
renderer、缺失条件块与不安全路径都会拒绝该条目并给出结构化诊断。

- 顶层字段：`petManifestVersion`=2、`id`（`^[a-z0-9][a-z0-9-]*$` 小写 kebab）、
  `displayName`（≤ 80 字符）、`description`/`version`/`author`/`homepage` 可选、
  **`license`（v2 必填）**、`renderer`（`sprite2d` | `live2d`）、`sprite2d{}` /
  `live2d{}`、`sequences`、`remarks`。
- `sprite2d` 块：`spritesheetPath`（**安全相对路径**：无 `..`、无绝对路径、无反斜杠、
  无协议 scheme，段字符 `^[A-Za-z0-9._-]+$`，缺省 `spritesheet.webp`）；`cell` 缺省
  192×208（上限 2048）；`columns` 缺省 8（上限 32）；`atlasRows` 缺省 9（v2 图集可声明
  11 = 9 动画行 + 2 行 look 行）；`frames` 每行用到的列数（9 个 1..columns 整数），缺省
  hatch-pet 契约表 `[6, 8, 8, 4, 5, 8, 6, 6, 6]`；`tracks` 按动画覆盖 `durations`
  （正数毫秒，按该行帧数**循环补足**）、`loop`、`fallback`；缺省全部循环，`jumping` 与
  `failed` 停在末帧后回 `idle`。
- **图集几何**：8 列 × 9 行（v2 图集 11 行），**行序固定**：0 idle / 1 running-right /
  2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review；
  未用格子保持全透明。
- `sequences`：按 ActivityPhase（idle / waiting / thinking / tool / review / done / failed）
  覆盖场景轨道序列，每个序列至少 5 个动画，否则该序列丢弃（warning，宠物保留默认单轨）。
- `remarks`：交互俏皮话槽位覆盖（每行 ≤ 120 字符，每槽 ≤ 64 行），社区宠物可用它配音。
- `voice.json`（M4，#677）：宠物目录内可选语音包（状态文案池 + 悬浮面板 chrome），纯内容
  warn-and-drop；全局覆盖放 `$DSH_HOME/pets/.voice.json`（垫底于每个宠物包之下）。
- live2d（M3）：`renderer: "live2d"` + `live2d{}` 块（`model` 相对路径 .model3.json、
  `scale` (0,10]、`translate`、`motions`（idle 必填，未映射相位回退 idle）、`expressions`、
  `hitAreas`、`lipSync`）。model3.json 的引用闭包 = 资产路由的可服务集合；模型不可读或声明
  不安全引用 → **fail-closed 拒绝**。Cubism Core 由用户自供
  （`$DSH_HOME/pets/.runtime/live2dcubismcore.min.js`），插件永不打包或下载。
- 可选 `previews/<name>.gif`（文件名 `^[A-Za-z0-9._-]+$`），经
  `/pet/<id>/previews/<name>` 提供（README 动画预览表用它）。
- 资产大小上限（路由强制）：manifest 64 KiB / 图片 20 MiB / live2d 模型文件 32 MiB。

## 1. 美术与打包

图集制作与视觉 QA（8×9 拼图、逐行校验、QA contact sheet、pet.json 打包）走 **hatch-pet** skill
（Codex/hatch-pet 契约的生成流水线）；本技能只覆盖 dsh-web-ui 侧的接入与验证。
手工制作时按第 0 节几何逐行对齐；做 11 行 v2 图集时后两行留给 look 行。

## 2. 接入方式（四来源；后注册的来源在同 id 冲突时覆盖前者）

- **A. 个人自定义宠物（零代码，最常见）**：放进 **`$DSH_HOME/pets/<id>/`**（默认
  `~/.dsh/pets`，pet-center 用户目录，**优先于** legacy hatch-pet 源），或一键安装
  `node scripts/dsh-pet install <dir>`（复制进 `$DSH_HOME/pets/<id>/`，--force 覆盖），
  重启 `dsh web` 即出现在「宠物」设置选择器，无需任何接线。
- **B. legacy hatch-pet 源**：`${CODEX_HOME:-~/.codex}/pets/<pet>/`（兼容保留）。
- **C. 贡献为内置宠物（PR）**：
  1. 新增 `packages/dsh-pet/assets/<dir>/`（dir 建议与 id 一致；dir basename 是历史 URL 别名）：
     `pet.json` + 图集 + 可选 `previews/*.gif`、`voice.json`。
  2. 在 `packages/dsh-pet/src/registry.test.ts` 增加该 manifest 的归一化断言
     （几何/行数/轨道对齐，参照 whale-girl 的用例）。
  3. 同步更新 `packages/dsh-pet/README.md` 与 `README.zh.md`（宠物契约示例/动画预览表），
     并 `pnpm docs:write-pair` 重录配对。
  4. 重建与测试：`pnpm --filter @linxin666/dsh-pet build`、
     `pnpm --filter @linxin666/dsh-pet test`、`pnpm typecheck`；
     提交 `assets/`、重建的 `lib/` 与 README 三件套，开 PR。
- **D. 组合注入**：嵌入 dsh-pet 的应用通过 `PetConfig.pets` 传入 manifest 条目（最高优先级）——
  仅嵌入场景使用，社区接入一般走 A 或 C。

**状态装饰（status decorations，M5，#567）**：宠物周边装饰是独立于宠物条目的另一份注册表
（`assets/decorations/<id>/` 内置；用户同 id 覆盖放 `$DSH_HOME/pets/decorations/`）：
`decoration.json`（`decorationManifestVersion`=1、`id`、`displayName`、**`license` 必填**、
`entry` 条带图、`cell`、`columns`、`frameMs`、`loop`、`phases`（ActivityPhase →
{from,to} 帧区间或 "hide"））+ 单行条带图（**cell.width×columns 宽 × cell.height 高**，
不匹配会 warning 并渲染错帧）。内置默认装饰 id `whale`；资产经
`/api/pet/decoration/<id>/<entry>`。装饰贡献走与内置宠物相同的流程（测试 + README + PR）。

## 3. 验证

- 重启 `dsh web`（注册表在宿主启动时构建一次，改宠物后必须重启）。
- 设置页一级菜单「宠物」（`settings.section` id `pet`，order 130，直接展开）选择器出现新宠物；
  切换后右下角精灵立即更换。
- 同源 `/api/pet/pets` 返回该条目（几何、行数、tracks、sequences 齐全）；图集经
  `/pet/<id>/<spritesheetPath>` 可访问；`/api/pet/diagnostics` 给出结构化诊断。
- 坏 manifest 不会让宿主崩溃：结构错误 fail-closed 拒绝（error 诊断），内容错误 warn-and-drop。
- 名字/显示布局按宠物 id 独立持久化（`petId` 存于 `pet` 设置命名空间）。
- CLI 预检：`node scripts/dsh-pet validate <dir>`（manifest + 声明资产 + live2d 闭包 + voice.json）。

## 4. 验收清单（全部满足才算完成）

- [ ] manifest 契约全部满足（id 字符集、license、路径安全、几何与行序、frames/tracks、sequences）
- [ ] 图集 8 列 × 9 行（或 v2 11 行）、未用格子全透明（或经 hatch-pet QA）
- [ ] 内置贡献：registry 测试新增断言，`build`/`test`/`typecheck` 通过，README 双语同步并重录配对
- [ ] 装饰贡献：decoration.json 契约满足、条带几何正确、有测试与 README
- [ ] 重启后 GUI 实测：设置页「宠物」选择器出现、切换与动画正常、`/api/pet/pets` 含该条目
- [ ] 提交信息与文案无 emoji

## 5. 常见坑

- **id 不合字符集**：manifest 被跳过（warning），选择器里不出现。
- **v2 缺 license 或带未知顶层键**：fail-closed 拒绝（error 诊断）。
- **spritesheetPath 含 `..` / 绝对路径 / 协议 scheme**：直接拒绝（路径穿越防护）。
- **忘了重启**：注册表启动时构建一次，改完宠物不重启看不到变化。
- **自定义宠物与内置同 id**：后注册源覆盖前者（warning）；`$DSH_HOME/pets` 优先于
  `~/.codex/pets`，改名或换 id。
- **行序写错**：动画错位（如 idle 行放了 running 帧）；按第 0 节固定行序逐行对齐。
- **时长数组太短**：会按该行帧数循环补足——想要每帧固定节奏就给满帧数的数组。
- **frames 超过 columns**：被截断到 columns；行内帧数与时长以截断后为准。
- **未用格子不透明**：渲染时露出残影；保持全透明。
- **sequences 少于 5 项**：该序列被丢弃（warning），宠物保留默认单轨播放。
- **装饰条带几何不符**：渲染错帧（warning）；条带必须正好 cell.width×columns × cell.height。
- **README 只改了一侧**：docs:check 双语配对变红。
