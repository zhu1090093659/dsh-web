---
name: skin-developer
description: Build a new skin for the dsh-web-ui skin collection (DSH Web GUI) and publish it into the Skin Center — the first-level settings section — scaffold with scripts/dsh-skin-new, author the v2 skin.json manifest plus skin.css token remap (pure asset directory, no package.json, no build step), validate with scripts/dsh-skin, regenerate the gallery, and submit the PR. Use when the user asks to create, add, develop, scaffold, or publish a new skin for the dsh web GUI skin collection.
whenToUse: The user wants a new skin (新建/新增/开发一个皮肤), or wants to publish/发 skin-center, or asks how skins are built and shipped in the dsh-web-ui repo. Not for the act of applying a skin (scripts/dsh-skin use) or gallery-only edits.
---

# 皮肤开发者（dsh-web-ui 皮肤集合）

本技能指导在 dsh-web-ui 克隆里从零构建一个新皮肤，并把它发布进**皮肤中心**（GUI 设置页一级菜单）
与 gallery。v2 架构（issue #506）：皮肤是纯资产目录，skin-center 包是唯一加载器，皮肤不再是
独立插件包、不参与构建。

## 仓库与标准速览

- `packages/skins/skin-center/skins/<name>/` — 一个皮肤 = 一个纯资产目录；
  `mint/` 是官方锚定的最小范例（纯 token、零补丁零脚本），遇到疑问先读它。
- 目录构成：`skin.json`（v2 清单，契约见
  `packages/skins/skin-center/contracts/skin-manifest-v2.schema.json`）+ `skin.css`（token 重映射）
  + 可选 `patches.css`（L3 自由选择器补丁，高敏感）/ `hooks.mjs`（逃生舱 JS，高敏感，需同评审同发布）
  / `assets/`（背景等媒体）/ `preview/`（画廊截图）/ 双语 README。
- **没有** package.json / tsdown / tsconfig / 测试工程：资产不构建。scripts/skin-asset-dirs.test.mjs
  守卫这一形态（资产目录里出现 package.json 即红）。
- 加载器纪律：skin-center 在提供样式时把每条选择器强制作用域到 `html[data-dsh-skin="<id>"]`，
  作者按官方 shell 的写法写 `:root` / `body[data-ds-dark-theme]` 即可；安全管线
  （transformSkinCss）在门禁（pnpm skin-center:check）与服务时都会跑。

## 0. 前置

```sh
cd <dsh-web-ui 克隆根>
pnpm install
```

先读 `packages/skins/skin-center/skins/mint/` 的 `skin.css` 与 `skin.json`，理解 token 契约与元数据契约。

## 1. 脚手架

```sh
node scripts/dsh-skin-new <kebab-case-name>   # 如 matrix、coffee-break
```

生成 `packages/skins/skin-center/skins/<name>/`：skin.json（v2，order 自动取最大值+1）、
skin.css（:root 亮色 + body[data-ds-dark-theme] 暗色双套 --dsw-alias-* 占位）、preview/README.md
（截图占位说明）、README.md + README.zh.md（双语 stub）。随后按脚本打印的 next steps 填写。

## 2. 皮肤契约（硬性约束，违反会挂评审）

- **纯呈现层**：不注入服务、不发 cordis 事件、不触及模型请求。
- **token 优先**：亮色值写 `:root`，暗色值写 `body[data-ds-dark-theme]`（官方暗色属性在 body 上）；
  只重映射官方 `--dsw-alias-*` 语义 token（L1），mint 是可复制的全集样例。插件侧按
  `packages/skins/skin-center/contracts/semantic-attrs-v1.md` 输出 `data-dsh-plugin` /
  `data-dsh-part` 语义属性（L2），patches.css 里按这些锚点写补丁比裸选择器稳。
- **patches.css 是高敏感逃生舱**：自由选择器补丁会在 UI 与 gallery 披露；能 token 解决就不写补丁。
- **hooks.mjs 是受信逃生舱**：与 skin-center 同评审同发布的 JS（`facets.client` 声明
  `entry` + `apiVersion`，hooks 运行时契约与 skinManifestVersion 相互独立）；社区皮肤默认不含 hooks。
- 媒体资产放 `assets/` 并在 `contributes.backgroundMedia` 声明（亮/暗各一层：type image|video、
  src、可选 scrim）；用户手动背景与壁纸引擎优先于它。
- `skin.json` 必填字段：`skinManifestVersion`=2、`id`（=目录名，`^[a-z][a-z0-9-]{0,31}$`）、
  `name`/`nameEn`、`version`（semver）、`author`、`contributes.stylesheet`（相对路径，无前导
  斜杠、无 `..`、无协议 URL）。可选：tagline/description/tags/accent（#rrggbb）/order/
  `preview`（{light,dark} 两张截图路径）/license/licenseUrl/noticeUrl/sourceUrl/attribution
  （第三方素材必须给 license 字段）、`contributes.patches`、`requires.contracts`
  （SkinRuntime/SkinHooks 契约声明，可选）。v1 字段（bodyAttr/package/wiring）已废弃，
  写了只会收到迁移警告。

## 3. 校验

```sh
node scripts/dsh-skin validate packages/skins/skin-center/skins/<name>   # v2 契约校验
pnpm skin-center:check                                                 # 全量目录门禁（含样式安全管线）
```

## 4. 试穿与截图

```sh
node scripts/gallery-build                              # 注册进 gallery/manifest.js + styles.js
open 'gallery/preview.html?skin=<name>&theme=light'     # 静态注入 skin.css 的模拟器（不执行 hooks）
open 'gallery/preview.html?skin=<name>&theme=dark'
node scripts/capture-previews <name>                    # 重拍 preview/{light,dark}.png（可列多个皮肤名过滤）
```

- 模拟器把 skin.css（+patches.css）静态注入官方 facade 快照；hooks.mjs 不执行、backgroundMedia 不渲染。
- 截图需要 playwright + chromium；preview/README.md 占位在拍完照后删除。

## 5. 发布到皮肤中心与 gallery

- 皮肤中心的目录就是注册表：资产目录进了 `skins/` 即被加载，无需再生成注册表。
- 用户级安装/切换走 `scripts/dsh-skin`：`dsh-skin install <dir>` 复制进 `$DSH_HOME/skins/<id>/`
  （--force 覆盖；hooks 皮肤需 --allow-hooks 且只跑其声明部分）、`dsh-skin use <id>` /
  `dsh-skin use official` 选择、`dsh-skin list` / `dsh-skin current` 查看、`dsh-skin uninstall <id>`
  卸载（内置皮肤拒绝）。切换是客户端原子交换，下次页面加载生效（tapIndex adapter）。
- gallery：`node scripts/gallery-build` 重新生成 `gallery/manifest.js`（window.SKIN_MANIFEST）
  + `gallery/styles.js`（window.SKIN_STYLES）并提交；CI 的 `pnpm gallery:check` 校验产物新鲜度。
- 若皮肤要出现在仓库 README 的推荐位，同步更新 README.md（中文）与 README.en.md（英文）。
- 提交全部产物（preview/、gallery 产物、README），开 PR；PR 描述附 gallery 试穿截图（亮/暗）。

## 6. 验收清单（全部满足才算完成）

- [ ] `node scripts/dsh-skin validate` 通过，`pnpm skin-center:check` 通过
- [ ] gallery 模拟器亮/暗两态渲染正常（`preview.html?skin=<name>&theme=light|dark`）
- [ ] `preview/{light,dark}.png` 已用 capture-previews 重拍并提交
- [ ] `scripts/gallery-build` 已重跑，gallery 产物已提交，`pnpm gallery:check` 通过
- [ ] 纯呈现层约束未违反（无服务注入/事件/模型请求）
- [ ] README 双语、第三方素材的 license/licenseUrl/attribution 齐全
- [ ] 提交信息清晰，PR 附试穿截图

## 常见坑

- **别在资产目录里放 package.json / 构建文件**：皮肤不是包，skin-asset-dirs 测试会红。
- **暗色没写**：`body[data-ds-dark-theme]` 一套值是必须的，缺了暗色模式直接用亮色 token。
- **自由选择器泄露**：patches.css 每条规则都会被作用域化并披露，能 token 解决就别写补丁。
- **hooks 未与 skin-center 同评审**：hooks.mjs 是受信代码，直接提交会挂评审。
- **预览图过期**：改完外观必须重跑 capture-previews，否则 gallery/皮肤中心显示旧图。
- **一级菜单「皮肤中心」不显示新皮肤**：确认资产目录在 `skins/` 下（目录即注册表），再刷新页面。
