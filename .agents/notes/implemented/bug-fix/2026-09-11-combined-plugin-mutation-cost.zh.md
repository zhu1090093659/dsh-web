# Agent Note: 插件组合的 DOM mutation 开销（共享 body 观察器与合并的 shell 同步）

Status: implemented

Supersession check: 没有现行 note 拥有家族插件 DOM 观察成本这一决策。已退役的 dsh-perf 系列（[渲染管线 batch 2](../feature/2026-08-26-dsh-perf-render-pipeline-batch2.md)、[归因记分板](../feature/2026-08-27-dsh-perf-plugin-attribution-scoreboard.md)）优化的是官方渲染管线并做成本归因，它们记录了本 note 所据以行动的排名层，但未涉及观察器扇出与皮肤 shell 同步。[panel-mount-core 抽取](../simplification/2026-09-02-panel-mount-core-extraction.md) 产出了本 note 重新接线的共享核心。

## Problem

家族插件在 DOM 层挂载，因此每个插件都要观察 `document.body`，以便在 shell 围绕其注入节点重渲染时察觉。`sidebar-entry-core`（ssh、task-board、skill-explorer）、`panel-mount-core`（ssh、task-board）以及聚合包的兼容 shim 各自安装了一个 `{ childList: true, subtree: true }` 的 `MutationObserver`。因此带有 N 个家族插件的页面，会为应用产生的**每一个** mutation 批次付出 N 个原生观察器与 N 次回调；在出厂组合加用户可开启的可选行下，就是五到七个 body 子树观察器，且该数量随插件数增长。聊天 token 流式输出每秒产生大量批次，所以这正是用户感知为「流畅度」的交互期间的逐帧开销。

皮肤 shell 在此之上又加了逐批次工作。`installShellRenderingAdapter`（`packages/skins/skin-center/src/client/runtime/shell-rendering.ts`）对每个 mutation 批次都重跑 `document.body.querySelector(COMPOSER_SEAT_SELECTORS)` 与 `composer.getBoundingClientRect()`，随后即使测量值未变，也照样把 `--dsh-composer-height` 写到 `document.documentElement`。`startContentObserver`（`backdrop-scene.ts`）为维护 `data-dsh-conversation-content` 标记，对每个批次都重跑一次全 body 的 `querySelector`。

用受控 Chromium 基准测量（由 tsdown 从这些源码打包出的真实模块，400 条预置消息行，三个真实侧栏入口加 shell-rendering 适配器与 backdrop 内容观察器，5 秒风暴、301 帧、三轮）：五个 body 观察器每 5 秒触发 1503 次，回调内耗时 237 ms；`ScriptDuration` 69.6 ms，`TaskDuration` 984 ms。改在 `display:none` 容器内制造 mutation（页面无需绘制）的免布局变体，回调内仍耗 67 ms、脚本 71 ms。

## Decision

- **`shared/client/body-mutations.ts`** 每页拥有唯一一个 `document.body` childList 观察器。hub 以 `Symbol.for('dsh-web.body-mutation-hub')` 注册在 `globalThis` 上，因此各包经 `scripts/sync-shared.mjs` 生成的副本与各自打包的插件在运行时命中同一实例，而不是每个模块副本一个 hub。订阅者收到自上次 flush 以来累积的 records，且每动画帧最多运行一次；无 `requestAnimationFrame` 时同步 flush，无 DOM 或 `MutationObserver` 时订阅退化为空操作 disposer。最后一个订阅者离开即断开观察器。抛错的订阅者不会阻断其他订阅者。
- **`sidebar-entry-core`、`panel-mount-core` 与聚合包 shim** 改为订阅 hub，不再各自构造 body 观察器。它们的回调本就是幂等的重检查，因此合并只会去掉重复工作；用户可见契约由「同一微任务检查点内自愈」变为「下一帧前自愈」，两者都发生在绘制之前，因此不可感知。
- **`installShellRenderingAdapter`** 在 composer 保持连接时缓存已解析元素，仅在首次解析或断连后重新解析（保留 ResizeObserver 的重定向），测量值未变时跳过 `--dsh-composer-height` 写入，并把 mutation 驱动的测量合并为每帧一次。ResizeObserver 驱动的路径保持同步，以保留同帧的尺寸响应。
- **`startContentObserver`** 把内容检查合并为每帧一次，拆除时取消待处理帧，并且仅在属性不同时才写 `data-dsh-conversation-content` 与 `data-dsh-backdrop-active` 标记。
- **聚合包的 `ensureMobileDismiss`** 缓存 `[data-dsh-frame]` 元素，仅在其断连后重新查询，去掉了每 mutation 批次一次的全文档查询。

## Measured effect

后续的[插件组合闲置资源](2026-09-12-plugin-composition-idle-resources.md)补充了不保存记录的失效通知订阅、待处理帧清理，以及直接在共享帧中运行的 shim 检查。原有记录交付 API 继续可用。下列测量描述本 note 最初的观察器合并。

同一基准、同样三轮、可见风暴（每 5 秒 301 帧）：

| 指标（三轮均值） | 改动前 | 改动后 | 变化 |
| --- | --- | --- | --- |
| body 观察器回调次数 | 1503.3 | 902.0 | -40%（五个观察器降至三个） |
| 观察器回调内耗时 | 237.0 ms | 2.9 ms | -98.8% |
| `ScriptDuration` | 69.6 ms | 13.6 ms | -80% |
| `TaskDuration` | 983.9 ms | 725.3 ms | -26% |
| `LayoutDuration` | 148.5 ms | 124.3 ms | -16% |
| `LayoutCount` / `RecalcStyleCount` | 301.7 / 301.7 | 301.7 / 301.7 | 不变 |

逐轮观察器耗时改动前为 191-268 ms、改动后为 2.3-3.4 ms，区间不重叠。`LayoutCount` 不变是刻意的：可见风暴每帧都改 DOM，因此每帧一次布局是绘制本身的工作，不是插件造成的。免布局变体则隔离出自招的那部分（回调耗时 67.1 ms 降至 3.0 ms，`TaskDuration` 151.6 ms 降至 87.8 ms）。

局限：基准在受控页面驱动真实模块，而非完整 GUI；且聚合 bundle 的改动要在 DSH 重启后才到达正在运行的 GUI。真实 GUI 验证顺延至该次重启。

## Considered and declined

聚合 shim 的 `stampSemanticParts` 忽略了其 pass 已经算出的 `changed` 标志，因此四个全帧 `querySelectorAll` 扫描（`composer`、`pre`、`menu`、`treeitem`）即使每个属性都已打标也会每动画帧重跑。在 1365 节点帧上的实测开销：整个 pass 0.087 ms（composer 扫描 0.044 ms、menu 0.019 ms、treeitem 0.007 ms、`pre` 0.004 ms）。约占一帧的 0.5%，而把扫描收窄到新增子树会重写所有 DOM 挂载插件都依赖的兼容 shim，且无法做视觉验证。按此实测规模判定不值得承担该风险而放弃；结论留在此处，便于帧规模大幅增长时重新定价。

## Alternatives considered

- **保留每插件一个观察器，只各自合并回调。** 只做了一半：逐批次的原生回调数仍随插件数增长，而跨 bundle 共享正是让家族成本随行开启保持平坦的机制。拒绝。
- **用 cordis 服务而非 `globalThis` 共享观察器。** 长期词汇上更正确，但折叠子项的浏览器半区是作为嵌套 client 插件挂载的，而这些 DOM 挂载核心刻意不依赖框架（纯 DOM、无 cordis context），以便在 shell 就绪前运行；引入服务会给这些目前无任何依赖的文件强加 context 依赖。暂缓，未拒绝。
- **hub 改为微任务 flush 而非动画帧。** 能保留旧的同检查点时序，也就不必调整 task-board 测试。拒绝，因为逐帧合并才是约束流式期间工作量的性质；当 React 在彼此独立的任务中提交时，微任务 flush 一帧内仍可能跑多次。
- **把 composer 高度改为完全由 ResizeObserver 驱动，从 mutation 路径去掉 `getBoundingClientRect`。** 能去掉最后一处强制布局读取，但在 ResizeObserver 回调中写自定义属性会在同一帧重新使布局失效，并触及观察器循环上限；还需要本次任务无法执行的视觉验证。留作后续。
- **复活已退役的 `dsh-perf` 插件。** 它测量并约束的是官方管线，不是家族插件自身的观察成本，且已从聚合包墓碑化。此处成本可在源头消除。

## Consequences

- 家族 DOM 观察成本随安装插件数变为平坦：每页一个原生 body 观察器，无论开启多少家族行，且每个订阅者每帧只运行一次。
- `body-mutations.ts` 成为有四个生成副本的共享契约；新增消费者需在 `scripts/sync-shared.mjs` 增加 target，副本由 `sync-shared --check` 把关。
- mutation 驱动的自愈、composer 高度与 backdrop 标记更新最多顺延一个动画帧。正常情形下绘制前无差异；若页面在其所在帧的动画回调之后才发生 mutation，则在下一帧自愈。
- hub 的缺陷会同时影响多个插件，而不是一个。失败策略刻意 fail-open：无 DOM、无 `MutationObserver` 或订阅者抛错时，其余消费者仍照常工作。
- 聚合包的 `lib/client.js` 内联了家族客户端源码，因此任何子包客户端改动都必须重建 `@linxin666/dsh-web-all`；本次改动作了该重建。

## Testing

- `shared/tests/body-mutations.spec.ts`，5 例：多订阅者只用一个原生观察器、records 按帧合并送达每个订阅者、抛错订阅者不阻断其他订阅者、hub 在最后一个订阅者前后被丢弃与重建、无 `MutationObserver` 时 disposer 为空操作。
- `packages/skins/skin-center/tests/shell-rendering.spec.ts` 与 `backdrop-scene.spec.ts`，8 例：高度未变时在多次突变中只写一次、真实高度变化被写入、被替换的 composer 重新解析并重新观察、dispose 取消待处理工作、缓存 composer 仍连接时跳过 body 查询、内容标记合并且无冗余写入、行出现与消失每帧只更新一次、最后一个 scene 来源清除时取消并清理。
- `packages/dsh-task-board/tests/board-view.spec.tsx` 的重挂载用例改为等待合并帧。
- 门禁：`pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm aggregate:check`、`pnpm skin-center:check`、`node scripts/sync-shared.mjs --check` 全部通过。
