# Agent Note: 家族聚合退役自更新行

Status: implemented

## 问题

`packages/dsh-web-all/aggregate.yml` 曾以 `web-ui-update` 行挂载 `dsh-update`，并把 `@linxin666/dsh-update` 列进聚合的依赖，于是装一次全家桶就把界面内的家族自更新入口带进每个 profile。而本包对「家族包由检出安装」的 profile 一律拒绝更新——`link:` 规格无法由 registry 搬动，它报告本地开发模式并停下——这恰好是 `node scripts/link-profile.mjs` 造出来的 profile，也就是本仓文档写明的开发流程、以及「从仓库安装」指引会产出的 profile。于是全家桶自己的用户，正是那个入口永远不可能生效的一群人。逐行的更新路径另有归属：插件管理器的列表工具条会检查每个已装插件、逐条应用符合条件的第三方更新，并提供让它们生效的重启。聚合为一个工作范围更窄、粒度更粗的更新器，付出了运行时依赖与一个侧栏席位两样东西。[家族自更新成为独立插件行](2026-09-25-self-update-own-plugin-row.zh.md) 拥有席位决策；本记录只退役聚合里的那份挂载，包自身行为不变。

## 决策

- **聚合不再挂载更新行。** `../dsh-update` 已从 [aggregate.yml](../../../../packages/dsh-web-all/aggregate.yml) 的 `patchFrom` 与 `deps` 两处移除：`@linxin666/dsh-web-all` 不再依赖本包，安装全家桶也不再给 profile 带上该行。
- **包保留，并继续发布。** `packages/dsh-update` 保留源码、测试、`lib/`、cordis patch 与 README 双语；[docs/publish-prep.md](../../../../docs/publish-prep.md) 保留它的行，发布照旧。`dsh plugin --profile <profile> add @linxin666/dsh-update` 在任何需要它的 profile 里挂载该行；缺少 `@linxin666/dsh-web-all` 时，本包自己的包清单本来就是回退锚点。
- **子路径变成 tombstone。** `update` 留在 `tombstones:`，并在 `retiredPlugins:` 登记为 `{"family":"update","plugin":"@linxin666/dsh-update"}`，其 `shellNotes:` 行照旧保留给壳自己的展示元数据。profile 里记录的旧行名 `@linxin666/dsh-web-all/update` 仍能解析到该导出，壳从登记表读到退役事实后按静默 no-op 处理，而不是记一条导入失败。该机制属于 [从聚合清单生成退役插件登记表](../bug-fix/2026-10-17-aggregate-retired-plugin-registry.zh.md)。
- **俄语字典保留。** 只要本包还能安装，`packages/dsh-i18n/src/client/ru/update.ts` 与该包的 `update` 命名空间行就继续为它服务：退役聚合里的行不是删除包。这里刻意不同于 `remote-web-ui` 的退役——那一次的字典随家族的最后一个消费者一起消失。
- **文档按当前状态陈述退役事实。** [README.md](../../../../README.md) 与 [README.en.md](../../../../README.en.md) 保留插件表格行与单独安装示例，两处都写明全家桶不含本包；[docs/architecture.md](../../../../docs/architecture.md) 的 `dsh-update` 行同理，本包 README 双语与本包的 [AGENTS.md](../../../../packages/dsh-update/AGENTS.md) 一致。

## 备选方案

- **连包一起删掉。** 否决：这次退役的只是全家桶里的挂载。经 npm 安装家族、想在界面里一键更新家族的 profile 没有别的入口；本包的回环 run 管线、测试与字典都还在正常工作；删包会让每一个既有的单独安装变成无法解析的 import。删掉一个已发布的 npm 包本身也是一项发布期弃用决策，不是聚合清理的附带效果。
- **保留该行，列进 `inactive:`。** 否决：未激活的行照样是依赖、照样把包装进每个 profile；README 会描述一个默认安装根本没有的面；而用户被告知要拨的仍是那一行的开关——一个全家桶正想甩掉的插件。退役的意思是全家桶不再携带它，而不是携带了再关掉。
- **继续挂载该行，只把 link 模式的限制写得更清楚。** 否决：拒绝本身是对的——`link:` 规格绝不能被改写——剩下要修的只有「全家桶默认装它」这件事。写进文档的死入口，等于在本仓叫人去建的开发 profile 里常驻一个「这个按钮为什么失败」。
- **彻底删掉子路径导出，不做 tombstone。** 否决：每个经全家桶升级过的 profile，其记录的行名都写着 `@linxin666/dsh-web-all/update`；没有该导出，那条目在 import 阶段失败并被记为 failed/degraded。tombstone 加一条 `retiredPlugins` 登记让同一次升级静默通过，而这套机制聚合本来就已有。
- **照 `remote-web-ui` 的先例把 ru 字典也删掉。** 否决：那个先例删字典，是因为家族正在移除该能力的最后一个消费者。本包在这里仍可安装，它的 `update` 命名空间仍要给俄语界面供货；删掉字典只会让单独安装的俄语 profile 回落到英文。

## 后果

- 聚合 profile 的侧栏底部不再出现更新触发器。更新走插件管理器的逐行路径；家族来自 npm 且需要一键家族更新时，单独安装 `@linxin666/dsh-update`。
- 聚合少了运行时依赖与一个挂载行；`web-ui-update` 不再出现在任何生成的 patch 里，`tombstones`、`retiredPlugins` 与 `shellNotes` 是这个家族名仅存的痕迹。
- 仍带旧行名的 profile 升级静默：子路径解析到壳，壳把该行按 no-op 处理，健康账本里不多一条记录。
- 单独安装保留全部已记录的行为，包括本地开发模式下的拒绝与 `SELF_PACKAGE` 回退锚点。
- 退役不动本包的发布线、测试与字典。
