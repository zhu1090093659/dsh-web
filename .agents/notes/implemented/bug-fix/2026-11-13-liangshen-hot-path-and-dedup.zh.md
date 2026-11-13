# Agent Note: 梁神热路径收敛、辅助函数去重与 YAML 原型链安全加固

Status: implemented

本笔记负责 `packages/dsh-liangshen` 的单步热路径执行结构、共享持久化事件日志辅助函数、宿主预设覆盖缓存、YAML 映射原型链安全与输入栏拉杆热路径守卫，在不改变用户侧与模型侧契约的前提下细化 [LiangShen shell 与分页让 PTC 成为真正被执行的呈现](../feature/2026-09-17-liangshen-shell-and-paging-ptc-surface.zh.md)、[梁神模式改以 user 角色送达工作区指令](../feature/2026-09-17-liangshen-workspace-instructions-user-role.zh.md) 与 [新会话输入栏里的梁神拉杆](../feature/2026-09-11-liangshen-composer-lever.zh.md) 的运行时实现。

## Problem

长会话下的梁神模式在每一步或每次工具调用时都会面对不断增长的持久化事件流执行 `tools/post-execute`、`tools/result`、`system-prompt/assemble` 与 `agent/pre-step`。每次分页同步对工具全集做三次独立切分、在每次常驻只读工具调用后无条件重同步作用域限制、对 `plan/mode`、`todo/write`、`fact_register`、`tool/result` 与 `tool_activate` 分多趟扫描事件日志、每步分配 `Set` 查找最近一条可见插件消息、在四个预设模块间维护重复的日志遍历辅助函数，以及在 `instructionSource` 为 `'host'` 时仍追踪 `touchedDirs` 并重放 `snapshotEvents()`，都会随会话增长累积线性的单步 CPU 与内存分配开销。

在宿主与浏览器侧，单次激活内在重复的 `rearm()` / `declare()` 调用（如 `loader/volatile-update` 设置写入）时重新解析基础 `PresetDefinition`、用中括号属性赋值写入解析出的 YAML 映射键值（使 `'__proto__'` 键篡改目标对象原型而非定义自有可枚举属性）、在非空白会话（`!facts.blank`）上执行 `detectPreset()` 的 DOM/存储读取与 `restoreLabel` 计算，以及在控制器生命周期内（主要是渲染拉杆并调用 `face.t(...)` 的空白会话上）重复创建 `face()` 实例与重复解析 `locale.bind('liangshen')` 翻译函数，同样带来冗余开销并在 `parseMap` 中留下原型链污染隐患。

## Decision

1. **单次切分分页与选择性执行后重同步（`presets/liangshen/tool-catalog.mjs`、`presets/liangshen/paging.mjs`）。** `syncScopePaging` 通过 `partitionWireTools(fullSurface, pagedToolPatterns, [])` 对 `fullSurface` 只做一次切分，取代三次独立切分；当作用域已完成分页且刚执行的工具属于常驻非激活工具（既非 `tool_activate`、`run_code`，也不匹配 `pagedToolPatterns`）时，`tools/post-execute` 跳过 `syncBeforeAssembly`；`system-prompt/assemble` 在单趟遍历中同时统计常驻面 token 数与最重的前 3 个工具；渲染后的目录文本按组装状态做记忆化缓存。
2. **工作上下文单趟归约与持久化日志辅助函数收敛（`presets/liangshen/working-context.mjs`、`presets/liangshen/fact-ledger.mjs`、`presets/liangshen/paging.mjs`、`presets/liangshen/tool-activate.mjs`、`presets/liangshen/subagent-routes.mjs`）。** `renderWorkingContext` 在单趟遍历中同时归约 `plan/mode`、`todo/write`、事实账本（经共享的 `applyFactLedgerEvent`）、报错的 `tool/result` `callId` 集合与 `tool_activate` 出现标记，并在不存在 `tool_activate` 事件时直接跳过激活重放；共享的 `sessionEvents`（延续 [session events SDK 兼容适配](2026-09-03-liangshen-session-events-sdk-compat.zh.md) 并用 `try/catch` 包裹 `snapshotEvents`）、`textOf`、`latestVisiblePluginMessage`（使用 `nodes.lastIndexOf` 避免每步分配 `Set`）与 `reconcileStepMessage` 统一收敛在 `presets/liangshen/paging.mjs`，替换 `tool-catalog`、`working-context`、`tool-activate` 与 `subagent-routes` 中的重复实现。
3. **`minimal-prompt` 的指令追踪门控（`presets/liangshen/minimal-prompt.mjs`）。** `tools/result` 与 `getSessionState` 仅在 `instructionSource === 'system-prompt'` 时执行 `touchedDirs` 追踪与 `snapshotEvents()` 重放，其余模式下直接早退并保留已注册监听器以维持契约兼容，同时 `'system-prompt'` 重放同时覆盖 `tool/call` 与 `tool/ptc-dispatch`。
4. **宿主单次激活声明缓存、YAML 原型链安全与浏览器拉杆热路径裁剪（`src/index.ts`、`src/composition.ts`、`src/client/lever-controller.ts`）。** 在每次 `applyImpl` 激活闭包内，`basePreset` 惰性缓存解析后的基础 `PresetDefinition` 并在重复的 `rearm()` / `declare()` 调用间复用且不原地修改；`parseMap` 通过 `Object.defineProperty` 定义键，使 `'__proto__'` 保持为自有可枚举属性；`LeverController` 将 `detectPreset()` 的 DOM/存储查询与 `restoreLabel` 计算限定在 `facts.blank` 为真时执行（在非空白会话上跳过），并在控制器生命周期内缓存 `face()` 实例及惰性解析后的 `locale.bind('liangshen')` 翻译函数。

## Alternatives considered

- **跨步在内存中增量缓存激活集与工作上下文状态，而非归约 `snapshotEvents()`。** 否决：会话压缩、分叉与恢复会在进程内存下方改写或替换持久化事件流；单趟纯归约配合选择性跳过钩子既能取得主要加速，又能保持重放确定性。
- **在 `run_code` 调用后也像原生常驻工具那样跳过 `syncBeforeAssembly`。** 否决：在 `ptc` 呈现下，`run_code` 程序内部可经 `tool/ptc-dispatch` 调用 `tool_activate` 或已激活的分页工具，从而在下一次提示词组装前改变激活集合或 LRU 顺序。
- **当 `instructionSource !== 'system-prompt'` 时直接省略 `minimal-prompt` 的钩子注册。** 否决：保留监听器注册可维持各模式下统一的钩子拓扑与契约预期，而常数时间的门控早退已将该模式的运行时开销降至零。
- **在 `parseMap` 中使用 `Object.create(null)` 而非对普通对象调用 `Object.defineProperty`。** 否决：下游调用方与结构断言依赖解析结果具备标准 `Object.prototype` 行为，`Object.defineProperty` 在保留普通对象原型的同时即可消除 `'__proto__'` 访问器副作用。

## Consequences

分页限制、目录渲染、工作上下文对账、`system-prompt` 触碰目录发现（同时覆盖 `tool/call` 与 `tool/ptc-dispatch`）、宿主预设覆盖与输入栏拉杆行为均保持原有外部契约。持久化日志辅助函数统一归口于 `presets/liangshen/paging.mjs`，单次激活内缓存的基础预设定义在同次激活内重复的 `rearm()` / `declare()` 重声明间保持不可变，且 `parseMap` 将 `'__proto__'` 键安全地作为普通自有数据属性处理。

在 Node v24.21.0（`linux x64`）上的 100 步 5 轮中位数基准测试中，1,500 事件规模下的全管线耗时为 21.54 ms（基线 38.22 ms，下降 43.6%）。在 3,000 事件的分钩子拆解中，`tools/post-execute`（`read`）为 0.09 ms（基线 14.04 ms），冷态 `tools/result`（`host` 模式）为 0.00 ms（基线 1.37 ms），`system-prompt/assemble` 为 17.87 ms（基线 19.44 ms），`agent/pre-step` 为 14.71 ms（基线 28.05 ms）。

## Testing

通过 `pnpm --filter @linxin666/dsh-liangshen test`（23 个文件，461 项测试全部通过）、`pnpm typecheck`、`pnpm --filter @linxin666/dsh-liangshen build`、`npx oxlint --deny-warnings packages/dsh-liangshen`、`pnpm test:standards`、`pnpm i18n:check`、`pnpm emoji:check`、`pnpm docs:check`、`pnpm aggregate:check` 与 `pnpm libs:check` 验证。
