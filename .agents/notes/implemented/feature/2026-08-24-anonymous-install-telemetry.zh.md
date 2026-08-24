# Agent Note：经市场边缘 API 的匿名安装遥测

Status: implemented

## Problem

全家桶此前没有任何真实使用规模度量。npm 下载量被聚合包连带拉取、镜像重复计数与 CI 缓存抬高，无法回答「到底有多少独立 DSH 实例在跑这些插件」。要修复就需要唯一实例信号，但 GUI 跑在用户本地浏览器里，遥测绝不能泄露对话内容或身份。

## Decision

dsh-web 通过两类匿名事件统计使用规模，存储在现有 dsh-market.com worker 的 D1 中：

- dsh-market.com 页面的站点 pageview（`market/src/app.js`）。
- 已接入插件浏览器半区的每日心跳，经 `shared/client/telemetry.ts`（sync-shared 副本），已接入全部十五个全家桶客户端插件：皮肤中心、创意工坊、Pet 以及另外十二个。

每个浏览器在 localStorage 里一次性生成随机 UUID；载荷只含该 ID、UTC 日期与包名或站点路径。worker 入库前用部署盐值对 ID 做 SHA-256 哈希，不存 IP，按确定性行 id 做每日去重，清理超过 400 天的事件，且只在 `GET /api/telemetry/summary` 暴露聚合计数。发送是 fire-and-forget，仅在服务端接受后才写本地日标记，离线浏览器随后补报。

机制契约见 `docs/telemetry.md`；各包 README 配对文件链接到该文档。

## Alternatives considered

- npm 下载量：否决，结构性虚高且不可修正。
- 第三方分析（Umami、Plausible、Cloudflare Web Analytics）：网站面可用，但插件心跳协议仍需自定义，数据分散在不同后台；Cloudflare Web Analytics 不暴露原始事件，做不了按包拆分。
- opt-in 遥测：产品决策上否决；选择默认开启 + 完全匿名 + 公开披露，接受已在各 README 声明的社区信任风险。

## Consequences

- 安装量覆盖加载了已接入包的浏览器；未接入包的纯 npm 安装在接入前不可见。
- 写端点接受匿名流量，计数可被伪造心跳污染；接受其作为趋势读数的噪声，不为写入加 Turnstile。
- 新增一个包只需一行 sync-shared 清单条目加一次 `reportDailyHeartbeat` 调用，共享同一实现。
