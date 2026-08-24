# 多代理并行开发资源纪律（multi-agent-resources）

多子代理并行工作流（如 /code-optimization 的 wave 实施）与本机 DSH Web GUI 共享同一台机器的 CPU 与内存。
本文定义这类工作流的资源上限与复用规则；实测依据见 [archive 测量报告](archive/perf-measurement-multi-agent-gui-lag-20260823.md)。

## 适用范围

- 一个会话同时派出多个实施子代理，且子代理执行 worktree 创建、依赖安装、测试或构建等重负载动作。
- 运行 DSH 服务（dsh web）的机器同时承载 GUI 交互。

## 硬性上限

- **重型实施子代理并发 ≤ 3**。重型 = 子代理内会做 pnpm install / vitest / tsc / 构建之一。
  实测：3 路并行时 GUI 已出现秒级响应尖峰；5-7 路时中位延迟与尖峰频率显著恶化。
- 轻量调查类子代理（只读、不跑门禁）不受本条限制，但仍受 settings 的 subagents.maxConcurrent 全局上限约束。
- 全仓重型门禁（全量 vitest / typecheck / build）由主会话在 wave 结束后串行执行，不与实施子代理并行。

## 复用规则

- worktree 内 pnpm install 必须加 --prefer-offline，复用共享 pnpm store，禁止离线下载全量包。
- 子代理禁止在各自 worktree 内执行 codegraph init；代码索引只在主 checkout 维护一份（每份索引约 75MB SQLite，且构建本身吃 CPU/IO）。
- worktree 用完立即 git worktree remove，不堆积。

## 内存预算

- 以 16GB 内存机器为基准：每个重型子代理按 1-1.5GB 常驻 + 测试期瞬时峰值估算。
- 出发 wave 前查 memory_pressure 的系统空闲百分比；低于 40% 时先降并发再开工。
- swap 已用量高（>4GB）时，同样并发下的卡顿会显著放大。

## 已知无效的手段

- 给子代理进程降优先级（nice 19）：实测不能消除 GUI 秒级卡顿，因为瓶颈是内存压力与 swap 抖动而非 CPU 调度。不要把它当修复手段。

## 卡顿排查顺序

GUI 卡顿时按此顺序取证，不要先猜：

1. memory_pressure 空闲百分比与 vm.swapusage 的 swap 增量——最常见的根因。
2. top / ps 的 CPU 饱和进程（区分负载进程与 DSH 宿主进程）。
3. DSH 宿主对 / 与 /status 的响应延迟（curl time_total）。
4. 前端渲染层（CDP longtask / rAF 间隙）——历史会话渲染已分页虚拟化，通常不是根因。
