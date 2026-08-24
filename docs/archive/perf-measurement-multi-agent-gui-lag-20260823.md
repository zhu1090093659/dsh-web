# 测量报告：多子代理并行开发期间 DSH Web GUI 卡顿（2026-08-23）

## 事件

session-24fdae5a（标题「处理远程仓库Issue」，8-13 23:47 - 8-14 17:34）在 wave 方式下累计启动 63 个子代理
（约 34 个实施子代理 + 等待/检查辅助），同刻最多约 5-7 个并行。每个实施子代理：git worktree add
（全程约 20 个，dsh-web-ui-wt/*）、worktree 内完整 pnpm install（monorepo 约 580 包）、vitest
（部分包 300-480 用例）、tsc/tsdown 构建、多数还执行 codegraph init（每份索引约 75MB SQLite）。
用户感知 GUI 整体卡顿；服务无异常日志；子代理全部结束后卡顿消失。

## 测试环境

- 机器：Apple M5，10 核，16GB 内存。实验开始时 swap 已用约 4.5GB（Chrome 等常驻）。
- DSH 宿主：node dsh web（PID 31646），监听 127.0.0.1:3080。
- 负载模型：每「虚拟子代理」= 独立 worktree（/tmp/dsh-loadtest/wt-N，从 dev HEAD 切出）
  + pnpm install --prefer-offline + 循环执行 packages/dsh-pet 的 vitest run（33 文件 / 372 用例，
  单次 3.1s wall / 11.5s user）与 pnpm typecheck。
- 测量：5s 间隔采样 loadavg / memory_pressure / swap / DSH 宿主 CPU / GUI HTTP 延迟
  （GET / 与 /status 的 curl time_total）；headless Chrome CDP 测量前端 longtask 与 rAF 间隙
  （解除帧率限制后的 rAF 间隙直接反映渲染主线程可用性）。

## 梯度结果（中位数取自稳态窗口）

| 负载 | load1 峰值 | 内存空闲最低 | swap 变化 | GUI 中位 | GUI p95 | GUI max | >1s 尖峰次数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 空闲 | 6 | 48% | - | 1.3ms | 103ms | 103ms | 0 |
| N=1 | 11 | 40% | - | 1.9ms | 6ms | 99ms | 0 |
| N=3 | 31 | 31% | +162MB | 2.9ms | 3876ms | 3876ms | 1 |
| N=5 | 49 | 31% | +1030MB | 4.1ms | 3920ms | 3920ms | 2 |
| N=5 + nice19 | 52 | 34% | 峰值 6865MB | 96.8ms | 7706ms | 7706ms | 4 |
| N=7 | 59 | 29% | +1281MB | 10.5ms | 3278ms | 3278ms | 2 |
| 纯 CPU 饱和 x8 | 20 | 57% | - | 1.8ms | 547ms | 547ms | 0 |

每次实验 CDP 前端测量（8s 窗口）：longtask 0-1 个（最大 132ms），rAF 间隙 p95 均 <= 0.3ms。

## 因果表（负载源 -> 资源 -> 卡顿层）

| 负载源 | 被挤占资源 | 卡顿层 | 证据 |
| --- | --- | --- | --- |
| N>=3 路 vitest/tsc 并行 | 内存 -> swap 抖动 | DSH 宿主进程响应（HTTP 层秒级尖峰） | 内存空闲 <35% 的采样点 GUI 延迟中位约 1.3s，>=35% 的采样点中位约 3ms，相差约 400 倍；尖峰时刻宿主 CPU 占用反而低（0.2-10%，进程被换出/缺页卡住） |
| N>=5 路并行 | CPU 饱和（us 81-85%，id 0-1%） | GUI 中位延迟随 N 上升（1.3 -> 10.5ms） | 对照纯 CPU 饱和（load 20、内存空闲 57%）中位仅 1.8ms、无 >1s 尖峰，说明 CPU 单独只造成亚秒级毛刺 |
| 每 worktree 重复 pnpm install / codegraph init | 磁盘 IO 与内存（瞬时） | 加剧内存压力窗口的出现频率 | 事件期 20 个 worktree x 全量 install + 每份 75MB 索引写入；实验中 N=5/7 时 disk 1680-2276 tps、swap +1.0-1.3GB |

## 被排除的假设（附排除证据）

1. **GUI 前端渲染大历史会话变慢**：9 天前的 34 子代理会话（85k 事件行 / 23MB）在空闲系统打开后仅渲染
   约 6.7k DOM 节点（历史已分页/虚拟化），8s 窗口 longtask=0、rAF p95=0.3ms、滚动帧 p95=1.7ms，
   与新会话（1149 节点）同样流畅。
2. **浏览器渲染进程被 CPU 饿死**：各负载等级下 headless Chrome 的 rAF p95 始终 <= 0.3ms，longtask <= 1 个。
   注：用户真实 Chrome 进程内存占用大，在 swap 抖动期被换出后的恢复卡顿会比 headless 新 profile 更重，
   但这属于内存压力的下游表现，不是前端代码问题。
3. **DSH 服务内部故障**：服务无异常日志；卡顿时刻宿主进程 CPU 占用低，系被系统层换出/调度饥饿，
   而非自身死循环。
4. **nice 降优先级可修复**：N=5 + nice 19 实测中位 96.8ms、p95 7.7s，比不降优先级更差（尖峰仍在且
   内存压力窗口不变），排除。

## 结论

根因是 **内存压力引发的 swap 抖动使 DSH 宿主进程（及用户真实浏览器）被换出/缺页停顿**，
CPU 饱和只是次级因素（贡献中位延迟的毫秒级上升与亚秒毛刺）。
可消除因素：无并发上限的 wave 调度、每 worktree 重复 install、每 worktree 重复 codegraph init。
必然因素：同机多路 vitest/tsc 的内存与 CPU 占用本身——只能靠并发上限控制。

## 修复验证

| 方案 | 测量 | 结论 |
| --- | --- | --- |
| 实施子代理并发 <=3 | N=3 仅 1 次 >1s 尖峰（3.9s），对比 N=5（2 次）与 N=5+nice（4 次、7.7s） | 有效，纳入纪律 |
| 子代理 nice 19 | 中位 96.8ms / p95 7.7s | 无效，明确排除 |
| 每 worktree install --prefer-offline + 禁止 worktree 内 codegraph init | 实验安装均 31s（store 命中）；避免每份 75MB 索引写入 | 有效（减少内存/IO 峰值窗口），纳入纪律 |
| GUI 前端改动 | 前端层被排除，不需要改动 | 不改 DSH 源码与本仓插件 |

## 复现工件

- 采样器与负载脚本：/tmp/dsh-loadtest/sampler.sh、load-worker.sh、load-worker-nice.sh（临时目录，按需重建）。
- CDP 测量脚本：/tmp/cdp-perf.mjs（用法：node cdp-perf.mjs newsession|bigsession|current <tag>）。
- 原始采样：/tmp/dsh-loadtest/metrics-*.csv。
