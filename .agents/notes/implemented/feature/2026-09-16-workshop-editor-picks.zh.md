# Agent Note: 创意工坊「编辑推荐」类别

Status: implemented

## Problem

创意工坊商店卡（`packages/dsh-market`）把目录呈现为四个互斥的类别页签——皮肤 / 宠物 / 插件 / 预设。用户能看到的一切，要么是完整目录，要么是完整目录经搜索与筛选后的缩减，因此缺少一个跨类别、只点名一小份固定推荐内容的编辑式界面。负责人要求在商店卡中引入「编辑推荐」类别：它只展示一份策划好的皮肤、宠物与社区插件清单，初版内容取负责人本机当前启用的皮肤与宠物，以及从创意工坊安装的社区插件。该类别需要在创意工坊的两个界面都提供：GUI 商店卡与 dsh-market.com 导航。

## Decision

商店卡新增一个位于最前的「编辑推荐」页签，其数据来自新发布的清单。

- 唯一来源：`market/editor-picks.json`——手工维护、带顺序的 `{ kind, id }` 引用列表，只允许 `skin` / `pet` / `plugin`；预设刻意排除在外。
- `scripts/market-build` 读取该文件，校验每条引用都能在自己刚扫描出的目录中解析、且没有重复，然后按与其他清单相同的 `{ generated, items }` 形状产出 `market/dist/manifest/editor-picks.json`。指向不存在资产的条目会让构建失败，而不是悄悄让该类别变空。
- 卡片在拉取各目录清单的同时拉取 `manifest/editor-picks.json`。该请求是非致命的：较旧的部署只是让该页签显示 `picks.empty` 文案，而不会让整个目录加载失败。每条引用都会对照已加载的目录解析，保持清单顺序；重复、类别不受支持或解析不到的引用会被丢弃。
- 该页签渲染混合类别：没有搜索框，也没有一级/二级分类筛选行；每张卡片保留其所属类别自身的能力（皮肤与宠物的一键安装与预览链接、插件的复制安装命令与一键安装、点赞、源码仓库链接）。按类别渲染本就是条目驱动的，因此本次把卡片的渲染路径从「当前页签的类别」改为「条目自身的类别」，并把卡片 key 从 `id` 改为 `kind:id`。
- 页签计数显示解析成功后的条数，因此引用全部落空的部署读作空，而不是目录规模。

- dsh-market.com 用同一份清单渲染同一类别：`market/src/index.html` 新增位于最前的 `data-kind="picks"` 导航按钮，`market/src/app.js` 把 `manifest/editor-picks.json` 解析成真实的目录条目，因此既有的卡片、详情弹层、点赞与 `#kind:id` 深链对推荐条目直接可用，不需要第二套渲染路径。该分区保持清单固定顺序（排序下拉被禁用）、不显示筛选胶囊行，页头搜索只在推荐集合内部收窄——因此它永远不会展示清单之外的任何内容。

初版内容：皮肤 `orca-link`（负责人当前启用的皮肤）、宠物 `jyn`（当前启用的宠物），以及负责人运行中 profile 里已从工坊目录安装的四个社区插件——`dsh-annotation`、`dsh-chatgpt-subscription`、`dsh-free-search`、`dsh-llm-verifier`。

卡片字典新增 `tab.picks` 与 `picks.empty` 两个键（zh 为 key 源，en 完整对照），并同步镜像进 `dsh-i18n` 的集中式 ru 语言包。

## Alternatives considered

- 把固定清单内置进客户端 bundle：不取。它会背离其他所有目录共用的「单一事实源」模型，并把一次编辑改动变成一次插件发版。
- 运行时从本机状态推导该类别（当前皮肤、当前宠物、已安装插件）：不取。编辑推荐是所有用户看到的编辑式选择，而不是「你碰巧装了什么」的个人视图；负责人的本机状态只是初版清单的来源。
- 允许预设进入该类别：不取。需求范围是皮肤、插件与宠物，且预设已有专属页签与贡献槽位（`dsh-workshop.panel`）。
- 只做商店卡、不动 dsh-market.com 导航：不取。负责人同时要求站点导航；由于解析出的条目保留真实目录类别，站点直接复用既有的按类别渲染，无需并行实现一份。
- 让「编辑推荐」页签像目录页签一样带搜索与筛选：不取。该类别按定义就是固定的，允许浏览会与「只固定展示」相矛盾。

## Consequences

- 卡片页签变为 编辑推荐 / 皮肤 / 宠物 / 插件 / 预设；默认页签仍是皮肤，因此清单为空或不可达时不会成为落地状态。
- `market/editor-picks.json` 由此成为需要维护的仓库输入：每条引用都必须持续在目录中解析成功，否则 `scripts/market-build`（也就是 `market:check` 门禁）会失败。
- GUI 卡片从已部署的 dsh-market.com 读取清单，因此在 `market/dist` 部署之前，该页签显示空状态；这与插件二级分类清单已记录的部署顺序限制相同。
- 站点导航把 编辑推荐 排在 探索 之前；探索 仍是落地视图，继续聚合四类作品。
- 推荐条目是引用而非副本：卡片始终渲染目录记录（名称、作者、描述、版本、仓库、预览图），因此编辑顺序与目录元数据不会产生漂移。

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-market typecheck` 与 `test`：82 个 vitest 用例通过，其中三个新增 MarketCard 用例覆盖固定混合顺序（无搜索框与筛选行）、重复 / 类别不受支持 / 解析不到的引用被丢弃，以及空状态。
- `node scripts/market-build` 产出 `manifest/editor-picks.json`；`node --test scripts/market-layout.test.mjs scripts/market-build-clean.test.mjs` 16/16 通过，其中两个新增的干净检出拒绝用例（引用不存在的资产、类别不在 skin / pet / plugin 之内），以及一条断言提交的清单与手写清单顺序一致的结构用例。
- 重建后的 `market/dist` 由本地静态服务器托管并在无头 Chrome 中实测：导航为 编辑推荐 / 探索 / 皮肤 / 宠物 / 插件 / 预设，分区标题显示 6 件作品，六张卡片按清单顺序渲染（虎鲸链路、女仆鲸鱼娘、选中批注、子代理管理、免费搜索、LLM 裁判复核），排序下拉禁用、筛选胶囊行为空，输入「鲸」把固定集合收窄到 2 条。
- `node --test scripts/market-layout.test.mjs` 同时固定站点契约：`data-kind="picks"` 导航按钮、`picks: '编辑推荐'` 标签、`manifest/editor-picks.json` 拉取与解析函数。
- `pnpm docs:check` 与 `pnpm i18n:check`（1407 个 zh 键在 ru 中完整镜像）。
