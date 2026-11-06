# Agent Note: 家族移除自更新包

Status: implemented

## Problem

`packages/dsh-update`（`@linxin666/dsh-update`）是家族在界面内的自更新面：侧栏底部触发器、更新日志面板，以及在当前 profile 内执行带核对的 `pnpm update --latest` 的 `/api/update/status` 与 `/api/update/run` 两条路由。它独占行 id `update`——而不是与 `dsh-remote-web-ui` 共用一行——这样关闭远程访问永远不会顺带拿走更新入口；它也拒绝桌面壳的页面，因为那个应用有自己的更新器。

随后两件事抽走了它存在的理由。2026-11-01 聚合退役了该行：本包对「家族由检出安装」的 profile 一律拒绝更新，而 `link:` profile 正是本仓自己的开发流程造出来的那一种，于是全家桶的用户恰恰是这个入口永远不可能生效的一群人。接着 DSH 0.2.2-rc.1 把注册表版本检查做进了官方插件页：每个已装 bundle 都会与其来源所提供的版本比对，按该版本声明的 DSH 下限设门禁，并在对话框叙述的移除/安装/还原步骤里就地更新，列表工具条再给出汇总。同一件事，做在用户本来就会打开的页面上，而且覆盖全部插件而不只是本家族。

本包当时仅剩的独有能力，是一个在打开插件页之前就宣告新版本的侧栏底部被动角标，以及一次点击搬动整个家族。两者描述的都是一条全家桶不再默认安装的发布线：包为独立安装继续发布，带着自己的测试、ru 字典、共享模块清单里的六处副本与四条门禁基线——为一个只有刻意额外安装才能触及、而官方页面已经提供的能力做维护。

## Decision

- **包已删除。** `packages/dsh-update` 整包移除，连同决定它的两篇 Agent Note——给它独立行与独立包的那篇，以及退役聚合挂载的那篇。本记录承载它们仍然成立的取舍：家族还在承担这个能力时，它值得有自己的行与包；而聚合在包本身被删之前就先不再挂载那一行。
- **插件更新归官方插件页。** 想把 `@linxin666/dsh-web-all`、或单独安装的某个家族包往前挪的 profile，走该页的版本检查，家族不再包一层。
- **聚合保留退役痕迹。** `update` 仍留在聚合的 `tombstones:`，`retiredPlugins` 仍登记为 `{"family":"update","plugin":"@linxin666/dsh-update"}`，`shellNotes:` 行照旧保留：profile 里记录的旧行名 `@linxin666/dsh-web-all/update` 仍解析到 shell 并按静默 no-op 处理。这套机制属于[从聚合清单生成退役插件登记表](../bug-fix/2026-10-17-aggregate-retired-plugin-registry.md)，不属于被删的包。
- **ru 字典随唯一消费者一起走。** `packages/dsh-i18n/src/client/ru/update.ts` 与该包 `ruDictionaries` 映射里的命名空间行已移除，i18n 审计的包清单也不再列 `dsh-update`。这与聚合退役时的保留不同——那次保留是因为包仍然可安装。
- **共享模块清单与门禁基线各失一行。** `scripts/sync-shared.mjs` 不再把 `mount-once.ts`、`telemetry.ts`、`loopback.ts`、`http.ts`、`vitest.setup.ts`、`console-output.ts` 同步进本包；`coverage-baseline.json`、`test-standards-baseline.json` 与 `test-shard.mjs` 不再带它的条目。
- **文档陈述的是缺失。** 根 README 双语版与 `docs/architecture.md` 不再列自更新条目，`docs/publish-prep.md` 不再发布本包，本包的 README 双语随包删除。
- **npm 保留最后一个版本。** `@linxin666/dsh-update@0.4.15` 留在 registry 上并标记 deprecated，指向官方插件页：已有的独立安装在其所有者卸载之前照常工作，本包不再有后续发布。

## Alternatives considered

- **保留发布但不再挂载。** 否决：那正是聚合退役后留下的状态，也正是本次改动被评判的对象——为官方页面已经承担的能力，维持一条发布线、一份字典、六处共享模块副本与四条门禁基线，而它只有靠额外安装才够得到。
- **把包裁成官方页面唯一没做的事：一次点击搬动整个家族。** 否决：经聚合安装的家族在官方页面上是一个 bundle，更新它一次就搬完；逐个安装的家族则是工具条给出汇总、用户逐行更新的一张列表。粗粒度更新器已无独立职责，留着它就要留着同样的六处副本与字典。
- **只保留侧栏被动角标，删掉其余。** 否决：角标唯一的消费者就是它自己的面板；只留角标仍然意味着一个已发布的包、一条挂载的行与一份字典，用来提示一件用户在另一个页面里处理的事。
- **彻底删掉 `update` 子路径导出，不做 tombstone。** 否决，理由与先前那次退役一致且在此不变：每个经全家桶升级过的 profile 记录的行名都是 `@linxin666/dsh-web-all/update`，没有该导出，那条目在 import 阶段失败并被记为 failed/degraded。tombstone 才让这次删除静默通过。
- **为独立安装保留 ru 的 `update` 字典。** 否决：删除包即终止发布线，没有哪份家族构建的 ru 副本会再与它漂移，而字典会描述一个无人注册的命名空间。先前那次退役之所以保留，只因为包仍在发布。

## Consequences

- 聚合 profile 与独立 profile 都失去侧栏底部更新触发器与更新日志面板；更新由官方插件页的版本检查承担，运行时下限门禁与失败还原步骤都归该页。
- 四条门禁基线与共享模块清单各少一个包；`pnpm test:scripts`、`pnpm i18n:check`、`pnpm aggregate:check` 是能发现漏改一行的检查。
- 仍带着旧行名的 profile 静默升级：子路径解析到 shell，shell 把该行按 no-op 处理，降级台账里不会留下记录。
- 任何宿主上都不再有 `/api/update/`。`dsh-remote-web-ui` 仍把该前缀留在自己的门禁通道表里：一个不服务任何路由的路径占一行成本，删它属于另一个包的通道规则改动。
- 俄语界面失去 `update` 命名空间：字典已删，也没有已装插件注册它。
- `@linxin666/dsh-update@0.4.15` 仍可从 npm 安装。其代码不再维护，本次改动之后安装它的 profile 拿到的是一份官方页面已经提供其能力的插件。
