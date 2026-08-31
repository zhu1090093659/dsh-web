# Agent Note: Telemetry users badge stays servable under D1 overload

Status: implemented

## Problem

README 的 "users" shields 端点徽章渲染为 "inaccessible"。两层独立的故障叠加在 `/api/telemetry/badge/users` 上：

1. **计算太慢。** 徽章实时执行 `telemetry_events` 的 `COUNT(DISTINCT visitor)`（约 110 万行心跳、约 8.6 万去重访客）。生产 `wrangler tail` 捕获到 shields 自己的抓取器（UA `Shields.io/080e177`) 全部在约 3450 ms 处中止——shields 的上游抓取超时约为 3.5 秒。每次中止的调用被直接杀掉、来不及写任何缓存，shields 的下一次抓取依旧冷启动：无论数据库是否健康，徽章经 shields 永远不可能成功。
2. **D1 过载。** 过载窗口内该查询直接失败：`D1_ERROR: D1 DB is overloaded. Requests queued for too long.`，Worker 以未捕获异常崩溃，shields 拿到 Cloudflare 1101 错误页（HTTP 500）。同一段 tail 在十分钟生产流量内捕获到数百个失败请求，包括徽章本身、`/api/stats` 读取与遥测写入。

## Decision

- 新增 `badge_cache` D1 表（迁移 `0005_badge_cache.sql`）以单行存放预算计数。cron 触发器（`market/worker/wrangler.jsonc` 的 `*/30 * * * *`，`market/worker/src/index.js` 的 `scheduled` 处理器）每 30 分钟把心跳去重访客数重算进该表。
- `handleTelemetryUsersBadge`（`market/worker/src/telemetry.js`）现在只读这一行主键——任意 colo 都能在 shields 超时内返回——其上再叠加 30 分钟边缘 Cache API 条目与 24 小时 stale 副本。首次 cron 之前（或行缺失时）走 bootstrap：跑一次全表扫描并播种该行。任何 D1 失败时回退 stale 副本，或返回合法的 `{"schemaVersion":1,...,"message":"unavailable"}` 200 JSON。不存在会产生 5xx 或因首字节过慢超出 shields 超时的路径。
- `handleTelemetryPost` 捕获 D1 写入错误并返回 `503 {"ok":false,"error":"storage-unavailable"}`——与既有缺绑定分支同构——而非未捕获异常页。客户端把未接受视为「下次挂载再补报」，与 docs/telemetry.md 记录的 fire-and-forget 契约一致。
- `/api/stats`（market/worker/src/index.js）套用同样的边缘缓存模式（60 秒新值 + 1 小时 stale 副本）并增加 503 `storage-unavailable` 兜底：工坊卡片每次 GUI 启动都会抓取它，卡片 UI 本来就把非 200 当作零值状态。`/api/telemetry/summary` 返回同样的 503 JSON 而非异常页；它刻意不做边缘缓存——缓存键无法携带 `x-telemetry-key` 鉴权。
- 保留期清理从汇总读取路径移入 cron 触发器，仪表盘读取不再对过载的 D1 发出机会式 DELETE。
- 公开契约文本同步了同样的事实：docs/telemetry.md（徽章条目、客户端补报段落、清理句子）、api-doc.js 端点表（徽章预算、stats 与 summary 503）与 OpenAPI 描述。

## Testing

本地 `wrangler dev --test-scheduled` 加本地 D1：cron 触发把被故意改坏的行值刷回真实计数；徽章约 10 ms 返回行值；删除该行后下一请求经全表扫描 bootstrap 并重新播种；清空缓存后删表返回 200 "unavailable" JSON；删表状态 POST 返回 503 JSON。`/api/stats` 正常返回计数，删表后仍由 stale 副本顶上，无缓存副本时返回 503 JSON；`/api/telemetry/summary` 在删表后返回 503 JSON；两张表都缺失时 cron 依然干净跑完。部署后生产 `wrangler tail` 显示 `Shields.io/080e177` 抓取器以 "ok" 结果、远低于 3.5 秒超时完成，shields 徽章渲染出真实计数。

## Alternatives considered

- 在每次心跳插入时维护递增计数器，替代 cron 重算：免除周期扫描，但把成本与复杂度加进每条事件写入，而这个数字变化很慢。每 30 分钟一次扫描的 cron 更简单且自愈。
- 只靠边缘缓存做 stale-while-revalidate：冷 colo 仍要跑慢扫描，而 shields 的中止会杀掉整个调用、什么都缓存不下，徽章经 shields 永远无法恢复。否决。
- 只调 shields 侧 `cacheSeconds`：约束是抓取超时而不是缓存。否决。
- 对心跳写入做采样或限流以降低 D1 负载：这是遥测架构决策（频率、聚合、存储档位），应当单独立项；本变更让徽章与写入路径无论如何都保持韧性。

## Consequences

- 徽章数值最多旧约 1 小时（30 分钟 cron + 30 分钟边缘缓存）；对全量累计数可以接受。
- 若 D1 在最后一次计算之后持续不可用、且两级缓存副本都过期，徽章显示灰色 "unavailable" 而非数字。
- 过载期间遥测发送方收到 503 并在下次挂载时补报；补报量以每浏览器一天为上界。
