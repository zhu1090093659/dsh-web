# 匿名安装遥测（telemetry）

English 文档随包发布；本文是全家桶遥测机制的唯一事实源，各包 README 与市场 API 文档只链接到这里。

## 统计什么

dsh-web 通过两类匿名事件统计真实使用规模：

| 事件 | 触发方 | 含义 | 去重粒度 |
| --- | --- | --- | --- |
| `pageview`（PV） | dsh-market.com 页面脚本 | 站点页面访问 | 访客 ID + 路径 + UTC 日，每日一条 |
| `heartbeat` | 已接入插件的浏览器半区 | 该浏览器里该包处于安装且启用状态 | 访客 ID + 条目名 + 版本 + 渠道（同一组合只落一行，`day` 记该组合首次出现的 UTC 日；客户端每天上报，重复上报由该组合折叠） |

UV（独立实例数）= 当日去重访客 ID 数，即当天首次出现该组合的去重实例数；因此「安装量」读作心跳 UV，日序列读作各日首次出现量。

## 收集与不收集什么

每个浏览器在 `localStorage` 里生成一个纯随机 UUID 作为访客 ID，不与任何账号、会话或内容关联。上报载荷只有：随机访客 ID、事件类型、UTC 日期、站点路径或条目名（含已知版本号与安装渠道）。条目名可以是包名，也可以是资产 ID（`skin:<id>`）：Skin Center 会把已安装皮肤清单（含渠道判定：创意工坊一键装的市场皮肤带有 `dsh-market.provenance.json`，记为 `market`；内置/仓库直装记为 `npm`；无法判定的记为 `unknown`）一并纳入心跳，从而得到每个皮肤的真实安装量。包级版本号由共享构建预设 `shared/tsdown.client.ts` 在打包时把该包 `package.json` 的 version 烧进 bundle（`__DSH_PKG_VERSION__`），调用方无需手填。worker 在入库前用部署侧盐值对访客 ID 做 SHA-256 哈希，原始 ID 不落库；IP 地址不存储。汇总接口（`GET /api/telemetry/summary`）只返回计数聚合，永不暴露原始事件。

站点 pageview 另有一层爬虫过滤：worker 丢弃 UA 命中已知 bot 特征（搜索引擎爬虫、扫描器、curl 等）的 pageview，客户端在 `navigator.webdriver` 为真时不上报；只滤诚实的批量噪声，UA 可伪造的部分不追求（插件心跳本身要求真实 DSH GUI，天然少噪声）。

发送是 fire-and-forget：网络不可达时静默失败，下次挂载或次日自动补报一次；标记位只在服务端接受后才写入，离线浏览器不会因此漏计整天。服务端 D1 过载时上报返回 503（客户端视为未接受，下次挂载补报），不会以 Worker 异常页响应。隐私模式等存储不可用的环境下不发任何请求。事件保留 400 天，过期由 worker 的 cron 触发器定期清理。

## 查看数据

```sh
curl -s 'https://dsh-market.com/api/telemetry/summary?days=30'
```

返回最近 N 天（1-365）的站点 PV/UV 日序列与热门路径、各条目的期间活跃数与当日活跃数。聚合分两层：cron 触发器把每个 UTC 日的事件写进 `telemetry_rollup_days` / `telemetry_rollup_daily` / `telemetry_rollup_items` / `telemetry_rollup_dims` 按日滚存表（每 tick 重写今天与昨天，再用剩余预算回填缺日，游标表让中断的 tick 下次续跑），汇总接口只读这些表——单次聚合的行数是「天数 × 目录规模」，不随事件表增长；汇总结果另有按窗口的滚存缓存（cron 轮转预热仪表盘常用窗口并按需刷新；30 天内窗口最多滞后 30 分钟，90/365 天窗口最多 12 小时；实时聚合无法完成或窗口内仍有未回填日期时回退上一份缓存，而不是返回残缺的短序列），天数与分页窗口的组合即缓存键。日序列、当日活跃数与条目总数按日去重精确计算；期间活跃数、渠道与版本分布是各日去重计数的求和（按日去重求和，同一实例多天活跃会重复计入），因为窗口级 `COUNT(DISTINCT visitor)` 需要把窗口内每一天的访客集合同时放进 D1 记忆体——这正是每天 13-23 万行心跳在 2026-09-20 撑爆的查询。每个载荷带 `generated_at`（滚存计算时刻的 epoch 毫秒，读缓存不刷新该值）与 `degraded`（被跳过的辅助分布标签，`channels`/`versions`）。热门路径与心跳条目按服务端分页返回：`paths_limit`/`paths_offset`（默认 20，上限 100，总量见响应的 `site.paths_total`）与 `items_limit`/`items_offset`（默认 200，上限 200，总量见 `plugins.totals.items`）。机器可读契约见 `/openapi.json` 中 `/api/telemetry/*` 两项。汇总接口由 `TELEMETRY_READ_KEY` secret 保护：只能通过 `x-telemetry-key` 请求头携带（URL `?key=` 参数不再接受，避免密钥落入边缘日志、浏览器历史与 referrer）。

### 公开徽章端点

GitHub README 展示用两个无需密钥的 shields 端点徽章（只返回聚合计数，响应带 30 分钟缓存头）：

- `GET /api/telemetry/badge/users` — 心跳全量去重实例数（用户数），数据随插件发版后增长。计数来源是写入路径维护的预去重访客表 `telemetry_visitors`（每次心跳上报按访客哈希 upsert 一行），cron 每 30 分钟把它预算到 D1 单行缓存，端点只做单行主键读，响应再经边缘缓存 30 分钟；D1 不可用时回退最近一次成功计数，端点始终向 shields 返回合法的 200 JSON，README 徽章不会渲染成 inaccessible
- `GET /api/npm-badge/total` — 全部已发布家族包（含聚合包改名前后的两个名字与已退役包名）的全渠道累计下载量合计：npm 官方源 + 国内镜像源 registry.npmmirror.com + 本仓库 GitHub Releases 附件下载量（worker 服务端聚合，npm 与镜像按不超过一年的窗口分窗求和以绕过 range API 的 18 个月钳制；含聚合包连带下载的常规口径；单通道失败时徽章只显示其余通道之和，全部失败才降级灰色）。设置 `GITHUB_TOKEN` secret（只需公共仓库只读权限的 fine-grained token）可把 GitHub 通道切到认证配额；未设置时匿名读取并在限流时沿用最近一次成功值

创意工坊卡片另用 `GET /api/npm-downloads` 展示每个带 npm 包名的插件近 30 天 registry 下载量（npm 公开口径，非工坊安装量；包名白名单由服务端已发布 manifest 派生，worker 小时级缓存，响应带 30 分钟缓存头）。工坊安装量本身由 `POST /api/install` 记录一次成功安装事件（幂等去重 + 每次安装计数，Turnstile 校验后一次 D1 批次写入），经 `GET /api/stats` 的 `installs` 字段向卡片与站点展示。

### 私有实时视图

`market/telemetry-view`（部署为 worker `dsh-market-telemetry-view`，地址 `tv.dsh-market.com`）是只读仪表盘：读取汇总接口的滚存缓存并渲染 KPI 卡片、日活跃实例趋势图（心跳 UV）与站点日 PV/UV 趋势图、分页的热门路径与各包/皮肤安装量（期间活跃按日去重求和、当日活跃、渠道分布与版本分布），自身不存任何数据。页面同时显示滚存的生成时间与滞后时长，并在滚存滞后或辅助分布被降级跳过时给出醒目提示——滞后的缓存是「聚合暂时受限」，不是数据丢失。仪表盘页内切换时间范围与翻页经由同源 `/data` JSON 代理（同样校验 Access JWT）调用汇总接口的分页参数，不刷新整页。访问保护双层：路由应挂 Cloudflare Access 自托管应用（邮箱验证），worker 内部同时校验 Access JWT 签名（`ACCESS_TEAM` + `ACCESS_AUD` secret，未配置前默认拒绝服务）。路由上 `tv.dsh-market.com` 落在主 worker 的 `*.dsh-market.com` 通配 zone 路由内，由主 worker 在 fetch 入口把整个主机名经 `TELEMETRY_VIEW` 服务绑定转发给本 worker（Access JWT 头随请求透传；`/app.js` 与 `/data` 相应列入主 worker 的 `run_worker_first`，主站自己的 `/app.js` 资源由 worker 显式回退到 ASSETS 提供）。看板取数相应经反向的 `MARKET` 服务绑定直调主 worker：本 worker 运行在主 worker 的调用链内，公开 fetch 回 `dsh-market.com` 会在同一请求上下文里二次进入主 worker，触发 Cloudflare 环路保护并回落占位源站（522）。

## 接入新包

reporter 的事实源在 `shared/client/telemetry.ts`，包内副本经 `scripts/sync-shared.mjs` 同步（禁止手改）。接入只需两步：在 `sync-shared.mjs` 的 `telemetry.ts` 条目下加目标路径并重跑同步；在该包 `src/client/index.ts` 的 `apply()` 开头调用一次 `reportDailyHeartbeat([{ name: '<npm 包名>' }])`（version 由构建预设自动填充；channel 仅当来源可判定时显式传入）。行为测试参照 `packages/dsh-market/src/client/telemetry.test.ts`。

## 部署

端点实现在 `market/worker/src/telemetry.js`，表结构与读路径索引在 `market/worker/migrations/0002_telemetry.sql`（基础表）、`0003_telemetry_channel.sql`（渠道列）、`0005_badge_cache.sql`（徽章单行缓存）与 `0006_telemetry_summary_cache.sql`（聚合覆盖索引、预去重访客表、汇总滚存缓存），部署时需对 D1 应用迁移。设置 `TELEMETRY_SALT` secret 可更换哈希盐值；未设置时使用内置默认盐，仅影响哈希值不影响语义。
