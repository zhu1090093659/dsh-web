# Agent Note: 移除 dsh-aionui-panel

Status: implemented

完成包文档里自 provider 选择删除后就已记录的退役：面板列早已不再挂载，[dsh-perf 渲染管线第二批](../feature/2026-08-26-dsh-perf-render-pipeline-batch2.zh.md) 也早已把 dsh-better-sidebar 当作右侧面板的归属者。

## 问题

aionui 右侧面板分两步退役，但包本身一直在发货：聚合包仍在拉取它，其浏览器半区还背着三个活表面——composer 拖文件插入路径、聊天区 mermaid 哨兵、「侧边卡片」设置卡（内嵌编辑 dsh-better-sidebar 偏好的编辑器，含位置兼容模式开关）。「已弃用但仍挂载」让这个包留在每一份安装、锁文件和文档里；而内嵌的侧边卡片编辑器伸手进了另一个插件的设置传输层——面板死后成了一个没有归属者的跨插件表面。

## 决策

dsh-aionui-panel 包被彻底移除：包目录、dsh-web-all 聚合清单里的 `patchFrom` 与 `deps` 条目（含重新生成的产物）、生成器「保留未知依赖」规则本会留下的陈旧 workspace 依赖、publish-prep 行、以及全部 README 引用。packages/AGENTS.md 的测试例外改写为移除事实。右侧面板仍只属于 dsh-better-sidebar；其偏好在该插件自身的设置区管理。三个残留行为随包消失：聊天区 mermaid 渲染（官方管线没有 mermaid 渲染器——这是已知损失）、composer 拖文件插入路径、内嵌侧边卡片偏好编辑器。

## 考虑过的替代方案

- 先把 MermaidChatEnhancer 抢救进存活包：本轮暂缓，非必需——若聊天区 mermaid 出图被怀念，应把它移植进一个小的专用插件，而不是复活一个已弃用的载具。
- 仅从聚合包摘除（原记录的「后续版本从全家桶移除」）：本轮否决——保留一个已弃用、默认关闭、仍可安装的包，等于留下跨插件设置表面和这次移除要终结的文档债。

## 影响

所有安装失去聊天区 mermaid 渲染与 composer 拖文件插入路径；dsh-better-sidebar 的偏好（含位置兼容模式开关）只能在其自身设置区编辑。生成器的「保留未知依赖」行为意味着：今后移除包时必须手工删除生成 package.json 里的陈旧依赖行——只重跑聚合生成器不会删掉它。

## 测试

`node scripts/aggregate.mjs` 重新生成 patch（18 行）与 package.json（16 依赖），`--check` 通过；`pnpm install` 从 pnpm-lock.yaml 剪掉 workspace importer（158 行）；`pnpm docs:check` 通过，web-all README 配对哈希已重录；删除及后续清理（web-settings allowlist 条目与规格、remote-web-ui 注释示例与 update 规格夹具、经 sync-shared 的 poll-guard 消费者示例）之后全仓 `pnpm typecheck` 与 `pnpm test` 通过。残留的 aionui 字样均为有意保留：本笔记的交叉链接、README 墓碑与 AGENTS.md 移除行、aggregate.yml 移除注释、冻结的 archive 与 release notes、以及皮肤里不生效的 `.aionui-*` CSS 选择器。
