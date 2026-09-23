# Agent Note: DeepSeek V4.1-Flash 价目表刷新与 v4-pro 路由时间栅栏

Status: implemented

## Problem

`packages/dsh-usage/src/core/pricing.ts` 的折叠时消费估算沿用的是 2026-08-17 公布的 DeepSeek 价目表：flash 档空闲时段为 0.05 / 1.5 / 4.5 CNY 每百万 tokens（缓存命中 / 未命中 / 输出），pro 档为 0.15 / 4.5 / 13.5。

官方页面在北京时间 2026-09-10 12:00 改价：flash 档空闲时段降至 0.02 / 1 / 4（高峰恰为两倍），规范模型 id 变为 `deepseek-flash`（DeepSeek-V4.1-Flash），脚注说明自北京时间 2026-09-14 12:00 起访问 `deepseek-v4-pro` 的请求全部由 V4.1-Flash 提供服务并按 flash 档计费，直至 V4.1 Pro 上线。因此所有按旧价目表定价的官方路由请求都高估了消费——按公布降幅为缓存读 60%、未命中输入 33%、输出 11%；一旦跨过路由时刻，`deepseek-v4-pro` 会话更是按 7.5 倍 / 4.5 倍 / 3.4 倍高估。

## Decision

- **flash 档刷新**（`src/core/pricing.ts`）：`FLASH_PRICE` 采用公布的 `deepseek-flash` 价格——空闲时段缓存命中 0.02、未命中 1.0、输出 4.0 CNY 每百万 tokens，高峰时段各翻倍。已下线的 flash 系列 id（`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`）继续按该档计价，与官方页面一致：它们由 V4.1-Flash 提供服务。
- **pro 档保留并加时间栅栏**：`PRO_PRICE` 不变，`priceFor(model, atMs)` 仅在该时刻早于 `V4_PRO_FOLDED_INTO_FLASH_AT_MS`（北京时间 2026-09-14 12:00，即 `Date.UTC(2026, 8, 14, 4, 0)`）时对 `v4-pro` id 使用它；自该时刻起同一 id 按 flash 档计价。栅栏与峰谷时钟并列，折叠时刻仍是唯一的定价输入，其注释写明解除条件（V4.1 Pro 上线并公布自己的价格）。
- **模块头部记录出处**：文件头写明价目表生效时间（北京时间 2026-09-10 12:00）、公布的行 id 及其版本名（`deepseek-flash` = DeepSeek-V4.1-Flash，`deepseek-v4-pro` = DeepSeek-V4-Pro-0813）与旧 id 映射，下一次刷新从明示的前态出发。
- **README 双语**：消费估算口径一节改为记录当前生效的两档价格与 2026-09-14 路由日期，不再写"公布的 DeepSeek V4 价目表"。

## Testing

`packages/dsh-usage/tests/pricing.spec.ts` 以固定时刻钉住刷新后的价目表：flash 档空闲时段缓存命中 / 未命中 / 输出的每百万单价、高峰时段精确翻倍、已下线 flash id 按同一档计价、pro 档把缓存写按未命中输入计价，以及路由栅栏——周日 20:00（北京）pro 档为 4.5、周一 11:59:59（北京）仍为 pro 档 9.0（且处于高峰）、周一 12:00（北京，栅栏时刻）与周一 20:00（北京）均为 flash 档 1.0。包内 83 个测试通过，仓库级 `pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check` 门禁全绿。

把真实台账的一天（`$DSH_HOME/dsh-usage/usage-ledger.json`）回放进更新后的模块，当天 `deepseek-flash` 档的估算比旧价目表对同样 tokens 盖上的成本低约 41%（以缓存读为主），即公布降幅在真实数据上得到复现，而非只在 fixture 上。

## Alternatives considered

- **只刷新数字、不实现路由脚注**：改动最小，但 2026-09-14 之后每一次 `deepseek-v4-pro` 折叠都会高估消费至多 7.5 倍，直到有人重新查看该文件——而这正是本次改动要修的失效模式。
- **现在就删掉 pro 档，把所有 `v4-pro` id 一律按 flash 档计价**：表格最简单，但对栅栏之前的折叠、以及任何折叠时刻早于栅栏的已存桶都是错的，且 V4.1 Pro 公布自己的价格时还得把该档加回来。
- **运行时从文档页抓取价目表**：消除静态陈旧，但给纯本地的台账折叠引入出网依赖、面向营销页的解析器与无界的失败模式——本插件一贯把价目表当作随版本发布的快照。
- **价目表变化时重估已持久化的桶**：在引入折叠时估算时就已被否决（见[折叠时消费估算记录](../feature/2026-08-29-usage-peak-pricing-and-announce-fix.zh.md)）；台账每个桶不保存峰谷拆分，历史无法诚实重估。

## Consequences

- 本次改动之前折叠的桶保留当时盖上的成本，因此跨越部署时刻的那一天会混用新旧两档价格；高估幅度以部署小时为界，并在下一个本地日消失。
- 栅栏在另一个方向上有时间敏感性：若 V4.1 Pro 上线并公布了价格而本文件未被重新查看，`deepseek-v4-pro` 的折叠会低估消费。常量注释写明了移除条件。
- 中转流量（ZenMux、SiliconFlow）保持不计价——只有 DeepSeek 官方家族有价目表。
