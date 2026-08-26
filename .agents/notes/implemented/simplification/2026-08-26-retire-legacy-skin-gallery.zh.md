# Agent Note：退役旧版皮肤画廊

状态：implemented（已实现）

## 问题

原始 dsh-web 皮肤画廊——`gallery/` 静态站（首页、静态试穿模拟器 `preview.html`、`manifest.js`/`styles.js`/`official-facade.js` 资产）及其 `scripts/gallery-build` 构建管线——已被 dsh-market.com 创意工坊取代。市场拥有商店前台、试穿模拟器（`market/src/preview.html`、内置 `market/shell` 试穿 shell）与皮肤按需安装；画廊等于多维护一套静态渲染器与一套资产注册表，靠 `gallery:check`/发版门禁维系，并被文档、技能、PR 审核工具与脚手架大量引用。它的域名只以 301 重定向（`gallery.dsh-market.com`）形式存活——由 `scripts/deploy-market` 每次市场部署时重建——旧 Cloudflare Pages 项目（`dsh-market-gallery`）仍在账号侧存在。

## 决策

- 整体删除画廊面：`gallery/`（index.html、manifest.js、styles.js、official-facade.js、preview.html、_headers）、`scripts/gallery-build`、`scripts/gallery-headers.test.mjs`、`scripts/gallery-layout.test.mjs`，以及 `gallery:check` / `gallery:build` / `gallery:capture` npm 脚本；从 `ci.yml`、`release.yml`、`deploy-market.yml` 与文档、技能、PR 模板中移除 gallery 步骤与门禁条目。
- 迁移幸存的共享产物：`official-facade.js` 改由 `scripts/export-official-facade` 生成到 `market/src/official-facade.js`，并由 `scripts/market-build` 复制进 `market/dist`（唯一消费方）。`scripts/market-build-clean.test.mjs` 的 fixture 跟随新位置。
- 预览工具改指向市场：`scripts/capture-previews` 渲染 `market/dist/preview.html` 并从 `market/dist/manifest.js` 取清单（本就是同一模拟器、同一皮肤预览契约）；`scripts/skins-montage.mjs` 改读市场清单生成 README 一览图。
- 移除 gallery 301 维护：`scripts/deploy-market` 不再创建或更新 `gallery.dsh-market.com` 重定向规则集（`--skip-redirect` / `--redirect-only` 一并删除；脚本只剩 D1 + worker 部署）。
- Cloudflare 侧清理（Pages 项目 `dsh-market-gallery`、`gallery.dsh-market.com` DNS 记录、zone 301 规则集）属于账号侧，仓库代码不再维护；由维护者在控制台删除。
- `scripts/pr-review.mjs` 删除画廊页截图与 gallery 注册适配检查；皮肤 PR 检查改为 `checkSkinPreviews`（新皮肤必须提交 `preview/{light,dark}.jpg`），并修复预览图复制路径为 `packages/skins/skin-center/skins/<id>/preview/<mode>.jpg`（原指向迁移前的旧路径且扩展名已过期）。
- 皮肤 README 双语与皮肤开发者技能改为指引 `pnpm market:build` + `open market/dist/preview.html?...`；改动过的皮肤均已 `docs:write-pair` 重新记录配对。

## 备选方案

- 保留画廊作为模拟器源、只停部署：否决——市场模拟器与画廊是同一个渲染器、同一份 v2 皮肤资产，每次皮肤改动本就重新生成 `market/dist`；第二套渲染器加资产注册表是纯重复维护，正是画廊一致性门禁在每个皮肤 PR 上反复拉闸的原因。
- 只退站点、继续发布重定向规则：否决——域名要整体退役；301 正是让旧主机与域名继续存续的东西，从 `deploy-market` 里拿掉它，控制台侧的删除才算完整。
- 把 `gallery/preview.html` 与 facade 一并搬进 `market/src/` 并保留画廊自己的页面生成器：否决——`market/src/preview.html` 就是模拟器的家（正是从画廊页演化而来），只需给 facade 文件换个家；画廊的首页/manifest/styles 复制品没有任何独有价值。

## 后果

- 新皮肤接入：`pnpm market:build` 重新生成 `market/dist`（注册表 + 样式 + 打包），`pnpm market:check` 成为商店唯一的一致性门禁；`skin-center:check` 继续校验 v2 目录契约，`community:check` 校验社区插件索引。
- `capture-previews` 现在依赖新鲜的 `market/dist`（已提交产物按 `market:check` 恒为最新），并按站点根相对路径读取市场清单。
- 发布准备与发版门禁清单去掉 `gallery:check`；版本 bump 后重建 `market/dist` 而非画廊资产。
- 剩余文本中的 "gallery" 只存在于冻结历史（`docs/archive/`、`docs/release-notes/`、早期 Agent Note）、官方 GUI facade 快照（外部导出）与 `market/shell` 供应商构建产物中；它们不是仓库拥有的画廊基础设施。

## 测试

- `scripts/market-build` 重新生成 `market/dist`（1138 个文件），`market:check` 在构建与 `--check` 模式下均报 "dist up to date"（把 shell dist 移开以复用已提交的 tryon hash 清单，与 CI 行为一致）。
- `pnpm test:scripts`（209 个测试）、`pnpm docs:check`、`scripts/pr-review.test.mjs`（38 个测试，含被替换的 gallery 适配测试）全部通过。
- `scripts/deploy-market` 与 `scripts/pr-review.mjs` 通过 `node --check`。
