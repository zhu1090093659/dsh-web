---
name: pet-developer
description: Create a pet for the dsh-pet plugin and integrate it into the dsh web GUI — author a pet.json manifest plus an 8-column x 9-row atlas per the Codex/hatch-pet contract, drop it into the custom pets directory or contribute it as a built-in asset under packages/dsh-pet/assets, rebuild and test dsh-pet, verify the pet in the first-level Pet settings section, and submit the PR. Use when the user asks to create/add/develop/接入 a pet (宠物), build or calibrate a pet spritesheet, register a custom pet, or asks how pets are discovered and rendered.
whenToUse: 用户要新建/开发/接入一只宠物（桌面宠物、dsh-pet）、制作或校准宠物图集与 pet.json、把宠物放进自定义目录或贡献为内置宠物，或询问宠物如何被发现与渲染。美术与图集生成参考 hatch-pet skill；皮肤走 skin-developer skill。
---

# 宠物开发者（dsh-pet 多宠物注册表）

本技能指导制作并接入一只宠物到 **dsh-pet**（GUI 右下角桌面宠物 + 设置页一级菜单「宠物」）。
宠物是**注册表条目而不是代码**：一只宠物 = 一个目录 + 一份 `pet.json` manifest + 一张图集，
新增宠物不需要改任何宿主或客户端代码。

## 0. 宠物契约（硬性约束，违反会被跳过或拒绝）

契约的权威实现是 `packages/dsh-pet/src/registry.ts`（README.md「Pet contract」一节与之一致）。
完整示例：`packages/dsh-pet/assets/whale/pet.json`（鲸鱼娘，自带 frames 与 tracks 覆盖）。

- `id`：唯一，`^[a-z0-9][a-z0-9-]*$`（小写 kebab），不合规直接跳过（记录 warning）。
- `displayName`：设置选择器与悬浮面板的显示名（≤ 80 字符）；`description` 可选。
- `spritesheetPath`：图集相对 manifest 目录的**安全相对路径**（无 `..`、无绝对路径、无反斜杠，
  段字符 `^[A-Za-z0-9._-]+$`），缺省 `spritesheet.webp`。
- **图集几何**：8 列 × 9 行；`cell` 缺省 192×208（上限 2048）；`columns` 缺省 8（上限 32）；
  **行序固定**：0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed /
  6 waiting / 7 running / 8 review；未用格子保持全透明。
- `frames`：每行用到的列数（9 个 1..columns 整数），缺省 hatch-pet 契约表
  `[6, 8, 8, 4, 5, 8, 6, 6, 6]`。
- `tracks`：按动画覆盖 `durations`（正数毫秒，按该行帧数**循环补足**）、`loop`、
  `fallback`；缺省全部循环，`jumping` 与 `failed` 停在末帧后回 `idle`。
- 可选 `previews/<name>.gif`（文件名 `^[A-Za-z0-9._-]+$`），经
  `/pet/<id>/previews/<name>` 提供（README 动画预览表用它）。

## 1. 美术与打包

图集制作与视觉 QA（8×9 拼图、逐行校验、QA contact sheet、pet.json 打包）走 **hatch-pet** skill
（Codex/hatch-pet 契约的生成流水线）；本技能只覆盖 dsh-web-ui 侧的接入与验证。
手工制作时按第 0 节几何逐行对齐。

## 2. 接入方式（三选一；后注册的来源在同 id 冲突时覆盖前者）

- **A. 个人自定义宠物（零代码，最常见）**：把目录放进
  `${CODEX_HOME:-~/.codex}/pets/<pet>/`（hatch-pet 流水线的输出目录），重启 `dsh web`
  即出现在「宠物」设置选择器，无需任何接线。
- **B. 贡献为内置宠物（PR）**：
  1. 新增 `packages/dsh-pet/assets/<dir>/`（dir 建议与 id 一致；dir basename 是历史 URL 别名）：
     `pet.json` + 图集 + 可选 `previews/*.gif`。
  2. 在 `packages/dsh-pet/src/registry.test.ts` 增加该 manifest 的归一化断言
     （几何/行数/轨道对齐，参照 whale-girl 的用例）。
  3. 同步更新 `packages/dsh-pet/README.md` 与 `README.zh.md`（宠物契约示例/动画预览表），
     并 `pnpm docs:write-pair` 重录配对。
  4. 重建与测试：`pnpm --filter @linxin666/dsh-pet build`、
     `pnpm --filter @linxin666/dsh-pet test`、`pnpm typecheck`；
     提交 `assets/`、重建的 `lib/` 与 README 三件套，开 PR。
- **C. 组合注入**：嵌入 dsh-pet 的应用通过 `PetConfig.pets` 传入 manifest 条目（最高优先级）——
  仅嵌入场景使用，社区接入一般走 A 或 B。

## 3. 验证

- 重启 `dsh web`（注册表在宿主启动时构建一次，改宠物后必须重启）。
- 设置页一级菜单「宠物」（`settings.section` id `pet`，order 130，直接展开）选择器出现新宠物；
  切换后右下角精灵立即更换。
- 同源 `/api/pet/pets` 返回该条目（几何、行数、tracks 齐全）；图集经
  `/pet/<id>/<spritesheetPath>` 可访问。
- 坏 manifest 不会让宿主崩溃：跳过并记录 warning（宿主日志里核对）。
- 名字/显示布局按宠物 id 独立持久化（`petId` 存于 `pet` 设置命名空间）。

## 4. 验收清单（全部满足才算完成）

- [ ] manifest 契约全部满足（id 字符集、路径安全、几何与行序、frames/tracks）
- [ ] 图集 8 列 × 9 行、未用格子全透明（或经 hatch-pet QA）
- [ ] 内置贡献：registry 测试新增断言，`build`/`test`/`typecheck` 通过，README 双语同步并重录配对
- [ ] 重启后 GUI 实测：设置页「宠物」选择器出现、切换与动画正常、`/api/pet/pets` 含该条目
- [ ] 提交信息与文案无 emoji

## 5. 常见坑

- **id 不合字符集**：manifest 被跳过（warning），选择器里不出现。
- **spritesheetPath 含 `..` 或绝对路径**：直接拒绝（路径穿越防护）。
- **忘了重启**：注册表启动时构建一次，改完宠物不重启看不到变化。
- **自定义宠物与内置同 id**：后者覆盖前者（warning），改名或换 id。
- **行序写错**：动画错位（如 idle 行放了 running 帧）；按第 0 节固定行序逐行对齐。
- **时长数组太短**：会按该行帧数循环补足——想要每帧固定节奏就给满帧数的数组。
- **frames 超过 columns**：被截断到 columns；行内帧数与时长以截断后为准。
- **未用格子不透明**：渲染时露出残影；保持全透明。
- **README 只改了一侧**：docs:check 双语配对变红。
