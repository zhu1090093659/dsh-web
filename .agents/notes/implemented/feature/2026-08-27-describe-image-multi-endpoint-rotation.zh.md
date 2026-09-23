# Agent Note: 图像理解多模型循环轮询与故障转移

Status: implemented

## Problem

使用图像理解（describe_image）的用户常配置免费或按量计费的第三方视觉模型（如智谱 GLM-4V、阿里百炼 Qwen-VL 等）。单一端点在并发或连续交互时容易遭遇服务商的 RPM/TPM 频率限制（HTTP 429）或临时服务不可用，且无法在多个免费配额之间平摊负载（Issue #1234）。

## Decision

在 @linxin666/dsh-tool-describe-image 中引入多端点候选列表、轮询调度与故障转移容灾机制：

- **配置结构**：在 Config 中新增 endpoints 数组（每个端点支持独立的 
ame、\baseURL、model、\apiKey、\apiKeyEnv、\apiStyle、maxOutputTokens、enabled），并支持顶层 \rotationMode（\round-robin 轮询或 \failover 故障转移）与 \retryNextOnFailure（失败顺延重试）。
- **向后完全兼容**：若未配置 endpoints 数组，系统无缝回退到顶层单一 \baseURL + model 配置，既有配置文件与测试无需任何调整。
- **调度引擎**：
  - \round-robin：维护实例内调用游标，按启用端点顺序依次轮换候选模型。
  - \failover：优先使用主端点（列表首项），仅在发生异常时顺序降级。
  - 遇到 429、5xx 或网络故障时，若开启 \retryNextOnFailure（默认开启），自动尝试候选列表中的下一个端点；若全部端点均失败，合并输出所有端点的清晰错误明细。
- **返回模型透明与语义缓存**：执行成功后返回实际响应模型的 ID（output.model）；短时语义缓存以实际调用的模型与图片内容为 key 精准缓存。
- **前端设置卡**：设置卡支持多端点调度策略切换与重试配置，并提供多语言（zh/en）支持。

## Alternatives considered

- **仅支持单个端点配置多个模型 ID（同 BaseURL 切换）**：否决——不同服务商（智谱 vs 阿里百炼 vs OpenAI 兼容中继）具有不同的 Base URL、API Style 与 API Key，仅切换 model id 无法满足跨厂商免费模型循环的需求。
- **由前端客户端执行轮询重试**：否决——describe_image 是 Host 侧由文本模型自主调用的工具，轮询与故障转移必须在 Host 端工具执行阶段完成，避免模型侧工具调用失败造成回合中断。

## Consequences

用户现在可以在多个视觉模型端点之间分摊限流压力并在单点故障时自动容灾，提升了图像理解的稳定性和配额利用率。所有既有单端点配置与用例 100% 保持兼容。新增了针对多端点轮询、故障转移、跳过禁用端点、端点专用 Key 鉴权及全故障汇总的完整单元测试（	ests/rotation.spec.ts）。
