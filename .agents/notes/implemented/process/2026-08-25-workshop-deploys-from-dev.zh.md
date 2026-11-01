# Agent Note：创意工坊改为 dev 推送即部署，与发版节奏解耦

状态：implemented（已实现）

## 问题

创意工坊（dsh-market.com）的可见性与 npm 发版节奏耦合：deploy-market.yml 仅在 push 到 main 时触发，而 main 只通过维护者集成在发版时接收 dev 内容。新皮肤、内置宠物的市场镜像或社区插件索引条目合并进 dev 后（按 market:check 要求已提交再生成的 market/dist），要等发版集成才能在商店出现，只能手动部署或等待数日。触发场景：OUO Neko 宠物（PR #1118）合入 dev 时其市场条目已进入 market/dist/manifest/pets.json（generated 2026-08-25），而线上仍在服务 2026-08-24 的清单。

## 决策

- deploy-market.yml 的 push 触发分支从 main 改为 dev。paths 过滤的职责不变，现在盯的是卫星仓 pin：market/**、satellites/**、market-inputs.lock.json、scripts/market-build、scripts/market-fetch-inputs.mjs、scripts/market-verify-assets.mjs、scripts/deploy-market、scripts/market-layout.test.mjs、package.json 及工作流文件本身。家族拆分前它盯的仓内内容路径（packages/skins/**、packages/dsh-pet/**、packages/dsh-community-plugins/**）随内容一起搬走了；pin 的机制由[卫星仓 note](../architecture/2026-09-23-family-satellite-repositories.zh.md) 拥有。
- 移除 main 触发而非双分支并存：main 只通过维护者集成接收 dev 内容，main 推送会用较旧或相同的 dist 再部署一次，对更新的 dev 部署形成回滚窗口。workflow_dispatch 保留为手动兜底。
- 工作流内部门禁不变：`cf deploy` 前先跑 market:check、community:check、test:scripts；只部署已提交的 market/dist 产物（不在 CI 重建），与 gallery 纪律一致。

## 备选方案

- dev + main 双触发：否决，main 集成推送可能瞬间用较旧 dist 覆盖更新的 dev 部署。
- 纯手动部署（workflow_dispatch 或本地 scripts/deploy-market）：否决，每次接入皮肤/宠物/插件都留一个人工环节，正是本次要消除的耦合。
- 在部署工作流内重建 market/dist：否决（长期纪律），构建机路径与不确定性不得进入部署产物；market:check 已 fail-closed 校验提交的 dist。

## 影响

新皮肤、宠物市场条目或社区插件索引行合并进 dev 且命中路径过滤后，创意工坊自动部署上架；商店条目运行时安装进用户目录（$DSH_HOME/skins/<id>、$DSH_HOME/pets/<id>），上架不再需要 npm 发版。npm 包内的内置内容（如 dsh-pet 捆绑注册表）仍走发版流程。OUO Neko 市场条目在下一次触及市场路径的 dev 推送时上线，或可经 workflow_dispatch 立即上线。同一轮用户决策还包含关联改造：dsh-pet 扩展 frames2d 渲染器、dsh-miku-pet 改造为创意工坊宠物——该工作单独记 feature note。验证：2026-09-26 的维护轮把四套皮肤与一条插件登记合入卫星仓，移动两个 gitlink（`dsh-skins` `0b0ea18` -> `05f5d512`、`dsh-community-plugins` `86303de` -> `9cefdcc1`），按 tarball 物化的 pin 重新生成 `market/dist` 并推送到 dev；工作流完成部署，线上 `manifest/plugins.json`（125 条）与 `manifest/skins.json`（47 套）与提交的产物逐字节一致。
