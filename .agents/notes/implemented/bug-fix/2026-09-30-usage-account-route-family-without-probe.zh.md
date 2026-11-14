# Agent Note: DeepSeek 账号通道归属家族但不参与探测

Status: implemented

## Problem

使用 DeepSeek 账号登录的用户（`llm-deepseek-account` 注册在线路由 `deepseek-account`，以账号令牌而非 API key 鉴权）看到 Token 银行页签恒为空，而同一面板的用量页签正显示该路由上的真实 token 消耗。卡片头部写着「DeepSeek Account · deepseek-flash」，即当前正在使用的通道，正文却是空状态（issue #1772）。

根因是 DEEPSEEK 适配器的 `ids` 只有 `deepseek` 与 `deepseek-official`，而 `isDeepSeekProviderRoute()` 由该列表派生。所有以该判定驱动的记账动作——折叠时消费计价、峰谷时段行、鲸元券铸币——都跳过了账号通道，家族 token 为 0 按设计不铸任何票面。宿主从未过滤台账：`summarizeDays()` 直接聚合会话上报的内容，数据一直在，只是客户端这一层的家族判定把它排除了。

最直觉的改法——把 `deepseek-account` 加进 `ids`——是错的，且错在最坏的方向。`ids` 不只是家族列表：`adapterFor()` 还驱动余额探测、`resolveCredential()` 中 `DEEPSEEK_API_KEY` 的凭据回落、别名折叠与可渲染的提供方行。而 `/user/balance` 读的是 API key 账户，于是探测账号通道要么在账号令牌上失败，要么在用户同时配置了 `DEEPSEEK_API_KEY` 时把 **API-key 账户的余额印到账号路由名下**——正是 #1688 关掉的那类张冠李戴。

## Decision

`ProviderAdapter` 增加 `familyOnlyIds` 列表：只参与家族记账、且刻意对探测不可见的路由 key。

DEEPSEEK 适配器声明 `familyOnlyIds: ['deepseek-account']`，`isDeepSeekProviderRoute()` 对列表中的 id 同样返回 true。`adapterFor()` 保持不变，对账号通道仍返回 `undefined`，两个判定因此不会一起变宽：`isDeepSeekProviderRoute()` 的每个调用方都是记账决策（计价、时段行、银行），而探测、凭据回落与别名折叠一律读 `adapterFor()`。

账号通道因此恰好得到该议题所要求的记账能力而不串户：其调用按同一份 V4 价格簿计价，其 token 铸成鲸元券，当它是会话当前路由时峰谷时段行出现。随后当 DSH 宿主挂载了 `@deepseek-ai/dsh-deepseek-account` 服务（issue #2047），`UsageService` 专门为 `deepseek-account` 增加了可选宿主服务读取（`ctx.get('deepseekAccount')`）：在登录态下将账号自身的充值钱包（`value`）与赠金钱包（`bonusWallets`）合并为 `CNY`/`USD` 余额快照（`credential: 'oauth'` 并计入 `observedSpend`），同时继续保持 `adapterFor('deepseek-account')` 为 `undefined`，绝不触碰 `/user/balance` 或 `DEEPSEEK_API_KEY`；未挂载 `deepseekAccount` 的宿主继续只显示用量与运行期名称。

这一拆分是适配器表的长期规则，而非一次性特例：**任何不以 API key 鉴权的路由都归属其提供方家族，且绝不可继承该提供方的 API-key 端点。** 未来任何非 key 通道都按 `familyOnlyIds` 处理。

## Alternatives considered

- **把 id 加进 `ids` 并接受探测结果。** 否决：它等于悄悄把官方余额端点与家族 `apiKeyEnv` 回落一并授予账号通道；配置了 `DEEPSEEK_API_KEY` 时会把他账户的余额报成该路由的余额，正是 #1688 关掉的失败。否决理由是正确性，不是观感。
- **只在客户端放宽家族判定**（鲸元券与时段行）。否决：宿主在折叠时通过同一判定写入 `cost`，只改客户端会让票面铸出来而消费估算恒为 0——同一路由在两张卡片上互相矛盾。家族身份属于适配器表，两侧半区本就从那里读取。
- **在不支持的地方一律压制账号通道**（当作未知提供方）。否决：它是在用、真实计费的路由。诚实的渲染是在有用量时展示该行，并在宿主提供 `deepseekAccount` 时展示其自身账号余额。
- **由插件直接猜测平台 HTTP 接口并发送账号令牌探测。** 否决：猜测端点或复用 `resolveCredential` 存在串户及复制宿主鉴权逻辑的风险；在宿主挂载 `deepseekAccount` 时通过该服务读取，令牌与请求头仍完全由宿主持有。
- **把账号通道并入官方行**，让一个 DeepSeek 账户只显示一次。否决：两条路由经由不同凭据计费，可能是不同账户；[别名折叠](2026-09-17-usage-alias-route-folding.md) 已确立「两条在线路由即两个账户」这一规则。

## Consequences

- 账号通道用户看到有内容的 Token 银行、折叠时消费估算与峰谷时段行。空状态从此只表示家族确实没有用量。
- 当宿主挂载 `deepseekAccount`（桌面端 App-managed 路由）时，`deepseek-account` 直接展示合并赠金后的账号余额并计入 `observedSpend`；未挂载时不发任何 HTTP 探测且不报余额。
- 因为 `adapterFor()` 与 `resolveRouteAdapter()` 对 `deepseek-account` 均仍返回 `undefined`，API-key 凭据回落、端点匹配与别名折叠都不受影响：休眠的目录条目既不会遮蔽账号通道也不会与它合并，两条在线路由仍是两行。
- `familyOnlyIds` 可选且目前没有其他适配器声明它，其余家族保持单列表的现有行为。
- 其他提供方未来若出现非 key 通道，只需增加一条列表项，表中其他部分不变。

## Testing

- `packages/dsh-usage/tests/adapters.spec.ts`：账号通道归属家族，但无论 `adapterFor` 还是 `resolveRouteAdapter`（即便指向 `api.deepseek.com`）均不对它返回探测适配器；family-only id 不与探测 id 冲突、也不与其他 family-only id 冲突。
- `packages/dsh-usage/tests/usage-service.spec.ts`：无 `deepseekAccount` 时，在账号通道上花费的会话不发任何请求且行不带余额；挂载 `deepseekAccount` 时，`deepseek-account` 在不触发 HTTP 请求、不读 `DEEPSEEK_API_KEY` 的前提下合并 `value` 与 `bonusWallets`，余额下降计入 `observedSpend`，`failed` 时保留旧余额并报错误，登出时清除状态。
- `packages/dsh-usage/tests/voucher.spec.ts`：银行在 key 路由旁也从账号通道铸币；其余 provider 如今同样铸造，只有消费估算仍留在有价家族（口径见 [全 provider 铸造笔记](../feature/2026-10-22-usage-bank-mints-every-provider.zh.md)）。
- 服务层测试正是被否决方案的护栏：把 `deepseek-account` 移进 `ids` 会让它们失败，因此「顺手把 id 加进去」这条误归因路径无法被后来的编辑重新引入。
- `pnpm --filter @linxin666/dsh-usage test`：14 个文件，206 个测试；`pnpm --filter @linxin666/dsh-usage typecheck` 通过。
