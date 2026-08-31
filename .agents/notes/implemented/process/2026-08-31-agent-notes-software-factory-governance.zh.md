# Agent Note: Agent Notes Structure and Software Factory Governance Baseline

Status: implemented

## Problem

随着 `dsh-web` 仓库中自主 Agent 协作规模扩大，出现以下治理痛点：
1. 决策记录存在非标准类别目录（`bugfix/`、`docs/`、`enhancement/`），偏离了 Agent Notes 规范定义的封闭分类集。
2. 不稳定的 Prompt 前缀导致服务端 KV Cache 频繁失效，推高了跨会话上下文开销。
3. CI 或本地门禁报错时缺乏确定性排查流程，偶发投机性重构或盲目重试导致回归震荡。
4. 子 Agent 派发缺乏明确的 Pareto 模型分级，导致高规格推理模型被浪费在机械搜索和文档翻译等简单任务上。

## Decision

全面升级并落地 Agent Notes 与软件工厂治理底座：
1. **目录结构规范化**：将 `bugfix/`、`docs/`、`enhancement/` 下的旧记录分别迁移至标准类别（`bug-fix/`、`process/`、`feature/`），消除非标准目录。
2. **Prompt 分层与缓存优化标准**：确立 3 层架构，将静态全局规则（Layer 1）与仓库元数据（Layer 2）与动态尾部上下文（Layer 3）分离，最大化 KV Cache 命中率。
3. **CI 自愈规范**：建立失败修复的 4 步确定性闭环（精准归因 -> 本地最小复现 -> 最小补丁修复 -> 全量门禁前置验证）。
4. **Pareto 模型分级与反震荡**：强制要求日常只读调研、文件搜索和文档同步优先使用轻量高性价比模型（`flash`/`flash_lite`），仅主架构设计与疑难根因分析使用 `pro`；引入 3 次重试失败即熔断并请求澄清的机制。
5. **演进闭环**：确立从单次决策（Note）到沉淀复用（Skill）再到确定性门禁（Gate）的持续演进路径。

## Alternatives considered

- **保留非正式 Note 习惯且不引入软件工厂治理规范**：被否决。非正式规则无法约束上下文膨胀、Prompt 缓存抖动与 Agent 自主循环震荡。
- **在 Prompt 头部注入动态时间戳与临时会话 ID**：被否决。头部动态数据会彻底破坏服务端前缀缓存复用。
- **允许开放式类别目录（如保留 docs、enhancement）**：被否决。无边界分类会导致目录膨胀并破坏 Agent 检索启发式的一致性。

## Consequences

- `.agents/notes/` 下所有记录严格符合 6 大封闭类别标准。
- Agent 会话受益于标准化的 Prompt 分层、低成本子任务分发与确定性自愈纪律。
- 软件工厂演进闭环正式确立，指导后续技能沉淀与门禁构建。
