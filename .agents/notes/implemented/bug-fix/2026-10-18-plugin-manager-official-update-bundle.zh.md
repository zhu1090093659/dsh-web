# Agent Note: 官方插件更新是一次官方调用，批量是本 host 对这条原语的串行

Status: implemented

## Problem

在打包桌面客户端上，更新区块的批量动作对它列出的每个第三方插件都推不动。三个已发布的事实合成这个结果：

- 应用自有 profile 只有一个写入器：宿主挂载的官方进程内插件管理器。CLI 直接拒绝 `--profile desktop`。
- 该管理器当时唯一的安装原语（0.2.1-rc.2）在宿主挂载 `hmr` 时会拒绝安装 profile 已携带的包，而那是每个 profile 宿主，因此原地更新根本无法表达成一次安装。
- 已上线的变通方案用自己的两次调用完成替换：`removeBundle`，再用 `installBundle` 装目标版本，回滚、层序复原与 `bundle-in-use` 移除拒绝的单次重试都是本包自己写的。它能用，但这个网关在重新推导一套官方管理器本来负责的生命周期；而且它无法清掉的拒绝（第二次 `bundle-in-use`，即该行确实还在本进程里加载）会终结整批——浏览器逐条驱动更新任务，遇到第一个失败就停，用户看到的 `操作失败: 官方插件管理器更新失败: 已安装版本无法移除（bundle-in-use）` 就是这条路。

自 `@deepseek-ai/dsh-plugin-manager` 0.2.2-rc.1 起，管理器暴露 `updateBundle(name, version, { requestId })`：先在 registry 上核验目标（必须存在、声明 bundle、接受当前 DSH 版本），宿主挂载 `hmr` 时移除已装版本，用找到的勾选状态安装目标，安装失败或取消时把移除的版本装回。它返回 `PluginUpdateResult`——`{ from, to, step: 'check' | 'remove' | 'install', result: ChangeResult, restore?: ChangeResult }`——因此「哪一阶段结束了这次运行」与该阶段自己的判定都可读。本包 `dsh.engines.dsh` 的下限已经是 `>=0.2.2-rc.1`。

## Decision

`CliGateway.runNativeUpdate` 只发一次官方调用并读它的判定；批量成为本 host 对同一原语的排序执行，而不是第二个写入器：

- **一次官方调用取代自拼的阶段序列。** 交给 `updateBundle` 的是已装包名、路由解析出的精确版本，以及作为 `requestId` 的任务 id；更新不再调用 `installBundle`／`removeBundle`，`already-installed` 分支、自写回滚与「装回哪个 spec」的记账一并删除。`nativeUpdateFailure()` 读取结束本次运行那一阶段的判定并点出阶段（`检查新版本时被拒`／`移除已安装版本时被拒`／`安装新版本时失败`），`nativeUpdateRestartRequired()` 读 `application: 'restart-required'`，`nativeUpdateRestoreNote()` 说明管理器移除的版本是否已回到盘上，还是需要用户手动重装。
- **两道守卫仍归本包，因为官方调用不覆盖它们。** 一是层序：官方移除会把这个包从 `dsh.profile.bundles` 删掉、重装再追加到末尾，而该数组就是 loader 套用 patch 的层级顺序，连续更新会让整批行的继承顺序漂移；`restoreBundleIndex()` 把它放回原位。二是 `bundle-in-use` 重试：官方守卫先取消勾选、重载 profile，之后才判定该包的行是否还有活跃 fiber，因此 `applyNativeUpdate()` 针对 reload 留下的落盘状态再调恰好一次。第二次仍被拒就是终局：用 `setBundleEnabled` 还原勾选，并在报告里写明该插件仍在本进程加载、需重启 DSH 后再执行本次更新。
- **批量是一个任务，按顺序应用，且不因一条被拒而停止。** `CliGateway.updateAll(entries)` 在 `GatewayJob.results` 里为每个被请求的插件记一行（`phase`／`targetVersion`／`landed`／`error`／`restartRequired`），`current` 指明正在跑的那行；每行走的就是单条更新路由走的那条路径（应用自有 profile 上是官方调用，其余运行时是 CLI），旧聚合迁移是独立的行种类。最后一行答复后整批一律 `done`——失败事实在各行上，因为下面每个写入器对单个插件都是原子的，一个卡住的插件不该丢掉它后面的行。已落地但需要重启的行是「带事实的落地行」，绝不是错误。
- **`POST /api/plugin-manager/updates` 在动手前逐条解析。** `planUpdate()` 是把单条路由自己的解析抽出来，两个入口因此以同一套理由拒同一批行（未安装、不是直接的 registry 插件、最新版本解析不到、已经是最新、本 host 不满足其声明的 DSH 下限）。拒绝变成该行在任务里的 `error`，而不是让整个请求失败；重复 id 只解析一次；一批上限 `MAX_BATCH_UPDATES`（50）。
- **浏览器只发一次调用。** 工具条的 `updateAll(ids)` 一次提交 id 并轮询这一个任务，正在跑的行仍用原来的 `updatingAll` 文案；已落地的行离开列表，被拒的行留在列表里并在行内渲染宿主给出的原因，只有请求本身失败才落到那条告警行。官方安装器通道没有批量端点，因此该通道下的 face 仍循环自己的单条更新——那是它唯一接受的写入器。
- **不退回旧序列。** 没有 `updateBundle` 的管理器会被如实报告（`官方插件管理器没有提供 updateBundle（需要 DSH >= 0.2.2-rc.1）`）；engines 下限就是前提，为一个走不到的运行时养着第二套判定与回滚是债，不是安全。

## Alternatives considered

- **把自写的两阶段保留为「没有 `updateBundle` 时」的回退路径。** 否决：`package.json` 的 `dsh.engines.dsh` 与 host peer 都要求 DSH `>=0.2.2-rc.1`，这条回退走不到；留着它等于留两套回滚实现、两种读同一个判定的方式。
- **继续让浏览器逐条驱动更新任务。** 否决：每行一次请求、一个任务，逐行的 HTTP 工作放在组件里，而且「遇到第一个失败就停」的策略留在了浏览器，而不是留在产生失败的那个写入器旁边。
- **批量遇到第一个拒绝就停。** 否决：下面的写入器对单个插件都是原子的——官方管理器会自己把失败的替换回滚——因此拒绝之后留下的是可用插件，没有任何理由放弃后面的行。这正是被报告那次失败的形状。
- **报告拒绝并停止（旧变通方案的行为）。** 当时否决、现在仍然否决：更新区块存在的意义就是推进插件版本，桌面端一旦某个插件无法在进程内卸载就永久装饰化。
- **宿主挂载 `hmr` 时禁用更新动作。** 否决：那是每个 profile 宿主，等于为了描述一个缺失的上游原语而全局关掉这个功能。
- **由 host 半区自己写依赖并跑启动器自带的 pnpm。** 否决：同一 profile 的第二个写入器——两者会争锁、争 bundle patch 应用、争官方管理器在变更前后做的重载，而仓库规则是每个 profile 只有一个写入器。
- **在插件被短暂卸载前再确认一次。** 否决：更新本来就是用户确认过的显式动作且有可见任务，替换推不动时管理器自己会把旧版本放回，多一次确认只会买到任务报告里已有信息的风险说明。

## Consequences

- 桌面端更新是一次官方调用，内部自己卸载并重装该组合包；只轮询那一个任务的客户端看到的仍是一次普通的进行中更新。
- 失败报告比过去更宽也更准：点出是哪一阶段拒绝、带上管理器自己的原因（pnpm 诊断、`incompatible-version` 拒绝点名的包、取消），并说明装回成功还是需要手动重装。
- 已落地但当前进程加载不了，就如实读成那样：`job.restartRequired` 带上包名，两处界面都写出来。这个事实绝不走 `job.error`——错误行会让整批失败，而版本确实落地了。
- 批量更新不再让 profile 的 bundle 顺序与开始时不同，因此连续更新中各行仍从同样的层继承。
- 批量里一次拒绝只花掉一行，而不是整批；面板把那一行连同原因留在列表里，于是「全部更新」现在能回答「我这边还剩哪几个、为什么」。
- 所有非桌面运行时的更新不变：CLI 路径看不到这条官方原语，CLI 自己的守卫（重复挂载剥离、insert 行与启动预检）仍留在原处。

## Testing

`packages/dsh-plugin-manager/tests/gateway-jobs.spec.ts` 用「`installBundle` 与 `removeBundle` 故意抛错」的脚本化管理器固定更新路径，因此任何摸回旧两阶段序列的测试会失败而不是悄悄通过：每次更新一次调用且 `requestId` 是任务 id、调用抛错、带阶段的折叠拒绝、绿跑但版本未动、两种形状的装回说明、`restart-required` 作为落地事实、`bundle-in-use` 的单次重试、持续拒绝后的重启提示与勾选还原、非 `bundle-in-use` 拒绝只调用一次、更新后保留的层序索引、取消与不兼容版本文案。

批量在那里和 `tests/update-route.spec.ts` 里另有覆盖：按顺序逐行落地并给出每行的 `landed`／`error`、越过失败行继续、运行前就带进来的被拒行、把迁移当作批量的一行、整批全被拒仍 `done`、应用自有 profile 上的原生路径，以及路由的 400／500、去重与逐行拒绝。`tests/plugin-list-toolbar.spec.tsx` 固定单次调用、行内失败文案、部分完成的汇总文案、需重启的行仍计为已落地、以及整个请求失败的路径。`tests/protocol.spec.ts` 固定批量行的宽容读取。

这条路径背后的拒绝现象的复现装置在 DSH checkout 里，不在本仓：`packages/boot/plugin-manager/tests/manager.spec.ts` 起真实的 profile Include、真实 Loader 与真实 `hmr` 服务，那是唯一能端到端观察官方守卫的地方。
