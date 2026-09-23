# Agent Note: 内置会话归档管理插件（dsh-session-archive）

Status: implemented

## Problem

全家桶此前没有成规模管理会话的原生能力。唯一的归档入口是官方侧边栏的逐会话"归档"开关（一个注册表全局隐藏集合，alpha.2 SDK 没有取消归档动词），而此前的第三方归档管理器 `@mlgbnb/dsh-archive-manager` 因其构建仍 import 已移除的 `@deepseek-ai/dsh-client-runtime` 面而持续被排除在 alpha.2 全家桶之外。面对成百上千的冷会话，用户无法统一查看、批量归档、恢复或物理删除，也没有任何自动策略能安全回收磁盘空间。

## Decision

新增家族插件 `packages/dsh-session-archive`（`@linxin666/dsh-session-archive`），挂入聚合包（设置区 order 152，Workshop 之下），实现：

- **完整清单**：宿主侧一次合并五个事实源——权威会话 feed（`sessionController.list`，含冷会话且不激活 Agent）、工作区注册表（成员关系 + 全局归档集合）、投影缓存索引（标题/创建信息）、磁盘 sessions 根（大小、feed 缺失的行）、本插件归档台账。只有 feed 列出或磁盘存在的会话才成行——缓存或台账条目本身不会凭空造出行。段名规范化（`session-<uuid>` 与裸 uuid 目录）杜绝幽灵重复行。
- **归档/恢复**：归档走公开的 `workspaceRegistry.archiveSession`；取消归档与工作区行清理走注册表的持久域 seam（`requireState`/`setState`、entity `mutate`），域写入会发出变更事件，浏览器实时收到 `{ type: 'archived' }` follow 帧与工作区 upsert。seam 经特征检测，缺失时报 `missing-seam`，绝不绕过注册表直改 `workspace.json`。
- **物理删除管线**固定顺序：归档集合 → 工作区行 → 存储（先经指纹校验的 `node:sqlite` 删 rdb 行，再经 realpath 校验的 sessions 根索引删目录）→ 投影缓存 → 归档台账。任一步中断只会留下"已取消列表但数据还在"的可重试状态，绝不半删除。会话族级联：删除会话连带全部后代；族内任一成员受保护（feed running、活跃 SessionStore、客户端声明的当前会话、在途操作）则整族以 `family-protected` 跳过。删除路径只来自插件自己的索引；客户端只提交会话 ID，绝不提交路径。计划中每个跳过 id 只登记一次：经多个直选路径可达的成员仍只有一条记录，被直接选中且自身受保护的会话保留自身原因，不会被亲属族的 `family-protected` 条目抢先（#1503/#1504 的语义落在 `core/cascade.ts`；批处理总数与结果列表都由这份清单推导，重复项也会让进度条走不满）。
- **批量交互**：浏览器半区用与宿主相同的 `planDelete` 核心规则预演（`expectedTotal` 不符时宿主以 409 返回宿主计划），删除按会话族整族分块（每请求 <=200 条），实时展示进度与逐会话跳过/失败原因，支持仅重试失败项。因为清单在客户端是完整的，全选覆盖完整筛选结果集；筛选变化后保留选择并明确提示"N 项在当前筛选之外"。
- **自动策略相互独立且默认关闭**：自动归档按最后活动时间（feed `updatedAt`，带可靠性标记）；自动删除按台账记录的归档时间，要求时间已知且严格早于本次运行开始（同一轮内刚归档的会话不会被删除；插件之前的历史归档即归档时间未知者永不自动删除）。调度器（15–1440 分钟，开机补跑，fail-fast 操作锁）把运行统计与下次检查时间持久化在 `$DSH_HOME/dsh-session-archive/`。
- **列表渲染**：每页 20 条分页（上一页/下一页 + 页码指示；筛选与排序变更回到第一页），区块默认打开"已归档"视图。分页只是渲染窗口——全选始终覆盖完整筛选结果集。
- **i18n**：包内 zh 键源 + en 对照；ru 由 `dsh-i18n` 集中承载（`dsh-web-ui-session-archive` 命名空间）。

## Alternatives considered

- **恢复第三方 `@mlgbnb/dsh-archive-manager`**：否——其最新构建 import 已移除的 `dsh-client-runtime` 面，对注册表内部结构的访问缺少特征检测，也不具备需求要求的会话族级联、保护与台账语义。
- **直改 `workspace.json` 文件实现取消归档**：否——注册表持有内存中的持久状态，会把过期归档集合写回；只有域句柄写入（`setState`/`mutate`）既持久又对 feed 可见。
- **浏览器逐条调用删除**：否——违背"不许资源创建/销毁尖峰"的约束；按族分块的有界批量才是正确形态。
- **基于文件 mtime 的自动策略**：被时间口径要求否决——自动归档必须读最后活动时间、自动删除必须读记录的归档时间；二者都是权威 feed/台账事实。

## Consequences

- `pnpm i18n:check` 现审计 16 个命名空间 / 1298 个键；ru 包覆盖新命名空间。
- `sync-shared` 新增四份副本（mount-once、dsh-home、host/http、host/loopback）；`scripts/sync-shared.test.mjs` 的副本计数断言已同步更新。
- 外部 `@mlgbnb/dsh-archive-manager` 维持排除；根 README 功能清单的归档需求现指向内置插件。
- 新宿主面 devDependencies（`@deepseek-ai/dsh-workspace`、`@deepseek-ai/dsh-api-session-controller`）已加入根与 `dsh-web-all` 闭包，保证 link profile 解析。
- 外部归档管理器的聚合测试不变量（`aggregate.test.mjs`）未动——仍断言第三方插件不被挂载。

## Testing

- 包级套件：8 个 spec 共 71 个测试，覆盖级联计划（族展开、整族保护、去重、not-found）、时间口径规则（最后活动 vs 归档时间、未知归档时间排除、同轮守卫、默认关闭配置）、筛选/排序/选择语义、台账持久化、清单合并 + 幽灵/无数据行、sessions 根路径安全（符号链接逃逸）、rdb 指纹 + 级联删除、完整 janitor 管线（单删清除全部痕迹、运行中/当前/活跃保护、族保护、部分失败、计划不符、忙锁、自动循环、预览）、路由围栏与契约（回环 + 同源围栏、方法门、409 plan-mismatch/busy）、客户端分块/进度/重试。
- 仓库门禁全绿：`pnpm typecheck`、`pnpm test`、`pnpm test:scripts`、`pnpm aggregate:check`、`pnpm sync-shared:check`、`pnpm i18n:check`、`pnpm docs:check`、`pnpm build`、`pnpm runtime-deps:check`。
- 真实 DSH Web GUI 的端到端验证在 profile 挂载新 bundle 后另行记录验证快照。
