# Agent Note: tv.dsh-market.com 遥测看板分页化升级

Status: implemented

## Problem

私有遥测看板此前把汇总聚合渲染为静态服务端表格：没有图表，且热门路径被 API 硬截断在 LIMIT 20、心跳条目 LIMIT 200，没有读取更多数据的途径——流量增长后两个最关键的榜单永远不完整。页面 CSP 同时禁止一切脚本，趋势图和原地翻页都不可能实现。

## Decision

汇总 API 改为服务端分页，看板改为自渲染的深色客户端：

- `GET /api/telemetry/summary` 接受 `paths_limit`/`paths_offset`（默认 20，上限 100）与 `items_limit`/`items_offset`（默认 200，上限 200）；响应携带 `site.paths_total` 与 `plugins.totals.items`（后者从「截断后的页长度」变为精确的去重条目总数），并回显 `*_page` 分页窗口。默认值复现分页前的响应，既有调用方不受影响。条目的渠道/版本分布保持全基数扫描（其行数由插件目录规模决定，与流量无关）并在内存中关联到返回页，保持单个 D1 批次九条语句。
- `market/telemetry-view` 拆为 `src/index.js`（Access JWT 校验、路由、`/app.js` 与 `/data` 端点）与 `src/page.js`（页面文档与客户端源码）。boot 数据放在不可执行的 `<script type="application/json">` 块中，客户端以同源外部脚本加载：该 zone 的边缘会向 CSP 注入 nonce，按规范 nonce 会使 `unsafe-inline` 失效，内联脚本无论 worker 发什么都会被拦——`script-src 'self'` 加外部文件对此免疫，而 JSON 数据块根本不受 script-src 管辖。客户端渲染含环比昨日的 KPI 卡片、两张手绘 SVG 趋势图（上方为每日活跃实例即心跳 UV，下方为站点 PV/UV，共用同一折线渲染器、各自带悬停十字线）、带分页器（页码 + 10/20/50 每页选择）的热门路径与插件表格。切换时间范围与翻页经由同源 `/data` 代理（同样校验 Access JWT 并转发分页窗口），不再整页刷新。
- CSP 从禁脚本调整为 `script-src 'self'; connect-src 'self'`：全部脚本为同一个同源文件（不引 CDN），内嵌 boot JSON 将 `<` 转义为 \\u003c，数据无法提前终结所在块。
- 两个 worker 均以 `wrangler deploy` 直接部署，不涉及 D1 迁移。

本 note 扩展 [Anonymous install telemetry via the market edge API](2026-08-24-anonymous-install-telemetry.md)；采集链路与隐私契约归该 note 所有，本次不变。

## Alternatives considered

- 在旧的定长响应上做纯前端分页：API 零风险，但热门路径永远只有 20 条，分页器形同虚设。分页的意义在于触达完整分组，故否决。
- 渠道/版本查询只查当前页条目（第二个 D1 批次 + 动态 IN 列表）：目录级基数下省不了什么，还多一次往返；内存关联方案保持单批次。
- 引 CDN 图表库（Chart.js/ECharts）：为保持 Access 门禁页面完全自包含而否决；手绘 SVG 图表约 80 行，无供应链面。
- 零脚本分页（URL 参数 + 整页刷新）：CSP 最严，但失去趋势图且每次点击都要全量重拉；同源脚本 CSP + 转义 boot JSON 下 XSS 面与原来等价（数据原本就是服务端转义进 HTML）。
- 内联脚本 + `script-src 'unsafe-inline'`（首个上线方案）：zone 边缘注入的 CSP nonce 使 `unsafe-inline` 失效导致生产环境整段被拦，发布前已替换为外部 `/app.js`。

## Consequences

- `plugins.totals.items` 语义从「页长度（≤200）」变为「区间内精确去重条目数」；把它当 items 数组长度用的消费方在目录规模超过 200 前读数一致。
- 汇总批次从 7 条增至 9 条 D1 语句（两个 COUNT DISTINCT 总量），均为同区间的索引聚合。
- tv.dsh-market.com 现在在 `script-src 'self'` 下执行一个同源 JavaScript 文件；页面仍不加载任何第三方资源，`/`、`/app.js` 与 `/data` 的 Access JWT 门禁不变。若客户端脚本再次无法运行，静态加载提示会保留、页面错误横幅会给出具体报错。
- 测试覆盖：`scripts/market-worker.test.mjs` 断言分页绑定、钳制与总量；`scripts/telemetry-view.test.mjs` 覆盖 Access 门禁、boot JSON 转义，以及活跃实例面板渲染在站点趋势面板之上。

## Testing

`node --test scripts/market-worker.test.mjs scripts/telemetry-view.test.mjs`（28 个用例），另用本地 HTTP harness 以 Playwright 驱动渲染页：翻页发出预期的 `/data` 窗口请求、切换范围重置两个偏移、两图悬停各自出现提示框、无控制台错误。桌面与移动端截图均已核验。
