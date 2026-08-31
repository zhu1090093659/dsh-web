# Agent Note: 使用统计插件（dsh-usage）

Status: implemented

## Problem

DSH 通过可插拔的 pi-ai provider 路由模型调用（kimi-coding、zai-coding-cn、opencode-go、deepseek……），各自持有独立凭据与独立计费模型——按量余额或带滚动窗口的编程套餐。家族里没有任何插件展示这些信息：已移除的 dsh-live-stats 只在客户端估算 token 且不分 provider，第三方社区插件（dsh-provider-usage）只覆盖以 DeepSeek 为中心的余额。用户要求一个第一方插件：(a) 检测所有已配置 provider 的余额/套餐用量，(b) 维护实时 token 用量台账，(c) 以一级设置分区落在创意工坊下方，(d) 把当前提供方的状态以专用气泡推给宠物。

## Decision

`packages/dsh-usage`（`@linxin666/dsh-usage`）采用宿主主导、浏览器轻量的形态：

- **宿主服务**（`src/host/usage-service.ts`）：把 `session/event` 折叠进持久的按日/按 provider/按模型台账 `$DSH_HOME/dsh-usage/usage-ledger.json`（路由归因来自 `request/header`/`request/context`，精确 `TokenUsage` 分桶来自 `assistant/message`；构造器 seed 事件不会重复派发，实时折叠不会重复计数）。按设置驱动的轮询周期，经 `ctx.llm.listProviders()/listConfigurableProviders()` 枚举路由，经凭据缝解析凭据（先 `llm-pi-ai` 记录，再 profile 的 `apiKeyEnv` 引用，DeepSeek 再退到 `DEEPSEEK_API_KEY`），按 `src/core/adapters.ts` 探测每个 provider——归一化为 `balance`/`plan` 视图。OAuth 授权只识别类型、绝不消耗。快照与台账同级持久化，探测失败降级为旧数据加错误行。
- **浏览器半区**：一级 `settings.section`（`id: dsh-usage`、`order: 151`，紧邻创意工坊的 150 之下），两个页签——用量（今日分桶合计、分 provider 行、余额、30 天趋势）与个人套餐（各 provider 配额窗口的百分比与重置时间）——加一个紧凑设置行。概览来自回环围栏的 `GET/POST /api/dsh-usage/overview|refresh`；密钥永不进入浏览器。轮询只在分区打开期间运行。
- **宠物联动**：每轮探测后，宿主把当前提供方（本次启动内最近的活跃路由，否则 `agent-default-model` 选择）推给 `ctx.pet.announce(...)`——见[宠物公告气泡契约](2026-08-29-pet-announcement-bubble.md)。

端点覆盖（2026-08 已验证）：DeepSeek 与 Moonshot 余额、Kimi For Coding `usages`、GLM 编程计划 `quota/limit`（原始 key 无 Bearer；`unit` 3=5 小时、6=每周）、OpenCode Go `zen/go/v1/usage`、MiniMax 套餐 `remains`（剩余百分比语义）、OpenRouter credits、SiliconFlow `user/info`、ZenMux 管理余额。Qwen token 套餐、OpenCode Zen 按量、Anthropic、OpenAI 无 key 可用端点，仅列出不出数据。

## Alternatives considered

- **浏览器侧探测**：部分余额主机带 CORS 头，跳过中转能让刷新即时。落败：Kimi、OpenCode、ZenMux 直接阻断 CORS，且浏览器 fetch 会把全部 API key 暴露给页面——宿主侧探测让所有 provider 统一做到密钥不出服务端。
- **经会话投影回填历史**：投影注册表可重放存储日志，旧会话本可回填台账。v1 放弃：台账以本地日 + 路由为键，而历史日志在半途出现 `request/header` 之前无法归因路由，且为跨会话聚合播种投影注册表键与按会话投影契约不合。统计自启用起计；若回填确实被需要再重启该方案。
- **鲸鱼插件式悬浮小组件**（参照 MeteorNOX/DeepSeek-Balance-Whale-Widget）：自绘浮层加独立回环端口。落败：用户要求设置页入口加宠物联动；宠物公告气泡取代了小组件的吉祥物表面，分区复用家族的设置/槽位机制而非第二个 HTTP 监听。

## Consequences

- 用量统计自插件首次启用起计，不回填历史会话（README 已注明）。
- 适配器解析固化了第三方响应形状（其中两个官方未文档化：GLM 的 `unit` 判别、MiniMax 的剩余百分比字段）；provider 改形会让该 provider 降级为错误行，直到适配器更新。
- 缺少 dsh-pet 时宠物气泡静默不出现——分区功能不受影响。
