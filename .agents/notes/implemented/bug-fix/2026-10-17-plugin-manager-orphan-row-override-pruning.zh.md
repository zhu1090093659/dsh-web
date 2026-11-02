# Agent Note: 在插件管理器更新路径上清理失效的行覆盖

Status: implemented

本记录拥有一个迁移决策：用户为一个已不存在的 cordis 行保留的逐行覆盖，应当如何处理。它所服务的退场由 [移除 dsh-model-capabilities](../simplification/2026-10-17-model-capabilities-native-removal.md) 拥有；本记录拥有 profile 如何在其之后存活下来。

## Problem

退场一个包会移除它的聚合行 id。0.4.6 发布过 `web-ui-model-capabilities`；0.4.7 的聚合 patch 改为声明 `web-ui-win-bash`，而 model-capabilities 的移除记录已把该包记为删除。写逐行覆盖的不是聚合包而是插件管理器：set-enabled 路由经 `setRowEnabled` 在 profile 的 `cordis.patch.yml` 里存一条裸 `{ id, name, disabled }` 行，因此切换过该家族行的用户会带有一条覆盖，指向下一个版本不再声明的 id。

被记录的「行 id」与被记录的「包说明符」不是一回事。移除记录里保留的模块子路径 tombstone 之所以存在，是因为记录了 `@linxin666/dsh-web-all/model-capabilities` 的 profile 缺了它会 import 失败（`ERR_PACKAGE_PATH_NOT_EXPORTED` 是启动错误）。行 id 不同：组合一条 id 无人声明的 patch 条目并不致命。loader 会在 stderr 打印 `patch: entry "web-ui-model-capabilities" not found`，然后继续组合——在隔离 profile 上实测：退出码 0，组合出 292 个条目。于是这次升级并没有坏掉，它只是从此在每一次启动时都吵上一条，并且文件里永久留着一条没有含义的行。

## Decision

插件管理器的更新事务把「清理自己的失效覆盖」当作又一道变更后守卫，与它已经在做的重复挂载剥离并列。启动时不做清理，不存在单独的命令，聚合 patch 也不改动：退场依旧是已发布的移除决定，迁移发生在本就拥有这次更新的写路径上。

判定「这个行 id 是否还存在」的权威，是 loader 对**更新后** profile 自己的组合结果——即启动预检本就已经捕获的 `--dump-config` 文本，由 `composedEntryIdsOf` 读取其中列首的 `- id:` 条目——**再并上 profile 的 bundle 层仍然声明的每一个 id**（`liveOverrideIds` 对 `dsh.profile.bundles` 里每个包自己的 `cordis.patch.yml` 跑 `declaredRowIds`）。它是组合后的目标条目集合，不是源 profile，也不是 profile patch：

- profile patch 回答不了。它只持有覆盖；覆盖指向的 id 落在管理器从不读取的 bundle patch 里，而一条「行还在」的覆盖与一条「行已没了」的覆盖在文本上完全一样。
- 源 profile 也回答不了。更新之后旧的组合仍然声明那个已退场的 id，而那正是要修的状态。
- 只有组合结果能看到官方 base 层。指向 `@deepseek-ai/dsh-base` 或其他已安装 bundle 所挂载 id 的覆盖依然是有效的，即便没有任何家族 patch 提到它；因此本地自行拼出的 id 集合（家族 bundle patch 加 profile）会把仍然活着的行误判为失效。
- 组合结果是**运行中宿主的快照**，所以它只被叠加，不被替换。宿主在某个 bundle 正被替换时组合出来的结果会缺这个 bundle 的行，尽管该 bundle 仍然声明着它们（见[组合结果本身不是证明](#组合结果本身不是证明)）。bundle 层自己的声明就是这段窗口里存活的地板；而「某行确实已退场」依旧只能由组合结果证明，因为只有它看得见官方 base。

清理发生在三处，都在变更落地且版本校验通过之后：CLI 更新分支（`runInner`，复用预检的 dump 而不额外再起一次探针）、旧聚合包迁移（`runMigration`，复用它的 `--dump-config` 输出），以及应用自有 profile 的路径（`runNativeUpdate`）——那里 CLI 被拒绝执行任何写入，但组合走的是同一个只读探针。安装与卸载不清理：它们不改变行 id 的全集，那里出现的失效行是既有状态，不是这两个动作造成的。

归属按形状判定，而不是靠猜。`overrideRowId` 只在以下情况认领一个顶层条目：它是裸行（没有 `insert` 键）、`id` 是字符串、`disabled` 是布尔值，且键集合整体为 `id`/`name`/`disabled`——正是 `setRowEnabled` 写出的形状。带 `config:` 的配置行、insert 包装行，以及任何携带本包不写之键的行，即便 id 不在组合里也绝不删除、绝不改写。被删行上方的注释块属于用户文本，因此它会挪到紧随其后的行（没有则挪到文件末尾），而不是随条目一起消失。

### 组合结果本身不是证明

`0.4.7` 交付这道守卫时把组合结果当作唯一权威。2026-10-17 19:32，一个真实的桌面 profile 因此丢了行：那次更新在聚合包正被替换时完成组合，组合里没有 `web-ui-remote-web-ui` 与 `ui-schedule`，而 bundle 层仍然声明着这两条。`ui-schedule` 的裸覆盖被从用户文件里清理掉，remote 行回落到 bundle 默认值——`autoTunnel: false`——于是 quick tunnel 不再启动、relay 仍指向已注销的 `trycloudflare` 域名，手机的 `hello` 在边缘被切断。

教训在探针**什么时候**跑，而不在它读什么。应用自有 profile 的更新是「先卸再装」（必须卸，是因为进程内管理器对 profile 已携带的包执行 `installBundle` 会以 `already-installed` 拒绝），因此有一瞬间 profile 自己的清单里不再有那个 bundle。在这个窗口里取的组合，反映的是「宿主还没重载」，不是「行已退场」。

因此现在有三条规则：

- 任何 bundle 层仍然声明其 id 的行，无论探针说什么都不清理。
- 读不到的层——包此刻解析不到，或它的 patch 解析失败——让声明变成未知，守卫整体不写。没有 patch 文件的 bundle 与 patch 为 `[]` 的 bundle 声明零条行，不算错误。
- 退场仍由组合结果证明：id 必须既不在探针里，也不在任何层的声明里。真正退场的行没有任何层声明它，所以原本的迁移依旧收敛。

### 解析 bundle 层目录

构成该声明地板的各 bundle 层目录由 `bundleLayerDir` 逐项解析 `dsh.profile.bundles` 条目：

- 若 profile 本地的 `node_modules` 中存在该包目录（可读取 `package.json`），则以该副本声明的行集合为准。
- 若目录缺失且该 bundle 名记录在 profile 的 `dependencies` 中，则视为未知（`undefined`），守卫整体不执行任何清理。列在 `dependencies` 中的包属于 profile 自身依赖，其缺失意味着正处于先卸后装的替换过渡态；若在此处贸然清理，会重蹈 0.4.7 在包替换窗口误删在用覆盖的教训。
- 若目录缺失且该 bundle 名不属于 profile 的 `dependencies`，则判定为宿主安装提供的 bundle。官方 CLI 创建的 profile 天然在 `dsh.profile.bundles` 中列出 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`，但从不在 profile 本地安装它们（由 CLI 宿主在启动时从安装树提供）。若一律要求本地副本存在，会在所有 CLI 创建的 profile 上永远返回未知，导致孤儿清理静默失效。因此解析回退到 `hostBundleDir(binary, name)`。
- `hostBundleDir` 从解析后的 dsh CLI 入口出发（经 `realpathSync` 穿透 npm-global 与 homebrew 的符号链接 shim），沿祖先目录向上探测至多 16 层中的 `node_modules/<name>` 与 `lib/node_modules/<name>`。若在宿主安装树中仍找不到副本，或无法解析 CLI 路径（`binary === null`），则声明仍视为未知（`undefined`），继续安全放弃清理。

## Contract

- **备份。** 写入经 `writePatchAtomic`，即 set-enabled 路由所用的同一个辅助函数：先把当前文件复制为 `cordis.patch.yml.bak-plugin-manager`，再写 `0o600` 临时文件并 rename 覆盖目标。不引入新的写盘纪律。
- **幂等。** 没有失效条目时 `pruneOrphanRowOverrides` 原样返回输入文本，调用方在清理列表为空时提前返回、不执行写入。因此在已清理的 profile 上再跑一次不会写入、不会产生第二个备份、也不会报告任何清理——备份里仍是清理前的文本。
- **拿不到权威就不改。** 组合不可得或为空（`composedEntryIdsOf` 返回 undefined）、patch 文件解析失败、或 profile 没有 `cordis.patch.yml` 时，文件保持原样。空的 id 集合绝不等于「全部清理」。
- **失败语义。** 写入失败会把任务结算为 `error`，错误文案带失败原因、备份路径与 patch 路径，与同一事务里重复挂载守卫的处理一致；profile 保留清理前的文本，备份就是记录下来的可恢复副本。迁移路径也不会为此回滚包替换——这与它在重复挂载剥离失败时已有的选择相同。
- **用户看到什么。** 第一次更新到退场了某行的版本之后，那条覆盖消失、启动警告停止，`cordis.patch.yml.bak-plugin-manager` 保留了清理前的样子。其余每一条覆盖与无关行都逐字节不变；覆盖全部仍然有效的用户不会察觉到这道守卫跑过。

## Alternatives considered

- **在聚合 patch 里为行 id 立 tombstone。** 否决：行 id 是全局预留的 loader id，聚合包要在整个家族余生里声明一条什么都不挂载的行，既占住该 id 不让未来的插件使用，也向每个 patch 阅读者隐藏这次退场。模块 tombstone 是另一回事——它修的是会阻断启动的 import——那条保留。
- **在 loader 找不到条目时顺手剥掉失效条目。** 否决：loader 分不清「用户指的是已经消失的行」与「用户指的是稍后由别的层加上的行」，它不拥有 profile 的写盘纪律，而且会在启动过程中静默改写用户文件。
- **按已安装的家族 bundle patch 而不是组合结果判定。** 否决：它看不到官方 base 层，于是指向官方行 id 的覆盖（发行 UI 行的常见情形）会被当作失效清掉，用户的启停意见被销毁。
- **在每次安装与卸载之后也清理。** 否决：这些动作不改变存在哪些行 id，额外写入只是在没有缺陷的情况下改用户文件；而更新路径才是退场真正会把覆盖晾在原处的地方。
- **先向用户报告失效 id，再决定是否清理。** 否决：这个状态只可能有一个有用答案——条目已被证明是死的（组合并不声明它）——而备份本身就让这次编辑可以手工回退。
- **将所有缺失的 bundle 视为空声明。** 否决：在先卸后装的更新窗口中，尚未落盘的 bundle 会被视为空声明并导致在用覆盖被删除，重现 0.4.7 事故。出现在 profile dependencies 中的缺失包必须维持未知状态，只有未就地安装的官方 bundle 允许回退至宿主安装树。

## Consequences

- 退场的家族行不再留下永久启动警告；profile 在退场后的第一次更新就自动收敛，用户无需任何操作，而同一条规则覆盖未来每一次退场，不需要新代码。
- 守卫只认得本管理器写出的覆盖形状。手工写成、指向已退场 id、还带了额外键（例如 `config:` 块）的行按设计保持不动，这类用户会继续看到 loader 警告，直到自己改掉那行——清理绝不用「删除管理器无法复现的内容」去换掉一条警告。
- 应用自有（桌面）路径只在其运行时仍能组合 profile 时才清理。CLI 无法运行 `--dump-config` 的宿主会原样保留所有覆盖：文件是安全的，但清理被推迟到能组合的运行时。
- 最坏情况下一次更新会多一次写入（清理），常见情况下一次写入都不多；CLI 路径上的 `--dump-config` 探针不会被拉起两次，因为清理复用了预检的 dump。
- 守卫比 `0.4.7` 更窄：bundle 仍声明、但运行中宿主没有挂载的 id（被拒绝或不兼容的 bundle、正在安装的包）会活下来，留下一条失效覆盖；等该 bundle 真的消失后的下一次更新会把它清掉——宁可留下噪音残留，也不删除仍然活着的覆盖。
- 地板的代价：仅在清理路径上、且变更已落地之后，每个 bundle 层一次 `readFile`，外加解析它的 patch。层多的 profile 每次更新付一次，不是每次启动付。
- CLI 创建的 profile 中未就地安装的官方 bundle 通过 `hostBundleDir` 沿宿主安装树正常解析，孤儿清理在标准 CLI profile 上能够顺利执行，而不会因本地缺失官方包而静默放弃。

## Testing

- `packages/dsh-plugin-manager/tests/rows.spec.ts` 固定纯编辑行为：失效覆盖被删除，注释块、仍然有效的覆盖与配置行逐字节不变；对已清理的层再次运行返回原文本且不报告任何清理；配置行、insert 包装行与带额外键的行永远不会被判为覆盖。
- `0.4.7` 事故的桌面回归用例在 `packages/dsh-plugin-manager/tests/gateway-jobs.spec.ts`：一个声明 `web-ui-remote-web-ui` 与 `ui-schedule` 的聚合 bundle、一个携带 quick tunnel 覆盖（`autoTunnel: true`、`relay: true`）与 `ui-schedule` 裸覆盖的用户层，以及一个在该 bundle 缺席时取的组合探针。更新结束后用户层逐字节不变且没有备份，因为没有任何条目失效。第二个用例删掉某个已列 bundle 的包目录，断言即便组合里真的缺了行、该层也原样保留——声明是未知，不是空。
- `packages/dsh-plugin-manager/tests/rows.spec.ts` 固定 `declaredRowIds`：层的 insert 条目、它自己的行、被声明两次的同一个 id，以及落在某行自身 `config:` 里的 id（那是子条目，不是层条目）各自去重后得到该层的 id 集合；解析失败的层抛错，使调用方无法把它读作空。
- `packages/dsh-plugin-manager/tests/gateway-jobs.spec.ts` 固定事务行为：带有失效 id 的层经更新后被清理，`cordis.patch.yml.bak-plugin-manager` 保存清理前的文本；同一次更新再跑一次不写入（备份仍是清理前的文本）；覆盖全部有效的层逐字节不变且不产生备份；写入失败把任务结算为 `error` 且备份在位；桌面自有 profile 的更新经只读探针完成清理，拿不到组合时则原样保留该层。
- `packages/dsh-plugin-manager/tests/gateway.spec.ts` 固定 `hostBundleDir`：解析 CLI 入口旁的安装副本、在回溯祖先目录前穿透 npm-global/homebrew 符号链接 shim、识别 `lib/node_modules` 前缀布局，以及在副本不存在或无法解析 CLI 路径（`binary === null`）时返回 `undefined`。

## 已知限制：制造失效覆盖的那次升级跑不到清理逻辑

发布后按真实 registry 复验（隔离 home、固定 `0.2.1-rc.2` CLI）表明，`0.4.6` 升到 `0.4.7` 时并不会清理：旧覆盖仍在，没有写出 `.bak-plugin-manager` 备份，`dsh --dump-config` 持续打印 `patch: entry "web-ui-model-capabilities" not found`。

原因是结构性的，不是接错线。更新执行的是运行中宿主已经加载的插件管理器代码，所以把 `0.4.7` 装上的那次更新由 `0.4.6` 的处理逻辑完成（对 `@linxin666/dsh-client-ui-plugin-manager@0.4.6` 做 npm pack 后，`pruneOrphanRowOverrides` 的引用数为零）。之后也没有补救路径：启动只组合、不改 patch，再次更新会以 `409 already at 0.4.7` 短路。该条目会由下一次在 `0.4.7` 或更高版本下执行的更新顺带清掉，因此残留是落后一个更新，而不是永久存在。

`0.4.7` 的升级矩阵之所以通过，是因为它从仓库源码导入 `makeGatewayRoutes`，等于用 `0.4.7` 的处理逻辑去跑 `0.4.6` 的 profile；用本地 registry 替代尚未发布的 `0.4.7` tarball 时，被替换的不只是清单来源，还有真正关键的被测处理代码。

`0.4.7` 的处理决定：在 release notes 与 release body 里如实披露该限制并给出手工处理步骤，下一个版本把清理移到对「已升级宿主」也会执行的路径（启动后或首次访问网关时，外加持装与卸载任务）。今后任何行退役都必须在退役版本执行那次升级之前清理，否则就要接受同样的滞后一个更新。
