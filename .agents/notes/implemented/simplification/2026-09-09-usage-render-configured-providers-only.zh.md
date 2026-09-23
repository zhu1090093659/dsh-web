# Agent Note: 使用统计分区只渲染已配置的 provider

Status: implemented

## Problem

概览快照枚举 LLM 运行时已知的全部路由（`llm.listProviders()` 加 `listConfigurableProviders()`），而不是用户真正配置了凭据的路由。两张客户端卡片因此都在展示噪音：用量页签的余额卡渲染目录里的每个 provider——未配置的显示为一行名称加「未配置凭据」灰字；个人套餐页签渲染用户从未配置的套餐类路由（一张名称卡加「未检测到套餐数据」）。目录路由多于已配置路由时，两张卡片大半是未配置的占位行，与插件「检测所有已配置 provider」的承诺相悖。

## Decision

dsh-usage 浏览器半区按宿主已解析并盖在每行快照上的凭据类型过滤两张卡片：provider 只有在 `credential !== 'none'`（`api-key`、`env` 或 `oauth` 授权）时才出现在余额卡与个人套餐页签。旧版线协议文档没有 `credential` 字段时按原样渲染（undefined 通过过滤）。余额卡空态区分「没有任何已配置 provider」（新增 `usage.balance.noneConfigured` zh/en/ru 键）与「已配置 provider 均无余额端点」（`usage.balance.unsupported`）；聚合错误行忽略未配置行，已移除凭据的遗留持久化错误不再与隐藏行同屏。宿主枚举、线协议文档、台账用量行、趋势图与宠物气泡均不变——过滤只存在于 `UsageSectionCard` 的显示层，是[使用统计插件](../feature/2026-08-29-usage-statistics-plugin.zh.md)显示行为的细化。

## Alternatives considered

- **宿主侧在 `overview()` 过滤**：把未配置路由从线协议文档剔除可以缩小载荷，但同一个数组还供头部当前 provider 查找与今日/趋势台账行的显示名查找使用；仅显示层过滤让文档保持完整并兼容旧客户端。
- **按探测事实（balance/plan 是否存在）过滤**：只显示有探测事实的行会连带隐藏探测失败或仅有 OAuth 的已配置 provider，丢掉服务刻意保留的错误行与旧数据；`credential` 才是「用户是否配置过」的稳定信号。

## Consequences

- 宿主进程刚启动、首轮探测未完成时，所有路由上报 `credential: 'none'`，两张卡片会短暂显示空态，首轮轮询完成后即恢复；持久化快照让这个窗口缩到一个轮询周期内。
- `usage.balance.noCredential`（「未配置凭据」）文案保留在词典中作为遗留回退路径的防御性渲染，但不再经过滤后的卡片出现。
- `tests/section-card.spec.tsx` 固化该行为：已配置行渲染，未配置的余额/套餐/错误行不渲染，两种空态可区分。
