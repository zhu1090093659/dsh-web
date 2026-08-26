# Agent Note：frames2d 渲染器与玩法契约（dsh-pet，miku 泛化）

Status: implemented

## Problem

新社区宠物与皮肤一直需要新插件包或插件发版：miku 宠物以独立包分发（dsh-miku-pet），后续每只宠物都会重复这种形态（见 [Re-add dsh-miku-pet](../feature/2026-08-25-readd-dsh-miku-pet.md)）。既定设计否定了这条路：新东西（宠物、皮肤、插件）都应经创意工坊分发，miku 的能力应作为宠物插件中的通用子系统，而不是并行插件。

## Decision

dsh-pet 的两项契约扩展 + 工坊优先分发路径：

- frames2d 渲染器：目录式帧序列（`thumb/<track>/<frame>.webp`），帧时长取 frameMs 列表 > 文件名 `_<ms>` 尾缀 > defaultFrameMs 200；`idle` 必填的相位映射、非循环轨道 fallback 链、拖拽轨道，以及按帧序自然排序（eat10 在 eat9 后）。上限：64 轨道 / 64 帧 / 16–5000ms。
- gameplay 块（仅 frames2d，子块全可选，fail-closed）：属性衰减条（含打工中与空闲变体）、命名货币、加权 idleDirector 与 maxMiss、hitBox 内触摸分区（概率分支：效果 + 轨道保持 + 台词气泡）、宿主裁决的打工循环与结果保持、睡觉循环惰性恢复、被动收入，以及带效果 / 货币兑换 / 分档抽奖的商店。所有掷骰宿主权威（`POST /api/pet/gameplay/touch|mode|work-tick|buy`）；状态按宠物持久化，沿用小鱼干经济惰性结算纪律。客户端为声明该块的宠物自动渲染玩法菜单卡（属性条、打工/睡觉、商店网格、钱包）。
- 工坊优先分发：`packages/dsh-pet/assets/<id>` 是市场源；npm files 白名单保持仅内置（miku 排除）；`scripts/market-build` 增加 frames2d 扫描路径（不要求 spritesheet；卡片走 previews，安装按 files 全量下载）；market/dist 已重建。deploy-market.yml 监听 dev 推送，新宠物无需发版即上线工坊。
- miku 成为参考实现：资产与原始玩法常量（衰减率、闲置权重、触摸概率与台词、打工/睡觉/商店/抽奖）转录进 `assets/miku`；Piapro 边界与贡献者署名迁入 THIRD_PARTY_NOTICES.md；dsh-miku-pet 包从工作区、aggregate（已重生成）与 sync-shared 表中移除。该包从未发过 npm，无需弃用流程。

## Alternatives considered

- 继续为 miku 另开插件：既定设计否决；通用子系统让后续宠物只需 manifest。
- 图集式 frames2d（复用 sprite2d）：否决；目录契约让 miku 原资产逐字节不动，社区作者也无需图集工具。
- 客户端权威玩法：否决；宿主结算与持久化保证离线衰减与多视图一致，与抚摸/小鱼干纪律一致。

## Consequences

今后任何宠物 = 一个资产目录 + 一份 manifest（契约 + 玩法），下一次 dev 推送即进工坊；dsh-web-pet-developer skill 已记录两项扩展与工坊路径。dsh-miku-pet 包已移除（aggregate 18 行 / 17 依赖；sync-shared 96 项 / 44 host 副本）；移除与重加两条记保留为历史。玩法设计记（design note）被本实现契约部分取代（上方交叉链接）。