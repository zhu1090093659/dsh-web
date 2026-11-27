# Agent Note: dsh-usage 设置描述符快照（#2100）

Status: implemented

## 问题

`@linxin666/dsh-usage` 由两个浏览器卡片轮询自己的 `/api/dsh-usage/overview` 路由（用量 section 每 10s、侧栏底部卡每 30s）。每份文档为每条 provider 路由拼一行，而每条路由都要读取外部设置命名空间 `llm-pi-ai` 与 `llm-deepseek`，取出各自的 `apiKeyEnv`/`baseURL`。

这条读路径走 `readNamespace`，它的第一个分支是 0.1.7 之前的 `settings.get(ns)`。而现代宿主把 `settings` 挂成 `SettingsForms`，只暴露 `describe`、`update`、`replace`、`mutate`，**没有 `get`**，因此快路径永不命中，每次读取都落到 `settings.describe({ redactSecrets: false })`：遍历全部 profile 条目，并让每个条目的 schema 经 schemastery 逐项解析。每路由一次读取意味着单份 overview 文档就要十几次全量扫描，而运行中的宿主还要按两个卡片的节奏反复支付。

42 条 profile 上的实测（DSH 0.2.2，macOS，Node inspector 36.6s 采样）：`@linxin666/dsh-usage` inclusive 占宿主 CPU 25.2%，`schemastery.resolve` self 19.4%，宿主事件循环阻塞占墙钟 23.9%。读取逻辑本身是正确的，缺陷只在代价，所以修复必须完整保留 [#1739 解决](2026-09-27-open-issues-resolution-1736-1739-1729.md) 里确立的每一条命名空间解析规则。

## 决策

`packages/dsh-usage/src/host/usage-service.ts` 为每个服务实例保留一份设置描述符快照：

- 模块级解析器改名为 `readSettingsNamespace`，第三个参数是 `descriptors` 提供者；服务传入 `() => this.settingsDescriptors()`，于是同一个轮询周期、同一份 overview 文档、同一次凭证解析里的每次读取都共享同一份 `describe()` 结果，而不是各扫一遍。
- `settingsDescriptors()` 把描述符行记在 `descriptorSnapshot` 上，只有当 `DESCRIPTOR_CACHE_TTL_MS`（30s）过期时才重新扫描。
- `start()` 订阅宿主的 `settings/document-updated` 事件并丢弃快照，因此配置改动在下一次读取即可见，而不必等 TTL；`stop()` 与 session 监听一并释放该订阅。
- 空描述符列表永不入缓存：启动阶段尚未就绪的设置不得把空 profile 钉住整个窗口。
- `describe()` 抛错时清空快照并按「无描述符」处理，保持轮询循环绝不抛出的约定。

解析顺序本身未变：0.1.7 之前的 `settings.get(ns)`、描述符快照、活跃 loader 条目、`configEditor.configuration()`。

## 备选方案

**优先走 `settings.get(ns)`、只为兜底才 `describe()`**（issue 的第一条建议）正是代码原本的做法，但它救不了：现代宿主挂载的服务没有 `get`。该分支仅作为旧版本兼容保留。

**把快照限定在单次请求内**——只把一份描述符列表串进 `overview()`——能消除按路由放大，但每次浏览器轮询（两个卡片）和每个探测周期仍然各付一次全量 profile 扫描。浪费不在文档内部重复，而在于相隔数秒到达的两份文档之间什么都不共享。

**给拼装好的 overview 文档加自己的 TTL 缓存**（issue 第三条建议）会连带冻结本来该在两次轮询之间变化的余额、套餐窗口与账本汇总，`refresh()` 还得为此开一条旁路。昂贵的是 profile 扫描而非文档拼装，所以缓存落在描述符层。

**只放宽客户端轮询间隔**（issue 最后一条建议：60s/120s）是用时效换 CPU，那是报告者自述的临时缓解而非修复；两个卡片本来就都会在标签页隐藏时暂停，代价并非来自节奏。

**只依赖 `settings/document-updated`、不要 TTL**：若改动发生在 `start()` 订阅之前，或宿主根本不发该事件，快照会永久过期；TTL 是把这种过期限制在一个窗口内的下限。

## 后果

- 同时服务两个卡片并探测所有 provider 的宿主，现在每分钟最多两次 profile 扫描，而非每次轮询数十次——这正是本条要关闭的 CPU 回归。
- 只供探测使用的配置事实（`apiKeyEnv`、`baseURL`）在宿主不广播的改动上最多滞后 30s；被广播的改动用下一次读取即生效。
- 启动时序不变：空 profile 会在下一次读取重试，设置服务一应答，provider 行就出现。
- 快照属于服务实例，插件重载（宿主会因配置改动重建该行）从一次全新的扫描开始。

## 测试

- `packages/dsh-usage/tests/usage-service.spec.ts` 新增 `settings descriptor snapshot (#2100)` 一组：无论路由数量多少，一份 overview 只扫描一次 profile；`settings/document-updated` 让快照在下一次读取前失效；无事件时按 TTL 过期重扫；空扫描会被重试，迟到的 `llm-deepseek` `baseURL` 仍然生效。
- 包内 `npx vitest run` 16 个文件 220 项通过；`tsgo --noEmit` 与 `tsgo -p tsconfig.test.json` 均干净。
