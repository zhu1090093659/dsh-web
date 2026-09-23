# Agent Note: 预设的点赞与安装上报被 Worker 拒绝

Status: implemented

## Problem

在 dsh-market.com 上给预设点赞返回 HTTP 400，Worker 只回答 "invalid-params"。商店从 [Community agent presets distributed through the Workshop](2026-09-09-community-agent-presets.zh.md) 起就已经在发布预设 manifest，`market/worker/src/asset-allowlist.js` 的 manifest 允许名单里也早已列出 `preset`——但写接口对客户端声明的 kind 走的是手工维护的 `KINDS` 集合，其中仍然只有 `skin`、`pet`、`plugin`。因此每一次预设点赞、每一次预设安装上报都在参数校验处就被拒，根本走不到 Turnstile 或允许名单。同一套「只有三种 kind」的假设还硬编码在 `readStats` 与 `readInstalls` 的桶初始化里，而它们会跳过没有桶的 kind 行，所以即使真存在预设计数行，也会在 `/api/stats` 中被丢弃。

预设中心那条 note 中「预设点赞与安装计数照常工作」的说法是错的：它验证的是允许名单，而不是 kind 门。

## Decision

`preset` 在 Worker 中成为一等资产类别：`KINDS` 包含它，两个统计桶初始化都带 `preset` 桶，OpenAPI 描述与 API 文档页也列出该类别。不需要 D1 migration——`counts` 与 `install_counts` 的 `kind` 只是普通 TEXT 列，没有 check 约束。

这次缺陷暴露出的持久规则：**一个市场资产类别要在三处注册**——发布管线（`scripts/market-build` 的 manifest 及其分类词表）、客户端界面（创意工坊卡片与站点）、以及 Worker（`KINDS` 加两个统计桶）。只注册前两处，发布出去的资产永远无法被商店的计数看到。

## Alternatives considered

**从允许名单已经读取的 manifest 推导可接受的 kind 集合。** 否决：`isKnownAsset` 在 manifest 不可读时是刻意 fail open 的（资产服务故障不应让全站点赞失效），用同一次读取推导写接口面会让故障期扩大可接受的 kind 集合。静态集合是廉价的独立护栏，现在它与允许名单的类别列表保持一致。

**只把 `preset` 加进 `KINDS`。** 否决，理由是不完整：`readStats` 与 `readInstalls` 用三个桶初始化的对象过滤行，预设投票与安装仍会从卡片读取的响应里消失。

**只修点赞接口，不管安装上报。** 否决：`/api/install` 共用同一道门，创意工坊每次安装都会上报预设，而客户端忽略失败——指标会静默停在零。

## Consequences

- 预设点赞会被记录，站点显示返回的计数，预设安装也计入商店的安装指标；`/api/stats` 增加 `preset` 桶（两个客户端本来就有空对象兜底，因此无需改客户端）。
- 无需回填：请求在写入前就被拒绝，故障期间不存在任何预设计数行。
- Worker 测试中喂给允许名单的 fixture 此前把调用点使用的单数 key 映射到复数 manifest 文件名上是错的，始终返回空 manifest，于是「未知资产」那条测试是因错误的原因通过。现在它会返回真实条目，正向的预设用例才有意义。
- 「三处注册」规则记录在此，但目前只有 Worker 一侧有机械覆盖；将来的新类别仍可能在管线与客户端词表之外被漏掉。

## Testing

- `scripts/market-worker.test.mjs`：预设点赞与预设安装都以 `kind: 'preset'` 抵达 D1（修复前两者都返回 400 `invalid-params`），且 `/api/stats` 返回 preset 桶；manifest fixture 现在把单数类别映射到复数 manifest 文件，允许名单被真正走通。
- 线上探测：带已发布预设 id 的 `POST /api/like` 在修复前返回 `400 invalid-params`，修复后走到 Turnstile 门，与 `skin`、`plugin` 请求表现一致。无头浏览器点击无法通过 Turnstile 挑战（不记录投票，站点回退到未点赞状态），因此端到端确认来自报告者：部署后浏览器里的预设点赞正常记录。
- `pnpm test:scripts` 带新用例通过。
