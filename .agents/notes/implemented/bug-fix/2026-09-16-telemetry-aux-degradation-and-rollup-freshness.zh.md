# Agent Note: 遥测汇总软降级辅助扫描并标注滚存新鲜度

Status: implemented

## Problem

tv.dsh-market.com 看似丢失了 2026-09-14 与 2026-09-15 的数据。原始数据从未丢失——D1 中两天分别有 158,721 与 151,707 条心跳行——但从 2026-09-14 01:01 UTC 到 2026-09-16 00:01 UTC，所有汇总重算全部失败（01:30 UTC 的 cron tick 对 30/365 天窗口记录 `D1_ERROR: out of memory: SQLITE_NOMEM`，同时 D1 连小的 relay 写入都以过载拒绝），`handleTelemetrySummary` 于是一直回退到 2026-09-13 06:07 UTC 计算的旧滚存。看板唯一的新鲜度信号是客户端取数时刻，三 天前的滚存因此被读成「数据丢失」，而不是缓存滞后。

事故期间对生产库实测：30 天心跳日序列 4.2 秒（扫 433 万行索引）、渠道分组 11.3 秒、条目页 12.2 秒，版本分组即使单独走 HTTP API 也直接失败（Cloudflare internal error 7500）。按每天约 15 万行的增长，所有窗口都会继续恶化——[滚存缓存笔记](2026-09-01-telemetry-summary-rollup-cache.zh.md) 当年就预言了 90/365 天窗口的结局，如今 30 天窗口也加入了。

## Decision

- 渠道/版本分布降级为辅助数据并失败即软降级：各自独占单语句 batch，当 COUNT(DISTINCT) 扫描失败（SQLITE_NOMEM）时，`telemetrySummary` 记录 `[summary-aux] <label> skipped`、返回空分布并在载荷上标记 `degraded: ["channels" | "versions"]`。日序列、条目页、总数与当日活跃始终精确；这些核心扫描一旦失败，整个窗口仍按原设计回退到旧滚存。
- 每个汇总载荷带 `generated_at`（滚存计算时刻的 epoch 毫秒；读缓存保留原值，因此回退快照的年龄可见）。看板在取数时刻旁渲染该值（「数据滚存于」），滚存年龄超过 TTL 两倍（30 天内窗口 1 小时、更长窗口 24 小时）时给出警示，并列出被跳过的分布——冻结的滚存不再能冒充数据完整。
- 九个聚合从四个 batch 改为五个：一个轻量批（pv 日序列、hb 日序列、热门路径、路径总数、当日活跃）加四个单语句批（渠道、条目页、条目总数、版本）。该批形状已被 [按日滚存流水线](2026-09-20-telemetry-daily-rollup-pipeline.zh.md) 取代：汇总改为三个 batch 读滚存表，软降级路径仍用于辅助分布。

## Testing

`scripts/market-worker.test.mjs`：更新批次形状断言（一个五语句轻量批加四个单语句批）；新增用例钉住版本/渠道扫描失败时仍返回 200、对应分布为空、`degraded` 在载荷与缓存滚存中都标记、兄弟分布与日序列不受影响；`generated_at` 同时存在于载荷与缓存行。`scripts/telemetry-view.test.mjs`：外壳含 `generated` 与 `stale-warn` 元素、客户端渲染新鲜度状态。部署证据：两个 worker 均已重新部署（dsh-market `92e28a74`、dsh-market-telemetry-view `4ce2ae4a`）；其后的 cron tick 以 `degraded: ["versions"]` 刷新了 30 天首屏滚存，看板重新显示 09-14/09-15。

## Alternatives considered

- 进一步拆分重语句或重试：版本扫描单独执行都会失败，任何 batch 形状都救不了；只有更省的查询形状才行。
- 按条目的预聚合事实表（2026-09-01 笔记搁置的终态）：仍是增长规模下精确窗口去重的根治方案，但涉及写入路径重设计加回填；本次靠软降级先恢复看板窗口，再次顺延。
- 砍掉 90/365 天窗口：在「旧滚存回退 + 新鲜度展示」能可读地退化之后没有必要。
- 把 UTC 日烧进事件 id：诊断发现 `telemetry_events.id` 不含日期，`day` 实为每个（访客、条目、版本、渠道）组合的首次出现日期，并非文档所称的按日去重。改动会重写全部历史序列的语义并成倍增加行数；作为事实记录给维护者，本次刻意不改。

## Consequences

- D1 高负载期间 30 天窗口（看板首屏）也能重新计算，代价是版本分布偶尔为空；消费方必须读取 `degraded`。[按日滚存流水线](2026-09-20-telemetry-daily-rollup-pipeline.zh.md) 已把这份开销移出读路径。
- 降级载荷与其他滚存一样按 TTL 缓存，标记随缓存字节一起留存。
- D1 记忆体压力下 90/365 天窗口仍会冻结在最后一次成功滚存；新鲜度标注让这一点从无声变为可见。被推迟的结构步骤已落为 [按日滚存流水线](2026-09-20-telemetry-daily-rollup-pipeline.zh.md)：聚合改读按日滚存表，不再扫事件表。
