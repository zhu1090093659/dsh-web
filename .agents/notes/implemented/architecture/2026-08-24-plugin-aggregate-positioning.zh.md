# Agent Note: 插件聚合定位与皮肤命名

Status: implemented

## Problem

仓库此前把皮肤呈现为与插件平级的产品支柱：标语写「插件与皮肤生态」，根 README 给皮肤开了与功能插件平级的一章，加载器以「皮肤中心」为名。实际产品是一个插件聚合包——包括皮肤在内的每项能力都是一个 Cordis 插件——而创意工坊（dsh-market.com）是分发方向。平级表述误述了层级，「皮肤中心」也是以容器而非内容命名。

## Decision

产品定位为 DSH Web 的插件聚合生态包，皮肤表面统一命名为「皮肤」（skins）：

- 根 README 双语对：皮肤章从平级章节降为功能插件章的末节；标语、导言、能力表、包表与故障排查文案均改为「皮肤是皮肤插件的纯资产包，经创意工坊分发」。中文显示名为「皮肤」，英文为 skins——「皮肤中心 / Skin Center」不再作为显示名出现在根 README 对中。
- GitHub About 描述与主页（dsh-market.com）与该定位一致；AGENTS.md 与 docs/development.md 开篇陈述同一层级。
- 标识符保持冻结：npm 包 @linxin666/dsh-client-ui-skin-center、packages/skins/skin-center 目录、web-ui-skin-center bundle id 与 skin-center/wallpapers 路径保留技术名；只改展示文案。
- 创意工坊店面保留 皮肤 / 宠物 / 插件 的商品分类——那是商店的货品类目，不是产品支柱。
- 交叉链接：[产品更名](2026-08-24-product-rename-dsh-web.md) 记录了本定位所依托的 dsh-web-ui 到 dsh-web 更名。

## Alternatives considered

- 保留「插件与皮肤」平级框架：被产品决策否决；它与插件聚合包的现实和创意工坊方向矛盾。
- 连技术标识符一起改（skin-center 包名、目录、bundle id）：与产品更名的冻结理由相同——已发布 npm 名与持久化 id 移动即破坏存量安装。
- 同改动内把 GUI 设置分区的显示名也改掉：暂缓；那是皮肤包 locales 里的用户可见运行时文案，需要独立的重建与验证，作为跟进范围问题记录，不混入文档改动。

## Consequences

- 当前文档只呈现一种层级：聚合包装插件；皮肤插件拥有皮肤资产；创意工坊统一分发。
- 「skin-center」仅存于技术标识符；文档文案不得再把「Skin Center / 皮肤中心」当作产品表面名。
- 验证：pnpm docs:check 通过（标题降级后双语结构镜像完好）；GitHub About 经 gh repo view 核实。
- 跟进：把 皮肤/skins 命名落到 GUI 设置分区标题与市场店面文案，需要改皮肤包 locale、重建并重新部署 market，等待明确的范围确认。
