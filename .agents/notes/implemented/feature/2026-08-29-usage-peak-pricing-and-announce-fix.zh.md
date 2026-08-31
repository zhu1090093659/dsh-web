# Agent Note: DeepSeek 峰谷消费估算与公告 id 归类修复

Status: implemented

## Problem

用户开启 `bubbleMode: always` 后一并反馈的两个缺陷与一个缺失面：

1. **气泡从不出现。** `announceCurrent()` 按当前 provider id 查快照，但两套 id 空间不一致：会话与 `agent-default-model` 携带 `deepseek-official`（宿主 `llm-deepseek` 适配器注册的运行时路由），而 dsh-usage 的 DEEPSEEK 适配器只认 `deepseek`（可配置目录键）。`snapshots.get('deepseek-official')` 恒为 undefined——已对运行中的宿主实测证实：`current.provider = deepseek-official` 没有快照行，而被探测的余额挂在另一个 `deepseek` 目录行下。
2. **即使公告成功也看不见。** 宠物契约把公告 TTL 收敛到 60 秒、默认 10 秒，而 usage 轮询周期默认 60 秒——常驻气泡至多每分钟闪 10 秒。
3. **DeepSeek 官方家族没有消费与峰谷可见性。** DeepSeek V4 峰谷定价（2026-08-17 生效：北京时间周一至周五 09:00-12:00、14:00-18:00 为高峰、双倍计费，其余时段为高峰一半）作用于官方路由的每个请求；用户要求气泡展示今日消费估算与当前时段，套餐/订阅类 provider 展示套餐用量。

## Decision

- **适配器层做 id 归类**（`src/core/adapters.ts`）：DEEPSEEK 适配器同时服务 `deepseek` 与 `deepseek-official`；`isDeepSeekProviderRoute()` 以适配器同一性（而非硬编码 id）驱动家族行为（经 `llm-deepseek` 设置节的凭证 env 回退、折叠时计价）。`announceCurrent()` 在当前路由 id 没有自己的快照时回退到适配器家族快照，目录/运行时 id 漂移从此无法再让气泡失声。
- **随轮询节奏的 TTL**（`src/host/usage-service.ts` + 宠物契约）：发布方声明 `ttlMs = 2 x 轮询间隔 + 30 秒`（封顶），宠物契约上限从 60 秒放宽到 2 小时（`ANNOUNCE_MAX_TTL_MS`）——常驻模式气泡跨轮询连续，失活来源仍在一个刷新周期内消失。
- **折叠时消费估算**（`src/core/pricing.ts`）：`UsageTokenTotals` 增加 `cost` 数值，在用量折叠时按公布的 V4 价目表（flash/pro 档，CNY / 百万 tokens）按折叠时刻所属计费时段定价。仅 DeepSeek 官方路由计价，其他家族保持 0，总和不会变成跨币种混算。已持久化的桶保留旧价（不追溯重估）；`reviveTotals` 恢复 `cost`，重载绝不二次计价。
- **消费优先的气泡**：当日有消费时 DeepSeek 公告 kind `cost`（契约新成员）——金额 `今日 ¥x.xx`，note 携带当前时段（`高峰时段 计价×2` / `空闲时段 计价减半`）与余额，高峰期 tone `warn`。零消费日回退余额气泡；套餐类 provider 保持套餐气泡。用量页签展示峰谷时段行（以 DeepSeek 家族为当前路由或今日有流量为门槛）与今日消费行（provider 行带消费后缀）。

## Alternatives considered

- **展示时按峰谷 token 桶计价**：调价时更灵活，但每个台账桶都要翻倍，且历史依旧无法重估（峰谷归属只有折叠时刻知道）。单一折叠时 `cost` 保持台账形态，且与 provider 实际计费方式一致。
- **按 baseURL 匹配未知路由 id 的适配器**：比双 id 别名更通用，但当前没有路由需要它（pi-ai profile 自带知名 id），宿主表会静默漂移；家族回退已覆盖 id 漂移。
- **在 overview 里合并 `deepseek` 目录行与 `deepseek-official` 运行时行**：两者都是运行时给出的路由、探测同一端点；隐藏其一需要凭证相等启发式，复杂度不值。

## Consequences

- 消费估算仅覆盖 DeepSeek 官方路由；中转的 deepseek 流量（ZenMux、SiliconFlow）不计价，未识别的 DeepSeek 模型 id 按 flash 档估算（README 已写明）。
- 高于新上限契约的旧版公告（升级前的 dsh-pet 配升级后的 dsh-usage）会收敛到 60 秒——两半随本仓库一起发版，混版本窗口只会缩短气泡，不会破坏功能。
- 本变更之前的历史日期 `cost: 0`；今日消费从更新后第一次折叠起计。
