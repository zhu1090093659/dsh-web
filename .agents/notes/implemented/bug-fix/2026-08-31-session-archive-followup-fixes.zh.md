# Agent Note：会话归档管理后续修复（标题、开关、默认值）

Status: implemented

## Problem

`dsh-session-archive` 首轮真实使用暴露三个缺陷：

1. **归档会话标题未解析。** 清单只从聚合投影缓存索引
   （`storages/session_projcache.json`）补充标题，而该索引只覆盖近期会话。
   较老与已归档的会话即使 per-session 投影缓存文件
   （`storages/session_projcache/sessions/<id>.json`，version 4 `record` 结构）
   中仍保有 `record.rows.title.val` 与 `record.identity`，也一律显示
   `（无标题）`。
2. **自动维护两个开关看起来点不动。** `AutoSettingsPanel` 在渲染时读取
   `settings.getSnapshot()`，但 `useSyncExternalStore` 只订阅了 controller
   store。settings 镜像在每次写入被接受后都会替换快照对象；缺少订阅时受控
   checkbox 永远不重渲染，宿主写入成功在视觉上不可见。（`dsh-usage` 的同款
   写法被它的轮询重渲染掩盖了。）
3. **天数默认 30/90 太重**，两个默认值都应改为 7 天。

## Decision

1. `buildInventory` 在索引补充之后追加一次有界回退：仍缺 title/createdAt/cwd
   的行读取各自的 per-session 投影缓存文件（`readProjcacheFile`，容忍损坏/
   缺失文件，`record ?? parsed` 兼容结构漂移）。文件永不制造行（无幽灵）；
   归档服务用 per-id 缓存（`InventorySources.projcacheFiles`）记忆文件事实，
   避免重复清单遍历反复读盘。索引事实保持优先（先应用）。
2. `AutoSettingsPanel` 改用
   `useSyncExternalStore(props.settings.subscribe, props.settings.getSnapshot)`
   订阅，开关立即反映被接受的宿主写入。
3. `DEFAULT_AUTO_CONFIG.autoArchiveDays`/`autoDeleteDays` 与宿主 schemastery
   schema 默认值 30/90 → 7/7（config.ts + index.ts + README 双语 +
   auto-rules.spec 回退断言）。

## Alternatives considered

- **从会话日志读标题**：legacy `session.jsonl.zstd` 是压缩格式，为投影缓存
  已有的事实引入 zstd 依赖不划算。否决。
- **非法天数输入钳制保存**：此前已否决（非法值绝不保存）；维持不变。

## Consequences

- 存在 per-session 投影缓存文件的老会话/归档会话能解析出真实标题；目录、
  feed、文件三者皆无的行保持 `（无标题）` 并带 `no-data` 标记（真幽灵）。
- 两个自动维护开关完整回路：点击 → 宿主写入 → 镜像快照 → 重渲染；状态
  跨刷新保持。
- 全新安装两个阈值默认 7 天；用户已显式保存的值不受影响（schema 默认只填充
  缺失字段）。
- 已在沙箱 QA 实例（全新 `DSH_HOME`，端口 3999）验证：仅有投影缓存文件的
  播种会话解析出 `早安测试`，索引优先于文件（`索引标题二`），仅有目录的
  会话保持 `（无标题）` 并带异常标记；两个开关可勾选且跨刷新保持；天数输入
  显示 7/7。证据：`/tmp/qa-evidence/22..24-*.png`。宿主半区改动需用户侧重启
  DSH 后在真实实例生效；客户端半区的开关修复刷新页面即送达。

## 同日后续：删除后的选择集幽灵与跳过呈现

**Problem.** 真实实例上一轮 371 个目标的批量删除后，5 条已归档行仍然可见，
选择条停在「已选 371 项」。对真实 home 的取证：这 5 个会话从未被删除——
存储目录完好，`archivedSessionIds` 恰好剩这 5 条——因为它们仍被运行中的
DSH 进程持有（活跃 SessionStore 成员）。批量对话框确实报告了跳过，但用的
是 `running` 原因（「会话正在运行」），对闲置挂载的会话是错误文案；而且
删除后的清单刷新没有剪枝选择集（371 个 id 里 366 个已不存在），摘要行还
声称有 366 项在筛选结果之外。

**Decision.**

1. `setInventory` 把选择集剪枝到仍存在于新行中的 id。跨筛选变化保留选择的
   语义不变；只丢掉清单已不再知道的 id。
2. 新增稳定原因码 `attached` 表示进程持有成员；feed 报告运行中的行仍用
   `running`。文案：zh「会话仍被 DSH 进程占用，重启服务或关闭该会话后可
   删除」/ en / ru（中央包）。
3. 完成态的批量对话框按原因聚合跳过项（`跳过明细：… ×n · …`），371 规模的
   结果一眼可读；per-id 明细列表保留。

**Consequences.** 保护语义不变——被运行中 DSH 进程持有的会话在服务重启或
会话关闭前仍不可删除；变的是 UI 现在如实说明原因，选择计数反映真实。QA
已验证：全选 3 条播种会话 → 批量删除 → 对话框 `成功：3 / 跳过：0`，选择
计数剪枝为 `已选 0 项`。证据：`/tmp/qa-evidence/25..27-*.png`。

## 同日后续 2：裸 UUID 的 harness id 让所有批量操作失败

**Problem.** 用户重启后，213 个目标的批量删除每个分片都报 400
`no session ids`。对真实 home 的诊断：这台安装的 harness 原生混用两种 id
拼写——feed、注册表归档集合与会话存储对大量会话持有**裸 UUID**（feed
741 行中 309 行；归档集合与插件台账当时 100% 是裸 id），其余行则是
`session-<uuid>`。路由的 id 校验只接受带前缀拼写，于是每个 id 都被丢弃、
空数组守卫回了 400。更早的 371 规模删除能成功，是因为当时部署的构建还没
有这个严格校验。

**Decision.** 插件内部统一一种规范形式，harness 边界使用原生拼写：

1. `buildInventory` 把它产出的每个 id（feed 行、父子链接、工作区成员、
   归档集合成员、台账查找）经 `canonicalSessionId` 规范为 `session-<uuid>`，
   并为见过的每个非规范拼写记录 canonical→native 映射
   （`BuiltInventory.nativeIds`）。
2. `routes.idList` 接受两种拼写，拒绝路径不安全字符串（id 会进入文件名），
   并在服务层看到之前规范化。
3. 面向 harness 的调用传原生 id：`archiveSession`、`inspect`（预览）、rdb
   删除（双拼写尝试）、归档集合取消与工作区行移除按规范等价比较并原样
   保留其余存储条目。
4. 归档台账与投影缓存清理写规范键、双拼写清理（现存 207 个裸 id 台账键
   经双格式查找继续可读并自然退役）。

**Consequences.** 混拼写的安装端到端可用；wire 格式统一为规范形式；遗留
裸 id 台账键可读并自然清理。修复前页面里的选择（裸 id）会被清单刷新剪枝
（行已是规范形式），用户重新全选即可。单测覆盖：裸 feed id → 规范行 +
父子链接 + 归档标记；裸 id 走删除路由清理裸归档集合条目；路径不安全 id
仍 400。自动周期把候选清单的原生 id 映射传给归档执行器，与手动批次保持一致。混合 id 的自动周期回归测试覆盖原生归档标记、规范化台账键、运行中/当前会话保护，以及重复周期不重置归档时间。

## 后续 3（同日）：一次用户操作只做一次目录遍历

**问题。** 每次装配清单都会重新遍历整个 sessions 根目录，以累加每个会话目录的文件大小（`indexSessionDirs`）。在维护者这台机器上，444 个会话目录下该遍历实测约 12.5 ms/次（其中约 11.6 ms 是递归的大小累加；`realpath` 约 4.2 ms、`stat` 约 1.5 ms、`readdir` 约 0.7 ms），而且每次装配还会重新读取 per-session 投影缓存兜底（442 个文件冷路径约 28 ms）。而一次用户操作会触发多次装配：442 个目标的批量删除按 200 个一组分块，每个分块请求都重建一次清单，客户端随后再刷新一次清单——一次删除共四次。单击某一行**预览**同样重建整份清单，只为展示面板已经持有的一行。实测：四次装配 80.3 ms（遍历重复），两次 52.2 ms。

**决策。** `InventorySources.dirIndex` 接受一份预先构建的索引；服务侧由 `DirIndexCache`（`dir-index-cache.ts`）提供——它是 sessions 根目录扫描的单条目、2 秒 TTL 记忆，拥有者在自己物理删除存储之后主动失效它。未提供索引时该次装配仍自行遍历目录，因此 `buildInventory` 的既有契约不变。复用是有界的而非永久：窗口很短，重扫始终只差一次调用，且没有任何轮询。

**实测效果**（444 个真实会话目录；一次批量删除所执行的四次装配序列）：

| 序列 | 之前 | 之后 |
| --- | --- | --- |
| 四次清单装配（一次批量删除） | 80.3 ms | 42.6 ms |
| 两次清单装配 | 52.2 ms | — |

剩余成本是投影缓存兜底读取，`projcacheFiles` 已按 id 记忆；目录遍历在窗口内不再重复。

**考虑并否决的替代方案。**

- **用 `readdirSync(path, { withFileTypes: true })` 省掉每个子目录的一次 `stat`**：已实现并实测，结果**更慢**——同样 444 个目录 6.93 ms 对 6.60 ms。以实测否决。
- **常驻目录索引**：否决——外部删除后大小与目录映射会过期，而这里的正确性决定删除管线允许删除什么。
- **放慢客户端分块或去掉批量后的刷新**：否决——它们的存在是为了让中断的批量停留在可重试状态、并让面板如实反映；多余的是重复遍历，不是刷新。
- **给清单响应本身加 TTL**：否决——那是更大的行为变更（还会掩盖外部并发变更），而复用扫描已在不改变任何对外可见结果的前提下消除了实测成本。
- **为 `preview()` 单独做一份缓存文档**：在扫描复用落地后重新测量并否决——preview 走的是同一个 `sources()`，已共享该次遍历与按 id 的事实记忆。它剩余的 31.7 ms 冷成本是 444 个会话一次性读取投影缓存事实，付过一次之后即 0.7 ms；再做一个缓存只会重复记忆第一层已经摊薄掉的开销。

**后果。** 外部删除后，大小与目录映射最多滞后 2 秒；服务自身的删除立即失效。`preview()` 仍自行装配清单，留待后续再收敛。验证：包内 14 个测试文件 / 104 个用例通过，两个 program 的 typecheck 与 build 通过，`test:standards`、`docs:check`、`i18n:check`、`emoji:check`、`sync-shared --check` 通过。新增覆盖 `tests/dir-index-cache.spec.ts` 共 5 例：窗口内多次装配只扫描一次、窗口过期后重新扫描、显式失效后被删除的存储消失、窗口过后能发现新增目录，以及自行遍历与接受索引得到完全相同的行。反向对照：把 `invalidate()` 改成空实现会让失效用例失败，忽略 TTL 会让两个用例失败。属 host 半区改动，需用户重启 DSH 服务后才会作用到 GUI。
## 后续 4（同日）：同一份有界记忆也服务于投影缓存索引

**问题。** 每次装配都会完整读取聚合投影缓存索引（`storages/session_projcache.json`）——一次 `readFileSync` 加一次对整份文档的 `JSON.parse`——而它旁边规模大得多的 sessions 根目录遍历已由一份有界记忆承担。对该索引文件做规模扫描测得这次读取加解析为 3.66 µs/KiB（R² = 0.943）；在维护者这台机器的 112 KB 索引上约为每次装配 0.40 ms，相当于冷装配的 1.2%、热装配的 36%——也就是目录遍历已由记忆承担的那一次装配。这笔收益是**亚毫秒级**的，此处如实记录：它值得移除，是因为它与遍历的记忆所移除的是同一类重复工作，且正好落在一次用户操作会重复的那些装配上。

**决策。** 一种记忆类型同时服务两处读取。`ttl-memo.ts` 拥有 `TtlMemo`：单条目、一个 TTL 窗口，以及由拥有者显式调用的失效。`DirIndexCache` 是该类型针对 sessions 根目录扫描的特化，公开面不变；`ArchiveService` 另持一份用于投影缓存索引的记忆，并在 `sources()` 中经 `InventorySources.projcacheIndex` 注入。`scrubProjcache()`——索引文件的唯一改写点——在确实改写了内容时（`ids.size > 0`）失效该记忆。未注入记忆时 `buildInventory` 仍自行调用 `readProjcacheIndex`，因此无论有没有服务，该次装配的契约不变。

**后果。** 一次装配读到的索引最多滞后一个 TTL 窗口；删除管线自身的改写会立即失效，因此被清理掉的标题不会活到下一次清单装配。每份记忆只持一个条目，不累积、不轮询。覆盖：`tests/projcache-index-memo.spec.ts`。

**反向对照。** 去掉注入会让守护报 `expected ['Amended','Beta'] to deeply equal ['Alpha','Beta']`；去掉失效会让被删除的标题复活：`expected 'Doomed' to be undefined`。
## 后续 5（2026-10-16）：投影缓存兜底同时读两种 id 拼写

**问题。** per-session 投影缓存兜底（`readProjcacheFile`）只解析一种文件名——`${id}.json`，而 `id` 恒为带 `session-` 前缀的形式，因为 `canonicalSessionId()` 只补前缀、从不剥离。harness 则是按它手上那一刻持有的 id 形式命名文件的，两种拼写同时生效：维护者这台机器的该目录里有 862 个文件，386 个名为 `session-<uuid>.json`、476 个为裸 `<uuid>.json`，没有任何会话同时以两种拼写出现，而两种拼写的修改时间都跨 2026-10-02 至 2026-10-16——是并存，不是改过命名。该机器上聚合索引不存在，因此全部富化都走这条兜底，于是每个裸名文件都读不到：857 行里有 478 行带 `no-title`，而其中 476 个会话其实各有一份含 title、createdAt 与 cwd 的文件。这次未命中随后被记忆成 `null`，落在无人失效的普通 `Map` 里，所以 harness 之后写入也无法修复该行，直到插件重载。`scrubProjcache` 早已按两种拼写删除：归档侧早就承认两种名字，只是读取侧没有。

**决策。** `readProjcacheFile` 先试 canonical 拼写，只有这次读取一无所获时才试裸拼写，并统一经一个 `readProjcacheEntry` 辅助函数解析。因此以 canonical 命名的缓存文件仍然只花它一直以来那一次读取，新增的工作只落在本来毫无事实的行上。记忆契约不变：仍按 canonical id 一个条目，两种拼写下都没有文件的会话仍记忆 `null`。

**实测效果**（维护者这台机器，857 行）：无标题行 478 → 7，有标题行 379 → 850，行集合完全一致，因此兜底仍然不会凭空造行。新增工作是 471 次成功的读取加解析：文件在页缓存中时三轮为 33-35 ms，第一次较冷的装配为 158 ms，而这些行此前付出的是 5.3 ms 的失败打开。热装配不变，因为记忆直接作答。剩下 7 行能解析到自己的 canonical 文件，其内容是显式的 `title: null` 配上真实的 createdAt 与 cwd——是诚实的 `no-title`，不是未命中。

**备选方案。** 把 `nativeIds` 传进读取：否决——这里的另一种拼写是 id 上的一次双射，推导出来即可让这个导出函数不依赖清单状态；`scrubProjcache` 需要那张映射，只是因为它还要删除自己推导不出的名字。把投影缓存目录一次读成一个名字集合：否决——成本不在名字上，而在名字背后那 11.8 MiB 的文件内容，这样一个集合一次读取也省不下来。让记忆在未命中时不记忆：作为另一项决策否决，它需要自己收集证据——它改变的是哪些装配会重读，而本次要修的行是文件本已存在的老会话。

**后果。** 会话的缓存文件用裸名命名时，该行从第一次装配起就得到富化，而不是永远得不到。两种拼写下都没有文件的会话，仍会在插件存活期内记忆 `null`——此处不变，并作为一项独立决策记在这里。覆盖：`tests/inventory.spec.ts` 新增两例——两种拼写都能读取且 canonical 优先、以及用裸名文件富化一个 canonical 行；包内 15 个测试文件 / 115 个用例、两个 program 的 typecheck 与 `docs:check` 通过。属 host 半区改动，需用户重启 DSH 服务后才会作用到 GUI。

## 后续修复 6（issue #2022）：列表拒绝的必须就是宿主拒绝的

**问题。** 宿主的保护判定只在删除路径里计算（`ArchiveService.protectedReason`：活跃 SessionStore 成员记 `attached`、feed 的 `running`、客户端声明的 `current`、正在处理的目标记 `in-flight`），而服务出去的清单只带 feed 的 `running` 位。于是浏览器半区只知道四个事实里的两个：被运行中的 DSH 进程占用的行看起来可以删除，即使选中的会话全部受保护，「批量删除」仍然可点，确认框对宿主一定会跳过的会话报 `skipped 0`——用户只有在批次跑完时才看到真相。四个事实里有三个在浏览器里根本观测不到：空闲占用、在途操作，以及混用 id 拼写时的当前会话，都是宿主侧状态。

**决策。**

1. `ArchiveSessionRow.hostProtectedReason?: 'attached' | 'in-flight'` 承载浏览器无法观测的那两个事实；`running`（feed 位）与 `current`（客户端自己的会话）照旧各自随行，于是线上协议只多一个可选字段，其余形状不变。`InventorySources.hostProtectedReason` 负责注入，`buildInventory` 把它贴到对应行上；`ArchiveService.sources()` 用 `liveSessionIds()` 与 busy 集合填充这张表，并把 `in-flight` 写在最后，使在途目标取胜的方式与 `protectedReason()` 完全一致。
2. `clientProtectedReason` 按宿主的优先级合并行事实——`in-flight > current > attached > running`——这条规则记在 `core/cascade.ts` 的 `planDelete` 旁边，于是确认框的跳过计数与批次的跳过原因，指向的胜者与宿主权威计划里的完全一致。
3. 列表每次装配只读一次该映射：受保护的行的删除按钮被禁用并以自身原因作 title，批量删除只在 `selectionFullyProtected` 成立时禁用——混合选择照常可用，确认框给出准确的跳过数量。新增文案键 `arch.batch.deleteBlocked`（zh/en，ru 在集中包）。
4. 不下发该字段的旧宿主退化为 `running` 加当前会话：正是修复前的行为，而宿主依旧权威地拒绝。

**备选方案。** 把宿主整张保护表作为单独的清单字段（`InventoryView.protected`）下发：否决——它会让「哪些行受保护」多出第二处查找点，而这本来是行自身的属性。让宿主连 `running` 与 `current` 一起下发：否决——浏览器两样都观测得到，重复来源只会漂移。对受保护行禁用复选框：否决——那是比问题报告大得多的行为变更；行保持可选，对话框才能如实记账，而这正是跳过明细存在的理由。

**后果。** 用户点得动的东西现在与宿主的实际行为一致；删除语义未变——宿主仍是唯一权威，每次拒绝仍以带原因的 `skipped` 结果落地。覆盖：`tests/card-protection.spec.ts`（行内控件、全保护与混合选择、对话框跳过记账、旧宿主降级）、`tests/cascade.spec.ts`（合并优先级、`selectionFullyProtected`）、`tests/inventory.spec.ts`（线上字段的有与无）、`tests/janitor.spec.ts`（服务出去的清单如何报告 attached 行与 in-flight 行）、`tests/controller.spec.ts`（确认框计数与逐行跳过原因）。改动前后的卡片组件 DOM 捕获（同一份清单、同样的 jsdom 渲染）存放在仓库外的 `C:\\Users\\A\\Documents\\qa-2022-archive-evidence\\{before,after}.{json,html}`；真实安装上的 GUI 确认留给维护者，因此此处不宣称已有截图。
