# Agent Note: 用量余额卡折叠同一适配器家族的别名路由

Status: implemented

## Problem

dsh-usage 的余额卡把 DeepSeek 官方账户渲染了两遍：小写 `deepseek` 与 `DeepSeek` 各一行、余额完全相同，而用户只配置了官方这一家提供方。

宿主枚举 LLM 运行时已知的全部路由——`llm.listProviders()` 加 `llm.listConfigurableProviders()`——后者即 pi-ai 目录，其中与 `llm-deepseek` 适配器注册的实时路由 `deepseek-official` 并列，还带着一个休眠的 `deepseek` 目录项。DeepSeek 适配器刻意同时服务两个 id（会话携带的是实时路由那个），而凭据解析对任何 DeepSeek 家族路由都回退到该家族的 `apiKeyEnv`（`llm-deepseek` 的 `DEEPSEEK_API_KEY`），于是未配置的目录项解析到同一把 key，通过了客户端「只渲染已配置供应商」的凭据过滤（见[该决策](../simplification/2026-09-09-usage-render-configured-providers-only.md)）。同时每个轮询周期都对 `https://api.deepseek.com/user/balance` 探测两次，服务于同一个账户。

## Decision

别名折叠放在宿主侧：`foldAliasRoutes()`（`packages/dsh-usage/src/core/provider-routes.ts`），在服务枚举路由处调用（`UsageService.listProviderRoutes()`）——当同一适配器家族已有实时路由时，LLM 运行时不服务任何请求的路由（仅目录项，`live: false`）被丢弃。`ProviderRoute` 带上它需要的 `live` 标志，由枚举本身置位，而不是从展示名或路由顺序推断。

该规则作用域限于家族内，且刻意保守：

- 实时路由永不折叠，因此共享同一适配器家族的两个已配置 profile（例如 api.z.ai 的 `zai` 与 `zai-coding`）仍是两个账户。
- 没有实时路由的家族保留其目录项，因此目录别名是该家族唯一路由的部署渲染结果与改动前完全一致。
- 适配器目录之外的路由原样通过。

会话运行在被折叠的 id 上时，摘要条视图照常可用：`currentView()` 本就会回落到同一适配器家族的任意快照，`routeDisplayName()` 会回落到适配器展示名。保留下来的行是实时路由那一行，其展示名是运行时给出的人类名称（`DeepSeek`），而不是目录项那个小写原始 id。

## Alternatives considered

- **在浏览器半区折叠**（即[已配置供应商过滤](../simplification/2026-09-09-usage-render-configured-providers-only.md)所选的层）：线协议文档不携带适配器家族身份，余额卡、个人套餐页签与侧栏面板得各实现一遍该规则，而且宿主侧重复探测依然存在。家族身份只存在于宿主、紧邻适配器表。
- **保留目录 id、丢弃实时路由**：会话与 agent 默认模型记录引用的是实时路由，人类可读的展示名也属于它，目录项才是休眠的那个。保留目录 id 会渲染一个小写 id，并丢掉运行时报告的名称。
- **按展示名或相同余额值去重**：两者都是巧合而非身份——两个真实账户可以有同名或同余额，错误折叠会隐藏用户真正配置的 provider。
- **照旧渲染别名行并加「某某的别名」标注**：为一个用户从未配置、余额也不可单独处置的路由保留一行，而且无法与碰巧能解析到凭据的未配置目录项区分。
- **枚举阶段直接过滤掉目录项**：会连 `llm-deepseek` 缺席时合法的目录路由一起丢掉，也会移除设置界面读取的目录数据。

## Consequences

- 每账户一行、每账户一次探测：每轮轮询中重复的 `api.deepseek.com/user/balance` 请求消失，账户以运行时的展示名出现一次。
- 被丢弃 id 的持久化快照由既有「本周期未见即删除」清理逻辑在下一轮移除。token 合计、趋势图与余额实测花费本就按家族合并，因此没有任何数字变化。
- 线协议文档不再携带被折叠的目录项；客户端的 `credential !== 'none'` 过滤仍会隐藏其余休眠项，旧客户端也照旧渲染新宿主发来的任何内容。
- 没有 `llm-deepseek` 适配器、`deepseek` 是其家族唯一路由的宿主不受影响。

## Testing

- `packages/dsh-usage/tests/provider-routes.spec.ts`：纯规则——被实时路由遮蔽的目录别名折叠掉、同家族两个实时路由都保留、仅有目录项的家族保留、折叠限于家族内、无适配器路由原样通过。
- `packages/dsh-usage/tests/usage-service.spec.ts`：上报环境的端到端形态（实时 `deepseek-official` 加目录 `deepseek`）恰好产出一行提供方记录、名称取自实时路由，且恰好一次余额探测。
- `pnpm --filter @linxin666/dsh-usage test` 与 `typecheck`：12 个文件、116 个测试，两条命令均以 0 退出。
