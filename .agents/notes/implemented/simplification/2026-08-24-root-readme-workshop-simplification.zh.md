# Agent Note: 精简根 README 并将资产发现归于创意工坊

Status: implemented

## Problem

根 README 同时展开了多款皮肤、宠物截图与梁神模式说明，导致入口文档承担了本应由创意工坊和各自插件 README 承担的目录与功能细节；README 的皮肤展示也没有突出随包提供的经典 Blue Fantasy。

## Decision

根 README 的中英文版本只保留 Blue Fantasy 的一张暗色截图与简短说明，并将其他皮肤、Wallpaper Engine 壁纸和鲸鱼娘宠物资产的目录、预览与来源统一指向创意工坊。README 不再展示或说明梁神模式；安装命令、npm 清单和许可证归属表也不再把该模式作为本聚合 README 的功能条目。宠物与皮肤仍在创意工坊中保持独立分类，避免将鲸鱼娘宠物误写成皮肤。

## Alternatives considered

- 保留所有皮肤截图并只删除拼图：不取，因为 issue 反馈的是皮肤图片与逐项说明整体过多，逐个展示仍会让 README 充当目录页。

- 删除全部皮肤视觉内容：不取，因为 Blue Fantasy 是随包提供的经典默认皮肤，保留一张截图能说明开箱即用的默认外观。

- 把鲸鱼娘宠物并入皮肤章节：不取，因为宠物是独立的创意工坊资产类型，和皮肤的安装目录、运行时注册表不同。

- 在 README 中保留梁神模式的简短链接：不取，因为本次范围明确要求移除梁神模式的展示和说明；该插件仍可通过自身包契约独立维护。

## Consequences

- README 更短，完整的皮肤、宠物预览和源码入口由 dsh-market.com 统一承载。
- Blue Fantasy 仍是根 README 中唯一展示的皮肤，且继续由皮肤中心包随包提供；其他皮肤按需从创意工坊安装。
- 根 README 仍由中英文手工配对维护，不属于 packages/docs 三件套门禁，因此提交前必须人工核对两侧的标题、表格、链接与图片。
- 皮肤图片资源与现有生成器保持不变，避免把文档简化误解为删除皮肤或市场资产。
- 被 [根 README SEO 优化与特色功能章节](../../archived/process/2026-08-25-root-readme-seo-feature-sections.zh.md) 部分取代：梁神模式已回归根 README（功能章节、安装命令、npm 清单行与许可证行）；皮肤与宠物的目录精简仍然有效。
- 进一步被 [根 README 的功能收敛与 DSH Desktop 章节](../process/2026-09-10-root-readme-feature-focus-and-desktop.zh.md) 部分取代：重新组装的梁神模式展示已随救助模式与外部归档管理章节一并移除；皮肤与宠物的目录精简仍然有效。

## Testing

本次只修改根 README.md 与 README.en.md；通过全文检索确认梁神模式、逐项皮肤展示与多余皮肤截图引用已移除，并保留 Blue Fantasy 截图及创意工坊链接。