# Agent Note: 市场界面上的预设分类

Status: implemented

## Problem

社区插件带 `category` 与可选的二级 `subcategory`，两个市场界面都把它们渲染成筛选胶囊：创意工坊卡片过滤自己的网格，dsh-market.com 渲染一行一级胶囊并在其下渲染二级行。预设此前完全没有分类。预设 manifest 只带 id、name、rank、files 与市场元数据，因此商店列表无法区分角色扮演预设与将来的编码预设；而目录里一装上 32 个角色扮演条目，首批就会以一份无差别的列表发布。`scripts/market-build` 也没有可供校验预设目录条目的词表，写错分类可以一路进到 manifest。

## Decision

预设目录条目从预设专用词表取 `category`，两个市场界面都在插件分类胶囊所在的位置把它渲染为筛选胶囊。

### 词表

- 规范词表位于 `scripts/market-build` 的 `PRESET_CATEGORIES`（目前为 `roleplay`），并由创意工坊卡片的 `PRESET_CATEGORY_IDS` 与 `market/src/app.js` 的 `CAT_LABEL` 镜像——与插件词表既有的三处镜像（`scripts/community-index`、`packages/dsh-market/src/client/categories.ts`、站点）同一模式。
- manifest 始终带 `category`；省略该字段的条目落入 `other`，与插件路径一致。`market-build` 拒绝其它未知取值，因此写错分类会让构建失败，而不是发布一个无法被筛选到的预设。
- 暂不设二级：`PRESET_SUBCATEGORY_IDS` 把 `roleplay` 映射为空列表，于是卡片只渲染一行筛选、站点隐藏二级行。将来加二级只需词表条目加目录数据，两个界面都无需改代码。

### 界面

- **创意工坊卡片**（`MarketCard.tsx`）：筛选行按当前标签页泛化。`facetKind` 选定当前可见的目录类别，`facetItems` 是其条目，`facetVocab` 是其标签与二级映射；插件页与预设页因此共用一套实现。交给贡献面板的预设条目经过与插件网格相同的 `byCategory`/`bySubcategory` 过滤，面板无需知道分类的存在即可渲染筛选后的集合。
- **市场站**（`market/src/app.js`）：`renderCatFilter` 读取当前 kind 的条目而不是固定读插件，并在所选分类没有二级条目时隐藏二级行——这正是预设页保持单行的原因。
- **文案**：`category.roleplay`（角色扮演 / Roleplay）声明在市场包的中英文字典中，并镜像进 `dsh-i18n` 的俄语市场字典，使 `pnpm i18n:check` 继续作为一致性门禁。

## Alternatives considered

**预设复用插件的分类词表。** 否决：插件分类描述的是实现面（ui、tools、integration），预设分类描述的是用途。共用词表会迫使角色扮演塞进某个插件桶，并让两套词表被迫同步漂移。

**从既有的 `tags` 推导预设分类。** 否决：标签是自由文本，且已经承载 `modern`/`fantasy`/`historical` 这类面向词；驱动商店筛选的分类需要闭集与构建期校验，而标签刻意不具备这两点。

**把筛选做在预设面板内部而不是卡片里。** 否决：面板是接收条目的贡献槽位，而卡片已经为插件拥有标签页级别的筛选状态与词表。放在卡片里只保留一套筛选实现与一条复位规则（切换标签页清空两级）。

**现在就上二级（把 32 个角色拆成现实/幻想/历史）。** 否决的理由与插件词表是闭集相同：层级应当在内容需要它时出现。主题拆分已经记在每个条目的 `tags` 里，将来提升为二级只是词表条目加数据。

## Consequences

- 预设页显示一行分类（全部 / 角色扮演）并带计数，插件页保持两行。两者由同一份代码渲染，因此将来新增预设分类不需要改界面。
- `market-build` 现在会因未知的预设分类而失败，这是目录编辑新增的一种构建失败方式——这是刻意的，否则发布出去的预设无法被任何筛选触达。
- 站点的分类胶囊按实际存在的条目生成，没有条目的分类不会出现；卡片通过 `categoryCounts` 表现一致。
- 预设仍无二级词表，因此 manifest、卡片与站点在单层上一致；加了二级之后，除了镜像列表本身，没有机制保证三者继续一致。
- 插件页的二级行现在会在所选分类没有二级条目时隐藏（此前对无二级的插件分类会渲染一行空的「全部 0」）。这是插件路径上的小行为变化，由既有卡片测试覆盖。

## Testing

- `packages/dsh-market` 覆盖新路径：预设页渲染 全部 / 角色扮演 / 其他 胶囊、过滤交给贡献面板的条目（含未分类桶）、不渲染二级行、切换标签页复位筛选；分类标签测试断言每个预设分类 id 都有中英文标签。
- `scripts/market-layout.test.mjs` 断言 `presets.json` 每个条目都带非空 `category`，且构建出的站点带有预设分类标签。
- `pnpm market:check` 以 check 模式对已提交的 `market/dist` 重跑 `market-build`，因此重新生成的 `manifest/presets.json` 与 `app.js` 就是被审查的交付物。
