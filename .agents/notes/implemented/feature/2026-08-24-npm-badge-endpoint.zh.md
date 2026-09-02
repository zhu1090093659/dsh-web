# Agent Note: npm 徽章端点累计更名前后的聚合包

Status: implemented

## Problem

根 README 的 npm 徽章指向更名后的聚合包 @linxin666/dsh-web-all，但它在下个 tag 发布前没有已发布版本，shields 原生 npm 徽章因此显示「package not found or too new」。更名同时把下载历史拆到两个包名上，而 shields 原生不支持跨包求和。累计家族总量同理且更宽：下载分散在家族发布过的所有包名（含已退役名）、两个 registry——npm 官方源与承载国内大部分流量的 npmmirror 镜像源——以及本仓库的 GitHub Releases 附件上，shields 同样无法原生求和。

## Decision

dsh-market worker 提供三个 Shields 端点徽章处理器（market/worker/src/npm-badge.js），注册进 worker 的 fetch 路由并在 openapi.json 与 api-docs.html 中声明：

- GET /api/npm-badge/downloads——@linxin666/dsh-web-all 与旧名 @linxin666/dsh-web-ui-all 的月下载量求和，徽章覆盖更名前后的完整历史。
- GET /api/npm-badge/version——两个包名中最高的 latest 版本（新包发布前由旧名提供）。
- GET /api/npm-badge/total——家族 scope 下发布过的全部包名（两个聚合名与已退役的 dsh-live-stats / dsh-client-ui-aionui-panel / dsh-skins）的全渠道累计下载量：range 按自家族起点 2026-01-01 起的 365 天窗口分窗求和（npm 官方 range API 会把窗口静默钳到最近 18 个月，npmmirror 拒绝更宽的窗口）；求和通道为 npm 官方源（api.npmjs.org）、npmmirror 镜像源（registry.npmmirror.com）与本仓库 GitHub Releases 附件；设置 fine-grained 的 GITHUB_TOKEN secret（公共仓库只读即可）可把 GitHub 通道切到认证配额，未设置时匿名读取并在限流时最长六小时内沿用上次成功值。

各处理器在请求时读取公开数据源，按 isolate 缓存（npm 数据一小时，GitHub 六小时），响应带 cache-control public max-age 1800 供 shields 与 CDN 缓存；与其他 GET 端点一样 CORS 开放。total 徽章跳过失败通道、只显示其余通道之和——全部通道都无数据才降级为灰色 unavailable。根 README 双语对的 npm 版本与累计下载徽章改用指向这些路由的 shields endpoint URL。徽章数据源保持 npm 口径：它是生态可比的惯例，也是唯一覆盖遥测上线前历史的来源；有 Access 门禁的遥测仪表盘（tv.dsh-market.com）仍是内部运营视图，未来如需「活跃安装数」徽章可在同一 worker 上读遥测 D1 表新增端点。

## Alternatives considered

- 发布前把两个徽章临时指回旧包名：被否决；它需要在未来某个不确定的时间点再改回，且把旧包数字误标为新包自己的。
- 现在就用遥测做徽章：被否决；遥测刚开始记录，无法回答累计下载量，且仪表盘的 Access 门禁不适合公开徽章抓取。
- 用 GitHub Action 定时更新静态徽章值（gist 或提交的 SVG）：被否决；market worker 已在提供公开 JSON，没必要引入第二个活动部件。
- total 只统计 npm 官方源：被否决；它漏掉承载国内大部分流量的 npmmirror 安装量与 GitHub Release 通道——而这正是徽章要补的口径。

## Consequences

- 徽章可用性不再依赖新包是否已发布；新包版本超过旧名时版本徽章自动翻转。
- npm API 故障表现为灰色徽章而非裂图；数字最多滞后真实值一小时。
- 验证：端点线上返回累计值（交付时 downloads 142.8k/month、version v0.3.2），shields 两个徽章均 200 正常渲染；worker 部署版本 05fb80d6-a175-4387-873a-87cd632e21cc。
- 跟进：双发窗口结束、旧名完全 deprecate 后，双名求和可收拢为单名——只需改 PACKAGES 列表。
- 分窗求和后累计值不再依赖 range API 的 18 个月静默钳制，数据变老也保持真实。
- 已退役包名经旧聚合包的依赖连带仍有真实流量，总量只对完整包名清单有意义。一次 total 冷计算今天耗 51 个上游子请求，随家族与窗口数增长；若 Workers 套餐子请求预算不够，参照 users 徽章把 total 预计算进 D1（cron 刷新）。
- 验证：README 双语对渲染新的累计徽章；测试覆盖三通道求和、单通道降级、全失败灰色路径、token 请求头与分窗平铺。2026-09-02 实测采样：npm 官方源 3,539,356 + npmmirror 2,111,236 + GitHub Releases 附件约 2,870——徽章渲染 5.7m total。
