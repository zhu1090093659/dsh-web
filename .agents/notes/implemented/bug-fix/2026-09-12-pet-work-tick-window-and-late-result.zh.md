# Agent Note: 宠物工作判定窗口跟随配置节奏，迟到判定被丢弃

Status: implemented

## Problem

宠物工作模式的两个缺陷：

1. 注入 API 入口的 `workTick` 用写死的 8500ms 窗口节流（`now - lastWorkTickAt < 8500`），而 HUD 的工作
   循环按 manifest 的 `gameplay.work.tickMs` 触发，该字段自身的合法范围是 1000–60000ms。任何配置低于
   8.5 秒的宠物都会被静默降频——`tickMs: 2000` 时判定约每 10 秒才跑一次——配置被无声推翻（#1494）。
2. 工作循环的 `.then` 回调无条件应用结果。判定在途时退出工作模式，返回的工作视图仍会被写回 store 并
   播放成败轨道，于是用户已经离开的模式会短暂地报告工作收益（#1495）。只有后续定时器检查了模式，回写
   没有。

## Decision

1. 节流逻辑移入 `src/client/work-tick-gate.ts`。`workTickWindowMs(tickMs)` 返回当前宠物的节奏并夹到
   manifest 自有的 `[1000, 60000]` 边界内，注册表条目未知时回退到 10000ms（内置宠物的取值）。
   `createWorkTickGate(now)` 保留原始意图——全页面每个窗口只判定一次，使热重载产生的重复实例无法重放
   结果——`reset()` 在进入工作模式时重新武装。写死的 8500 常量已移除。客户端从 store 的注册表列表与
   快照宠物 id 解析节奏，因此动词签名不变。
2. 工作循环回调在 `modeRef.current !== 'work'` 时提前返回，迟到结果既不写视图也不播轨道。

## Verification

- `pnpm --filter @linxin666/dsh-pet test`：43 个文件、511 条测试通过。新增覆盖：gate 模块（窗口跟随
  节奏、夹取边界、缺省值；每窗口一次判定；reset 重新武装）以及一条 HUD 用例——在判定 RPC 未完成时退出
  工作模式，断言 store 保持 `mode: null` 且不播放成功轨道。
- `pnpm --filter @linxin666/dsh-pet typecheck`：通过。

## Alternatives considered

把 `tickMs` 由 HUD 传进 `workTick` 被否决：那会改变动词签名、`GameplayApi` 接口以及所有测试 mock，
而 store 本就携带窗口所需的注册表定义。

完全去掉节流被否决：热重载后可能同时存在多个 HUD 实例，没有共享闸门时每个都会判定并重放结果——正是
原注释描述的那个故障。

只依赖 HUD 的 `busyRef` 被否决：它只守护单个组件实例，不是整个页面。

按报告建议给动词结果加显式"被节流"标记被否决：没有 `outcome` 的 `{ ok: true }` 在 HUD 中本就是空操作
（没有视图可写、没有轨道可播），该标记只会为所有调用方扩大结果类型。

## Consequences

配置低于 8.5 秒节奏的宠物现在能按其配置频率判定，窗口也始终跟随宠物自身配置而非常量。极小的 `tickMs`
（manifest 下限 1000ms）意味着成比例增多的宿主判定，这正是该配置所要求的。
