# Agent Note: 梁神模式针对 DeepSeek V4.1 Flash 的改进计划

Status: proposed

[English](2026-09-13-liangshen-v41-flash-improvement-plan.md) | 中文

## Problem

梁神模式组合了简短人格提示、工作区指令、覆盖首轮整个用户回合的原生工具锚定，以及第二轮起的 PTC 呈现。现有证据尚不能证明这套完整策略提高了 DeepSeek V4.1 Flash 的任务成功率。锚定回合的工具目录还会描述完整注册表，而实际请求仅开放四个工具。应先修复这一契约不一致，再评估性能。

本提案接续[四工具锚定与 PTC 语义修正](../../implemented/feature/2026-09-12-liangshen-anchor-tools-and-ptc-refinement.md)、[工作区指令进入系统提示词](../../implemented/feature/2026-09-12-liangshen-agents-md-in-system-prompt.md)和[极简人格与注入式工具目录](../../implemented/feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.md)。保存提案不替代这些已实现决策。如果评测支持新的默认配置，实施时再部分取代受影响的决策并更新交叉链接。

## Proposal

提高经验证的任务完成率，同时减少无效工具调用、人工介入和成本。拆成三个可独立审查的交付：工具契约修复、评测工具与候选配置、由结果支持的默认策略调整。

实施范围限定于梁神模式所属预设、评测工具、针对性测试及相关文档。复用现有配置和官方 NPM SDK。实验通过隔离的预设副本进行，不增加用户可见的预设注册。Shell 实现和宿主拥有的模型路由不属于本计划范围。

## Context & Efficiency Impact

较短的人格提示可能减少指令开销，但节省 token 本身不能证明性能更好。保留工作区指令、计划模式规则，以及完整 SDK 的参数、返回值和调用语义。只有确认权威契约已经覆盖相关含义，才删除重复的目录或程序用法说明。

原生工具 schema 与 PTC SDK 文本的开销不同。应测量实际组装的系统提示、注入消息、schema、缓存使用、输出 token 和整条任务轨迹成本。将文字移到其他消息角色不会使它离开模型上下文，缓存命中也不能证明行为稳定。

工具策略初筛之后，通过现有模型推理强度设置比较质量与成本。不引入首个响应 token 封顶作为锚定机制。根据 smoke 实测，为整批评测设置会话数量、超时和明确的费用预算。

## Implementation stages

### 1. 固定基线与验收指标

记录仓库提交、预设源码哈希、DSH 版本、provider 与模型路由、推理强度、任务版本、权限及工作区状态。将当前实现保留为可复现的参照。

主指标采用独立验证的任务成功率。同时记录回归、指令违反、工具错误、人工介入、耗时、token 使用量，以及包含失败尝试在内的每个成功任务总成本。`we/let me` 分类仅保留为语言风格调试数据。

完成条件：相同任务能够在隔离环境中重复执行，各组配置的精确差异可以核对。

### 2. 修复工具目录准确性

修改 [tool-catalog.mjs](../../../../packages/dsh-liangshen/presets/liangshen/tool-catalog.mjs)，使原生目录只宣告本次请求实际开放的工具。PTC 模式下区分可直接调用的 `run_code` 与通过 SDK 调用的底层工具。保留完整官方契约，修正“首轮只有 shell”等过时陈述。

保留失败回退、压缩恢复和会话隔离机制。在 [tool-catalog.test.ts](../../../../packages/dsh-liangshen/tests/tool-catalog.test.ts) 中针对首轮多步执行、晋升、缺少 code runtime、呈现失败、恢复和压缩补充覆盖。已有测试能够证明的行为直接复用。

完成条件：目录与实际请求工具集合及调用方式一致；原生回退后不会继续宣告 PTC。后续所有实验组共同使用这项正确性修复。

### 3. 准备可独立变化的提示词和工具策略

在 [agent.cordis.yml](../../../../packages/dsh-liangshen/presets/liangshen/agent.cordis.yml) 的实验副本中应用候选人格提示：

- 删除禁止推演具体实现的限制。
- 将发现思考循环立即退出，改为没有新证据时更换方法或使用工具验证。
- 将 PDCA 落实为读取相关代码、实施最小充分修改、验证结果。
- 保留已有注释，仅为不明显的行为补充必要说明。
- 保留工作区指令、计划模式规则与官方 SDK 契约。

候选文案：

```text
Understand the task and inspect relevant files before making changes.
Make the smallest change that satisfies the requirements and workspace instructions.
Reason as deeply as needed, avoiding repetition without new evidence.
Use tools to test uncertain assumptions and verify the result.
Preserve existing comments and explain non-obvious behavior where necessary.
Finish when the requested outcome is verified; report remaining limitations.
```

工具策略复用 `anchorTools` 和 `ptcPresentation`。空锚定列表配合关闭 PTC 会开放完整原生工具集合，不能将它等同于官方 Minimal 或新筛选的精简工具集。

完成条件：可以分别改变人格提示、是否锚定和 PTC 呈现，而无需新增用户可见预设。

### 4. 扩展 runner 并执行分阶段 A/B

扩展 [benchmark-live-run.mjs](../../../../packages/dsh-liangshen/tools/benchmark-live-run.mjs)。它默认的列目录和创建文件任务属于协议 smoke 检查，不能证明通用代码能力提升。[analyze-session.mjs](../../../../packages/dsh-liangshen/tools/analyze-session.mjs) 的语言风格测量与任务结果分开记录。

| 组别 | 人格提示 | 工具策略 | 对照用途 |
| --- | --- | --- | --- |
| B | 当前提示词 | 当前两阶段策略 | 共同契约修复后的基线 |
| P | 候选提示词 | 当前两阶段策略 | B 与 P 隔离提示词影响 |
| T | 候选提示词 | 从首轮使用 PTC | P 与 T 检查锚定是否有益 |
| N | 候选提示词 | 全程原生工具 | T 与 N 比较呈现方式 |
| M | 官方 Minimal | 官方配置 | 外部参照，不用于单因素归因 |

按以下顺序执行评测：

1. 最多先运行 12 次 smoke 会话，验证协议、结果采集和费用估算。
2. 选择 20–30 个代表任务，每组重复至少三次。覆盖代码修复、首轮需要专用工具的任务、多轮修改、失败恢复及工作区指令遵循。
3. 主对照阶段固定模型路由、推理强度、权限和仓库初始状态。初筛后，再针对保留的候选单独比较 `high` 与 `max`。
4. 根据 smoke 估算，在大规模运行前确定总费用、会话数量和超时上限。达到上限停止，不自动扩样。
5. 使用测试、产出文件或明确验收项判断结果。基础设施失败单独记录，并在报告中说明处理方式。
6. 按任务进行配对比较并报告置信区间。小样本用于筛选方向，在声称稳定提升之前按约定预算扩大样本。

完成条件：报告能指出差异来自人格提示、锚定还是 PTC，以及收益是否值得相应成本。完整原生工具呈现不得标记为 Minimal。

### 5. 决定默认值并完成交付

默认值的选择顺序为：任务成功率、指令遵循与人工介入、成本与耗时。

- 如果取消锚定表现更好，将锚定保留为实验配置。
- 如果原生呈现与 PTC 分别适合不同任务，保留可配置选择，并记录观察到的任务类别。
- 如果证据不足以排除退化，落地契约修复并保留当前默认策略。

更新包的中英文 README、配对记录和相关 Agent Note。评测报告保存到 `docs/archive/`。原始凭据和私有会话内容不得进入提交的报告。

交付时运行所属包测试和要求的 `pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check`，根据最终 diff 增补生成与构建产物检查。当前仅保存文档的改动，检查 Markdown 结构、链接、双语配对和空白错误。

评测使用隔离的 headless 会话，不中断或重启运行中的 DSH 服务。如果交付的预设组合变更需要重新加载，明确注明需要用户重启 DSH 服务后生效。

完成条件：选定配置具备可复现证据，文档与实际交付行为一致，要求的检查都有真实结果记录。

## Evidence references

[DeepSeek R1 论文](https://arxiv.org/html/2501.12948v1)、[DeepSeek V3.2 论文](https://arxiv.org/html/2512.02556v1)、[V4.1 Flash 技术报告](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/DeepSeek_V41_Tech_Report.pdf)、[官方 V4.1 Flash 模型卡](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)和[思考模式 API 文档](https://api-docs.deepseek.com/guides/thinking_mode/)为候选策略提供依据。这些资料没有评测本项目当前的梁神模式组合。

[anchored-standard 来源项目](https://github.com/xiaobright/dsh-anchored-standard)说明了其针对 V4 Pro 的调优背景和 Flash 证据的局限。这些观察支持开展实验，不能视为 V4.1 Flash 必然提升的证明。

## Alternatives considered

暂缓直接将关闭锚定和 PTC 设为新默认：现有证据不能确定普遍最优配置，同时改变两者也会混淆各自影响。

不选择所有会话统一使用 PTC：批量调用和结果筛选的收益需要与任务成功率、工具契约开销一起衡量。

不恢复 1024-token 首轮封顶，也不使用 `we/let me` 作为晋升或成功判据：截断和输出风格不能证明正确性。

不为复刻裸 Minimal 提示而删除工作区指令或缩减 SDK schema：必要指令与工具语义属于任务契约。

不新建评测框架，也不额外注册公开预设：现有 runner 和配置字段可以用更小改动表达所需对照。

## Acceptance criteria

- 原生与 PTC 目录宣告和实际请求工具面一致，覆盖首轮执行、回退、恢复和压缩。
- 工作区指令、计划模式、SDK 契约和会话隔离的既有行为仍有覆盖。
- 每组对照记录源码与运行配置，使用独立验证的任务结果，并将风格指标分开。
- 报告涵盖不确定性、基础设施失败、费用上限以及质量与资源的取舍。
- 默认值调整遵循上述证据规则；结果不确定时保留当前策略。
- 实施时同步交付文档配对、决策记录与适用的验证证据。

## Risks

任务集过小或缺乏代表性，可能选出会使其他任务退化的配置。Provider 路由和模型更新也可能改变结果，因此需要记录运行日期与路由，并让对照运行在足够接近的时间内完成。

提示词与工具变化可能相互影响。当前矩阵隔离了指定对照，未覆盖所有交互作用；胜出组合成为默认值前可能需要针对性复测。

PTC 在压缩中间输出时可能遗漏下一步决策需要的证据；取消锚定则可能从首轮就暴露更多 schema。两者都需要测量，不能仅根据提示词长度判断。

完整样本可能产生较高费用。开始付费评测之前，应根据 smoke 估算和明确上限确定可执行预算。本文记录的是计划，不代表实施或真实 A/B 已完成。
