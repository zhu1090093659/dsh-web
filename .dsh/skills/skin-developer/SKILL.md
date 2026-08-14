---
name: skin-developer
description: Build a new skin for the dsh-web-ui skin collection (DSH Web GUI) and publish it into the skin-center plugin — scaffold with scripts/dsh-skin-new, author skin.json plus the apply/dispose + scoped-CSS contract, build and test with the official standalone bundle standard (turtle-ui shape), regenerate the skin-center registry and gallery, and submit the PR. Use when the user asks to create, add, develop, scaffold, or publish a new skin for the dsh web GUI skin collection.
whenToUse: The user wants a new skin (新建/新增/开发一个皮肤), or wants to publish/发 skin-center, or asks how skins are built and shipped in the dsh-web-ui repo. Not for switching skins (scripts/dsh-skin) or gallery-only edits.
---

# 皮肤开发者（dsh-web-ui 皮肤集合）

本技能指导在 `/Users/zcl/code/dsh-web-ui`（或任何 dsh-web-ui 克隆）里从零构建一个新皮肤，
并把它发布进 **skin-center 插件**（GUI 设置页 Skins 分区）与 gallery。每个皮肤是符合 DSH
官方插件标准（turtle-ui 式 setup）的自包含包，可被 `dsh plugin add` 安装。

## 仓库与标准速览

- `packages/skins/<name>/` — 一个皮肤 = 一个自包含插件包；`packages/skins/qq98/` 是成熟样例，遇到疑问先读它。
- 官方标准四件套（对照 DSH `docs/user/develop/basic/publish.md`，turtle-ui 为范例）：
  1. `package.json` 声明 `dsh.bundle.patch` → `cordis.patch.yml`（安装时自动插入 `ui-skin-*` dshClient 行）；
  2. `cordis.patch.yml` — bundle patch 层；
  3. `prepare` 脚本 = `tsdown`（pnpm 在 git 安装后自动运行，自包含构建 `lib/`，无项目引用、无类型检查）；
  4. devDependencies 只用真实发布版本（tsdown / lightningcss / cordis / vitest / jsdom）——
     `@deepseek-ai/dsh-*` 未发布到 npm，运行时由宿主 shell 的 module table 提供，构建时作 external。
- 构建预设：`packages/skins/tsdown.client.ts`（官方 `packages/client/tsdown.client.ts` 的 standalone 移植）。
- 仓库是 pnpm workspace：根目录 `pnpm install` 一次即可构建/测试全部皮肤。

## 0. 前置

```sh
cd <dsh-web-ui 克隆根>
pnpm install        # 首次；顺带跑每个皮肤的 prepare
```

先读 `packages/skins/qq98/` 的 `src/client/index.ts` 与 `skin.json`，理解 apply 契约与元数据契约。

## 1. 脚手架

```sh
node scripts/dsh-skin-new <kebab-case-name>   # 如 matrix、coffee-break
```

生成 `packages/skins/<name>/`：package.json（官方标准）、cordis.patch.yml、tsdown.config.ts、
tsconfig.json、skin.json（order 自动取最大值+1）、src/index.ts（无操作 host 入口）、
src/client/index.ts（最小 apply 模板）、`<name>.module.css`（作用域样式）、tests/apply.spec.ts
（契约测试）、README.md。随后按脚本打印的 next steps 填写。

## 2. 皮肤契约（硬性约束，违反会挂评审）

- **纯呈现层**：不注入服务、不发 cordis 事件、不触及模型请求（与既有皮肤一致）。
- `apply(ctx)` 只写自己会收回的东西：body 属性、注入的 chrome DOM、favicon、document.title；
  所有写面在 `ctx.effect(() => () => {...}, 'ui-skin-<name>: …')` 的 disposer 里**全部收回**
  （包括 body 属性、每个注入元素、favicon；标题仅在仍是皮肤自己的标题时才还原，不覆盖会话标题）。
- 样式全部挂在**自己的 body 属性**下：`body[data-dsh-<name>]`；暗色变体
  `body[data-dsh-<name>][data-ds-dark-theme]`。不得用裸类名/全局选择器污染其它皮肤与官方 UI。
- CSS Modules：`import css from './<name>.module.css'`，类名经 `css[name]` 取值；
  CSS 文本由 bundle 的 CSS-modules 自动注入（`<style data-plugin-css>`，loader 卸载时移除），
  皮肤不自己管理 style 标签。
- 不携带静态资源文件：内联 SVG / data URI（参考 qq98 的企鹅 favicon 写法）。
- `skin.json` 字段（gallery 与 dsh-skin 的契约）：id（=目录名）、name/nameEn、author、
  tagline、description、tags、accent、bodyAttr、package、wiring、preview 路径、order。

## 3. 构建与测试

```sh
pnpm --filter @deepseek-ai/dsh-client-ui-skin-<name> build   # 或根目录 pnpm build
pnpm --filter @deepseek-ai/dsh-client-ui-skin-<name> test    # 或根目录 pnpm test
```

- 产物：`lib/index.js`（node half）+ `lib/client.js`（bundle，`window.__ModuleLoader__.load({id, factory})`，
  导出 `apply`）。
- 测试：`tests/apply.spec.ts`（vitest + jsdom）至少断言 body 属性设置/收回、chrome 注入/收回、
  标题固定/还原。可按 qq98 的 apply.spec 扩展。
- 冒烟：bundle 结构可用 node 脚本核对（`__ModuleLoader__.load` 一次、`exports.apply` 为函数）。

## 4. 试穿与截图

```sh
open gallery/preview.html?skin=<name>&theme=light   # 真实执行 bundle 的模拟器
open gallery/preview.html?skin=<name>&theme=dark
```

- 模拟器真实执行 `lib/client.js`（shim `__ModuleLoader__` + 最小 ctx），chrome/样式真实渲染。
- 重拍并提交预览图（脚本需要 playwright chromium，已装则直接跑）：

```sh
node scripts/capture-previews    # 重写 packages/skins/<name>/preview/{light,dark}.png（提交入库）
```

## 5. 发布到皮肤中心与 gallery

```sh
node scripts/skin-center-bundles   # 扫描 packages/skins/*/skin.json + lib/client.js，重新生成
                                   # packages/skins/skin-center/src/client/generated/skins.ts（内嵌注册表）
pnpm --filter @linxin666/dsh-client-ui-skin-center build   # skin-center 重新构建以嵌入新注册表
node scripts/gallery-build         # 重新生成 gallery/manifest.js + gallery/bundles.js
```

- 若皮肤要出现在仓库 README「结构」表/「优质推荐」里，同步更新 README.md（中文）与 README.en.md（英文）。
- `dsh-skin` 的 SKINS 注册表在 `scripts/dsh-skin` 顶部——新皮肤需由维护者添加（或用
  `dsh-skin install <name>` 直接官方安装）。
- 提交全部生成产物（lib/、preview/、generated/skins.ts、gallery 产物、README），推送到
  `dsh-external/dsh-web-ui`（private）并开 PR。PR 描述附 gallery 试穿截图（亮/暗）。

## 6. 验收清单（全部满足才算完成）

- [ ] `pnpm build` 通过，`lib/client.js` 结构正确（`__ModuleLoader__.load` + `exports.apply`）
- [ ] `pnpm test` 通过（body 属性与 chrome 的 apply/dispose 契约）
- [ ] gallery 模拟器试穿真实渲染，亮/暗两态正常（`preview.html?skin=<name>&theme=light|dark`）
- [ ] `preview/{light,dark}.png` 已用 capture-previews 重拍并提交
- [ ] `scripts/skin-center-bundles` 已重跑、skin-center 已重建（新皮肤会出现在 GUI 设置页 Skins 分区）
- [ ] `scripts/gallery-build` 已重跑，gallery 产物已提交
- [ ] 纯呈现层约束未违反（无服务注入/事件/模型请求）
- [ ] 提交信息清晰，PR 附试穿截图

## 常见坑

- **别删 `dsh.bundle`/`cordis.patch.yml`/`prepare`**：这是官方安装（`dsh plugin add`）的契约。
- **别把 `@deepseek-ai/dsh-*` 写进 devDependencies**：未发布到 npm，workspace:^ 在独立环境必炸。
- **作用域外漏样式**：检查 CSS 每个规则都以 `body[data-dsh-<name>]` 开头（含暗色变体）。
- **dispose 没收干净**：对照 qq98 逐项核对——body 属性、每个 append 的节点、favicon、标题。
- **预览图过期**：改完外观必须重跑 capture-previews，否则 gallery/皮肤中心显示旧图。
- **皮肤中心不显示新皮肤**：先确认 skin-center-bundles 已重跑 + skin-center 已重建（注册表内嵌在 bundle 里）。
