# Agent Note: 面向 #1372 UI 门控的家族行状态路由

Status: implemented

## Problem

停用聚合包的某个家族行（`web-ui-market`、`web-ui-plugin-manager` 等）只影响宿主半：loader 不会启动该 entry，行的后端通道随之消失；但 aggregate 客户端 bundle 仍然无条件注册该行的设置 tab。tab 保留且点击报错——这就是 #1372 的诉求。第一次修复尝试（v0.3.15）用 `__DSH_BOOT__.entries` 做挂载门控，次日即被回退（[聚合子插件挂载的 boot wire 形状](../../implemented/bug-fix/2026-09-05-aggregate-child-mount-boot-wire-shape.zh.md)）：boot entries 只携带已伺服 bundle 的包名 id，无法表达行级状态。回退恢复了服务，但 #1372 保持未解决：被停用的行仍留着可见的 UI 入口。

## Decision

让 aggregate 的浏览器半拿到「哪些家族行处于活跃状态」的权威答案，由 aggregate 自己的宿主半提供服务，走每个家族插件已在用的同插件路由惯例（同源 fetch 到 `webServer.register` 路由，同任务看板的 `HttpTaskBoardHostTransport`）。

宿主半（`packages/dsh-web-all/src/rows.ts` + `src/shell.ts`）：

- `src/rows.ts` 持有活跃行 ledger：真实插件包名的模块级 Set。每次拿到合法 `config.plugin` 的 shell apply 在 apply 开始时记录该名字——而非成功启动后：已启用但降级的行保留其 UI 入口（诚实状态），只有被停用的行（loader 从未 apply）离开 ledger。entry dispose 时移除（`ctx.effect` 清理回调）。
- 每个 shell entry——包括无配置的 self 行 `web-ui-compat`——都经同一个共享引用计数持有两条健康路由（`holdHealthRoutes`）：首个 entry 注册一次，末个 entry 随 dispose 拆除，因此即使全部家族行被停用，`GET /api/dsh-web-all/rows` 仍然存活。这把提案的「self 行负责注册」放宽为「每个 entry 共同持有」——一个引用计数覆盖两条路由。注册经由每个 entry 的嵌套 `ctx.inject(['webServer'], cb)` fiber（2026-09-09 修复）：shell 以 `inject = []` 运行，早于 web 应用提供 `webServer`，apply 时的同步读取必然落空、路由永不注册——嵌套 fiber 在服务出现时启动，在无该服务的宿主上则永不启动。
- `GET /api/dsh-web-all/rows` 返回 `{ ok: true, children: ["@linxin666/dsh-client-ui-market", ...] }`——活跃的真实插件包名。与 degraded 路由不同，它不做 loopback 栅栏：远程浏览器（remote-web-ui）需要同源读取它做门控，且 payload 不暴露任何已发布 bundle 之外的信息。

浏览器半（`src/client/mount-children.ts`）：

- 挂载前 fetch 该路由，带 1500ms `AbortController` 超时与防御性形状校验。任何不确定——网络错误、非 200、形状不符、非 JSON body、超时、路由不存在（旧版宿主半）——都视为「未知」，门控失败放行：全部家族子插件照常挂载，与门控前的热修行为逐位一致。只有路由返回了形状完好的活跃集合、且其中缺少某子插件名时，才允许隐藏该子插件。
- `mountClientChildren` 变为 async，但客户端 `apply` 不等待它——fire-and-forget 加错误日志，因为同一个 `apply` 还负责时间敏感的 DOM shim 与启动遮罩退场，不能排在一次网络 fetch 之后。各 tab 晚几十毫秒注册，无其他顺序依赖。这是对提案「apply 等待它」的刻意偏离。
- 双挂载保护不变：自身包 id 出现在 `__DSH_BOOT__.entries` 中的子插件仍先被跳过（独立安装优先）。

一致性门禁：`packages/dsh-web-all/tests/children-consistency.spec.ts` 双向断言这个连接——每个 client child 恰好有一条家族行在 `config.plugin` 里携带它的名字；每条真实插件带客户端面（`dsh.client` + `exports["./client"]`）的家族行都在 `children.specifiers.json` 里——未来新增家族不会静默破坏行配置与客户端 ledger 键的连接。

管理入口：rows 路由是读半；写半（逐行启停开关）见[聚合行级插件管理](2026-09-09-aggregate-row-level-management.zh.md)。

## Alternatives considered

- 查询宿主 `loader` 服务（`inject: ['loader']`，读 `entry.options.id`/`options.name`/`entry.disabled`）：信号最权威（能求值 `!!js` 禁用表达式与祖先继承），但把插件耦合到宿主 loader 内部实现，且相比 ledger 无增益——loader 只启动已启用的行，shell apply 缺席即意味着停用，无论原因是什么。
- 复用官方插件清单 UI 的数据源：那是宿主内部实现，随宿主版本变化，不是已发布的插件契约；同样的耦合问题。
- 先挂载再裁剪（全部挂载，fetch 返回后注销 tab）：slot 与副作用清理在每个家族 UI 上都不可靠；先可见后消失的 tab 比稍延迟的挂载更糟。
- 服务端裁剪（按行伺服独立 client bundle）：重构单 bundle 聚合架构；[#1372 讨论](../../implemented/bug-fix/2026-09-04-multi-issue-landing-1368-1370-1372-1359.zh.md)中已因性能与结构原因否决。

## Consequences

- 启动时序发现（2026-09-09）：同样的同步读取缺陷意味着 degraded 路由自引入以来在生产中从未真正注册过——单测全部在 apply 前就备妥 webServer，构成纯 mock 验证盲区。两条路由现均经 inject fiber 注册；`rows-ledger.spec.ts` 带有回归测试断言 webServer 出现前路由缺席、出现后注册。
- chunk 拆分发现（2026-09-09）：构建产物经两个入口 artifact 加载（self 行走 `lib/index.js`，家族行走 `lib/shells/shell.js`），bundler 的 chunk 拆分让每个入口持有自己的模块拷贝，模块级状态因此静默分裂。第一症状：两份拷贝都注册健康路由产生 duplicate 告警；更糟的第二症状：抢到注册的拷贝伺服自己的空 ledger，`children: []` 这个「形状完好但内容错误」的回答让客户端门控隐藏了全部家族页签——失败放行只能覆盖不确定性，覆盖不了「错误的确定」。shell 全部状态（活跃行 ledger、degraded ledger、路由引用计数）现集中于 `src/state.ts` 的 globalThis 注册表（Symbol.for 键，与客户端 mounted-plugins 去重同一手法）；`vi.resetModules()` 双导入测试模拟该分裂。包级 AGENTS.md 已禁止本包使用模块级可变单例。
- 每次页面加载多一个同源 GET（几百字节，`no-store`），宿主端一个内存 Set，shell/client 合计约一百行外加测试。无 schema、协议或磁盘格式变更；路由纯增量且版本偏差安全（404 降级为失败放行）。
- 验证：`pnpm --filter @linxin666/dsh-web-all test`（42 个测试，含门控、失败放行、ledger 与双路由引用计数十项用例），包级 typecheck 与 build 通过。
- 桌面版：桌面应用就是同一 origin 上的 Electron 窗口，路由与门控原样适用；失败放行规则吸收任何 cohort 偏差。
- 残余边界（接受）：compat 行与全部家族行都被停用时无路由持有者，客户端失败放行，为已停用行显示 tab（前 0.3.15 行为）。插件管理器整包停用会强制保留锁定行（compat、settings、manager），所以从 GUI 无法进入这个状态。
- 该路由与所有插件 `/api` 路由一样不鉴权；它只泄露活跃家族子插件名。接受为平台既有水平；若平台未来提供路由级鉴权再跟进。
- 页面保持打开期间的行切换只在 loader 的插件变更刷新后生效；与 degraded 路由同一新鲜度模型。

## Testing

- `tests/rows-ledger.spec.ts`：ledger 顺序、self 行持有路由、dispose 记账、无栅栏远程读取、降级但活跃的诚实性。
- `tests/client-children-mount.spec.ts`：停用即隐藏的门控，加失败放行矩阵（路由不存在、非 200、形状损坏、非 JSON）。
- `tests/shell-isolation.spec.ts`：#1363 单例测试现在断言 17 个 entry 下两条路由各注册一次、随最后一个 entry 一并拆除。
- `tests/children-consistency.spec.ts`：上述行配置/客户端子插件连接门禁。
