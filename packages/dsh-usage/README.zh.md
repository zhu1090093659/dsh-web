# dsh-usage

[English](README.md) | 中文

dsh Web GUI 的使用统计插件：多 provider 余额与编程套餐用量检测，外加实时 token 用量台账。

## 功能

插件由宿主侧服务与设置页一级分区（使用统计，位于创意工坊下方）组成：

- **用量页签**：今日 token 分桶合计（输入 / 输出 / 缓存读 / 缓存写，按 provider 上报口径互不相加），分 provider 与模型细分，近 30 天以「提供方-模型」水平条形图展示，以及所有已配置 provider 的余额（同一适配器家族只渲染一行：被该家族运行时路由遮蔽的休眠目录别名不再单独出余额行）。对 DeepSeek 官方路由，页签还展示当前峰谷计价时段（北京时间工作日 09:00-12:00、14:00-18:00 为高峰，按双倍计费）与今日消费估算（CNY）。台账从 `session/event` 实时流折叠（`request/header` 归因路由 + `assistant/message` 用量），持久化到 `$DSH_HOME/dsh-usage/usage-ledger.json`，按本地日保留；统计自插件首次启用起计。
- **个人套餐页签**：每个已配置且暴露套餐端点的 provider 的配额窗口——已用百分比与重置时间（Kimi For Coding 5 小时/每周、GLM 编程计划 5 小时/每周/每月、OpenCode Go 滚动/每周/每月、MiniMax 5 小时/每周、Codex / ChatGPT 订阅 5 小时/每周）。没有真实套餐/订阅体系的厂商（DeepSeek、ZenMux、Moonshot、OpenRouter、SiliconFlow）不出现在此页签，其余额显示在用量页签。
- **Token 银行页签**：以 DeepSeek 官方家族的台账用量铸造「鲸元券」，汇率按 100 万 tokens 兑 1 鲸元（防膨胀）。页签把该家族保留台账内的 token 总量（`deepseek` 目录别名与运行时路由 `deepseek-official` 合并计算）折算成票面面额印在钞票图上，附带走票窗口的序列号行，并提供保存图片按钮与（浏览器支持文件分享时的）系统分享按钮。消费行优先展示从官方余额观测到的真实累计花费——余额下降即计为消费，充值上涨不计——首次观测到下降之前回落为折叠时刻估算。铸造总量优先取宿主的全台账聚合，旧宿主回落为近 30 天；无官方用量时展示空状态。票面文字与语言无关（数字、拉丁小字、ISO 日期），导出图在浏览器本地渲染。
- 探测完全在宿主侧按轮询周期执行（默认 60 秒，可手动刷新）；API key 经宿主凭据缝解析（`llm-pi-ai` 记录、`apiKeyEnv` 引用），永不进入浏览器。

支持的余额端点：DeepSeek（官方运行时路由 `deepseek-official` 与目录别名 `deepseek` 均可解析）、Moonshot（国内/国际）、OpenRouter、SiliconFlow（国内/国际）、ZenMux。支持的套餐端点：Kimi For Coding、GLM 编程计划（国内 open.bigmodel.cn、国际 api.z.ai——即 pi-ai 目录注册的 `zai` 路由，另兼容 `zai-coding` / `zai-coding-cn` 别名；覆盖 5 小时 / 每周 / 每月窗口与 token 制、积分制套餐）、OpenCode Go、MiniMax、Codex / ChatGPT 订阅（OAuth access token 取自 pi-ai grant；token 过期时显示错误行，宿主下次跑 Codex 请求自动刷新后恢复）。没有程序化端点的 provider（Qwen token 套餐、OpenCode Zen 按量、Anthropic、OpenAI）仅列出，不展示数据。

### 消费估算口径

今日消费是折叠时刻按 DeepSeek 公布的峰谷价目表（CNY / 百万 tokens；高峰即上表时段，空闲为高峰一半）做出的估算。当前生效的是 `deepseek-flash`（DeepSeek-V4.1-Flash）与 `deepseek-v4-pro` 两档：已下线的 flash 系列 id（`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`）按 flash 档计价，`deepseek-v4-pro` 在北京时间 2026-09-14 12:00 被 DeepSeek 路由到 V4.1-Flash 后同样按该档计价。

估算仅覆盖 DeepSeek 官方路由——其他渠道转发的流量（ZenMux、SiliconFlow 等）不计价；未识别的 DeepSeek 模型 id 按 flash 档估算。价目表调整前记录的桶保留旧价，因此调价从发布时点起生效，不追溯历史数据。

## 安装

要求 DSH 0.1.7-alpha.1 或更高：插件基于 0.1.7-alpha.1 DSH cohort 开发（其设置页即宿主根据插件自身 Config schema 生成的页面），`@deepseek-ai/*` 运行时导入由宿主本体提供。

在 profile（如 `~/.dsh/profiles/web`）中：

```bash
pnpm add @linxin666/dsh-usage
```

并插入 `cordis.patch.yml`（或使用 bundle patch）：

```yaml
- insert:
    - id: usage
      name: '@linxin666/dsh-usage'
```

宿主半区需要重启 `dsh web`；客户端半区刷新页面即生效。分区入口在 `设置 -> 使用统计`。

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；关闭后不监听、不探测、不注册路由 |
| `pollIntervalSec` | `60` | provider 探测周期（30-3600 秒；改动由宿主重载插件行生效） |
| `retainDays` | `180` | 台账按本地日保留天数（7-730） |

## 已知限制

- 用量统计自插件首次启用起计，不回填历史会话。
- OAuth 类路由（如 qwen OAuth 授权）仅识别类型，不做探测；插件不消耗第三方 OAuth 额度。
- 探测失败时保留上一次数据并展示错误行；过于频繁的轮询可能触发 provider 限流。
- 鲸元券面额只覆盖台账保留窗口（`retainDays`）内的用量：被清理的天同时退出趋势图与票面。
- 真实花费观测从第一次官方余额观测开始：更早的消费不回补，且只有观测到的余额下降才累计（余额上涨是充值，永不计费）。
